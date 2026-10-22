import { validateConnection, VaultError, type Connection } from './connection';

export { VaultError } from './connection';
export type { VaultErrorCode } from './connection';

export interface VaultRecord {
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; keyBits: 256; tagBits: 128 };
  paddedBytes: 16384;
  wrap: { iv: string; ciphertext: string };
  payload: { iv: string; ciphertext: string };
}

const PADDED_BYTES = 16384;
const MIN_ITERATIONS = 600_000;
const MAX_ITERATIONS = 2_000_000;
const encoder = new TextEncoder();

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decode(value: unknown, minimum: number, maximum = minimum): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(maximum / 3) ||
    value.length < 4 * Math.ceil(minimum / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error();
  }
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length < minimum || bytes.length > maximum || encode(bytes) !== value) throw new Error();
  return bytes;
}

function fields(input: unknown, names: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some((key) => typeof key !== 'string' || !names.includes(key))) {
    throw new Error();
  }
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error();
    result[name] = descriptor.value;
  }
  return result;
}

// Snapshot validated scalar fields before the first await; callers cannot mutate the crypto context.
function parseRecord(input: unknown): VaultRecord {
  try {
    const record = fields(input, ['version', 'kdf', 'cipher', 'paddedBytes', 'wrap', 'payload']);
    const kdf = fields(record.kdf, ['name', 'hash', 'iterations', 'salt']);
    const cipher = fields(record.cipher, ['name', 'keyBits', 'tagBits']);
    const wrap = fields(record.wrap, ['iv', 'ciphertext']);
    const payload = fields(record.payload, ['iv', 'ciphertext']);
    if (record.version !== 1 || record.paddedBytes !== PADDED_BYTES ||
      kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' ||
      typeof kdf.iterations !== 'number' || !Number.isSafeInteger(kdf.iterations) ||
      kdf.iterations < MIN_ITERATIONS || kdf.iterations > MAX_ITERATIONS ||
      cipher.name !== 'AES-GCM' || cipher.keyBits !== 256 || cipher.tagBits !== 128) throw new Error();
    decode(kdf.salt, 16, 64);
    decode(wrap.iv, 12);
    decode(payload.iv, 12);
    decode(wrap.ciphertext, 48);
    decode(payload.ciphertext, PADDED_BYTES + 16);
    return {
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: kdf.salt as string },
      cipher: { name: 'AES-GCM', keyBits: 256, tagBits: 128 },
      paddedBytes: PADDED_BYTES,
      wrap: { iv: wrap.iv as string, ciphertext: wrap.ciphertext as string },
      payload: { iv: payload.iv as string, ciphertext: payload.ciphertext as string },
    };
  } catch {
    throw new VaultError('invalid_vault');
  }
}

export function isVaultRecord(input: unknown): input is VaultRecord {
  try { parseRecord(input); return true; } catch { return false; }
}

function validPassword(password: string): boolean {
  return typeof password === 'string' && password.length >= 12 && password.length <= 1024 &&
    !/[\ud800-\udfff]/u.test(password);
}

// Fixed order and separate purposes authenticate the full header and both nonces without ciphertext circularity.
function aad(record: VaultRecord, purpose: 'wrap' | 'payload'): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify([
    'linkwarden-sync/vault', purpose, record.version,
    record.kdf.name, record.kdf.hash, record.kdf.iterations, record.kdf.salt,
    record.cipher.name, record.cipher.keyBits, record.cipher.tagBits,
    record.paddedBytes, record.wrap.iv, record.payload.iv,
  ]));
}

async function wrappingKey(password: string, record: VaultRecord, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const bytes = encoder.encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({
      name: 'PBKDF2', hash: 'SHA-256', iterations: record.kdf.iterations, salt: decode(record.kdf.salt, 16, 64),
    }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
  } finally {
    bytes.fill(0);
  }
}

function parameters(record: VaultRecord, purpose: 'wrap' | 'payload'): AesGcmParams {
  return { name: 'AES-GCM', iv: decode(record[purpose].iv, 12), additionalData: aad(record, purpose), tagLength: 128 };
}

export async function createVault(connection: Connection, password: string): Promise<VaultRecord> {
  const validated = validateConnection(connection);
  if (!validPassword(password)) throw new VaultError('weak_password');
  const encoded = encoder.encode(JSON.stringify(validated));
  const padded = new Uint8Array(PADDED_BYTES);
  let rawKey: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (encoded.length > PADDED_BYTES - 4) throw new VaultError('invalid_connection');
    new DataView(padded.buffer).setUint32(0, encoded.length, false);
    padded.set(encoded, 4);
    const record: VaultRecord = {
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: MIN_ITERATIONS, salt: encode(crypto.getRandomValues(new Uint8Array(32))) },
      cipher: { name: 'AES-GCM', keyBits: 256, tagBits: 128 },
      paddedBytes: PADDED_BYTES,
      wrap: { iv: encode(crypto.getRandomValues(new Uint8Array(12))), ciphertext: '' },
      payload: { iv: encode(crypto.getRandomValues(new Uint8Array(12))), ciphertext: '' },
    };
    const kek = await wrappingKey(password, record, 'encrypt');
    const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', dek));
    record.payload.ciphertext = encode(new Uint8Array(await crypto.subtle.encrypt(parameters(record, 'payload'), dek, padded)));
    record.wrap.ciphertext = encode(new Uint8Array(await crypto.subtle.encrypt(parameters(record, 'wrap'), kek, rawKey)));
    return record;
  } finally {
    encoded.fill(0);
    padded.fill(0);
    rawKey?.fill(0);
    // JavaScript strings, CryptoKeys and runtime copies cannot be reliably erased.
  }
}

export async function openVault(input: unknown, password: string): Promise<Connection> {
  const record = parseRecord(input);
  if (!validPassword(password)) throw new VaultError('unlock_failed');
  let rawKey: Uint8Array<ArrayBuffer> | undefined;
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    const kek = await wrappingKey(password, record, 'decrypt');
    rawKey = new Uint8Array(await crypto.subtle.decrypt(parameters(record, 'wrap'), kek, decode(record.wrap.ciphertext, 48)));
    if (rawKey.length !== 32) throw new Error();
    const dek = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    plaintext = new Uint8Array(await crypto.subtle.decrypt(parameters(record, 'payload'), dek, decode(record.payload.ciphertext, PADDED_BYTES + 16)));
    if (plaintext.length !== PADDED_BYTES) throw new Error();
    const length = new DataView(plaintext.buffer).getUint32(0, false);
    if (length === 0 || length > PADDED_BYTES - 4 || plaintext.subarray(4 + length).some((byte) => byte !== 0)) throw new Error();
    return validateConnection(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext.subarray(4, 4 + length))) as unknown);
  } catch {
    throw new VaultError('unlock_failed');
  } finally {
    rawKey?.fill(0);
    plaintext?.fill(0);
  }
}
