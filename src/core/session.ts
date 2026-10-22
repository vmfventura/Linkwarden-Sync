import { validateConnection, originPattern, type Connection } from './connection';
import { createVault, openVault } from './vault';
import { AppError } from './errors';
import { LinkwardenApi, type ApiContext } from './api';
import type { LockMode, VaultState } from './protocol';

export const IDLE_MS = 5 * 60_000;
export const ABSOLUTE_MS = 30 * 60_000;
export interface SessionRecord extends Connection {
  version: 2; id: string; createdAt: number; expiresAt: number | null;
  absoluteExpiresAt: number | null; connected: boolean; lockMode: LockMode;
}
export interface SessionStorage {
  getLockMode(): Promise<unknown>;
  setLockMode(mode: LockMode): Promise<void>;
  clearLockMode(): Promise<void>;
  getVault(): Promise<unknown>;
  setVault(record: unknown): Promise<void>;
  removeVault(): Promise<void>;
  getSession(): Promise<unknown>;
  setSession(record: SessionRecord): Promise<void>;
  clearSession(): Promise<void>;
  schedule(when: number, recurring: boolean): Promise<void>;
  clearAlarm(): Promise<void>;
  hasAlarm(): Promise<boolean>;
  permission(pattern: string): Promise<boolean>;
  changed(): void;
}
interface SessionOptions {
  now?: () => number;
  seal?: typeof createVault;
  open?: typeof openVault;
  api?: (context: ApiContext) => LinkwardenApi;
}

