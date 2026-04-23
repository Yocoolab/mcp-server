import { describe, it, expect, vi } from 'vitest';
import { handleAddThreadMessage } from '../../tools/add-thread-message.js';
import type { YocoolabApiClient } from '../../api-client.js';

function makeApi(): YocoolabApiClient {
  return {
    getThread: vi.fn().mockResolvedValue({ id: 'thread-1', repo: 'acme/repo', messages: [] }),
    addMessage: vi.fn().mockResolvedValue({ id: 'msg-1', content: 'test' }),
  } as unknown as YocoolabApiClient;
}

describe('handleAddThreadMessage', () => {
  it('fetches thread to get repo then calls addMessage', async () => {
    const api = makeApi();
    await handleAddThreadMessage(api, { thread_id: 'thread-1', message: 'Fix is live!' });

    expect(api.getThread).toHaveBeenCalledWith('thread-1');
    expect(api.addMessage).toHaveBeenCalledWith('thread-1', 'Fix is live!', 'acme/repo');
  });

  it('returns confirmation text with thread id', async () => {
    const api = makeApi();
    const result = await handleAddThreadMessage(api, { thread_id: 'thread-1', message: 'Fix is live!' });

    expect(result.content[0].text).toContain('thread-1');
    expect(result.content[0].text).toContain('Fix is live!');
  });

  it('does not resolve the thread', async () => {
    const api = makeApi();
    // Ensure updateThread is not called (thread stays open)
    (api as any).updateThread = vi.fn();

    await handleAddThreadMessage(api, { thread_id: 'thread-1', message: 'Update' });

    expect((api as any).updateThread).not.toHaveBeenCalled();
  });
});
