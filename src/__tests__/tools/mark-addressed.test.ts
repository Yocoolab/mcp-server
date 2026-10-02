import { describe, it, expect, vi } from 'vitest';
import { handleMarkAddressed, derivePrNumber } from '../../tools/mark-addressed.js';
import { PROJECT_PR_LINKS } from '../../feature-flags.js';
import type { YocoolabApiClient } from '../../api-client.js';

function makeApi(threadOverrides: Record<string, unknown> = {}): YocoolabApiClient {
  return {
    getThread: vi.fn().mockResolvedValue({ id: 'thread-1', repo: 'acme/repo', ...threadOverrides }),
    updateThread: vi.fn().mockResolvedValue({}),
    addMessage: vi.fn().mockResolvedValue({}),
    notifyParticipants: vi.fn().mockResolvedValue({ notified: 1 }),
  } as unknown as YocoolabApiClient;
}

const PROJECT_KEY = 'project:0f3b2a1c-4d5e-4f60-8a9b-0c1d2e3f4a5b';

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

  // ── PROJECT_PR_LINKS: link-only projects record their own PR / preview ──

  describe.skipIf(!PROJECT_PR_LINKS)('link-only project ("project:<uuid>" key) with pr_url + preview_url', () => {
    const args = {
      thread_id: 'thread-1',
      message: 'Bumped the CTA contrast.',
      pr_url: 'https://github.com/acme/site/pull/17',
      pr_branch: 'fix/cta-contrast',
      preview_url: 'https://site-git-fix-cta-contrast-acme.vercel.app',
    };

    it('moves the stage first, then PATCHes pr_url, derived pr_number and pr_branch separately', async () => {
      const api = makeApi({ repo: PROJECT_KEY, pr_number: null, pr_url: null });
      await handleMarkAddressed(api, args);

      const calls = (api.updateThread as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual(['thread-1', PROJECT_KEY, { kanban_stage: 'in_review', claude_code_pending: false }]);
      expect(calls[1]).toEqual(['thread-1', PROJECT_KEY, {
        pr_url: 'https://github.com/acme/site/pull/17',
        pr_number: 17,
        pr_branch: 'fix/cta-contrast',
      }]);
    });

    it('a rejected link PATCH never undoes the stage move, and the result says so', async () => {
      const api = makeApi({ repo: PROJECT_KEY, pr_number: null, pr_url: null });
      (api.updateThread as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('HTTP 400: pr_url must be a valid URL'));
      const result = await handleMarkAddressed(api, args);

      expect((api.updateThread as ReturnType<typeof vi.fn>).mock.calls[0][2]).toEqual({ kanban_stage: 'in_review', claude_code_pending: false });
      expect(api.addMessage).toHaveBeenCalledTimes(1); // the review message still goes out
      const notifyCall = (api.notifyParticipants as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(notifyCall[4]).toBeUndefined(); // no PR announced that was not recorded
      expect(result.content[0].text).toContain('could not be recorded');
      // The preview still counts as recorded (it lives in the message); the PR does not.
      expect(result.content[0].text).not.toMatch(/Links recorded on the thread: PR /);
    });

    it('posts the preview (and PR) link in the review message', async () => {
      const api = makeApi({ repo: PROJECT_KEY, pr_number: null, pr_url: null });
      await handleMarkAddressed(api, args);

      const [, message, repo] = (api.addMessage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(repo).toBe(PROJECT_KEY);
      expect(message).toContain('Bumped the CTA contrast.');
      expect(message).toContain('Preview: https://site-git-fix-cta-contrast-acme.vercel.app');
      expect(message).toContain('PR: https://github.com/acme/site/pull/17');
      // No github.io derivation for a project key
      expect(message).not.toContain('github.io');
    });

    it('passes the PR URL to notifyParticipants and includes links in the emit', async () => {
      const api = makeApi({ repo: PROJECT_KEY, pr_number: null, pr_url: null });
      const emit = vi.fn();
      await handleMarkAddressed(api, args, emit);

      const notifyCall = (api.notifyParticipants as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(notifyCall[0]).toBe('thread-1');
      expect(notifyCall[2]).toBe('pr_created');
      expect(notifyCall[4]).toBe('https://github.com/acme/site/pull/17');

      expect(emit).toHaveBeenCalledWith('thread-1', 'thread_in_review', expect.objectContaining({
        status: 'open',
        kanban_stage: 'in_review',
        pr_url: 'https://github.com/acme/site/pull/17',
        pr_number: 17,
        pr_branch: 'fix/cta-contrast',
        preview_url: 'https://site-git-fix-cta-contrast-acme.vercel.app',
      }));
    });

    it('says the links were recorded in the tool result', async () => {
      const api = makeApi({ repo: PROJECT_KEY, pr_number: null, pr_url: null });
      const result = await handleMarkAddressed(api, args);

      expect(result.content[0].text).toContain('Links recorded on the thread');
      expect(result.content[0].text).toContain('https://github.com/acme/site/pull/17 (#17)');
      expect(result.content[0].text).toContain('https://site-git-fix-cta-contrast-acme.vercel.app');
    });

    it('still posts a message carrying the links when no message text is given', async () => {
      const api = makeApi({ repo: PROJECT_KEY, pr_number: null, pr_url: null });
      await handleMarkAddressed(api, { thread_id: 'thread-1', pr_url: args.pr_url, preview_url: args.preview_url });

      expect(api.addMessage).toHaveBeenCalledTimes(1);
      const message = (api.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(message).toContain('PR: https://github.com/acme/site/pull/17');
      expect(message).toContain('Preview: https://site-git-fix-cta-contrast-acme.vercel.app');
    });

    it('derives pr_number from a GitLab merge request URL', async () => {
      const api = makeApi({ repo: PROJECT_KEY, pr_number: null, pr_url: null });
      await handleMarkAddressed(api, { thread_id: 'thread-1', pr_url: 'https://gitlab.com/acme/site/-/merge_requests/9' });

      const updates = (api.updateThread as ReturnType<typeof vi.fn>).mock.calls[1][2];
      expect(updates.pr_url).toBe('https://gitlab.com/acme/site/-/merge_requests/9');
      expect(updates.pr_number).toBe(9);
    });

    it('records pr_url without pr_number when the URL carries no number', async () => {
      const api = makeApi({ repo: PROJECT_KEY, pr_number: null, pr_url: null });
      await handleMarkAddressed(api, { thread_id: 'thread-1', pr_url: 'https://bitbucket.org/acme/site/pull-requests/abc' });

      const updates = (api.updateThread as ReturnType<typeof vi.fn>).mock.calls[1][2];
      expect(updates.pr_url).toBe('https://bitbucket.org/acme/site/pull-requests/abc');
      expect(updates).not.toHaveProperty('pr_number');
      expect(updates).not.toHaveProperty('pr_branch');
    });
  });

  describe('GitHub-App-connected "owner/name" key without link args (unchanged behaviour)', () => {
    it('derives the github.io pr-preview URL from the thread PR number and appends it to the message', async () => {
      const api = makeApi({ repo: 'Acme/design-system', pr_number: 42, pr_url: 'https://github.com/Acme/design-system/pull/42' });
      const result = await handleMarkAddressed(api, { thread_id: 'thread-1', message: 'Fixed' });

      expect(api.addMessage).toHaveBeenCalledWith(
        'thread-1',
        'Fixed\n\nPreview: https://acme.github.io/design-system/pr-preview/pr-42/',
        'Acme/design-system',
      );
      expect(result.content[0].text).toContain('Preview: https://acme.github.io/design-system/pr-preview/pr-42/');
      expect(result.content[0].text).not.toContain('Links recorded');
    });

    it('PATCH body carries only the stage change — no pr_* fields', async () => {
      const api = makeApi({ repo: 'Acme/design-system', pr_number: 42 });
      await handleMarkAddressed(api, { thread_id: 'thread-1', message: 'Fixed' });

      expect(api.updateThread).toHaveBeenCalledWith('thread-1', 'Acme/design-system', {
        kanban_stage: 'in_review',
        claude_code_pending: false,
      });
    });

    it('notifies participants that a change is ready for review — with exactly the legacy four arguments', async () => {
      const api = makeApi();
      await handleMarkAddressed(api, { thread_id: 'thread-1' });

      const call = (api.notifyParticipants as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call.slice(0, 4)).toEqual(['thread-1', 'acme/repo', 'pr_created', 'A change is ready for your review.']);
      expect(call[4]).toBeUndefined();
    });

    it('never re-announces a PR already on the thread (no 5th notify argument unless supplied in this call)', async () => {
      const api = makeApi({ repo: 'Acme/design-system', pr_number: 42, pr_url: 'https://github.com/Acme/design-system/pull/42' });
      await handleMarkAddressed(api, { thread_id: 'thread-1', message: 'Fixed' });

      const notifyCall = (api.notifyParticipants as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(notifyCall[4]).toBeUndefined();
    });

    it('does not post a message when none is given, even with a PR on the thread', async () => {
      const api = makeApi({ repo: 'Acme/design-system', pr_number: 42 });
      await handleMarkAddressed(api, { thread_id: 'thread-1' });

      expect(api.addMessage).not.toHaveBeenCalled();
    });

    it.skipIf(!PROJECT_PR_LINKS)('prefers an explicit preview_url over the github.io derivation', async () => {
      const api = makeApi({ repo: 'Acme/design-system', pr_number: 42 });
      await handleMarkAddressed(api, { thread_id: 'thread-1', message: 'Fixed', preview_url: 'https://pr-42.preview.acme.dev' });

      const message = (api.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(message).toContain('Preview: https://pr-42.preview.acme.dev');
      expect(message).not.toContain('github.io');
    });

    it('does not derive a github.io preview for a project key even when the thread has a pr_number', async () => {
      const api = makeApi({ repo: PROJECT_KEY, pr_number: 42 });
      await handleMarkAddressed(api, { thread_id: 'thread-1', message: 'Fixed' });

      expect(api.addMessage).toHaveBeenCalledWith('thread-1', 'Fixed', PROJECT_KEY);
    });
  });
});

describe('derivePrNumber', () => {
  it('reads GitHub /pull/N', () => {
    expect(derivePrNumber('https://github.com/acme/site/pull/17')).toBe(17);
    expect(derivePrNumber('https://github.com/acme/site/pull/17/files')).toBe(17);
    expect(derivePrNumber('https://github.com/acme/site/pull/17?diff=split')).toBe(17);
  });

  it('reads GitLab /merge_requests/N', () => {
    expect(derivePrNumber('https://gitlab.com/acme/site/-/merge_requests/9')).toBe(9);
    expect(derivePrNumber('https://gitlab.example.com/g/sub/site/-/merge_requests/123/diffs')).toBe(123);
  });

  it('returns null when there is no number to read', () => {
    expect(derivePrNumber('https://github.com/acme/site')).toBeNull();
    expect(derivePrNumber('https://github.com/acme/site/pulls')).toBeNull();
    expect(derivePrNumber('https://bitbucket.org/acme/site/pull-requests/abc')).toBeNull();
  });
});