/** Credentials are encrypted at rest; only non-secret locking/appearance preferences are stored separately. */
export class SessionController {
  private epoch = 0;
  private blocked = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly requests = new Set<AbortController>();
  private readonly now: () => number;
  constructor(private readonly storage: SessionStorage, private readonly options: SessionOptions = {}) {
    this.now = options.now ?? Date.now;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private invalidate(): number {
    this.blocked = true;
    this.epoch++;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.storage.changed();
    return this.epoch;
  }
  private assertEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw new AppError('session_changed');
  }
  private decode(value: unknown): SessionRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    const keys = ['version', 'id', 'url', 'token', 'createdAt', 'expiresAt', 'absoluteExpiresAt', 'connected', 'lockMode'];
    if (Object.keys(data).length !== keys.length || keys.some(key => !Object.hasOwn(data, key))) return null;
    if (data.version !== 2 || typeof data.id !== 'string' || !/^[\da-f-]{36}$/iu.test(data.id) ||
      typeof data.connected !== 'boolean' || (data.lockMode !== 'timeout' && data.lockMode !== 'browser')) return null;
    const created = data.createdAt;
    const expires = data.expiresAt;
    const absolute = data.absoluteExpiresAt;
    const now = this.now();
    if (typeof created !== 'number' || !Number.isSafeInteger(created) || created < 0 || created > now) return null;
    if (data.lockMode === 'timeout') {
      if (typeof expires !== 'number' || !Number.isSafeInteger(expires) ||
        typeof absolute !== 'number' || !Number.isSafeInteger(absolute) ||
        absolute !== created + ABSOLUTE_MS || expires <= now || expires > absolute ||
        expires > now + IDLE_MS || expires <= created) return null;
    } else if (expires !== null || absolute !== null) return null;
    try {
      const connection = validateConnection({ url: data.url, token: data.token });
      if (connection.url !== data.url) return null;
      return { ...connection, version: 2, lockMode: data.lockMode, id: data.id, createdAt: created, expiresAt: expires,
        absoluteExpiresAt: absolute, connected: data.connected };
    } catch { return null; }
  }
  private async read(): Promise<SessionRecord | null> {
    if (this.blocked) return null;
    const epoch = this.epoch;
    const raw = await this.storage.getSession();
    this.assertEpoch(epoch);
    let session = this.decode(raw);
    if (session && ((await this.storage.getVault()) == null || !await this.storage.hasAlarm() ||
      session.lockMode !== await this.lockMode())) session = null;
    this.assertEpoch(epoch);
    if (raw !== undefined && raw !== null && !session) {
      this.invalidate();
      await this.cleanup();
    }
    return session;
  }
  private async lockMode(): Promise<LockMode> {
    return await this.storage.getLockMode() === 'browser' ? 'browser' : 'timeout';
  }
  private async schedule(session: SessionRecord): Promise<void> {
    // Keep a liveness alarm in both modes. Its removal revokes stale RAM after partial cleanup.
    await this.storage.schedule(session.expiresAt ?? this.now() + IDLE_MS, session.lockMode === 'browser');
  }
  private async stateInternal(): Promise<VaultState> {
    const session = await this.read();
    const hasVault = (await this.storage.getVault()) != null;
    return { hasVault, lockMode: await this.lockMode(), unlocked: session !== null, connected: session?.connected ?? false,
      ...(session ? { url: session.url, ...(session.expiresAt !== null ? { expiresAt: session.expiresAt } : {}) } : {}) };
  }
  private async cleanup(): Promise<void> {
    // Try both independent cleanup actions even when one storage operation fails.
    const results = await Promise.allSettled([this.storage.clearSession(), this.storage.clearAlarm()]);
    if (results.some(result => result.status === 'rejected')) throw new AppError('invalid_request');
  }
  state(): Promise<VaultState> { return this.serial(() => this.stateInternal()); }
  lock(): Promise<VaultState> {
    this.invalidate(); // Cancel network and pending crypto immediately, before queued I/O.
    return this.serial(async () => {
      await this.cleanup();
      return this.stateInternal();
    });
  }
  forget(): Promise<VaultState> {
    this.invalidate();
    return this.serial(async () => {
      const results = await Promise.allSettled([this.cleanup(), this.storage.removeVault(), this.storage.clearLockMode()]);
      if (results.some(result => result.status === 'rejected')) throw new AppError('invalid_request');
      return this.stateInternal();
    });
  }
  async expire(): Promise<void> {
    await this.serial(async () => {
      const session = await this.read();
      if (session) await this.schedule(session);
    });
  }
  private async establish(connection: Connection, epoch: number, connected = false): Promise<VaultState> {
    this.assertEpoch(epoch);
    const now = this.now();
    const lockMode = await this.lockMode();
    this.assertEpoch(epoch);
    const session: SessionRecord = { ...connection, version: 2, lockMode, id: crypto.randomUUID(),
      createdAt: now, expiresAt: lockMode === 'timeout' ? now + IDLE_MS : null,
      absoluteExpiresAt: lockMode === 'timeout' ? now + ABSOLUTE_MS : null, connected };
    await this.storage.setSession(session);
    this.assertEpoch(epoch);
    await this.schedule(session);
    this.assertEpoch(epoch);
    this.blocked = false;
    this.storage.changed();
    return this.stateInternal();
  }
  async setup(connectionInput: Connection, password: string): Promise<VaultState> {
    const connection = validateConnection(connectionInput);
    const epoch = this.invalidate();
    await this.serial(async () => {
      this.assertEpoch(epoch);
      await this.storage.clearSession();
      await this.storage.clearAlarm();
      if ((await this.storage.getVault()) != null) throw new AppError('invalid_request');
      this.assertEpoch(epoch);
      await this.storage.clearLockMode();
    });
    const record = await (this.options.seal ?? createVault)(connection, password);
    return this.serial(async () => {
      this.assertEpoch(epoch);
      if ((await this.storage.getVault()) != null) throw new AppError('invalid_request');
      this.assertEpoch(epoch);
      await this.storage.setVault(record);
      this.assertEpoch(epoch);
      return this.establish(connection, epoch);
    });
  }
  async unlock(password: string): Promise<VaultState> {
    const epoch = this.invalidate();
    const record = await this.serial(async () => {
      this.assertEpoch(epoch);
      await this.storage.clearSession();
      await this.storage.clearAlarm();
      const value = await this.storage.getVault();
      if (value == null) throw new AppError('no_vault');
      return value;
    });
    const connection = await (this.options.open ?? openVault)(record, password);
    return this.serial(() => this.establish(connection, epoch));
  }
  async replaceToken(token: string, password: string): Promise<VaultState> {
    const startEpoch = this.epoch;
    const record = await this.serial(async () => {
      this.assertEpoch(startEpoch);
      const value = await this.storage.getVault();
      if (value == null) throw new AppError('no_vault');
      return value;
    });
    const old = await (this.options.open ?? openVault)(record, password);
    this.assertEpoch(startEpoch);
    const connection = validateConnection({ url: old.url, token });
    const replacement = await (this.options.seal ?? createVault)(connection, password);
    return this.serial(async () => {
      this.assertEpoch(startEpoch);
      const epoch = this.invalidate();
      await this.cleanup();
      this.assertEpoch(epoch);
      await this.storage.setVault(replacement);
      this.assertEpoch(epoch);
      return this.establish(connection, epoch);
    });
  }
  setLockMode(mode: LockMode): Promise<VaultState> {
    if (mode !== 'timeout' && mode !== 'browser') return Promise.reject(new AppError('invalid_request'));
    return this.serial(async () => {
      const previousEpoch = this.epoch;
      const session = await this.read();
      this.assertEpoch(previousEpoch);
      if (!session) throw new AppError('locked');
      if (session.lockMode === mode) return this.stateInternal();
      const epoch = this.invalidate();
      try {
        await this.cleanup();
        this.assertEpoch(epoch);
        await this.storage.setLockMode(mode);
        this.assertEpoch(epoch);
        return await this.establish({ url: session.url, token: session.token }, epoch, session.connected);
      } catch (error) {
        // A failed preference or RAM write must never leave a partially changed usable session.
        this.invalidate();
        await this.cleanup();
        throw error;
      }
    });
  }
  activity(): Promise<VaultState> {
    return this.serial(async () => {
      const epoch = this.epoch;
      const session = await this.read();
      if (!session || session.lockMode === 'browser') return this.stateInternal();
      session.expiresAt = Math.min(this.now() + IDLE_MS, session.absoluteExpiresAt!);
      this.assertEpoch(epoch);
      await this.storage.setSession(session);
      this.assertEpoch(epoch);
      await this.schedule(session);
      return this.stateInternal();
    });
  }
  async run<T>(operation: (api: LinkwardenApi) => Promise<T>, connecting = false, write = false): Promise<T> {
    const epoch = this.epoch;
    const session = await this.serial(async () => {
      const value = await this.read();
      this.assertEpoch(epoch);
      if (!value) throw new AppError('locked');
      if (!connecting && !value.connected) throw new AppError('permission_required');
      return value;
    });
    const controller = new AbortController();
    this.assertEpoch(epoch);
    this.requests.add(controller);
    const assertActive = async () => {
      this.assertEpoch(epoch);
      if (controller.signal.aborted || this.blocked) throw new AppError('session_changed');
      const expiresAt = await this.serial(async () => {
        const current = await this.read();
        this.assertEpoch(epoch);
        if (current?.id !== session.id) throw new AppError('session_changed');
        return current.expiresAt;
      });
      if (!await this.storage.permission(originPattern(session.url))) throw new AppError('permission_required');
      this.assertEpoch(epoch);
      if (expiresAt !== null && this.now() >= expiresAt) { await this.lock(); throw new AppError('locked'); }
    };
    const api = (this.options.api ?? (context => new LinkwardenApi(context)))({
      connection: { url: session.url, token: session.token }, signal: controller.signal, assertActive,
      onAuthenticationFailure: async () => { if (epoch === this.epoch) await this.lock(); },
    });
    try {
      await assertActive();
      const result = await operation(api);
      if (!write) await assertActive();
      return result;
    } finally { this.requests.delete(controller); }
  }
  async connect(): Promise<VaultState> {
    const epoch = this.epoch;
    await this.run(api => api.verify(), true);
    return this.serial(async () => {
      this.assertEpoch(epoch);
      const session = await this.read();
      if (!session) throw new AppError('locked');
      session.connected = true;
      await this.storage.setSession(session);
      this.assertEpoch(epoch);
      return this.stateInternal();
    });
  }
}
