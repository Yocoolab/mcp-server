import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YocoolabApiClient, YocoolabApiError, agentDisplayName } from '../api-client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('YocoolabApiClient', () => {
  let api: YocoolabApiClient;

  beforeEach(() => {
    mockFetch.mockReset();
    api = new YocoolabApiClient('http://localhost:3000', 'test-token');
  });

  it('sets Authorization header with Bearer token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await api.listThreads('acme/repo');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer test-token');
  });

  it('strips trailing slashes from baseUrl', async () => {
    const apiSlash = new YocoolabApiClient('http://localhost:3000/', 'tok');
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await apiSlash.listThreads('acme/repo');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/v1/threads?repo=acme%2Frepo');
  });

  describe('listThreads', () => {
    it('calls GET /threads with repo param', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 't1' }]));
      const result = await api.listThreads('acme/repo');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v1/threads?repo=acme%2Frepo');
      expect(result).toEqual([{ id: 't1' }]);
    });

    it('includes status and branch filters', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));
      await api.listThreads('acme/repo', { status: 'open', branch: 'dev' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('status=open');
      expect(url).toContain('branch=dev');
    });
  });

  describe('getThread', () => {
    it('calls GET /threads/:id', async () => {
      const thread = { id: 'abc', repo: 'acme/repo', messages: [] };
      mockFetch.mockResolvedValueOnce(jsonResponse(thread));
      const result = await api.getThread('abc');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/v1/threads/abc');
      expect(result).toEqual(thread);
    });
  });

  describe('updateThread', () => {
    it('calls PATCH /threads/:id with PR fields', async () => {
      const updated = { id: 't1', pr_number: 42 };
      mockFetch.mockResolvedValueOnce(jsonResponse(updated));

      const result = await api.updateThread('t1', 'acme/repo', {
        pr_number: 42,
        pr_url: 'https://github.com/acme/repo/pull/42',
        pr_branch: 'fix/btn',
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.method).toBe('PATCH');
      const body = JSON.parse(opts.body);
      expect(body.repo).toBe('acme/repo');
      expect(body.pr_number).toBe(42);
      expect(body.pr_url).toBe('https://github.com/acme/repo/pull/42');
      expect(body.pr_branch).toBe('fix/btn');
      expect(result).toEqual(updated);
    });
  });

  describe('addMessage', () => {
    it('calls POST /threads/:id/messages', async () => {
      const msg = { id: 'm1', content: 'Hello' };
      mockFetch.mockResolvedValueOnce(jsonResponse(msg));

      const result = await api.addMessage('t1', 'Hello', 'acme/repo');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/v1/threads/t1/messages');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.content).toBe('Hello');
      expect(body.repo).toBe('acme/repo');
      expect(result).toEqual(msg);
    });
  });

  describe('notifyParticipants', () => {
    it('calls POST /threads/:id/notify with pr_created', async () => {
      const response = { notified: 3, message: 'Notified 3 participant(s)' };
      mockFetch.mockResolvedValueOnce(jsonResponse(response));

      const result = await api.notifyParticipants(
        't1',
        'acme/repo',
        'pr_created',
        'PR #42 created',
        'https://github.com/acme/repo/pull/42'
      );

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/v1/threads/t1/notify');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.type).toBe('pr_created');
      expect(body.pr_url).toBe('https://github.com/acme/repo/pull/42');
      expect(result.notified).toBe(3);
    });
  });

  describe('getThreadBrief', () => {
    it('calls GET /threads/:id/brief?format=json, worded for attached images when asked', async () => {
      const brief = { brief_version: 1, markdown: '## Yocoolab thread t1\n', images: [] };
      mockFetch.mockResolvedValueOnce(jsonResponse(brief));
      const result = await api.getThreadBrief('t1', { images: 'attached' });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/v1/threads/t1/brief?format=json&images=attached');
      expect(opts.method).toBeUndefined();
      expect(result).toEqual(brief);
    });

    it('leaves drafts out only when asked', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ markdown: 'x' }));
      await api.getThreadBrief('t1', { drafts: false });

      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/threads/t1/brief?format=json&drafts=0');
    });

    it('returns null on 404 (a backend from before the brief, or the brief turned off)', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'The agent brief is turned off', code: 'brief_disabled' }, 404));
      expect(await api.getThreadBrief('t1')).toBeNull();
    });

    it('throws other failures with their status', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Guests cannot read the agent brief' }, 403));
      const err = await api.getThreadBrief('t1').catch((e) => e);

      expect(err).toBeInstanceOf(YocoolabApiError);
      expect(err.status).toBe(403);
    });

    it('encodes the thread id into the path', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ markdown: 'x' }));
      await api.getThreadBrief('../threads?x=1');

      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/threads/..%2Fthreads%3Fx%3D1/brief?format=json');
    });
  });

  describe('getThreadImages / getThreadSketch', () => {
    it('asks /threads/:id/images for one kind', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ element: { dataUrl: 'data:image/png;base64,AA', w: 1, h: 1 } }));
      const result = await api.getThreadImages('t1', 'element');

      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/threads/t1/images?kind=element');
      expect(result.element?.dataUrl).toBe('data:image/png;base64,AA');
    });

    it('a backend without /images answers {}; without a sketch, null', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404));
      expect(await api.getThreadImages('t1')).toEqual({});
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404));
      expect(await api.getThreadSketch('t1')).toBeNull();
    });
  });

  describe('addressThread', () => {
    it('POSTs /threads/:id/addressed with the links, the message and the agent name — and nothing empty', async () => {
      const answer = { ok: true, thread: { id: 't1' }, message: null, recorded: {}, rejected: [] };
      mockFetch.mockResolvedValueOnce(jsonResponse(answer));
      const result = await api.addressThread('t1', {
        message: 'Done',
        pr_url: 'https://github.com/acme/repo/pull/42',
        pr_branch: null,
        preview_url: '',
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/v1/threads/t1/addressed');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({
        author_display_name: agentDisplayName(),
        message: 'Done',
        pr_url: 'https://github.com/acme/repo/pull/42',
      });
      expect(result).toEqual(answer);
    });

    it('returns null on 404 (a backend from before the route)', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404));
      expect(await api.addressThread('t1', {})).toBeNull();
    });
  });

  describe('error handling', () => {
    it('throws on non-200 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('Thread not found'),
      });

      await expect(api.getThread('missing')).rejects.toThrow('API request failed: 404 Not Found');
    });

    it('carries the HTTP status on the error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
      const err = await api.getThread('t1').catch((e) => e);

      expect(err).toBeInstanceOf(YocoolabApiError);
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(500);
    });
  });
});
