import { describe, expect, it } from 'vitest';
import { canonicalInstanceUrl, originPattern, permissionPattern, validateConnection, VaultError } from '../src/core/connection';

describe('connection validation', () => {
  it('canonicalizes HTTPS origins and optional base paths', () => {
    expect(canonicalInstanceUrl('HTTPS://EXAMPLE.com:443/base///')).toBe('https://example.com/base');
    expect(canonicalInstanceUrl('https://example.com/')).toBe('https://example.com');
    expect(canonicalInstanceUrl('https://example.com:8443/a/b/')).toBe('https://example.com:8443/a/b');
    expect(canonicalInstanceUrl('https://例え.jp/café/')).toBe('https://xn--r8jz45g.jp/caf%C3%A9');
    expect(originPattern('https://example.com:8443/base/')).toBe('https://example.com:8443/*');
    expect(originPattern('https://[::1]:8443/base')).toBe('https://[::1]:8443/*');
  });

  it.each([
    '', ' ', 'http://example.com', 'ftp://example.com', 'https://', 'example.com',
    'https:example.com', 'https:///example.com', 'https://u:p@example.com', 'https://@example.com',
    'https://example.com?', 'https://example.com?q=secret', 'https://example.com#',
    'https://example.com/#secret', ' https://example.com', 'https://example.com\n',
    'https://example.com/a b', 'https://example.com\\evil', 'https://example.com/%zz',
    'https://example.com:99999', 'https://[bad]', 'https://example.com/\ud800',
    `https://example.com/${'a'.repeat(2048)}`, `https://example.com/${'é'.repeat(500)}`,
  ])('rejects invalid URL %# without including it in errors', (url) => {
    expect(() => canonicalInstanceUrl(url)).toThrowError(new VaultError('invalid_connection'));
    expect(() => originPattern(url)).toThrowError(new VaultError('invalid_connection'));
  });

  it('keeps the configured fetch port while adapting Firefox permission patterns', () => {
    expect(permissionPattern('https://nas.example:8443/base', 'firefox')).toBe('https://nas.example/*');
    expect(permissionPattern('https://nas.example:8443/base', 'chrome')).toBe('https://nas.example:8443/*');
  });

  it('preserves opaque printable ASCII tokens', () => {
    expect(validateConnection({ url: 'https://example.com/', token: '  opaque ASCII token  ' })).toEqual({
      url: 'https://example.com', token: '  opaque ASCII token  ',
    });
    expect(validateConnection({ url: 'https://example.com', token: 'x'.repeat(4096) }).token).toHaveLength(4096);
  });

  it.each([
    null, undefined, [], {}, { url: 'https://example.com' },
    { url: 'https://example.com', token: 'ok', extra: true },
    ...['', '   ', 'unicode-🗝️', 'x\ny', 'x\ty', 'x\0y', 'x\u007fy', 'x\u0085y', 'x'.repeat(4097), '\ud800', 123].map((token) => ({ url: 'https://example.com', token })),
    { url: null, token: 'ok' }, { url: 12, token: 'ok' },
  ])('rejects invalid connections %# with a stable error', (value) => {
    expect(() => validateConnection(value)).toThrowError(new VaultError('invalid_connection'));
  });

  it('does not invoke property getters or return the caller object', () => {
    const getter = { url: 'https://example.com', get token(): string { throw new Error('private'); } };
    expect(() => validateConnection(getter)).toThrowError(new VaultError('invalid_connection'));
    const input = { url: 'https://example.com', token: 'secret' };
    expect(validateConnection(input)).not.toBe(input);
  });
});
