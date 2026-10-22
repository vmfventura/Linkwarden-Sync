import { describe, expect, it } from 'vitest';
import { parseCommand, trustedSender } from '../src/core/commands';
import { assertDestination, collectionPath, descendants, directChildren } from '../src/core/collections';
import type { Collection } from '../src/core/models';
const folder = (id: number, parentId: number | null): Collection => ({ id, parentId, name: String(id), ownerId: 1, shared: false,
  canCreate: true, canUpdate: true, canDelete: true, canManage: true, linkCount: 0 });
describe('message boundary', () => {
  it('accepts only exact extension UI pages and ID', () => {
    const pages = ['moz-extension://uuid/popup.html', 'moz-extension://uuid/library.html'];
    expect(trustedSender({ id: 'extension', url: pages[0]! }, 'extension', pages)).toBe(true);
    for (const sender of [{ id: 'other', url: pages[0]! }, { id: 'extension', url: 'https://page.test' }, { id: 'extension' },
      { id: 'extension', url: `${pages[0]}?spoof` }]) expect(trustedSender(sender, 'extension', pages)).toBe(false);
  });
  it.each([null, [], {}, { type: 'setLockMode', mode: 'never' }, { type: 'setLockMode', mode: true }, { type: 'setLockMode', mode: 'browser', token: 'extra' }, { type: 'state', token: 'unexpected' }, { type: 'unlock', password: 'x'.repeat(1025) },
    { type: 'search', collectionId: null, query: '', cursor: '../redirect' }, { type: 'deleteLink', id: -1 },
    { type: 'createCollection', input: { name: 'x', parentId: null, members: [] } }])('rejects malformed messages %j', input => expect(() => parseCommand(input)).toThrow());
  it.each(['timeout', 'browser'])('accepts explicit lock mode %s', mode => expect(parseCommand({ type: 'setLockMode', mode })).toEqual({ type: 'setLockMode', mode }));
  it('accepts explicitly bounded commands', () => expect(parseCommand({ type: 'search', collectionId: 1, query: 'test', cursor: '99' })).toMatchObject({ cursor: '99' }));
});
describe('collection navigation', () => {
  it('exposes every sibling, orphan, empty folder, and a root for disconnected cycles', () => {
    const folders = [folder(1, null), ...Array.from({ length: 150 }, (_, index) => folder(index + 2, 1)), folder(200, 999), folder(201, 202), folder(202, 201)];
    expect(directChildren(folders, 1)).toHaveLength(150);
    expect(directChildren(folders, null).map(f => f.id)).toEqual(expect.arrayContaining([1, 200, 201]));
    expect(directChildren(folders, 201).map(f => f.id)).toContain(202);
    expect(collectionPath(folders, 201)).toHaveLength(2);
  });
  it('traverses descendants without recursion or cycle loops and prevents cycles on writes', () => {
    const folders = [folder(1, 2), folder(2, 1), folder(3, 2)];
    expect(descendants(folders, 1)).toEqual(new Set([1, 2, 3]));
    expect(() => assertDestination(folders, 1, 3)).toThrow();
    expect(() => assertDestination(folders, 1, null)).not.toThrow();
  });
});
