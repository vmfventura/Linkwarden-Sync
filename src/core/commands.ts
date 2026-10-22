import { AppError } from './errors';
import { positiveId } from './models';
import type { Command } from './protocol';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid_request');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) throw new AppError('invalid_request');
}
function string(value: unknown, max: number): boolean { return typeof value === 'string' && value.length <= max; }
function folder(value: unknown): void {
  const input = record(value);
  keys(input, ['name', 'parentId']);
  if (!string(input.name, 2048) || (input.parentId !== null && !positiveId(input.parentId))) throw new AppError('invalid_request');
}
function link(value: unknown): void {
  const input = record(value);
  keys(input, ['url', 'name', 'description', 'collectionId', 'tags']);
  if (!string(input.url, 2048) || !string(input.name, 2048) || !string(input.description, 2048) ||
    !positiveId(input.collectionId) || !Array.isArray(input.tags) || input.tags.length > 50 ||
    input.tags.some(tag => !string(tag, 50))) throw new AppError('invalid_request');
}
/** Runtime validation is independent of the TypeScript UI and rejects extra message fields. */
export function parseCommand(value: unknown): Command {
  const data = record(value);
  switch (data.type) {
    case 'state': case 'lock': case 'forget': case 'activity': case 'connect': case 'collections': case 'currentPage':
      keys(data, ['type']); break;
    case 'setup':
      keys(data, ['type', 'url', 'token', 'password']);
      if (!string(data.url, 2048) || !string(data.token, 4096) || !string(data.password, 1024)) throw new AppError('invalid_request');
      break;
    case 'setLockMode':
      keys(data, ['type', 'mode']);
      if (data.mode !== 'timeout' && data.mode !== 'browser') throw new AppError('invalid_request');
      break;
    case 'unlock':
      keys(data, ['type', 'password']);
      if (!string(data.password, 1024)) throw new AppError('invalid_request');
      break;
    case 'replaceToken':
      keys(data, ['type', 'token', 'password']);
      if (!string(data.token, 4096) || !string(data.password, 1024)) throw new AppError('invalid_request');
      break;
    case 'search':
      keys(data, ['type', 'collectionId', 'query', 'cursor']);
      if ((data.collectionId !== null && !positiveId(data.collectionId)) || !string(data.query, 500) ||
        (data.cursor !== null && (typeof data.cursor !== 'string' || !/^\d{1,20}$/u.test(data.cursor)))) throw new AppError('invalid_request');
      break;
    case 'createLink': keys(data, ['type', 'input']); link(data.input); break;
    case 'updateLink':
      keys(data, ['type', 'id', 'input', 'original']);
      if (!positiveId(data.id)) throw new AppError('invalid_request');
      link(data.input); link(data.original); break;
    case 'deleteLink':
      keys(data, ['type', 'id']);
      if (!positiveId(data.id)) throw new AppError('invalid_request');
      break;
    case 'createCollection': keys(data, ['type', 'input']); folder(data.input); break;
    case 'updateCollection':
      keys(data, ['type', 'id', 'input']);
      if (!positiveId(data.id)) throw new AppError('invalid_request');
      folder(data.input); break;
    default: throw new AppError('invalid_request');
  }
  return data as unknown as Command;
}

export function trustedSender(sender: { id?: string; url?: string; origin?: string; tab?: unknown }, extensionId: string, pageUrls: string[]): boolean {
  // A matching ID alone also admits content scripts. Only our two document URLs may call the broker.
  return sender.id === extensionId && typeof sender.url === 'string' && pageUrls.includes(sender.url);
}
