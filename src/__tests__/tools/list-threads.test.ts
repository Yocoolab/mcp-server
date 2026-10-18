import { describe, it, expect, vi } from 'vitest';
import { handleListThreads } from '../../tools/list-threads.js';
import { AGENT_BRIEF } from '../../feature-flags.js';
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
    expect(text).toContain(AGENT_BRIEF ? 'Repository: acme/site-a' : 'Repo: acme/site-a');
    expect(text).toContain(AGENT_BRIEF ? 'Repository: acme/site-b' : 'Repo: acme/site-b');
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

  it('never prints what was typed into a form control', async () => {
    const api = makeApi([
      { id: 't4', repo: 'acme/site-a', branch: 'main', priority: 'normal' as const, message_count: 1, creator_name: 'A', created_at: '2026-01-01', tags: [], created_by: 'u1', status: 'open' as const, element_tag: 'INPUT', element_text: 'hunter2' } as Partial<ThreadSummary>,
    ]);
    const text = (await handleListThreads(api, {})).content[0].text;

    expect(text).toContain('Tag: <INPUT>');
    expect(text).not.toContain('hunter2');
  });

  it('keeps multi-line element text on its row (⏎ for line breaks)', async () => {
    const api = makeApi([
      { id: 't6', repo: 'acme/site-a', branch: 'main', priority: 'normal' as const, message_count: 1, creator_name: 'A', created_at: '2026-01-01', tags: [], created_by: 'u1', status: 'open' as const, element_tag: 'H1', element_text: 'Return\n  to   yourself.' } as Partial<ThreadSummary>,
    ]);
    const text = (await handleListThreads(api, {})).content[0].text;

    expect(text).toContain('Tag: <H1> "Return ⏎ to yourself."');
  });

  it('prints the page address without its query string', async () => {
    const api = makeApi([
      { id: 't5', repo: 'acme/site-a', branch: 'main', priority: 'normal' as const, message_count: 1, creator_name: 'A', created_at: '2026-01-01', tags: [], created_by: 'u1', status: 'open' as const, page_url: 'https://app.example.com/login?session=s3cr3t' } as Partial<ThreadSummary>,
    ]);
    const text = (await handleListThreads(api, {})).content[0].text;

    expect(text).toContain('Page: https://app.example.com/login');
    expect(text).not.toContain('s3cr3t');
  });

  it('empty message adapts when no repo given', async () => {
    const api = makeApi([]);
    const result = await handleListThreads(api, {});

    expect(result.content[0].text).toContain('across your connected repos');
  });
});

describe.skipIf(!AGENT_BRIEF)('list_open_threads repository line', () => {
  const PROJECT_KEY = 'project:0f3b2a1c-4d5e-4f60-8a9b-0c1d2e3f4a5b';
  const base = { branch: 'main', priority: 'normal' as const, message_count: 1, creator_name: 'A', created_at: '2026-01-01', tags: [], created_by: 'u1', status: 'open' as const };

  it('an "owner/name" key is the repository: connected through the GitHub App', async () => {
    const api = makeApi([{ id: 't1', repo: 'acme/site', ...base } as Partial<ThreadSummary>]);
    const text = (await handleListThreads(api, {})).content[0].text;

    expect(text).toContain("Repository: acme/site (branch: main) — connected through Yocoolab's GitHub App (create_pr_for_thread works)");
  });

  it('a link-only project never prints its internal key, nor its made-up branch, and points at get_thread_context', async () => {
    const api = makeApi([{ id: 't1', repo: PROJECT_KEY, ...base, lane: 'design' } as Partial<ThreadSummary>]);
    const text = (await handleListThreads(api, {})).content[0].text;

    expect(text).not.toContain('project:');
    expect(text).not.toContain('branch: main');
    expect(text).toContain('Repository: link-only project — get_thread_context names the repository');
    expect(text).toContain('Lane: Design');
  });

  it("prints the API's repository label when it gives one", async () => {
    const api = makeApi([
      { id: 't1', repo: PROJECT_KEY, ...base, repository: { kind: 'linked', full_name: 'Acme/site', url: 'https://github.com/Acme/site' } } as Partial<ThreadSummary>,
      { id: 't2', repo: PROJECT_KEY, ...base, repository: { kind: 'not-linked', full_name: null, url: null } } as Partial<ThreadSummary>,
      { id: 't3', repo: PROJECT_KEY, ...base, repository: 'github.com/Acme/api — linked in Yocoolab, Production lane' } as Partial<ThreadSummary>,
    ]);
    const text = (await handleListThreads(api, {})).content[0].text;

    expect(text).toContain('Repository: Acme/site — linked in Yocoolab');
    expect(text).toContain('Repository: not linked in Yocoolab — get_thread_context says what to do');
    expect(text).toContain('Repository: github.com/Acme/api — linked in Yocoolab, Production lane');
  });

  it('shows the lane next to type and stage', async () => {
    const api = makeApi([{ id: 't1', repo: 'acme/site', ...base, service_type: 'frontend', kanban_stage: 'todo', lane: 'qa' } as Partial<ThreadSummary>]);
    const text = (await handleListThreads(api, {})).content[0].text;

    expect(text).toContain('Type: frontend | Stage: todo | Lane: QA');
  });
});
