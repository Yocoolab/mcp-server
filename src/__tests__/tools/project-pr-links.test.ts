/**
 * PROJECT_PR_LINKS: link-only projects ("project:<uuid>" workspace keys).
 * Covers the surfaces that tell a remote agent which repo the project points
 * at, and that steer it to open the PR itself + mark_thread_addressed(pr_url)
 * instead of the GitHub-only create_pr_for_thread.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleGetContext } from '../../tools/get-context.js';
import { handleListThreads } from '../../tools/list-threads.js';
import { handleCreatePr } from '../../tools/create-pr.js';
import { generateClaudePrompt } from '../../prompt-template.js';
import { AGENT_BRIEF, isOwnerNameKey, PROJECT_PR_LINKS } from '../../feature-flags.js';
import type { YocoolabApiClient, ThreadDetail, ThreadSummary } from '../../api-client.js';
import type { GitHubClient } from '../../github-client.js';
import type { ClaudePromptContext } from '../../types.js';

const PROJECT_KEY = 'project:0f3b2a1c-4d5e-4f60-8a9b-0c1d2e3f4a5b';
const REPO_LINKS = [
  { role: 'main', url: 'https://github.com/acme/site' },
  { role: 'api', url: 'https://github.com/acme/site-api' },
];

function baseThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-1',
    repo: PROJECT_KEY,
    branch: 'main',
    status: 'open',
    priority: 'normal',
    selector: null,
    xpath: null,
    coordinates: null,
    screenshot_url: null,
    element_tag: null,
    element_text: null,
    view_context: null,
    element_context: null,
    page_url: null,
    tags: [],
    created_by: 'u1',
    created_at: '2026-01-01',
    jira_issue_key: null,
    pr_number: null,
    pr_url: null,
    pr_branch: null,
    jira_status: null,
    jira_status_category: null,
    fix_commit_sha: null,
    working_branch_id: null,
    claude_code_pending: true,
    claude_code_pending_at: null,
    parent_thread_id: null,
    iteration_type: null,
    iteration_number: null,
    creator_name: 'Alice',
    creator_email: 'alice@test.com',
    message_count: 0,
    last_activity: null,
    messages: [],
    ...overrides,
  };
}

describe('isOwnerNameKey', () => {
  it('matches GitHub-App "owner/name" keys only', () => {
    expect(isOwnerNameKey('acme/site')).toBe(true);
    expect(isOwnerNameKey(PROJECT_KEY)).toBe(false);
    expect(isOwnerNameKey('acme')).toBe(false);
    expect(isOwnerNameKey('a/b/c')).toBe(false);
    expect(isOwnerNameKey(null)).toBe(false);
  });
});

// The legacy builder (a backend without the agent brief: the brief 404s → null).
describe.skipIf(!PROJECT_PR_LINKS)('get_thread_context prints repo_links', () => {
  it('lists each link as role: url for a link-only project', async () => {
    const api = { getThread: vi.fn().mockResolvedValue(baseThread({ repo_links: REPO_LINKS })), getThreadBrief: vi.fn().mockResolvedValue(null) } as unknown as YocoolabApiClient;
    const result = await handleGetContext(api, { thread_id: 'thread-1' });
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('**Repo links:**');
    expect(text).toContain('- main: https://github.com/acme/site');
    expect(text).toContain('- api: https://github.com/acme/site-api');
  });

  it('omits the section when there are no links', async () => {
    const api = { getThread: vi.fn().mockResolvedValue(baseThread({ repo: 'acme/site', repo_links: [] })), getThreadBrief: vi.fn().mockResolvedValue(null) } as unknown as YocoolabApiClient;
    const result = await handleGetContext(api, { thread_id: 'thread-1' });
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).not.toContain('Repo links');
  });
});

describe.skipIf(!PROJECT_PR_LINKS)('list_feedback_threads prints repo_links', () => {
  it('shows the links inline on the thread row', async () => {
    const api = { listThreads: vi.fn().mockResolvedValue([baseThread({ repo_links: REPO_LINKS }) as unknown as ThreadSummary]) } as unknown as YocoolabApiClient;
    const result = await handleListThreads(api, {});
    expect(result.content[0].text).toContain('Repo links: main: https://github.com/acme/site, api: https://github.com/acme/site-api');
  });
});

describe.skipIf(!PROJECT_PR_LINKS)('create_pr_for_thread on a link-only project', () => {
  it('returns an error that points to the mark_thread_addressed(pr_url) path, not a dead end', async () => {
    const api = {
      getThread: vi.fn().mockResolvedValue(baseThread({ repo_links: REPO_LINKS })),
      updateThread: vi.fn(),
      getWorkingBranch: vi.fn(),
    } as unknown as YocoolabApiClient;
    const github = { createPullRequest: vi.fn() } as unknown as GitHubClient;

    const result = await handleCreatePr(api, github, {
      thread_id: 'thread-1', title: 't', body: 'b', files: [],
    });

    expect((result as any).isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('link-only project');
    expect(text).toContain('mark_thread_addressed');
    expect(text).toContain('pr_url');
    expect(text).toContain('https://github.com/acme/site');
    expect(text).toContain('gh pr create');
    // Nothing was pushed or patched
    expect(github.createPullRequest).not.toHaveBeenCalled();
    expect(api.updateThread).not.toHaveBeenCalled();
    expect(api.getWorkingBranch).not.toHaveBeenCalled();
  });
});

describe.skipIf(!PROJECT_PR_LINKS)('create_pr_for_thread on a link-only project with no repo links', () => {
  it('points at where get_thread_context names the repository, not at an empty field', async () => {
    const api = {
      getThread: vi.fn().mockResolvedValue(baseThread({ repo_links: [] })),
      updateThread: vi.fn(),
      getWorkingBranch: vi.fn(),
    } as unknown as YocoolabApiClient;
    const github = { createPullRequest: vi.fn() } as unknown as GitHubClient;

    const result = await handleCreatePr(api, github, { thread_id: 'thread-1', title: 't', body: 'b', files: [] });
    const text = result.content[0].text;
    expect(text).toContain(AGENT_BRIEF ? '(get_thread_context names it under Where › Repository)' : '(see repo_links in get_thread_context)');
  });
});

describe.skipIf(!PROJECT_PR_LINKS)('prompt template workflow branches on the key shape', () => {
  function ctx(repo: string, repoLinks?: Array<{ role: string; url: string }>): ClaudePromptContext {
    return {
      elementPayload: {
        element: { selector: 'button.cta', tag: 'BUTTON', text: 'Go', id: '', classList: ['cta'], attributes: {} },
        page: { url: 'https://app.example.com' },
        styles: { computed: {} },
      } as unknown as ClaudePromptContext['elementPayload'],
      candidates: [],
      workspaceRoot: '/ws',
      threadContext: {
        threadId: 'thread-1',
        repo,
        branch: 'main',
        messages: [{ author_name: 'Alice', content: 'More contrast please' }],
        ...(repoLinks ? { repoLinks } : {}),
      },
    };
  }

  it('keeps the create_pr_for_thread steps for an "owner/name" key', () => {
    const prompt = generateClaudePrompt(ctx('acme/site'));
    expect(prompt).toContain('Use the `create_pr_for_thread` tool with:');
    expect(prompt).toContain('get_deployment_preview');
    expect(prompt).not.toContain('link-only project');
  });

  it('tells a "project:" key agent to open the PR itself and record it with mark_thread_addressed', () => {
    const prompt = generateClaudePrompt(ctx(PROJECT_KEY, REPO_LINKS));
    expect(prompt).toContain('link-only project');
    expect(prompt).toContain('gh pr create');
    expect(prompt).toContain('Use the `mark_thread_addressed` tool with:');
    expect(prompt).toContain('pr_url: the PR you opened');
    expect(prompt).toContain('preview_url:');
    expect(prompt).toContain('repo_links');
    expect(prompt).toContain('  - main: https://github.com/acme/site');
    expect(prompt).not.toContain('Use the `create_pr_for_thread` tool with:');
    expect(prompt).toContain('do NOT use `create_pr_for_thread`');
  });

  it('points at get_thread_context when repo_links were not passed in', () => {
    const prompt = generateClaudePrompt(ctx(PROJECT_KEY));
    // With the brief, get_thread_context has no "Repo links" section: the
    // repository is under Where › Repository.
    expect(prompt).toContain(AGENT_BRIEF ? 'names it under Where › Repository' : 'see "Repo links" in get_thread_context');
    expect(prompt).toContain('thread "thread-1"');
  });
});
