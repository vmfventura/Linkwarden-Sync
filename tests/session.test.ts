import { describe, expect, it, vi } from 'vitest';
import { ABSOLUTE_MS, IDLE_MS, SessionController, type SessionRecord, type SessionStorage } from '../src/core/session';
import { LinkwardenApi } from '../src/core/api';
import type { Connection } from '../src/core/connection';
const connection = { url: 'https://links.example.test', token: 'private-test-token' };
function harness() {
  let mode: unknown; let now = 100_000; let vault: unknown; let session: unknown; let alarm: number | null = null; let recurring = false;
  const storage: SessionStorage = {
    getLockMode: async () => mode, setLockMode: async value => { mode = value; }, clearLockMode: async () => { mode = undefined; },
    getVault: async () => vault, setVault: async value => { vault = value; }, removeVault: async () => { vault = undefined; },
    getSession: async () => session, setSession: async value => { session = structuredClone(value); }, clearSession: async () => { session = undefined; },
    schedule: async (when, repeat) => { alarm = when; recurring = repeat; }, clearAlarm: async () => { alarm = null; }, hasAlarm: async () => alarm !== null,
    permission: vi.fn(async () => true), changed: vi.fn(),
  };
  const seal = vi.fn(async () => ({ encrypted: true } as never));
  const open = vi.fn(async () => ({ ...connection }));
  const requests: AbortSignal[] = [];
  let verification: () => Promise<void> = async () => undefined;
  const make = () => new SessionController(storage, { now: () => now, seal, open, api: context => {
    requests.push(context.signal);
    return { verify: async () => { await context.assertActive(); await verification(); await context.assertActive(); } } as LinkwardenApi;
  } });
  return { controller: make(), make, storage, seal, open, requests, setNow: (value: number) => { now = value; }, now: () => now,
    vault: () => vault, session: () => session as SessionRecord | undefined, alarm: () => alarm, recurring: () => recurring,
    mode: () => mode, corruptMode: (value: unknown) => { mode = value; },
    corrupt: (value: unknown) => { session = value; }, verify: (fn: () => Promise<void>) => { verification = fn; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('credential session boundaries', () => {
  it('persists only a sealed vault and keeps credentials in the RAM adapter', async () => {
    const h = harness(); const state = await h.controller.setup(connection, 'example password');
    expect(h.vault()).toEqual({ encrypted: true });
    expect(JSON.stringify(h.vault())).not.toContain(connection.token);
    expect(h.session()).toMatchObject({ ...connection, connected: false });
    expect(state).toEqual({ lockMode: 'timeout', hasVault: true, unlocked: true, connected: false, url: connection.url, expiresAt: h.now() + IDLE_MS });
    expect(JSON.stringify(state)).not.toContain(connection.token);
    expect(h.alarm()).toBe(state.expiresAt);
  });
  it('restores RAM session after worker suspension, but locks after browser session RAM is cleared', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password');
    expect((await h.make().state()).unlocked).toBe(true);
    await h.storage.clearSession();
    expect(await h.make().state()).toEqual({ lockMode: 'timeout', hasVault: true, unlocked: false, connected: false });
  });
  it('does not extend expiry by reads and clears data when an alarm observes expiration', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password');
    h.setNow(h.now() + IDLE_MS - 1); expect((await h.controller.state()).unlocked).toBe(true);
    h.setNow(h.now() + 1); await h.controller.expire();
    expect(h.session()).toBeUndefined(); expect(h.alarm()).toBeNull(); expect((await h.controller.state()).unlocked).toBe(false);
  });
  it('extends idle expiry only through activity and never past the absolute deadline', async () => {
    const h = harness(); const start = h.now(); await h.controller.setup(connection, 'example password');
    for (let index = 1; index < 30; index++) { h.setNow(start + index * 60_000); await h.controller.activity(); }
    expect(h.session()?.expiresAt).toBe(start + ABSOLUTE_MS);
    h.setNow(start + ABSOLUTE_MS); expect((await h.controller.activity()).unlocked).toBe(false);
  });
  it('reschedules an old alarm instead of locking a still-active session', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password');
    h.setNow(h.now() + 60_000); await h.controller.activity(); await h.controller.expire();
    expect((await h.controller.state()).unlocked).toBe(true); expect(h.alarm()).toBe(h.now() + IDLE_MS);
  });
  it.each([{ version: 1 }, { createdAt: -1 }, { token: '' }, { connected: 'true' }, { extra: 'sensitive' }])('fails closed on corrupt session %j', async change => {
    const h = harness(); await h.controller.setup(connection, 'example password'); h.corrupt({ ...h.session(), ...change });
    expect((await h.controller.state()).unlocked).toBe(false); expect(h.session()).toBeUndefined();
  });
  it('lock aborts an in-flight operation and rejects a late result', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.connect();
    const pending = deferred<string>(); const started = deferred<void>();
    const request = h.controller.run(async () => { started.resolve(); return pending.promise; });
    await started.promise; await h.controller.lock(); pending.resolve('private library');
    await expect(request).rejects.toMatchObject({ code: 'session_changed' });
    expect(h.requests.at(-1)?.aborted).toBe(true); expect(h.session()).toBeUndefined();
  });
  it('forget during slow setup cannot resurrect either vault or session', async () => {
    const h = harness(); const seal = deferred<never>(); h.seal.mockImplementationOnce(() => seal.promise);
    const attempt = h.controller.setup(connection, 'example password');
    await vi.waitFor(() => expect(h.seal).toHaveBeenCalled()); await h.controller.forget(); seal.resolve({ encrypted: true } as never);
    await expect(attempt).rejects.toMatchObject({ code: 'session_changed' }); expect(h.vault()).toBeUndefined(); expect(h.session()).toBeUndefined();
  });
  it('lock during slow unlock prevents session resurrection', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.lock();
    const open = deferred<Connection>(); h.open.mockImplementationOnce(() => open.promise);
    const attempt = h.controller.unlock('example password'); await vi.waitFor(() => expect(h.open).toHaveBeenCalled());
    await h.controller.lock(); open.resolve(connection);
    await expect(attempt).rejects.toMatchObject({ code: 'session_changed' }); expect(h.session()).toBeUndefined();
  });
  it('preserves the active session when replacement password is incorrect', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.connect();
    h.open.mockRejectedValueOnce(new Error('wrong password'));
    await expect(h.controller.replaceToken('new-token', 'wrong password')).rejects.toThrow();
    expect((await h.controller.state()).connected).toBe(true); expect(h.session()?.token).toBe(connection.token);
  });
  it('a successful alarm clear prevents restoration after session removal fails', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password');
    h.storage.clearSession = async () => { throw new Error('storage failed'); };
    await expect(h.controller.lock()).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.alarm()).toBeNull();
    const resumed = h.make();
    await expect(resumed.state()).rejects.toMatchObject({ code: 'invalid_request' });
    expect((await resumed.state()).unlocked).toBe(false);
  });
  it('permission denial prevents an API operation', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); vi.mocked(h.storage.permission).mockResolvedValue(false);
    await expect(h.controller.connect()).rejects.toMatchObject({ code: 'permission_required' });
    expect(h.session()?.connected).toBe(false);
  });
  it('lock while a RAM write is pending cannot restore usable credentials', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password');
    const write = deferred<void>(); const original = h.storage.setSession;
    h.storage.setSession = async value => { await write.promise; await original(value); };
    const activity = h.controller.activity(); await Promise.resolve();
    const locked = h.controller.lock(); write.resolve();
    await activity.catch(() => undefined); await locked;
    expect(h.session()).toBeUndefined(); expect((await h.controller.state()).unlocked).toBe(false);
  });
  it('requires an unlocked unexpired session to change the preference', async () => {
    const h = harness();
    await expect(h.controller.setLockMode('browser')).rejects.toMatchObject({ code: 'locked' });
    await h.controller.setup(connection, 'example password');
    h.setNow(h.now() + IDLE_MS);
    await expect(h.controller.setLockMode('browser')).rejects.toMatchObject({ code: 'session_changed' });
    expect(h.mode()).toBeUndefined();
  });
  it('keeps browser mode unlocked past both deadlines without activity and across worker recreation', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.connect();
    const state = await h.controller.setLockMode('browser');
    expect(state).toMatchObject({ unlocked: true, connected: true, lockMode: 'browser' });
    expect(state).not.toHaveProperty('expiresAt');
    expect(h.session()).toMatchObject({ lockMode: 'browser', expiresAt: null, absoluteExpiresAt: null });
    expect(h.mode()).toBe('browser'); expect(h.recurring()).toBe(true);
    h.setNow(h.now() + 7 * 24 * 60 * 60_000);
    await h.controller.expire(); await h.controller.activity();
    expect((await h.make().state()).unlocked).toBe(true);
    await expect(h.make().run(async () => 'allowed')).resolves.toBe('allowed');
    expect(h.alarm()).toBe(h.now() + IDLE_MS);
  });
  it('manual lock and browser RAM loss still require a password with the saved browser preference', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.setLockMode('browser');
    await h.controller.lock(); expect(h.session()).toBeUndefined();
    expect(await h.controller.state()).toMatchObject({ unlocked: false, lockMode: 'browser' });
    await h.controller.unlock('example password');
    expect(h.session()?.lockMode).toBe('browser');
    await h.storage.clearSession();
    const resumed = h.make(); expect((await resumed.state()).unlocked).toBe(false);
    await resumed.unlock('example password'); expect((await resumed.state()).unlocked).toBe(true);
  });
  it('restores the default time limits immediately when selected and does not renew on identical selection', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.setLockMode('browser');
    h.setNow(h.now() + ABSOLUTE_MS * 2); await h.controller.setLockMode('timeout');
    const created = h.now(); expect(h.recurring()).toBe(false); expect(h.session()?.expiresAt).toBe(created + IDLE_MS);
    expect(h.session()?.absoluteExpiresAt).toBe(created + ABSOLUTE_MS);
    h.setNow(created + 60_000); await h.controller.setLockMode('timeout');
    expect(h.session()?.createdAt).toBe(created);
    h.setNow(created + IDLE_MS); expect((await h.controller.state()).unlocked).toBe(false);
  });
  it('forgets the preference and always starts a new vault with safe defaults', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.setLockMode('browser');
    await h.controller.forget(); expect(h.mode()).toBeUndefined();
    h.corruptMode('browser'); await h.controller.setup(connection, 'example password');
    expect(h.session()?.lockMode).toBe('timeout'); expect(h.mode()).toBeUndefined();
  });
  it.each([undefined, null, true, 0, {}, 'never', 'BROWSER'])('invalid preferences cannot restore a browser-mode RAM session: %j', async value => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.setLockMode('browser');
    h.corruptMode(value);
    expect((await h.make().state()).unlocked).toBe(false); expect(h.session()).toBeUndefined();
  });
  it.each([{ expiresAt: 999999 }, { absoluteExpiresAt: 999999 }, { createdAt: -1 }, { lockMode: 'never' }])('rejects corrupt browser-mode RAM %j', async change => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.setLockMode('browser');
    h.corrupt({ ...h.session(), ...change }); expect((await h.make().state()).unlocked).toBe(false);
  });
  it('failed preference writes lock and clear the existing session', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password');
    h.storage.setLockMode = async () => { throw new Error('storage failure'); };
    await expect(h.controller.setLockMode('browser')).rejects.toThrow();
    expect(h.session()).toBeUndefined(); expect((await h.make().state()).unlocked).toBe(false);
  });
  it('mode changes abort in-flight reads and discard their late results', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.connect();
    const pending = deferred<string>(); const started = deferred<void>();
    const read = h.controller.run(async () => { started.resolve(); return pending.promise; });
    await started.promise; await h.controller.setLockMode('browser'); pending.resolve('private data');
    await expect(read).rejects.toMatchObject({ code: 'session_changed' });
    expect(h.requests.at(-1)?.aborted).toBe(true);
  });
  it('a lock during a pending preference write cannot re-establish a browser session', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password');
    const write = deferred<void>(); const original = h.storage.setLockMode;
    h.storage.setLockMode = async value => { await write.promise; await original(value); };
    const change = h.controller.setLockMode('browser'); await vi.waitFor(() => expect(h.session()).toBeUndefined());
    const lock = h.controller.lock(); write.resolve();
    await expect(change).rejects.toMatchObject({ code: 'session_changed' }); await lock;
    expect((await h.make().state()).unlocked).toBe(false);
  });
  it('partial session cleanup is revoked by removing the liveness alarm in browser mode', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.setLockMode('browser');
    h.storage.clearSession = async () => { throw new Error('storage failure'); };
    await expect(h.controller.lock()).rejects.toThrow(); expect(h.alarm()).toBeNull();
    const resumed = h.make(); await expect(resumed.state()).rejects.toThrow();
    expect((await resumed.state()).unlocked).toBe(false);
  });
  it('authentication failure and lost permission still block browser-mode API use', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password'); await h.controller.setLockMode('browser');
    vi.mocked(h.storage.permission).mockResolvedValue(false);
    await expect(h.controller.connect()).rejects.toMatchObject({ code: 'permission_required' });
    // The broker's permissions.onRemoved handler locks independently; the API guard rejects lost grants.
    vi.mocked(h.storage.permission).mockResolvedValue(true); await h.controller.connect();
    const controller = new SessionController(h.storage, { now: h.now, api: context => ({ verify: async (): Promise<void> => {
      await context.onAuthenticationFailure(); throw new Error('authentication rejected');
    } }) as LinkwardenApi });
    await expect(controller.run(api => api.verify())).rejects.toThrow();
    expect((await controller.state()).unlocked).toBe(false);
  });

  it('a failed RAM write after saving the preference leaves no usable session', async () => {
    const h = harness(); await h.controller.setup(connection, 'example password');
    h.storage.setSession = async () => { throw new Error('RAM write failed'); };
    await expect(h.controller.setLockMode('browser')).rejects.toThrow();
    expect(h.mode()).toBe('browser'); expect(h.session()).toBeUndefined(); expect(h.alarm()).toBeNull();
    expect((await h.make().state()).unlocked).toBe(false);
  });

});
