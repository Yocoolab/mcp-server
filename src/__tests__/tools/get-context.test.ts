import { describe, it, expect, vi } from 'vitest';
import { handleGetContext } from '../../tools/get-context.js';
import { YocoolabApiError } from '../../api-client.js';
import { AGENT_BRIEF } from '../../feature-flags.js';
import type { YocoolabApiClient, ThreadDetail, AgentBrief, BriefImage } from '../../api-client.js';

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

// A backend from before the agent brief: GET /threads/:id/brief is a 404,
// which the client turns into null — the text is built here.
function makeApi(thread: ThreadDetail): YocoolabApiClient {
  return {
    getThread: vi.fn().mockResolvedValue(thread),
    getThreadBrief: vi.fn().mockResolvedValue(null),
  } as unknown as YocoolabApiClient;
}

describe('handleGetContext (backend without the agent brief)', () => {
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

describe('legacy builder privacy', () => {
  it('never prints what was typed into a form control, nor a value attribute', async () => {
    const thread = makeThread({
      element_tag: 'INPUT',
      element_text: 'hunter2',
      element_context: { attributes: { type: 'password', value: 'hunter2', name: 'pw' } },
    });
    const result = await handleGetContext(makeApi(thread), { thread_id: 'thread-1' });
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('**Element:** <INPUT>');
    expect(text).not.toContain('hunter2');
    expect(text).toContain('`name="pw"`');
  });

  it('prints the page address without its query string', async () => {
    const thread = makeThread({ page_url: 'https://app.example.com/reset?token=abc123#/step-2' });
    const result = await handleGetContext(makeApi(thread), { thread_id: 'thread-1' });
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('**Page URL:** https://app.example.com/reset#/step-2');
    expect(text).not.toContain('abc123');
  });
});

// ── AGENT_BRIEF: the backend's brief is the text, the screenshots follow ──

const THREAD_ID = '071e11c7-9774-4fdc-aa40-c346ea656ee2';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const JPG = 'data:image/jpg;base64,/9j/4AAQSkZJRg==';

function makeBrief(images: BriefImage[] = [], markdown = `## Yocoolab thread ${THREAD_ID}\nAsk: Restyle the hero heading.\n`): AgentBrief {
  return {
    brief_version: 1,
    markdown,
    repository: {
      kind: 'inferred', url: 'https://github.com/Jonahbkerr/TFASPA', full_name: 'Jonahbkerr/TFASPA', host: 'github.com',
      confirmed: true, candidates: [], branch: 'main', branch_source: 'github-default', branch_use: 'base', base_branch: 'main', hint: null,
    },
    images,
    close_loop: {},
    draft_count: 0,
  };
}

function makeBriefApi(brief: AgentBrief | null | Error, thread: Partial<ThreadDetail> | Error = {}, extra: Record<string, unknown> = {}) {
  return {
    getThreadBrief: brief instanceof Error ? vi.fn().mockRejectedValue(brief) : vi.fn().mockResolvedValue(brief),
    getThread: thread instanceof Error ? vi.fn().mockRejectedValue(thread) : vi.fn().mockResolvedValue(makeThread({ id: THREAD_ID, ...thread })),
    getThreadImages: vi.fn().mockResolvedValue({ element: { dataUrl: JPG, w: 800, h: 300 } }),
    getThreadSketch: vi.fn().mockResolvedValue({ png: PNG }),
    ...extra,
  } as unknown as YocoolabApiClient;
}

const texts = (content: Array<{ type: string; text?: string }>) => content.filter((c) => c.type === 'text').map((c) => c.text);

describe.skipIf(!AGENT_BRIEF)('handleGetContext with the agent brief', () => {
  it('asks for the brief worded for attached images, and returns its markdown as the first block', async () => {
    const brief = makeBrief();
    const api = makeBriefApi(brief);
    const result = await handleGetContext(api, { thread_id: THREAD_ID });

    // Drafts (up to 200k characters of HTML) only on request.
    expect(api.getThreadBrief).toHaveBeenCalledWith(THREAD_ID, { images: 'attached', drafts: false });
    expect(result.content[0]).toEqual({ type: 'text', text: brief.markdown });
    // None of the legacy builder's lines
    const all = texts(result.content as any).join('\n');
    expect(all).not.toContain('**Repo:**');
    expect(all).not.toContain('## Messages');
    // No images named, none fetched
    expect(api.getThreadImages).not.toHaveBeenCalled();
    expect(api.getThreadSketch).not.toHaveBeenCalled();
    expect(result.content).toHaveLength(1);
  });

  it('attaches the element crop first (from /images), then the full page, each after its [n] label', async () => {
    const api = makeBriefApi(
      makeBrief([{ n: 1, kind: 'element', label: 'element crop' }, { n: 2, kind: 'page', label: 'full page' }]),
      { screenshot_url: PNG },
    );
    const result = await handleGetContext(api, { thread_id: THREAD_ID });

    expect(api.getThreadImages).toHaveBeenCalledWith(THREAD_ID, 'element');
    expect(result.content.slice(1)).toEqual([
      { type: 'text', text: '[1] element crop' },
      { type: 'image', data: '/9j/4AAQSkZJRg==', mimeType: 'image/jpeg' },
      { type: 'text', text: '[2] full page' },
      { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' },
    ]);
  });

  it('maps attached elements, the sketch and reply images to the numbers the brief gives them', async () => {
    const api = makeBriefApi(
      makeBrief([
        { n: 1, kind: 'page', label: 'full page' },
        { n: 2, kind: 'attached_element', label: 'element 3', element: 3 },
        { n: 3, kind: 'sketch', label: 'sketch' },
        { n: 4, kind: 'attachment', label: 'image in message 2', message: 2, attachment: 1 },
      ]),
      {
        screenshot_url: PNG,
        attached_elements: [{ screenshot: null }, { screenshot: 'data:image/webp;base64,UklGRg==' }],
        messages: [
          // An intent-only first message the brief leaves out of its numbering…
          { id: 'm0', thread_id: THREAD_ID, content: 'Build:', created_at: '', author_name: 'A', author_email: '' },
          // …so conversation message 2 is the first message here that has images.
          {
            id: 'm1', thread_id: THREAD_ID, content: 'like this', created_at: '', author_name: 'A', author_email: '',
            attachments: [{ url: 'data:image/png;base64,AAAA' }, { url: 'data:image/gif;base64,R0lGOD==' }],
          },
        ],
      },
    );
    const result = await handleGetContext(api, { thread_id: THREAD_ID });

    expect(api.getThreadImages).not.toHaveBeenCalled(); // no element crop named
    expect(api.getThreadSketch).toHaveBeenCalledWith(THREAD_ID);
    expect(result.content.slice(1)).toEqual([
      { type: 'text', text: '[1] full page' },
      { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' },
      { type: 'text', text: '[2] element 3' },
      { type: 'image', data: 'UklGRg==', mimeType: 'image/webp' },
      { type: 'text', text: '[3] sketch' },
      { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' },
      { type: 'text', text: '[4] image in message 2' },
      { type: 'image', data: 'R0lGOD==', mimeType: 'image/gif' },
    ]);
  });

  it('names an image it cannot send instead of shifting the numbers', async () => {
    const api = makeBriefApi(
      makeBrief([
        { n: 1, kind: 'element', label: 'element crop' },
        { n: 2, kind: 'page', label: 'full page' },
        { n: 3, kind: 'attachment', label: 'image in message 1', message: 1, attachment: 0 },
      ]),
      {
        screenshot_url: PNG,
        messages: [{ id: 'm1', thread_id: THREAD_ID, content: 'x', created_at: '', author_name: 'A', author_email: '', attachments: [{ url: 'https://cdn.example.com/a.png' }] }],
      },
      { getThreadImages: vi.fn().mockRejectedValue(new Error('API request failed: 500')) },
    );
    const result = await handleGetContext(api, { thread_id: THREAD_ID });

    expect(result.content.slice(1)).toEqual([
      { type: 'text', text: '[1] element crop — not attached (no image came back for it)' },
      { type: 'text', text: '[2] full page' },
      { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' },
      { type: 'text', text: '[3] image in message 1 — not attached (stored as a link; open the thread in Yocoolab to see it)' },
    ]);
  });

  it('does not send an image over 5 MB', async () => {
    const huge = `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}`;
    const api = makeBriefApi(makeBrief([{ n: 1, kind: 'page', label: 'full page' }]), { screenshot_url: huge });
    const result = await handleGetContext(api, { thread_id: THREAD_ID });

    expect(result.content.slice(1)).toEqual([
      { type: 'text', text: '[1] full page — not attached (too large to send; open the thread in Yocoolab to see it)' },
    ]);
  });

  it('still returns the brief when the thread row cannot be read', async () => {
    const brief = makeBrief([{ n: 1, kind: 'element', label: 'element crop' }, { n: 2, kind: 'page', label: 'full page' }]);
    const api = makeBriefApi(brief, new Error('API request failed: 500 Internal Server Error'));
    const result = await handleGetContext(api, { thread_id: THREAD_ID });

    expect(result.content[0]).toEqual({ type: 'text', text: brief.markdown });
    expect(texts(result.content as any)).toContain('[2] full page — not attached (no image came back for it)');
    expect(result.content.filter((c) => c.type === 'image')).toHaveLength(1); // the element crop
  });

  it('falls back to the legacy builder on a 404 (older backend, or the brief turned off)', async () => {
    const api = makeBriefApi(null, { screenshot_url: PNG });
    const result = await handleGetContext(api, { thread_id: THREAD_ID });

    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain(`# Thread: ${THREAD_ID}`);
    expect(text).toContain('Button needs more contrast');
    expect(result.content[1]).toEqual({ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' });
    expect(api.getThreadImages).not.toHaveBeenCalled();
  });

  it('falls back to the legacy builder when the server fails to build the brief (5xx)', async () => {
    const api = makeBriefApi(new YocoolabApiError('API request failed: 500 Internal Server Error — {}', 500));
    const result = await handleGetContext(api, { thread_id: THREAD_ID });

    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain(`# Thread: ${THREAD_ID}`);
  });

  it('a refusal is final: a 403 on the brief is thrown, not papered over with the raw thread', async () => {
    const api = makeBriefApi(new YocoolabApiError('API request failed: 403 Forbidden — {"code":"guest_not_allowed"}', 403));
    await expect(handleGetContext(api, { thread_id: THREAD_ID })).rejects.toThrow('403');
  });

  // Claude Code refuses or cuts a tool result over its MCP output limit
  // (25k tokens by default), so the default call stays well under it.
  describe('output size', () => {
    it('include_drafts: true asks for the drafts, and adds no pointer to them', async () => {
      const api = makeBriefApi({ ...makeBrief(), draft_count: 2 });
      const result = await handleGetContext(api, { thread_id: THREAD_ID, include_drafts: true });

      expect(api.getThreadBrief).toHaveBeenCalledWith(THREAD_ID, { images: 'attached', drafts: true });
      expect(texts(result.content as any)[0]).not.toContain('include_drafts');
    });

    it('says how to get the drafts when this call left them out', async () => {
      const brief = { ...makeBrief(), draft_count: 2 };
      const result = await handleGetContext(makeBriefApi(brief), { thread_id: THREAD_ID });

      const text = texts(result.content as any)[0]!;
      expect(text.startsWith(brief.markdown)).toBe(true);
      expect(text).toContain('get_thread_context with include_drafts: true');
    });

    it('caps its text, keeping the start of the brief and saying what was cut', async () => {
      const head = `## Yocoolab thread ${THREAD_ID}\nAsk: Restyle the hero heading.\n\n## Drafts\n`;
      const markdown = head + '<div class="draft">x</div>\n'.repeat(20_000); // ~540k characters
      const result = await handleGetContext(makeBriefApi(makeBrief([], markdown)), { thread_id: THREAD_ID, include_drafts: true });

      const text = texts(result.content as any).join('\n');
      expect(text.length).toBeLessThan(50_000);
      expect(text.startsWith(head)).toBe(true);
      expect(text).toMatch(/\d[\d,]* more characters left out/);
    });

    it('sends at most four images and names the rest, without fetching what it will not send', async () => {
      const api = makeBriefApi(
        makeBrief([
          { n: 1, kind: 'element', label: 'element crop' },
          { n: 2, kind: 'page', label: 'full page' },
          { n: 3, kind: 'attached_element', label: 'element 2', element: 2 },
          { n: 4, kind: 'attached_element', label: 'element 3', element: 3 },
          { n: 5, kind: 'sketch', label: 'sketch' },
          { n: 6, kind: 'attachment', label: 'image in message 1', message: 1, attachment: 0 },
        ]),
        {
          screenshot_url: PNG,
          attached_elements: [{ screenshot: PNG }, { screenshot: PNG }],
          messages: [{ id: 'm1', thread_id: THREAD_ID, content: 'x', created_at: '', author_name: 'A', author_email: '', attachments: [{ url: PNG }] }],
        },
      );
      const result = await handleGetContext(api, { thread_id: THREAD_ID });

      expect(result.content.filter((c) => c.type === 'image')).toHaveLength(4);
      expect(api.getThreadSketch).not.toHaveBeenCalled();
      const names = texts(result.content as any);
      expect(names).toContain('[5] sketch — not attached (this call sends at most 4 images; open the thread in Yocoolab to see it)');
      expect(names).toContain('[6] image in message 1 — not attached (this call sends at most 4 images; open the thread in Yocoolab to see it)');
    });

    it('keeps the images it sends under one total size, naming the one that would go over', async () => {
      const big = `data:image/png;base64,${'A'.repeat(Math.ceil((4.5 * 1024 * 1024) / 0.75))}`; // 4.5 MB each
      const api = makeBriefApi(
        makeBrief([
          { n: 1, kind: 'page', label: 'full page' },
          { n: 2, kind: 'attached_element', label: 'element 2', element: 2 },
          { n: 3, kind: 'attached_element', label: 'element 3', element: 3 },
        ]),
        { screenshot_url: big, attached_elements: [{ screenshot: big }, { screenshot: PNG }] },
      );
      const result = await handleGetContext(api, { thread_id: THREAD_ID });

      const shapes = result.content.slice(1).map((c) => (c.type === 'image' ? 'image' : (c as { text: string }).text));
      expect(shapes).toEqual([
        '[1] full page', 'image',
        '[2] element 2 — not attached (over this call\'s 8 MB of images; open the thread in Yocoolab to see it)',
        '[3] element 3', 'image',
      ]);
    });
  });

  it('throws the thread error when neither the brief nor the thread can be had', async () => {
    const api = makeBriefApi(null, new YocoolabApiError('API request failed: 404 Not Found — Thread not found', 404));
    await expect(handleGetContext(api, { thread_id: THREAD_ID })).rejects.toThrow('404 Not Found');
  });
});
