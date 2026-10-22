import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createVault, isVaultRecord, openVault, VaultError, type VaultRecord } from '../src/core/vault';

const password = 'correct horse battery staple';
const connection = { url: 'https://example.com:8443/linkwarden', token: 'opaque-super-secret-token' };
let record: VaultRecord;

function changed(update: (copy: VaultRecord) => void): VaultRecord {
  const copy = structuredClone(record);
  update(copy);
  return copy;
}

function flip(value: string): string {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  bytes[0] = bytes[0]! ^ 1;
  return btoa(String.fromCharCode(...bytes));
}

beforeAll(async () => { record = await createVault(connection, password); });
afterEach(() => { vi.restoreAllMocks(); });

describe('vault encryption', () => {
  it('roundtrips through JSON with the versioned fixed-length envelope', async () => {
    expect(isVaultRecord(record)).toBe(true);
    expect(await openVault(JSON.parse(JSON.stringify(record)), password)).toEqual(connection);
    expect(record.kdf.iterations).toBe(600_000);
    expect(atob(record.kdf.salt)).toHaveLength(32);
    expect(atob(record.wrap.iv)).toHaveLength(12);
    expect(atob(record.payload.iv)).toHaveLength(12);
    expect(atob(record.wrap.ciphertext)).toHaveLength(48);
    expect(atob(record.payload.ciphertext)).toHaveLength(16384 + 16);
    for (const secret of [password, connection.url, connection.token, 'example.com']) {
      expect(JSON.stringify(record)).not.toContain(secret);
    }
  });

  it('uses independent fresh salts, nonces and ciphertexts', async () => {
    const second = await createVault(connection, password);
    expect(second.kdf.salt).not.toBe(record.kdf.salt);
    expect(new Set([record.wrap.iv, record.payload.iv, second.wrap.iv, second.payload.iv]).size).toBe(4);
    expect(second.wrap.ciphertext).not.toBe(record.wrap.ciphertext);
    expect(second.payload.ciphertext).not.toBe(record.payload.ciphertext);
  });

  it('supports UTF-8 and preserves password whitespace without normalization', async () => {
    const unicode = { url: 'https://example.com/café/', token: 'opaque ASCII token ' };
    const spaced = '  pãssword 🔒 secret  ';
    const encrypted = await createVault(unicode, spaced);
    expect(await openVault(encrypted, spaced)).toEqual({ ...unicode, url: 'https://example.com/caf%C3%A9' });
    await expect(openVault(encrypted, spaced.trim())).rejects.toEqual(new VaultError('unlock_failed'));
  });

  it('fits maximum-length connection data and pads different sizes identically', async () => {
    const large = { url: `https://example.com/${'a'.repeat(2028)}`, token: 'x'.repeat(4096) };
    const encrypted = await createVault(large, password);
    expect(await openVault(encrypted, password)).toEqual(large);
    expect(encrypted.payload.ciphertext.length).toBe(record.payload.ciphertext.length);
  });

  it('keeps imported password material and the derived wrapping key nonextractable', async () => {
    const imported = vi.spyOn(crypto.subtle, 'importKey');
    const derived = vi.spyOn(crypto.subtle, 'deriveKey');
    await openVault(record, password);
    expect(imported.mock.calls[0]?.[3]).toBe(false);
    expect(derived.mock.calls[0]?.[3]).toBe(false);
    expect(imported.mock.calls.at(-1)?.[3]).toBe(false);
    expect((await derived.mock.results[0]!.value).extractable).toBe(false);
    const encodedPassword = imported.mock.calls[0]?.[1] as Uint8Array;
    const rawDek = imported.mock.calls.at(-1)?.[1] as Uint8Array;
    expect(encodedPassword.every((byte) => byte === 0)).toBe(true);
    expect(rawDek.every((byte) => byte === 0)).toBe(true);
  });

  it('snapshots input before awaiting crypto', async () => {
    const copy = structuredClone(record);
    const opening = openVault(copy, password);
    copy.kdf.iterations = 1;
    copy.payload.ciphertext = '';
    expect(await opening).toEqual(connection);
  });

  it.each(['wrong password entirely', '', 'short', 'x'.repeat(1025)])('returns a generic unlock error for incorrect passwords %#', async (wrong) => {
    await expect(openVault(record, wrong)).rejects.toEqual(new VaultError('unlock_failed'));
  });

  it.each(['', 'short', 'x'.repeat(11), 'x'.repeat(1025), '\ud800'.repeat(12)])('rejects invalid creation passwords before crypto %#', async (weak) => {
    const cryptoCall = vi.spyOn(crypto.subtle, 'importKey');
    await expect(createVault(connection, weak)).rejects.toEqual(new VaultError('weak_password'));
    expect(cryptoCall).not.toHaveBeenCalled();
  });

  it('rejects invalid connection input before crypto', async () => {
    const cryptoCall = vi.spyOn(crypto.subtle, 'importKey');
    await expect(createVault({ ...connection, url: 'http://example.com' }, password)).rejects.toEqual(new VaultError('invalid_connection'));
    expect(cryptoCall).not.toHaveBeenCalled();
  });
});

