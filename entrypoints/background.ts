import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { SessionController, type SessionRecord } from '../src/core/session';
import { parseCommand, trustedSender } from '../src/core/commands';
import { THEME_KEY } from '../src/core/theme';
import { AppError, errorCode } from '../src/core/errors';
import { safeLinkUrl } from '../src/core/api';
import { permissionPattern } from '../src/core/connection';
import type { Result } from '../src/core/protocol';

export default defineBackground(() => {
  const VAULT = 'credentialVault';
  const LOCK_MODE = 'autoLockMode';
  const SESSION = 'unlockedSession';
  const EXPIRY = 'vaultExpiry';
  const pages = [browser.runtime.getURL('/popup.html'), browser.runtime.getURL('/library.html')];
  const notify = () => { void browser.runtime.sendMessage({ type: 'sessionChanged' }).catch(() => undefined); };
  const sessions = new SessionController({
    getLockMode: async () => (await browser.storage.local.get(LOCK_MODE))[LOCK_MODE],
    setLockMode: async mode => { await browser.storage.local.set({ [LOCK_MODE]: mode }); },
    clearLockMode: async () => { await browser.storage.local.remove(LOCK_MODE); },
    getVault: async () => (await browser.storage.local.get(VAULT))[VAULT],
    setVault: async record => { await browser.storage.local.set({ [VAULT]: record }); },
    removeVault: async () => { await browser.storage.local.remove(VAULT); },
    getSession: async () => (await browser.storage.session.get(SESSION))[SESSION],
    setSession: async (record: SessionRecord) => { await browser.storage.session.set({ [SESSION]: record }); },
    clearSession: async () => {
      try { await browser.storage.session.remove(SESSION); }
      catch { await browser.storage.session.set({ [SESSION]: null }); }
    },
    schedule: async (when, recurring) => { await browser.alarms.create(EXPIRY, { when, ...(recurring ? { periodInMinutes: 5 } : {}) }); },
    clearAlarm: async () => { await browser.alarms.clear(EXPIRY); },
    hasAlarm: async () => (await browser.alarms.get(EXPIRY)) !== undefined,
    permission: async pattern => browser.permissions.contains({ origins: [permissionPattern(pattern, import.meta.env.BROWSER)] }),
    changed: notify,
  });
  // Chromium supports reducing local storage visibility. Firefox has no content scripts in this extension.
  type AccessControl = { setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void> };
  const restrict = async () => {
    for (const area of [browser.storage.local, browser.storage.session]) {
      const control = area as unknown as AccessControl;
      if (control.setAccessLevel) await control.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
  };
  const ready = restrict();
  browser.runtime.onStartup.addListener(() => { void sessions.lock().catch(() => undefined); });
  browser.runtime.onInstalled.addListener(() => { void sessions.lock().catch(() => undefined); });
  browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === EXPIRY) void sessions.expire().catch(() => sessions.lock()).catch(() => undefined); });
  browser.permissions.onRemoved.addListener(() => { void sessions.lock().catch(() => undefined); });
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse): true | undefined => {
    // Ignore our own notifications and reject every sender except exact internal extension pages.
    if (!trustedSender(sender, browser.runtime.id, pages)) return undefined;
    void (async (): Promise<Result<unknown>> => {
      try {
        await ready;
        if (sender.tab?.incognito) throw new AppError('unauthorized');
        const command = parseCommand(message);
        let value: unknown;
        switch (command.type) {
          case 'state': value = await sessions.state(); break;
          case 'setup': value = await sessions.setup({ url: command.url, token: command.token }, command.password); break;
          case 'unlock': value = await sessions.unlock(command.password); break;
          case 'replaceToken': value = await sessions.replaceToken(command.token, command.password); break;
          case 'lock': value = await sessions.lock(); break;
          case 'forget': {
            value = await sessions.forget();
            await browser.storage.local.remove(THEME_KEY);
            const granted = await browser.permissions.getAll();
            if (granted.origins?.length) await browser.permissions.remove({ origins: granted.origins });
            break;
          }
          case 'setLockMode': value = await sessions.setLockMode(command.mode); break;
          case 'activity': value = await sessions.activity(); break;
          case 'connect': value = await sessions.connect(); break;
          case 'collections': value = await sessions.run(api => api.collections()); break;
          case 'search': value = await sessions.run(api => api.search(command.collectionId, command.query, command.cursor)); break;
          case 'createLink': value = await sessions.run(api => api.createLink(command.input), false, true); break;
          case 'updateLink': value = await sessions.run(api => api.updateLink(command.id, command.input, command.original), false, true); break;
          case 'deleteLink': value = await sessions.run(api => api.deleteLink(command.id), false, true); break;
          case 'createCollection': value = await sessions.run(api => api.createCollection(command.input), false, true); break;
          case 'updateCollection': value = await sessions.run(api => api.updateCollection(command.id, command.input), false, true); break;
          case 'currentPage': {
            // activeTab is granted by invoking the toolbar popup, not by opening the full library.
            if (sender.url !== pages[0]) throw new AppError('unauthorized');
            const state = await sessions.state();
            if (!state.unlocked) throw new AppError('locked');
            let page: { url: string; name: string };
            try {
              const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
              if (!tab?.url || tab.incognito) throw new AppError('capture_unavailable');
              page = { url: safeLinkUrl(tab.url), name: (tab.title ?? '').slice(0, 2048) };
            } catch { throw new AppError('capture_unavailable'); }
            if (!(await sessions.state()).unlocked) throw new AppError('locked');
            value = page;
            break;
          }
        }
        return { ok: true, value };
      } catch (error) { return { ok: false, error: errorCode(error) }; }
    })().then(result => { try { sendResponse(result); } catch { /* The requesting view may have closed. */ } }).catch(() => undefined);
    return true; // Keep the callback channel open on Chromium versions without Promise replies.
  });
});
