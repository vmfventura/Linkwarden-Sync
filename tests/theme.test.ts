import { describe, expect, it, vi } from 'vitest';
import { createThemeStore, themePreference, THEME_KEY } from '../src/core/theme';

describe('non-secret appearance preference', () => {
  it.each(['system', 'light', 'dark'] as const)('accepts the explicit %s preference', value => {
    expect(themePreference(value)).toBe(value);
  });
  it.each([undefined, null, '', true, 0, 'DARK', 'https://private.test', {}, ['dark']])('defaults malformed or missing values to system: %j', value => {
    expect(themePreference(value)).toBe('system');
  });
  it('reads without eagerly saving a preference', async () => {
    const set = vi.fn();
    const store = createThemeStore({ get: async () => undefined, set, subscribe: () => () => {} });
    expect(await store.read()).toBe('system'); expect(set).not.toHaveBeenCalled();
    expect(THEME_KEY).toBe('uiTheme');
  });
  it('writes only a validated enum and propagates write failures', async () => {
    const set = vi.fn(async () => undefined);
    const store = createThemeStore({ get: async () => 'light', set, subscribe: () => () => {} });
    await store.write('dark'); expect(set).toHaveBeenCalledExactlyOnceWith('dark');
    await expect(store.write('invalid' as never)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(set).toHaveBeenCalledTimes(1);
    set.mockRejectedValueOnce(new Error('storage failed'));
    await expect(store.write('light')).rejects.toThrow('storage failed');
  });
  it('normalizes changes and removes the listener on disposal', () => {
    let listener: ((value: unknown) => void) | undefined;
    const off = vi.fn(() => { listener = undefined; });
    const store = createThemeStore({ get: async () => 'system', set: async () => {}, subscribe: handler => { listener = handler; return off; } });
    const changed = vi.fn(); const dispose = store.subscribe(changed);
    listener?.('dark'); listener?.(undefined); listener?.({ theme: 'light' });
    expect(changed.mock.calls).toEqual([['dark'], ['system'], ['system']]);
    dispose(); expect(off).toHaveBeenCalledOnce(); expect(listener).toBeUndefined();
  });
});
