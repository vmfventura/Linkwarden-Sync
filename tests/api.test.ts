import { describe, expect, it, vi } from 'vitest';
import { LinkwardenApi, parsePage, safeLinkUrl, type ApiContext } from '../src/core/api';
const owner = { id: 1, name: 'Owner folder', ownerId: 7, parentId: null, members: [], _count: { links: 1 } };
const target = { ...owner, id: 2, name: 'Target' };
const link = { id: 9, name: '<script>private</script>', url: 'https://example.test', description: 'Keep me', collectionId: 1,
  collection: { id: 1, ownerId: 7 }, tags: [{ name: 'keep' }] };
function harness(responses: Array<unknown | Response | Error>) {
  const requests: Array<{ url: string; options: RequestInit }> = [];
  const fetcher = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    requests.push({ url: String(input), options: options! });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return Response.json(next);
  }) as unknown as typeof fetch;
  const context: ApiContext = { connection: { url: 'https://links.example.test/base', token: 'opaque-test-token' },
    signal: new AbortController().signal, assertActive: vi.fn(async () => undefined),
    onAuthenticationFailure: vi.fn(async () => undefined), fetch: fetcher };
  return { api: new LinkwardenApi(context), requests, context, fetcher };
}
describe('Linkwarden 2.16.3 API contracts', () => {
  it('restricts credentialed requests to the configured base and disables redirects/cookies/cache', async () => {
    const h = harness([{ response: { id: 7 } }]); await h.api.verify();
    expect(h.requests[0]).toMatchObject({ url: 'https://links.example.test/base/api/v1/users/me', options: {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer opaque-test-token', Accept: 'application/json' },
    } });
    expect(h.context.assertActive).toHaveBeenCalledTimes(3);
  });
  it('reads all flat folders, parent IDs and member rights from the account', async () => {
    const h = harness([{ response: { id: 7 } }, { response: [owner, { ...target, ownerId: 8, parentId: 1,
      members: [{ userId: 7, canCreate: true, canUpdate: false, canDelete: false }] }] }]);
    expect(await h.api.collections()).toMatchObject([{ id: 1, canManage: true }, { id: 2, parentId: 1, canManage: false, canCreate: true, canUpdate: false }]);
  });
  it('sends all link fields and current collection owner when moving a link', async () => {
    const h = harness([{ response: { id: 7 } }, { response: [owner, target] }, { response: link }, {}]);
    await h.api.updateLink(9, { url: link.url, name: link.name, description: link.description, tags: ['keep'], collectionId: 2 }, { url: link.url, name: link.name, description: link.description, tags: ['keep'], collectionId: link.collectionId });
    expect(JSON.parse(h.requests.at(-1)!.options.body as string)).toEqual({ id: 9, url: 'https://example.test', name: link.name,
      description: 'Keep me', tags: [{ name: 'keep' }], collection: { id: 2, ownerId: 7 } });
  });
  it('preserves freshly read complete memberships and uses root sentinel when detaching', async () => {
    const members = [{ userId: 8, canCreate: true, canUpdate: false, canDelete: true }];
    const h = harness([{ response: { id: 7 } }, { response: [owner, { ...target, parentId: 1 }] }, { response: { ...target, members } }, {}]);
    await h.api.updateCollection(2, { name: 'Renamed', parentId: null });
    expect(JSON.parse(h.requests.at(-1)!.options.body as string)).toEqual({ id: 2, name: 'Renamed', parentId: 'root', members });
  });
  it('rejects folder moves into descendants before mutation', async () => {
    const h = harness([{ response: { id: 7 } }, { response: [owner, { ...target, parentId: 1 }] }]);
    await expect(h.api.updateCollection(1, { name: 'Cycle', parentId: 2 })).rejects.toMatchObject({ code: 'invalid_destination' });
    expect(h.requests.every(request => request.options.method === 'GET')).toBe(true);
  });
  it('preserves raw URLs and unusual schemes without breaking a result page', () => {
    const page = parsePage({ success: true, data: { links: [link, { ...link, id: 10, url: 'javascript:alert(1)' }], nextCursor: null } }, null);
    expect(page.links.map(item => item.url)).toEqual(['https://example.test', 'javascript:alert(1)']);
  });
  it('uses the fresh raw URL when only metadata changed, including external URL edits', async () => {
    const fresh = { ...link, url: 'https://EXAMPLE.test:443/changed' };
    const h = harness([{ response: { id: 7 } }, { response: [owner] }, { response: fresh }, {}]);
    await h.api.updateLink(9, { url: link.url, name: 'Renamed', description: link.description, tags: ['keep'], collectionId: 1 }, { url: link.url, name: link.name, description: link.description, tags: ['keep'], collectionId: link.collectionId });
    expect(JSON.parse(h.requests.at(-1)!.options.body as string).url).toBe(fresh.url);
  });
  it('distinguishes an operation permission 401 from an invalid token', async () => {
    const h = harness([new Response('', { status: 401 }), { response: { id: 7 } }]);
    await expect(h.api.deleteLink(9)).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.context.onAuthenticationFailure).not.toHaveBeenCalled();
    expect(h.requests.at(-1)!.url).toMatch(/users\/me$/u);
  });
  it('locks only if the follow-up account check also rejects authentication', async () => {
    const h = harness([new Response('', { status: 401 }), new Response('', { status: 401 })]);
    await expect(h.api.deleteLink(9)).rejects.toMatchObject({ code: 'authentication' });
    expect(h.context.onAuthenticationFailure).toHaveBeenCalledOnce();
  });
  it('reports an interrupted write as uncertain even if the session was aborted', async () => {
    const controller = new AbortController(); const h = harness([new DOMException('aborted', 'AbortError')]);
    h.context.signal = controller.signal; controller.abort();
    await expect(h.api.deleteLink(9)).rejects.toMatchObject({ code: 'write_uncertain' });
  });
  it('does not turn a confirmed successful mutation into a retry error after lock', async () => {
    const h = harness([{}]);
    vi.mocked(h.context.assertActive).mockResolvedValueOnce(undefined).mockRejectedValue(new Error('locked after success'));
    await expect(h.api.deleteLink(9)).resolves.toBeNull();
  });
  it('reports a conflict rather than overwriting newly changed tags', async () => {
    const h = harness([{ response: { id: 7 } }, { response: [owner] }, { response: { ...link, tags: [{ name: 'new-server-tag' }] } }]);
    const baseline = { url: link.url, name: link.name, description: link.description, tags: ['keep'], collectionId: 1 };
    await expect(h.api.updateLink(9, { ...baseline, name: 'My edit' }, baseline)).rejects.toMatchObject({ code: 'conflict' });
    expect(h.requests).toHaveLength(3);
  });
  it.each([null, ' https://example.test '])('refuses unsafe metadata edits for stored URL %s', async url => {
    const h = harness([{ response: { id: 7 } }, { response: [owner] }, { response: { ...link, url } }]);
    const baseline = { url: url ?? '', name: link.name, description: link.description, tags: ['keep'], collectionId: 1 };
    await expect(h.api.updateLink(9, baseline, baseline)).rejects.toMatchObject({ code: 'unsupported_edit' });
    expect(h.requests).toHaveLength(3);
  });
  it.each([500, 502, 503, 504])('treats mutation HTTP %s as uncertain', async status => {
    const h = harness([new Response('', { status })]);
    await expect(h.api.deleteLink(9)).rejects.toMatchObject({ code: 'write_uncertain' });
  });
  it('preserves existing comma and whitespace tag names during a metadata edit', async () => {
    const tags = ['with,comma', ' spaced '];
    const h = harness([{ response: { id: 7 } }, { response: [owner] }, { response: { ...link, tags: tags.map(name => ({ name })) } }, {}]);
    const baseline = { url: link.url, name: link.name, description: link.description, tags, collectionId: 1 };
    await h.api.updateLink(9, { ...baseline, name: 'Renamed' }, baseline);
    expect(JSON.parse(h.requests.at(-1)!.options.body as string).tags).toEqual(tags.map(name => ({ name })));
  });
  it('does not guess an implicit collection for link creation', async () => {
    const h = harness([]);
    await expect(h.api.createLink({ url: link.url, name: '', description: '', tags: [], collectionId: 0 })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.requests).toHaveLength(0);
  });
  it('treats failed mutation transport as uncertain and never retries automatically', async () => {
    const h = harness([new TypeError('network includes private details')]);
    await expect(h.api.deleteLink(9)).rejects.toMatchObject({ code: 'write_uncertain' });
    expect(h.requests).toHaveLength(1);
  });
  it('invalid authentication locks via callback without exposing the remote response', async () => {
    const h = harness([new Response('private remote error', { status: 401 })]);
    await expect(h.api.verify()).rejects.toMatchObject({ message: 'authentication' });
    expect(h.context.onAuthenticationFailure).toHaveBeenCalledOnce();
  });
  it('requires JSON, bounded bodies, and valid response shapes', async () => {
    for (const response of [new Response('secret html'), Response.json({ response: null }),
      new Response('x'.repeat(4 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } })]) {
      await expect(harness([response]).api.verify()).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });
  it('retains an advancing opaque cursor when local exact-folder filtering yields no links', () => {
    expect(parsePage({ success: true, data: { links: [link], nextCursor: 99 } }, 2)).toEqual({ links: [], nextCursor: '99' });
    expect(parsePage({ success: true, data: [] }, null)).toEqual({ links: [], nextCursor: null });
    expect(() => parsePage({ success: true, data: { links: [], nextCursor: 'https://evil.test' } }, null)).toThrow();
  });
  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/a', 'https://u:p@example.test', 'https://x.test/\nsecret'])('never accepts privileged link scheme %s', url => {
    expect(() => safeLinkUrl(url)).toThrow();
  });
});
