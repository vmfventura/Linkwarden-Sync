import { browser } from 'wxt/browser';
import { permissionPattern } from './core/connection';
import { createThemeStore, THEME_KEY } from './core/theme';
import { AppError } from './core/errors';
import type { Bridge, Command, Result, ResultMap } from './core/protocol';

export const bridge: Bridge = {
  appearance: createThemeStore({
    get: async () => (await browser.storage.local.get(THEME_KEY))[THEME_KEY],
    set: async value => { await browser.storage.local.set({ [THEME_KEY]: value }); },
    subscribe: listener => {
      const handler: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
        if (area === 'local' && Object.hasOwn(changes, THEME_KEY)) listener(changes[THEME_KEY]?.newValue);
      };
      browser.storage.onChanged.addListener(handler);
      return () => browser.storage.onChanged.removeListener(handler);
    },
  }),
  async request<T extends Command>(command: T): Promise<ResultMap[T['type']]> {
    let result: Result<ResultMap[T['type']]>;
    try { result = await browser.runtime.sendMessage(command) as Result<ResultMap[T['type']]>; }
    catch { throw new AppError('session_changed'); }
    if (!result || typeof result.ok !== 'boolean') throw new AppError('invalid_response');
    if (!result.ok) throw new AppError(result.error);
    return result.value;
  },
  async requestPermission(url) { return browser.permissions.request({ origins: [permissionPattern(url, import.meta.env.BROWSER)] }); },
  onSessionChange(listener) {
    const handler = (message: unknown, sender: { id?: string; url?: string }) => {
      if (sender.id === browser.runtime.id && message && typeof message === 'object' &&
        'type' in message && message.type === 'sessionChanged') listener();
    };
    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  },
  openLibrary() { void browser.tabs.create({ url: browser.runtime.getURL('/library.html') }); },
};
