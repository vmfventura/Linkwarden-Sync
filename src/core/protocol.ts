import type { Collection, CollectionInput, LinkInput, LinkPage } from './models';
import type { ThemeStore } from './theme';
import type { ErrorCode } from './errors';

export type LockMode = 'timeout' | 'browser';
export interface VaultState {
  lockMode: LockMode;
  hasVault: boolean;
  unlocked: boolean;
  connected: boolean;
  url?: string;
  expiresAt?: number;
}
export type Command =
  | { type: 'state' } | { type: 'lock' } | { type: 'forget' } | { type: 'activity' }
  | { type: 'setup'; url: string; token: string; password: string }
  | { type: 'unlock'; password: string }
  | { type: 'replaceToken'; token: string; password: string }
  | { type: 'setLockMode'; mode: LockMode }
  | { type: 'connect' }
  | { type: 'collections' }
  | { type: 'search'; collectionId: number | null; query: string; cursor: string | null }
  | { type: 'createLink'; input: LinkInput }
  | { type: 'updateLink'; id: number; input: LinkInput; original: LinkInput }
  | { type: 'deleteLink'; id: number }
  | { type: 'createCollection'; input: CollectionInput }
  | { type: 'updateCollection'; id: number; input: CollectionInput }
  | { type: 'currentPage' };
export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorCode };
export interface ResultMap {
  setLockMode: VaultState; state: VaultState; lock: VaultState; forget: VaultState; activity: VaultState;
  setup: VaultState; unlock: VaultState; replaceToken: VaultState; connect: VaultState;
  collections: Collection[]; search: LinkPage;
  createLink: null; updateLink: null; deleteLink: null;
  createCollection: null; updateCollection: null;
  currentPage: { url: string; name: string };
}
export interface Bridge {
  appearance: ThemeStore;
  request<T extends Command>(command: T): Promise<ResultMap[T['type']]>;
  requestPermission(url: string): Promise<boolean>;
  onSessionChange(listener: () => void): () => void;
  openLibrary(): void;
}
