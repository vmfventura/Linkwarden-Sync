import type { Connection } from './connection';
import { AppError } from './errors';
import { assertDestination } from './collections';
import { positiveId, type Collection, type CollectionInput, type Link, type LinkInput, type LinkPage } from './models';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid_response');
  return value as ObjectValue;
}
function text(value: unknown, max: number, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new AppError('invalid_response');
  return value;
}
function id(value: unknown): number {
  if (!positiveId(value)) throw new AppError('invalid_response');
  return value;
}
function parent(value: unknown): number | null {
  return value === null || value === undefined ? null : id(value);
}
function list(value: unknown, max = 50_000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new AppError('invalid_response');
  return value;
}
export function safeLinkUrl(value: string): string {
  if (value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) throw new AppError('invalid_request');
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('invalid_request'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new AppError('invalid_request');
  return url.href;
}
function parseCollection(value: unknown, userId: number): Collection {
  const data = object(value);
  const members = list(data.members ?? [], 10_000).map(object);
  const member = members.find(item => item.userId === userId);
  const ownerId = id(data.ownerId);
  const owned = ownerId === userId;
  const counts = data._count ? object(data._count) : null;
  return {
    id: id(data.id), name: text(data.name, 2048), parentId: parent(data.parentId), ownerId,
    shared: data.isPublic === true || members.length > 0,
    linkCount: typeof counts?.links === 'number' && Number.isSafeInteger(counts.links) && counts.links >= 0 ? counts.links : null,
    canManage: owned,
    canCreate: owned || member?.canCreate === true,
    canUpdate: owned || member?.canUpdate === true,
    canDelete: owned || member?.canDelete === true,
  };
}
export function parseLink(value: unknown): Link {
  const data = object(value);
  const collection = object(data.collection);
  const url = text(data.url, 2048);
  // File/attachment entries are deliberately not opened as privileged extension URLs.
  return {
    id: id(data.id), name: text(data.name, 4096), url,
    description: text(data.description, 16_384), collectionId: id(data.collectionId ?? collection.id),
    tags: list(data.tags ?? [], 1000).map(tag => text(object(tag).name, 50)),
  };
}
export function parsePage(value: unknown, collectionId: number | null): LinkPage {
  const body = object(value);
  if (body.success !== true) throw new AppError('invalid_response');
  if (Array.isArray(body.data)) {
    if (body.data.length !== 0) throw new AppError('invalid_response');
    return { links: [], nextCursor: null };
  }
  const data = object(body.data);
  const cursor = data.nextCursor;
  if (cursor !== null && cursor !== undefined &&
      !((typeof cursor === 'number' && Number.isSafeInteger(cursor) && cursor >= 0) ||
        (typeof cursor === 'string' && /^\d{1,20}$/u.test(cursor)))) throw new AppError('invalid_response');
  const links = list(data.links, 5000).map(parseLink);
  return {
    links: links.filter(link => collectionId === null || link.collectionId === collectionId),
    nextCursor: cursor === null || cursor === undefined ? null : String(cursor),
  };
}
async function readJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new AppError('invalid_response');
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('invalid_response');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new AppError('invalid_response'); }
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new AppError('invalid_response'); }
  } finally { reader.releaseLock(); }
}
export interface ApiContext {
  connection: Connection;
  signal: AbortSignal;
  assertActive(): Promise<void>;
  onAuthenticationFailure(): Promise<void>;
  fetch?: typeof fetch;
}

export class LinkwardenApi {
  constructor(private readonly context: ApiContext) {}

  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const { context } = this;
    await context.assertActive();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    context.signal.addEventListener('abort', cancel, { once: true });
    if (context.signal.aborted) controller.abort();
    let timedOut = false;
    let sent = false;
    let definiteFailure = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    try {
      sent = true;
      const response = await (context.fetch ?? fetch)(`${context.connection.url}/api/v1/${path}`, {
        method, headers: { Authorization: `Bearer ${context.connection.token}`, Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      // A confirmed mutation has no response data to expose. Lock cannot undo it.
      if (method !== 'GET' && response.ok) { await response.body?.cancel().catch(() => undefined); return null; }
      if (!response.ok && response.status < 500) definiteFailure = true;
      await context.assertActive();
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 401) {
          if (path !== 'users/me') {
            await this.verify(); // The server also uses 401 for authorization failures.
            throw new AppError('forbidden');
          }
          await context.onAuthenticationFailure(); throw new AppError('authentication');
        }
        if (response.status === 403) throw new AppError('forbidden');
        if (response.status === 404) throw new AppError('not_found');
        if (response.status === 409) throw new AppError('duplicate');
        if (response.status === 429) throw new AppError('rate_limited');
        throw new AppError(response.status >= 500 ? (method === 'GET' ? 'server' : 'write_uncertain') : 'invalid_request');
      }
      const result = await readJson(response);
      await context.assertActive();
      return result;
    } catch (error) {
      if (method !== 'GET' && sent && !definiteFailure) throw new AppError('write_uncertain');
      if (error instanceof AppError) throw error;
      if (context.signal.aborted) throw new AppError('session_changed');
      if (method !== 'GET') throw new AppError('write_uncertain');
      throw new AppError(timedOut ? 'timeout' : 'network');
    } finally {
      clearTimeout(timeout);
      context.signal.removeEventListener('abort', cancel);
    }
  }

  async verify(): Promise<void> { id(object(object(await this.request('users/me')).response).id); }

  async collections(): Promise<Collection[]> {
    const userId = id(object(object(await this.request('users/me')).response).id);
    const folders = list(object(await this.request('collections')).response).map(value => parseCollection(value, userId));
    if (new Set(folders.map(folder => folder.id)).size !== folders.length) throw new AppError('invalid_response');
    return folders;
  }