describe('vault integrity and parsing', () => {
  it.each([
    ['salt', (copy: VaultRecord) => { copy.kdf.salt = flip(copy.kdf.salt); }],
    ['wrap nonce', (copy: VaultRecord) => { copy.wrap.iv = flip(copy.wrap.iv); }],
    ['payload nonce', (copy: VaultRecord) => { copy.payload.iv = flip(copy.payload.iv); }],
    ['wrap ciphertext', (copy: VaultRecord) => { copy.wrap.ciphertext = flip(copy.wrap.ciphertext); }],
    ['payload ciphertext', (copy: VaultRecord) => { copy.payload.ciphertext = flip(copy.payload.ciphertext); }],
    ['valid-cost KDF header', (copy: VaultRecord) => { copy.kdf.iterations++; }],
  ] as const)('returns the same generic error for tampered %s', async (_name, update) => {
    await expect(openVault(changed(update), password)).rejects.toEqual(new VaultError('unlock_failed'));
  });

  it.each([0, -1, 599_999, 2_000_001, 1e15, NaN, Infinity, 600_000.5])('rejects out-of-bounds KDF cost %s before crypto', async (iterations) => {
    const imported = vi.spyOn(crypto.subtle, 'importKey');
    const derived = vi.spyOn(crypto.subtle, 'deriveKey');
    await expect(openVault(changed((copy) => { copy.kdf.iterations = iterations; }), password)).rejects.toEqual(new VaultError('invalid_vault'));
    expect(imported).not.toHaveBeenCalled();
    expect(derived).not.toHaveBeenCalled();
  });

  it('rejects unknown fields, algorithms, versions, malformed base64 and size violations before crypto', async () => {
    const invalid: unknown[] = [
      null, undefined, [], {}, { ...record, version: 2 }, { ...record, paddedBytes: 8192 },
      { ...record, extra: true }, { ...record, kdf: { ...record.kdf, extra: true } },
      { ...record, cipher: { ...record.cipher, extra: true } },
      { ...record, wrap: { ...record.wrap, extra: true } },
      { ...record, payload: { ...record.payload, extra: true } },
      { ...record, kdf: { ...record.kdf, name: 'scrypt' } },
      { ...record, kdf: { ...record.kdf, hash: 'SHA-1' } },
      { ...record, cipher: { ...record.cipher, name: 'AES-CBC' } },
      { ...record, cipher: { ...record.cipher, keyBits: 128 } },
      { ...record, cipher: { ...record.cipher, tagBits: 96 } },
      { ...record, kdf: { ...record.kdf, iterations: '600000' } },
      ...['', '!!!!', 'A'.repeat(88), btoa('x'.repeat(15)), btoa('x'.repeat(65)), `${record.kdf.salt}\n`].map((salt) => ({ ...record, kdf: { ...record.kdf, salt } })),
      ...['', btoa('x'.repeat(11)), btoa('x'.repeat(13))].map((iv) => ({ ...record, wrap: { ...record.wrap, iv } })),
      ...['', 'A'.repeat(1_000_000), record.payload.ciphertext.slice(4)].map((ciphertext) => ({ ...record, payload: { ...record.payload, ciphertext } })),
      { ...record, wrap: { ...record.wrap, ciphertext: btoa('x'.repeat(49)) } },
      { ...record, [Symbol('unknown')]: true },
      Object.create(record),
      { ...record, get kdf(): never { throw new Error('secret'); } },
    ];
    const imported = vi.spyOn(crypto.subtle, 'importKey');
    for (const input of invalid) {
      expect(isVaultRecord(input)).toBe(false);
      await expect(openVault(input, password)).rejects.toEqual(new VaultError('invalid_vault'));
    }
    expect(imported).not.toHaveBeenCalled();
  });

  it('accepts supported KDF bounds structurally without deriving keys', () => {
    expect(isVaultRecord(changed((copy) => { copy.kdf.iterations = 2_000_000; }))).toBe(true);
    expect(isVaultRecord(changed((copy) => { copy.kdf.salt = btoa('a'.repeat(16)); }))).toBe(true);
    expect(isVaultRecord(changed((copy) => { copy.kdf.salt = btoa('a'.repeat(64)); }))).toBe(true);
  });
});
