import { AppError } from './errors';
import type { Collection } from './models';

export function collectionPath(collections: Collection[], id: number | null): Collection[] {
  const byId = new Map(collections.map(folder => [folder.id, folder]));
  const path: Collection[] = [];
  const visited = new Set<number>();
  let cursor = id;
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const folder = byId.get(cursor);
    if (!folder) break;
    path.unshift(folder);
    cursor = folder.parentId;
  }
  return path;
}

export function directChildren(collections: Collection[], parentId: number | null): Collection[] {
  const ids = new Set(collections.map(folder => folder.id));
  // A malformed server tree must not hide an entire cycle from root navigation.
  const cycleRoots = new Set<number>();
  if (parentId === null) {
    const byId = new Map(collections.map(folder => [folder.id, folder]));
    const done = new Set<number>();
    for (const folder of collections) {
      const path: number[] = [];
      const positions = new Map<number, number>();
      let cursor: number | null = folder.id;
      while (cursor !== null && byId.has(cursor) && !done.has(cursor)) {
        const position = positions.get(cursor);
        if (position !== undefined) { cycleRoots.add(Math.min(...path.slice(position))); break; }
        positions.set(cursor, path.length); path.push(cursor);
        cursor = byId.get(cursor)!.parentId;
      }
      for (const id of path) done.add(id);
    }
  }
  return collections.filter(folder => parentId === null
    ? folder.parentId === null || !ids.has(folder.parentId) || cycleRoots.has(folder.id)
    : folder.parentId === parentId
  ).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

export function descendants(collections: Collection[], id: number): Set<number> {
  const result = new Set<number>([id]);
  const children = new Map<number, number[]>();
  for (const folder of collections) {
    if (folder.parentId !== null) {
      const siblings = children.get(folder.parentId) ?? [];
      siblings.push(folder.id); children.set(folder.parentId, siblings);
    }
  }
  const queue = [id];
  for (let index = 0; index < queue.length; index++) {
    const parentId = queue[index];
    for (const child of children.get(parentId!) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

export function assertDestination(collections: Collection[], id: number, parentId: number | null): void {
  if (!collections.some(folder => folder.id === id)) throw new AppError('not_found');
  if (parentId !== null && (!collections.some(folder => folder.id === parentId) || descendants(collections, id).has(parentId))) {
    throw new AppError('invalid_destination');
  }
}
