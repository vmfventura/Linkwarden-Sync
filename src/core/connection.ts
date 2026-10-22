export interface Connection {
  url: string;
  token: string;
}

export type VaultErrorCode =
  | 'invalid_vault'
  | 'unlock_failed'
  | 'weak_password'
  | 'invalid_connection';

const messages: Record<VaultErrorCode, string> = {
  invalid_vault: 'The vault record is invalid.',
  unlock_failed: 'The vault could not be unlocked.',
  weak_password: 'The password must contain between 12 and 1024 characters.',
  invalid_connection: 'The connection is invalid.',
};

export class VaultError extends Error {
  constructor(public readonly code: VaultErrorCode) {
    super(messages[code]);
    this.name = 'VaultError';
  }
}

export function canonicalInstanceUrl(input: string): string {
  try {
    if (
      typeof input !== 'string' || input.length === 0 || input.length > 2048 ||
      !/^https:\/\/[^/]+/i.test(input) || /[\s\u0000-\u001f\u007f-\u009f\\?#]/u.test(input) ||
      /%(?![\da-f]{2})/i.test(input) || /[\ud800-\udfff]/u.test(input)
    ) throw new Error();
    const authority = input.slice(input.indexOf('://') + 3).split('/')[0]!;
    const url = new URL(input);
    if (authority.includes('@') || url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      throw new Error();
    }
    const result = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    if (result.length > 2048) throw new Error();
    return result;
  } catch {
    throw new VaultError('invalid_connection');
  }
}

export function validateConnection(input: unknown): Connection {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error();
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes('url') || !keys.includes('token')) throw new Error();
    const url = Object.getOwnPropertyDescriptor(input, 'url');
    const token = Object.getOwnPropertyDescriptor(input, 'token');
    if (!url || !token || !('value' in url) || !('value' in token) ||
      typeof token.value !== 'string' || token.value.trim().length === 0 || token.value.length > 4096 ||
      /[^\x20-\x7e]/u.test(token.value)) {
      throw new Error();
    }
    return { url: canonicalInstanceUrl(url.value as string), token: token.value as string };
  } catch {
    throw new VaultError('invalid_connection');
  }
}

export function originPattern(url: string): string {
  return `${new URL(canonicalInstanceUrl(url)).origin}/*`;
}

export function permissionPattern(url: string, browserName: string): string {
  const parsed = new URL(canonicalInstanceUrl(url));
  // Firefox match patterns cannot restrict ports. Fetch still uses the exact stored URL.
  if (browserName === 'firefox') parsed.port = '';
  return `${parsed.origin}/*`;
}
