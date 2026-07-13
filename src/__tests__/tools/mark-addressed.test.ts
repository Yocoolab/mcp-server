import { describe, it, expect, vi } from 'vitest';
import { handleMarkAddressed } from '../../tools/mark-addressed.js';
import type { YocoolabApiClient } from '../../api-client.js';

function makeApi(): YocoolabApiClient {
  return {
    getThread: vi.fn().mockResolvedValue({ id: 'thread-1', repo: 'acme/repo' }),
    updateThread: vi.fn().mockResolvedValue({}),
    addMessage: vi.fn().mockResolvedValue({}),
    notifyParticipants: vi.fn().mockResolvedValue({ notified: 1 }),
  } as unknown as YocoolabApiClient;
}

describe('handleMarkAddressed', () => {
  it('moves the thread to In Review and clears pending — it does NOT resolve', async () => {
    const api = makeApi();
    await handleMarkAddressed(api, { thread_id: 'thread-1' });

    expect(api.updateThread).toHaveBeenCalledWith('thread-1', 'acme/repo', {
      kanban_stage: 'in_review',
      claude_code_pending: false,
    });
  });

  it('never sets status — closing a thread is a human decision', async () => {
    const api = makeApi();
    await handleMarkAddressed(api, { thread_id: 'thread-1' });

    const updates = (api.updateThread as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(updates).not.toHaveProperty('status');
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

  it('returns confirmation text saying it moved to In Review, not resolved', async () => {
    const api = makeApi();
    const result = await handleMarkAddressed(api, { thread_id: 'thread-1' });

    expect(result.content[0].text).toContain('Thread thread-1 moved to In Review');
    expect(result.content[0].text).toContain('NOT auto-resolved');
  });

  it('includes message in confirmation when provided', async () => {
    const api = makeApi();
    const result = await handleMarkAddressed(api, { thread_id: 'thread-1', message: 'Done' });

    expect(result.content[0].text).toContain('Message added: "Done"');
  });

  it('notifies participants that a change is ready for review', async () => {
    const api = makeApi();
    await handleMarkAddressed(api, { thread_id: 'thread-1' });

    expect(api.notifyParticipants).toHaveBeenCalledWith(
      'thread-1',
      'acme/repo',
      'pr_created',
      'A change is ready for your review.',
    );
  });
});
