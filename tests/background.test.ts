import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../src/core/protocol';

type Sender = { id: string; url: string; tab?: { incognito: boolean } };
type Listener = (message: unknown, sender: Sender, response: (value: Result<unknown>) => void) => true | undefined;
const mock = vi.hoisted(() => {
  const storage = () => ({ get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) });
  const event = () => ({ addListener: vi.fn() });
  return { browser: {
    runtime: { id: 'own-extension', getURL: (path: string) => `chrome-extension://own${path}`,
      sendMessage: vi.fn(async () => undefined), onStartup: event(), onInstalled: event(), onMessage: { addListener: vi.fn<(listener: Listener) => void>() } },
    storage: { local: storage(), session: storage() },
    tabs: { query: vi.fn(async (): Promise<Array<{ url?: string; title?: string; incognito?: boolean }>> => []) },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true), get: vi.fn(async () => undefined), onAlarm: event() },
    permissions: { contains: vi.fn(async () => true), getAll: vi.fn(async () => ({})), remove: vi.fn(async () => true), onRemoved: event() },
  } };
});
vi.mock('wxt/browser', () => mock);
vi.mock('wxt/utils/define-background', () => ({ defineBackground: (main: () => void) => main }));
import main from '../entrypoints/background';

let listener: Listener;
beforeEach(() => {
  vi.clearAllMocks();
  mock.browser.storage.local.get.mockResolvedValue({});
  mock.browser.storage.session.get.mockResolvedValue({});
  mock.browser.storage.session.remove.mockResolvedValue(undefined);
  mock.browser.alarms.get.mockResolvedValue(undefined);
  mock.browser.tabs.query.mockResolvedValue([]);
  (main as unknown as () => void)();
  listener = mock.browser.runtime.onMessage.addListener.mock.calls[0]![0];
});
const sender: Sender = { id: 'own-extension', url: 'chrome-extension://own/popup.html' };
describe('actual background callback reply contract', () => {
  it('returns true synchronously and replies exactly once to an authorized state request', async () => {
    const response = vi.fn();
    expect(listener({ type: 'state' }, sender, response)).toBe(true);
    expect(response).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(response).toHaveBeenCalledExactlyOnceWith({ ok: true, value: { lockMode: 'timeout', hasVault: false, unlocked: false, connected: false } }));
  });
  it('returns true and replies once with a generic error when a command fails', async () => {
    const response = vi.fn();
    expect(listener({ type: 'unknown', token: 'must-not-echo' }, sender, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'invalid_request' }));
  });
  it.each([{ ...sender, id: 'other-extension' }, { ...sender, url: 'https://untrusted.test' },
    { ...sender, url: `${sender.url}?spoof` }])('does not keep a channel or reply to an unauthorized sender', async untrusted => {
    const response = vi.fn();
    expect(listener({ type: 'forget' }, untrusted, response)).toBeUndefined();
    await Promise.resolve(); expect(response).not.toHaveBeenCalled();
    expect(mock.browser.storage.local.remove).not.toHaveBeenCalled();
  });
  it('rejects an incognito request through the same callback channel', async () => {
    const response = vi.fn();
    expect(listener({ type: 'state' }, { ...sender, tab: { incognito: true } }, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'unauthorized' }));
  });
  it('handles a response channel closed by the view without retrying', async () => {
    const response = vi.fn(() => { throw new Error('view closed'); });
    expect(listener({ type: 'state' }, sender, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledTimes(1));
  });
  it('removes the theme even if permission cleanup fails after forgetting the vault', async () => {
    mock.browser.permissions.getAll.mockRejectedValueOnce(new Error('permission cleanup failed'));
    const response = vi.fn();
    expect(listener({ type: 'forget' }, sender, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledTimes(1));
    expect(response.mock.calls[0]![0]).toMatchObject({ ok: false });
    expect(mock.browser.storage.local.remove).toHaveBeenCalledWith('credentialVault');
    expect(mock.browser.storage.local.remove).toHaveBeenCalledWith('uiTheme');
  });
});

