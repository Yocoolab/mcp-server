import { describe, it, expect, vi } from 'vitest';
import { handleGetContext } from '../../tools/get-context.js';
import type { YocoolabApiClient, ThreadDetail } from '../../api-client.js';

function makeThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-1',
    repo: 'acme/design-system',
    branch: 'main',
    status: 'open' as const,
    priority: 'high' as const,
    selector: 'button.primary',
    xpath: null,
    coordinates: null,
    screenshot_url: null,
    element_tag: 'BUTTON',
    element_text: 'Get Started',
    view_context: null,
    element_context: null,
    page_url: 'https://app.example.com',
    tags: ['ui'],
    created_by: 'u1',
    created_at: '2026-01-01',
    jira_issue_key: null,
    pr_number: null,
    pr_url: null,
    pr_branch: null,
    creator_name: 'Alice',
    creator_email: 'alice@test.com',
    message_count: 1,
    last_activity: '2026-01-02',
    messages: [{ id: 'm1', thread_id: 'thread-1', content: 'Button needs more contrast', created_at: '2026-01-01', author_name: 'Alice', author_email: 'alice@test.com' }],
    ...overrides,
  };
}

function makeApi(thread: ThreadDetail): YocoolabApiClient {
  return {
    getThread: vi.fn().mockResolvedValue(thread),
  } as unknown as YocoolabApiClient;
}

describe('handleGetContext', () => {
  it('returns formatted text with thread details', async () => {
    const thread = makeThread();
    const api = makeApi(thread);
    const result = await handleGetContext(api, { thread_id: 'thread-1' });

    const text = result.content[0].text;
    expect(text).toContain('# Thread: thread-1');
    expect(text).toContain('**Repo:** acme/design-system');
    expect(text).toContain('**CSS Selector:** `button.primary`');
    expect(text).toContain('**Element:** <BUTTON> "Get Started"');
    expect(text).toContain('Button needs more contrast');
  });

  it('includes PR info when pr_url is set', async () => {
    const thread = makeThread({
      pr_url: 'https://github.com/acme/design-system/pull/42',
    });
    const api = makeApi(thread);
    const result = await handleGetContext(api, { thread_id: 'thread-1' });

    expect(result.content[0].text).toContain('**PR:** https://github.com/acme/design-system/pull/42');
  });

  it('includes Jira info when jira_issue_key is set', async () => {
    const thread = makeThread({ jira_issue_key: 'PROJ-123' });
    const api = makeApi(thread);
    const result = await handleGetContext(api, { thread_id: 'thread-1' });

    expect(result.content[0].text).toContain('**Jira:** PROJ-123');
  });

  it('includes screenshot as image content block', async () => {
    const thread = makeThread({
      screenshot_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    });
    const api = makeApi(thread);
    const result = await handleGetContext(api, { thread_id: 'thread-1' });

    expect(result.content).toHaveLength(2);
    expect(result.content[1].type).toBe('image');
    expect((result.content[1] as any).data).toBe('iVBORw0KGgoAAAANSUhEUg==');
    expect((result.content[1] as any).mimeType).toBe('image/png');
  });

  it('formats element_context from Bridge data', async () => {
    const thread = makeThread({
      element_context: {
        full_selector: 'div.hero > button.primary',
        dom_path: ['HTML', 'BODY', 'DIV', 'BUTTON'],
        framework_hints: { frameworkGuess: 'react', devServer: 'vite' },
        class_list: ['primary', 'btn-lg'],
        bounding_box: { x: 100, y: 200, w: 120, h: 40 },
        attributes: { 'data-testid': 'cta-btn' },
        computed_styles: { color: 'white', fontSize: '16px' },
      },
    });
    const api = makeApi(thread);
    const result = await handleGetContext(api, { thread_id: 'thread-1' });

    const text = result.content[0].text;
    expect(text).toContain('## Element Context (Yocoolab Bridge)');
    expect(text).toContain('**Full Selector:** `div.hero > button.primary`');
    expect(text).toContain('HTML > BODY > DIV > BUTTON');
    expect(text).toContain('**Framework:** react (dev server: vite)');
    expect(text).toContain('`primary`');
    expect(text).toContain('`btn-lg`');
    expect(text).toContain('**Size:** 120x40');
    expect(text).toContain('`data-testid="cta-btn"`');
  });

  it('shows "No messages found" for empty messages', async () => {
    const thread = makeThread({ messages: [] });
    const api = makeApi(thread);
    const result = await handleGetContext(api, { thread_id: 'thread-1' });

    expect(result.content[0].text).toContain('No messages found.');
  });

  it('includes view context when available', async () => {
    const thread = makeThread({
      view_context: {
        pathname: '/dashboard',
        hash: '#settings',
        activeTabs: ['General', 'Security'],
        activeModal: 'ConfirmDialog',
      },
    });
    const api = makeApi(thread);
    const result = await handleGetContext(api, { thread_id: 'thread-1' });

    const text = result.content[0].text;
    expect(text).toContain('**Page path:** /dashboard');
    expect(text).toContain('**URL hash:** #settings');
    expect(text).toContain('**Active tabs:** General, Security');
    expect(text).toContain('**Active modal:** ConfirmDialog');
  });
});