  async search(collectionId: number | null, query: string, cursor: string | null): Promise<LinkPage> {
    if (collectionId !== null && !positiveId(collectionId)) throw new AppError('invalid_request');
    if (query.length > 500 || (cursor !== null && !/^\d{1,20}$/u.test(cursor))) throw new AppError('invalid_request');
    const params = new URLSearchParams({ sort: '0' });
    if (collectionId !== null) params.set('collectionId', String(collectionId));
    if (query) params.set('searchQueryString', query);
    if (cursor !== null) params.set('cursor', cursor);
    return parsePage(await this.request(`search?${params}`), collectionId);
  }

  private validateLink(input: LinkInput, preserveUrl = false): LinkInput {
    if (!input || !positiveId(input.collectionId) || typeof input.name !== 'string' || input.name.length > 2048 ||
        typeof input.description !== 'string' || input.description.length > 2048 ||
        !Array.isArray(input.tags) || input.tags.length > 50 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 50)) {
      throw new AppError('invalid_request');
    }
    if (typeof input.url !== 'string' || input.url.length > 2048) throw new AppError('invalid_request');
    if (!preserveUrl) safeLinkUrl(input.url);
    return { ...input, tags: [...new Set(input.tags)] };
  }

  async createLink(input: LinkInput): Promise<null> {
    const data = this.validateLink(input);
    const target = (await this.collections()).find(folder => folder.id === data.collectionId);
    if (!target?.canCreate) throw new AppError('forbidden');
    await this.request('links', 'POST', { name: data.name, url: data.url, description: data.description,
      collection: { id: data.collectionId }, tags: data.tags.map(name => ({ name })) });
    return null;
  }

  async updateLink(linkId: number, input: LinkInput, baseline: LinkInput): Promise<null> {
    if (!positiveId(linkId)) throw new AppError('invalid_request');
    this.validateLink(baseline, true);
    const folders = await this.collections();
    const original = object(object(await this.request(`links/${linkId}`)).response);
    if (id(original.id) !== linkId) throw new AppError('invalid_response');
    if (typeof original.url !== 'string' || original.url !== original.url.trim()) throw new AppError('unsupported_edit');
    const unchanged = input.url === baseline.url;
    const fresh = parseLink(original);
    if (fresh.name !== baseline.name || fresh.description !== baseline.description || fresh.collectionId !== baseline.collectionId ||
      JSON.stringify([...fresh.tags].sort()) !== JSON.stringify([...baseline.tags].sort()) ||
      (!unchanged && fresh.url !== baseline.url)) throw new AppError('conflict');
    const data = this.validateLink(input, unchanged);
    // Preserve the fresh server URL byte-for-byte when the user edited other fields.
    data.url = unchanged ? text(original.url, 2048) : input.url;
    const currentCollection = object(original.collection);
    const current = folders.find(folder => folder.id === id(currentCollection.id));
    const target = folders.find(folder => folder.id === data.collectionId);
    if (!current?.canUpdate || !target || (target.id !== current.id && (!current.canManage || !target.canManage))) throw new AppError('forbidden');
    await this.request(`links/${linkId}`, 'PUT', { id: linkId, url: data.url, name: data.name,
      description: data.description, collection: { id: target.id, ownerId: id(currentCollection.ownerId) },
      tags: data.tags.map(name => ({ name })) });
    return null;
  }

  async deleteLink(linkId: number): Promise<null> {
    if (!positiveId(linkId)) throw new AppError('invalid_request');
    await this.request(`links/${linkId}`, 'DELETE');
    return null;
  }

  private validateFolder(input: CollectionInput): void {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 2048 ||
      (input.parentId !== null && !positiveId(input.parentId))) throw new AppError('invalid_request');
  }
  async createCollection(input: CollectionInput): Promise<null> {
    this.validateFolder(input);
    if (input.parentId !== null) {
      const parentFolder = (await this.collections()).find(folder => folder.id === input.parentId);
      if (!parentFolder?.canCreate || !parentFolder.canUpdate || !parentFolder.canDelete) throw new AppError('forbidden');
    }
    await this.request('collections', 'POST', { name: input.name.trim(), ...(input.parentId === null ? {} : { parentId: input.parentId }) });
    return null;
  }
  async updateCollection(collectionId: number, input: CollectionInput): Promise<null> {
    this.validateFolder(input);
    const folders = await this.collections();
    assertDestination(folders, collectionId, input.parentId);
    const current = folders.find(folder => folder.id === collectionId);
    const target = input.parentId === null ? null : folders.find(folder => folder.id === input.parentId);
    if (!current?.canManage || (target && !target.canManage)) throw new AppError('forbidden');
    const raw = object(object(await this.request(`collections/${collectionId}`)).response);
    if (id(raw.id) !== collectionId) throw new AppError('invalid_response');
    const members = list(raw.members, 10_000).map(memberValue => {
      const member = object(memberValue);
      if (typeof member.canCreate !== 'boolean' || typeof member.canUpdate !== 'boolean' || typeof member.canDelete !== 'boolean') throw new AppError('invalid_response');
      return { userId: id(member.userId), canCreate: member.canCreate, canUpdate: member.canUpdate, canDelete: member.canDelete };
    });
    // This endpoint replaces memberships. Always preserve the freshly-read list.
    await this.request(`collections/${collectionId}`, 'PUT', { id: collectionId, name: input.name.trim(),
      parentId: input.parentId === null ? 'root' : input.parentId, members });
    return null;
  }
}
