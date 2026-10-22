export interface Collection {
  id: number;
  name: string;
  parentId: number | null;
  ownerId: number;
  shared: boolean;
  canManage: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  linkCount: number | null;
}
export interface Link {
  id: number;
  name: string;
  url: string;
  description: string;
  collectionId: number;
  tags: string[];
}
export interface LinkPage { links: Link[]; nextCursor: string | null }
export interface LinkInput {
  url: string;
  name: string;
  description: string;
  collectionId: number;
  tags: string[];
}
export interface CollectionInput { name: string; parentId: number | null }

export function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