const request = (command: unknown, from = sender): Promise<Result<unknown>> => new Promise(resolve => {
  expect(listener(command, from, resolve)).toBe(true);
});
describe('explicit selected-tab capture', () => {
  beforeEach(() => {
    const now = Date.now();
    let ram: Record<string, unknown> = { unlockedSession: { version: 2, id: crypto.randomUUID(),
      url: 'https://links.example.test', token: 'synthetic-test-token', createdAt: now,
      expiresAt: now + 300_000, absoluteExpiresAt: now + 1_800_000, connected: true, lockMode: 'timeout' } };
    mock.browser.storage.local.get.mockResolvedValue({ credentialVault: { encrypted: true } });
    mock.browser.storage.session.get.mockImplementation(async () => ram);
    mock.browser.storage.session.remove.mockImplementation(async () => { ram = {}; });
    mock.browser.alarms.get.mockResolvedValue({ name: 'vaultExpiry' } as never);
  });
  it('reads only on an explicit request and returns the selected page URL and bounded title', async () => {
    await request({ type: 'state' }); expect(mock.browser.tabs.query).not.toHaveBeenCalled();
    mock.browser.tabs.query.mockResolvedValue([{ url: 'https://example.com/selected', title: 'Selected page' }]);
    expect(await request({ type: 'currentPage' })).toEqual({ ok: true, value: { url: 'https://example.com/selected', name: 'Selected page' } });
    expect(mock.browser.tabs.query).toHaveBeenCalledExactlyOnceWith({ active: true, currentWindow: true });
    expect(mock.browser.storage.local.set).not.toHaveBeenCalled();
  });
  it('bounds the untrusted page title and tolerates a missing title', async () => {
    mock.browser.tabs.query.mockResolvedValue([{ url: 'http://example.com/page', title: 'x'.repeat(3000) }]);
    expect(await request({ type: 'currentPage' })).toMatchObject({ ok: true, value: { name: 'x'.repeat(2048) } });
    mock.browser.tabs.query.mockResolvedValue([{ url: 'https://example.com/page' }]);
    expect(await request({ type: 'currentPage' })).toMatchObject({ ok: true, value: { name: '' } });
  });
  it.each(['about:blank', 'chrome://settings', 'file:///private/file', 'javascript:alert(1)', 'https://user:secret@example.com'])('rejects a non-capturable URL without echoing it: %s', async url => {
    mock.browser.tabs.query.mockResolvedValue([{ url, title: 'Private title' }]);
    expect(await request({ type: 'currentPage' })).toEqual({ ok: false, error: 'capture_unavailable' });
  });
  it.each([{ tabs: [] }, { tabs: [{}] }, { tabs: [{ url: 'https://example.com/private', incognito: true }] }])('rejects missing page access and incognito tabs', async ({ tabs }) => {
    mock.browser.tabs.query.mockResolvedValue(tabs);
    expect(await request({ type: 'currentPage' })).toEqual({ ok: false, error: 'capture_unavailable' });
  });
  it('reports tab API failure without returning browser exception text', async () => {
    mock.browser.tabs.query.mockRejectedValue(new Error('private page information'));
    expect(await request({ type: 'currentPage' })).toEqual({ ok: false, error: 'capture_unavailable' });
  });
  it('rejects capture from the library instead of reading its extension tab', async () => {
    expect(await request({ type: 'currentPage' }, { ...sender, url: 'chrome-extension://own/library.html' })).toEqual({ ok: false, error: 'unauthorized' });
    expect(mock.browser.tabs.query).not.toHaveBeenCalled();
  });
  it('does not capture while locked', async () => {
    await request({ type: 'lock' });
    expect(await request({ type: 'currentPage' })).toEqual({ ok: false, error: 'locked' });
    expect(mock.browser.tabs.query).not.toHaveBeenCalled();
  });
  it('discards page metadata when locking occurs during the tab lookup', async () => {
    let finish!: (tabs: Array<{ url: string; title: string }>) => void;
    mock.browser.tabs.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = request({ type: 'currentPage' });
    await vi.waitFor(() => expect(mock.browser.tabs.query).toHaveBeenCalledTimes(1));
    await request({ type: 'lock' }); finish([{ url: 'https://example.com/stale', title: 'Stale page' }]);
    expect(await pending).toEqual({ ok: false, error: 'locked' });
  });
});
