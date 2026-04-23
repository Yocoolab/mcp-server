import { describe, it, expect, vi } from 'vitest';
import { handleMarkAddressed } from '../../tools/mark-addressed.js';
import type { YocoolabApiClient } from '../../api-client.js';

function makeApi(): YocoolabApiClient {
  return {
    getThread: vi.fn().mockResolvedValue({ id: 'thread-1', repo: 'acme/repo' }),
    updateThread: vi.fn().mockResolvedValue({}),
    addMessage: vi.fn().mockResolvedValue({}),
  } as unknown as YocoolabApiClient;
}

describe('handleMarkAddressed', () => {
  it('resolves the thread by setting status to resolved', async () => {
    const api = makeApi();
    await handleMarkAddressed(api, { thread_id: 'thread-1' });

    expect(api.updateThread).toHaveBeenCalledWith('thread-1', 'acme/repo', {
      status: 'resolved',
      claude_code_pending: false,
    });
  });

  it('adds message when provided', async () => {
    const api = makeApi();
    await handleMarkAddressed(api, { thread_id: 'thread-1', message: 'Fixed in PR #42' });

    expect(api.addMessage).toHaveBeenCalledWith('thread-1', 'Fixed in PR #42', 'acme/repo');
  });

  it('does not add message when not provided', async () => {
    const api = makeApi();
    await handleMarkAddressed(api, { thread_id: 'thread-1' });

    expect(api.addMessage).not.toHaveBeenCalled();
  });

  it('returns confirmation text', async () => {
    const api = makeApi();
    const result = await handleMarkAddressed(api, { thread_id: 'thread-1' });

    expect(result.content[0].text).toContain('Thread thread-1 has been resolved');
  });

  it('includes message in confirmation when provided', async () => {
    const api = makeApi();
    const result = await handleMarkAddressed(api, { thread_id: 'thread-1', message: 'Done' });

    expect(result.content[0].text).toContain('Message added: "Done"');
  });
});
