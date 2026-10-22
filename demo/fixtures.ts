import type { Bridge, Command, ResultMap, VaultState } from '../src/core/protocol';
import type { Collection, Link } from '../src/core/models';
import { createThemeStore, type ThemePreference } from '../src/core/theme';
import { AppError } from '../src/core/errors';

// This in-memory bridge belongs exclusively to the standalone synthetic demo.
// Production entrypoints always import src/bridge and never import this fixture.
export class DemoBridge implements Bridge {
  private theme: ThemePreference = 'system';
  private themeListeners = new Set<(value: unknown) => void>();
  readonly appearance = createThemeStore({
    get: async () => this.theme,
    set: async value => { this.theme = value; this.themeListeners.forEach(listener => listener(value)); },
    subscribe: listener => { this.themeListeners.add(listener); return () => { this.themeListeners.delete(listener); }; },
  });
  private state: VaultState = { lockMode: 'timeout', hasVault: true, unlocked: true, connected: true, url: 'https://synthetic.example', expiresAt: Date.now() + 900_000 };
  private listeners = new Set<() => void>();
  private folders: Collection[] = [this.folder(1, 'Synthetic library', null), ...Array.from({ length: 150 }, (_, i) => this.folder(i + 2, `Folder ${String(i + 1).padStart(3, '0')}`, 1)), this.folder(200, 'Nested research', 2), { ...this.folder(201, 'Shared reading', null), shared: true, canManage: false, canCreate: true, canUpdate: true, canDelete: false }];
  private links: Link[] = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: `Synthetic reading ${i + 1}`, url: `https://example.com/reading/${i + 1}`, description: 'Synthetic material for reviewing navigation, editing and pagination.', collectionId: 1, tags: ['demo', i % 2 ? 'research' : 'reading'] }));
  private folder(id: number, name: string, parentId: number | null): Collection { return { id, name, parentId, ownerId: 1, shared: false, canManage: true, canCreate: true, canUpdate: true, canDelete: true, linkCount: id === 1 ? 120 : 0 }; }
  preview(unlocked: boolean): void { this.state = unlocked ? { lockMode: 'timeout', hasVault: true, unlocked: true, connected: true, url: 'https://synthetic.example', expiresAt: Date.now() + 900_000 } : { lockMode: 'timeout', hasVault: false, unlocked: false, connected: false }; this.emit(); }
  private emit(): void { this.listeners.forEach(listener => listener()); }
  onSessionChange(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async requestPermission(): Promise<boolean> { return true; }
  openLibrary(): void { window.open(location.href, '_blank', 'noopener,noreferrer'); }
  async request<T extends Command>(command: T): Promise<ResultMap[T['type']]> {
    let result: unknown = null;
    switch (command.type) {
      case 'state': result = { ...this.state }; break;
      case 'setup': this.state = { lockMode: 'timeout', hasVault: true, unlocked: true, connected: false, url: 'https://synthetic.example', expiresAt: Date.now() + 900_000 }; this.emit(); result = { ...this.state }; break;
      case 'unlock': this.state = { ...this.state, unlocked: true, connected: false, expiresAt: Date.now() + 900_000 }; this.emit(); result = { ...this.state }; break;
      case 'lock': this.state = { ...this.state, unlocked: false, connected: false }; this.emit(); result = { ...this.state }; break;
      case 'forget': await this.appearance.write('system'); this.state = { lockMode: 'timeout', hasVault: false, unlocked: false, connected: false }; this.emit(); result = { ...this.state }; break;
      case 'replaceToken': this.state = { ...this.state, connected: false }; this.emit(); result = { ...this.state }; break;
      case 'connect': this.state = { ...this.state, connected: true }; this.emit(); result = { ...this.state }; break;
      case 'setLockMode': this.state = { ...this.state, lockMode: command.mode, expiresAt: Date.now() + 900_000 }; if (command.mode === 'browser') delete this.state.expiresAt; this.emit(); result = { ...this.state }; break;
      case 'activity': this.state = { ...this.state, expiresAt: Date.now() + 900_000 }; if (this.state.lockMode === 'browser') delete this.state.expiresAt; result = { ...this.state }; break;
      case 'collections': result = this.folders.map(f => ({ ...f })); break;
      case 'search': {
        const offset = Number(command.cursor ?? 0); const filtered = this.links.filter(link => (command.collectionId === null || link.collectionId === command.collectionId) && `${link.name} ${link.description} ${link.tags.join(' ')}`.toLowerCase().includes(command.query.toLowerCase()));
        result = { links: filtered.slice(offset, offset + 20).map(link => ({ ...link, tags: [...link.tags] })), nextCursor: offset + 20 < filtered.length ? String(offset + 20) : null }; break;
      }
      case 'createLink': this.links.unshift({ ...command.input, id: Math.max(0, ...this.links.map(link => link.id)) + 1 }); break;
      case 'updateLink': this.links = this.links.map(link => link.id === command.id ? { ...command.input, id: link.id } : link); break;
      case 'deleteLink': this.links = this.links.filter(link => link.id !== command.id); break;
      case 'createCollection': this.folders.push(this.folder(Math.max(...this.folders.map(f => f.id)) + 1, command.input.name, command.input.parentId)); break;
      case 'updateCollection': this.folders = this.folders.map(f => f.id === command.id ? { ...f, ...command.input } : f); break;
      case 'currentPage': result = { url: 'https://example.com/synthetic-current-page', name: 'Synthetic current page' }; break;
      default: throw new AppError('invalid_request');
    }
    return result as ResultMap[T['type']];
  }
}
