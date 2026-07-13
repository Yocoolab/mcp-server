import { describe, it, expect, vi } from 'vitest';
import { handleListThreads } from '../../tools/list-threads.js';
import type { YocoolabApiClient, ThreadSummary } from '../../api-client.js';

function makeApi(threads: Partial<ThreadSummary>[] = []): YocoolabApiClient {
  return {
    listThreads: vi.fn().mockResolvedValue(threads),
  } as unknown as YocoolabApiClient;
}

describe('handleListThreads', () => {
  it('returns message when no threads found', async () => {
    const api = makeApi([]);
    const result = await handleListThreads(api, { repo: 'acme/repo' });

    expect(result.content[0].text).toContain('No open feedback threads found');
    expect(result.content[0].text).toContain('acme/repo');
  });

  it('includes branch in empty message when provided', async () => {
    const api = makeApi([]);
    const result = await handleListThreads(api, { repo: 'acme/repo', branch: 'dev' });

    expect(result.content[0].text).toContain('branch dev');
  });

  it('formats thread summary with PR URL', async () => {
    const api = makeApi([
      {
        id: 't1',
        repo: 'acme/repo',
        branch: 'main',
        status: 'open' as const,
        priority: 'high' as const,
        selector: 'button.cta',
        element_tag: 'BUTTON',
        element_text: 'Submit',
        page_url: 'https://app.example.com/form',
        pr_url: 'https://github.com/acme/repo/pull/42',
        jira_issue_key: null,
        tags: [],
        created_by: 'u1',
        created_at: '2026-01-01',
        creator_name: 'Alice',
        creator_email: 'alice@example.com',
        message_count: 3,
        last_activity: '2026-01-02',
        xpath: null,
        coordinates: null,
        screenshot_url: null,
        view_context: null,
        element_context: null,
        pr_number: 42,
        pr_branch: 'fix/btn',
      },
    ]);

    const result = await handleListThreads(api, { repo: 'acme/repo' });
    const text = result.content[0].text;

    expect(text).toContain('1 open thread');
    expect(text).toContain('Thread t1');
    expect(text).toContain('PR: https://github.com/acme/repo/pull/42');
    expect(text).toContain('Element: `button.cta`');
    expect(text).toContain('Tag: <BUTTON> "Submit"');
  });

  it('always filters by status open', async () => {
    const api = makeApi([]);
    await handleListThreads(api, { repo: 'acme/repo' });

    expect(api.listThreads).toHaveBeenCalledWith('acme/repo', {
      status: 'open',
      branch: undefined,
    });
  });

  it('passes branch filter when provided', async () => {
    const api = makeApi([]);
    await handleListThreads(api, { repo: 'acme/repo', branch: 'feature/x' });

    expect(api.listThreads).toHaveBeenCalledWith('acme/repo', {
      status: 'open',
      branch: 'feature/x',
    });
  });

  it('works WITHOUT a repo — lists across all connected repos', async () => {
    const api = makeApi([
      { id: 't1', repo: 'acme/site-a', branch: 'main', priority: 'normal' as const, message_count: 1, creator_name: 'A', created_at: '2026-01-01', tags: [], created_by: 'u1', status: 'open' as const } as Partial<ThreadSummary>,
      { id: 't2', repo: 'acme/site-b', branch: 'main', priority: 'high' as const, message_count: 2, creator_name: 'B', created_at: '2026-01-02', tags: [], created_by: 'u2', status: 'open' as const } as Partial<ThreadSummary>,
    ]);
    const result = await handleListThreads(api, {});

    expect(api.listThreads).toHaveBeenCalledWith(undefined, { status: 'open', branch: undefined });
    const text = result.content[0].text;
    expect(text).toContain('across all your connected repos');
    expect(text).toContain('Repo: acme/site-a');
    expect(text).toContain('Repo: acme/site-b');
  });

  it('labels each thread with change type and board stage when present', async () => {
    const api = makeApi([
      { id: 't3', repo: 'acme/site-a', branch: 'main', priority: 'normal' as const, message_count: 1, creator_name: 'A', created_at: '2026-01-01', tags: [], created_by: 'u1', status: 'open' as const, service_type: 'frontend', kanban_stage: 'in_review' } as Partial<ThreadSummary>,
    ]);
    const result = await handleListThreads(api, {});
    const text = result.content[0].text;

    expect(text).toContain('Type: frontend');
    expect(text).toContain('Stage: in_review');
  });

  it('empty message adapts when no repo given', async () => {
    const api = makeApi([]);
    const result = await handleListThreads(api, {});

    expect(result.content[0].text).toContain('across your connected repos');
  });
});
