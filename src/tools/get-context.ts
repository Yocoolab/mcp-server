import { YocoolabApiClient, YocoolabApiError } from '../api-client.js';
import type { AgentBrief, BriefImage, ThreadDetail, ThreadImages } from '../api-client.js';
import { AGENT_BRIEF, PROJECT_PR_LINKS } from '../feature-flags.js';
import { isFormControlTag, pageAddress } from '../thread-text.js';

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** The brief names at most nine screenshots; nothing beyond that is sent. */
const MAX_IMAGES = 9;
/** The model API refuses an image over 5 MB; one that big is named, not sent. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function handleGetContext(
  api: YocoolabApiClient,
  args: { thread_id: string }
) {
  if (!AGENT_BRIEF) return buildThreadContext(await api.getThread(args.thread_id));

  // The brief is the text; the thread row carries the full-page screenshot,
  // the attached elements' shots and the reply images. Both at once — the row
  // is also what the fallback needs.
  const [briefResult, threadResult] = await Promise.allSettled([
    api.getThreadBrief(args.thread_id, { images: 'attached' }),
    api.getThread(args.thread_id),
  ]);
  const brief = briefFrom(briefResult);
  if (!brief) {
    if (threadResult.status === 'rejected') throw threadResult.reason;
    return buildThreadContext(threadResult.value);
  }

  const thread = threadResult.status === 'fulfilled' ? threadResult.value : null;
  if (!thread) console.error('[get-context] thread row unavailable; screenshots from it are left out:', (threadResult as PromiseRejectedResult).reason);
  const content: ContentBlock[] = [{ type: 'text', text: brief.markdown }];
  content.push(...(await briefImageBlocks(api, args.thread_id, brief.images, thread)));
  return { content };
}

/**
 * The brief, or null when this client should build the text itself: a 404
 * (a backend from before the brief, or BRIEF_ENABLED=0), a brief the server
 * failed to build (5xx), or no answer at all. A refusal (401/403) is final.
 */
function briefFrom(result: PromiseSettledResult<AgentBrief | null>): AgentBrief | null {
  if (result.status === 'fulfilled') {
    const b = result.value;
    return b && typeof b.markdown === 'string' && b.markdown.trim() ? b : null;
  }
  const err = result.reason;
  if (err instanceof YocoolabApiError && err.status < 500) throw err;
  console.error('[get-context] agent brief unavailable, building the thread text locally:', err);
  return null;
}

/**
 * One image block per screenshot the brief names, in its order and each
 * after its "[n] label" line, so the numbers in the brief's text point at the
 * right picture even when one cannot be sent. Sources, as the dashboard's
 * "Copy thread images" uses them: the element crop from /threads/:id/images,
 * the full page (screenshot_url), each attached element's shot, the sketch,
 * and the images posted with replies.
 */
async function briefImageBlocks(
  api: YocoolabApiClient,
  threadId: string,
  images: BriefImage[] | null | undefined,
  thread: ThreadDetail | null
): Promise<ContentBlock[]> {
  const list = (Array.isArray(images) ? images : []).slice(0, MAX_IMAGES);
  if (!list.length) return [];
  const wants = (kind: BriefImage['kind']) => list.some((img) => img.kind === kind);

  const [stored, sketch] = await Promise.all([
    wants('element')
      ? api.getThreadImages(threadId, 'element').catch((err): ThreadImages => {
        console.error('[get-context] element crop unavailable:', err);
        return {};
      })
      : Promise.resolve({} as ThreadImages),
    wants('sketch')
      ? api.getThreadSketch(threadId).catch((err) => {
        console.error('[get-context] sketch unavailable:', err);
        return null;
      })
      : Promise.resolve(null),
  ]);

  // A reply's image is numbered by its message's place in the BRIEF's
  // conversation, which leaves out bare instruction lines — but never a
  // message with images, and keeps their order. So the k-th message number
  // the brief names is the k-th message here that has attachments.
  const withImages = (thread?.messages || []).filter((m) => Array.isArray(m.attachments) && m.attachments.length > 0);
  const order: number[] = [];
  for (const img of list) {
    if (img.kind === 'attachment' && img.message != null && !order.includes(img.message)) order.push(img.message);
  }
  const attached = thread && Array.isArray(thread.attached_elements) ? thread.attached_elements : [];

  const blocks: ContentBlock[] = [];
  for (const img of list) {
    let src: string | null | undefined = null;
    if (img.kind === 'element') src = stored.element?.dataUrl;
    else if (img.kind === 'page') src = thread?.screenshot_url;
    else if (img.kind === 'attached_element' && img.element) src = attached[img.element - 2]?.screenshot;
    else if (img.kind === 'sketch') src = sketch?.png;
    else if (img.kind === 'attachment' && img.message != null) {
      src = withImages[order.indexOf(img.message)]?.attachments?.[img.attachment ?? 0]?.url;
    }
    const label = `[${img.n}] ${img.label}`;
    const block = imageBlock(src);
    if (typeof block === 'string') blocks.push({ type: 'text', text: `${label} — not attached (${block})` });
    else blocks.push({ type: 'text', text: label }, block);
  }
  return blocks;
}

/** An image block from a data URL, or why there is none. */
function imageBlock(src: string | null | undefined): ContentBlock | string {
  if (!src) return 'no image came back for it';
  const m = src.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
  if (!m) return /^https?:\/\//i.test(src) ? 'stored as a link; open the thread in Yocoolab to see it' : 'not an image this client can send';
  if (Math.floor(m[2].length * 0.75) > MAX_IMAGE_BYTES) return 'too large to send; open the thread in Yocoolab to see it';
  return { type: 'image', data: m[2], mimeType: `image/${m[1] === 'jpg' ? 'jpeg' : m[1]}` };
}

/**
 * The thread as this client used to print it, for a backend without the
 * agent brief. Form-control text is left out (it is what someone typed) and
 * page addresses lose their query (where tokens live).
 */
function buildThreadContext(thread: ThreadDetail) {
  // Build text context
  const parts: string[] = [
    `# Thread: ${thread.id}`,
    `**Status:** ${thread.status} | **Priority:** ${thread.priority}`,
    `**Repo:** ${thread.repo} | **Branch:** ${thread.branch}`,
    `**Created by:** ${thread.creator_name} at ${thread.created_at}`,
  ];

  // Link-only projects: tell a remote agent which repository the project
  // points at, so it can open its PR there and hand the link back via
  // mark_thread_addressed(pr_url).
  if (PROJECT_PR_LINKS && Array.isArray(thread.repo_links) && thread.repo_links.length > 0) {
    parts.push('**Repo links:**');
    for (const link of thread.repo_links) {
      if (!link || !link.url) continue;
      parts.push(`- ${link.role || 'repo'}: ${link.url}`);
    }
  }

  // UI element context
  if (thread.selector) parts.push(`**CSS Selector:** \`${thread.selector}\``);
  if (thread.xpath) parts.push(`**XPath:** \`${thread.xpath}\``);
  if (thread.coordinates) parts.push(`**Coordinates:** (${thread.coordinates.x}, ${thread.coordinates.y})`);
  if (thread.element_tag) {
    const text = isFormControlTag(thread.element_tag) ? '' : thread.element_text;
    parts.push(`**Element:** <${thread.element_tag}>${text ? ` "${text}"` : ''}`);
  }

  // View context (active tabs, modals, URL hash)
  if (thread.view_context) {
    const vc = thread.view_context;
    if (vc.pathname) parts.push(`**Page path:** ${vc.pathname}`);
    if (vc.hash) parts.push(`**URL hash:** ${vc.hash}`);
    if (vc.activeTabs && Array.isArray(vc.activeTabs)) {
      parts.push(`**Active tabs:** ${(vc.activeTabs as string[]).join(', ')}`);
    }
    if (vc.activeModal) parts.push(`**Active modal:** ${vc.activeModal}`);
  }

  if (thread.page_url) parts.push(`**Page URL:** ${pageAddress(thread.page_url)}`);

  // Rich element context (Yocoolab Bridge)
  if (thread.element_context) {
    const ec = thread.element_context as Record<string, any>;
    parts.push('', '## Element Context (Yocoolab Bridge)', '');
    if (ec.full_selector) parts.push(`**Full Selector:** \`${ec.full_selector}\``);
    if (ec.dom_path && Array.isArray(ec.dom_path)) {
      parts.push(`**DOM Path:** ${ec.dom_path.join(' > ')}`);
    }
    if (ec.framework_hints) {
      const fh = ec.framework_hints;
      parts.push(`**Framework:** ${fh.frameworkGuess || 'unknown'} (dev server: ${fh.devServer || 'unknown'})`);
    }
    if (ec.class_list && Array.isArray(ec.class_list) && ec.class_list.length > 0) {
      parts.push(`**Classes:** ${ec.class_list.map((c: string) => `\`${c}\``).join(', ')}`);
    }
    if (ec.bounding_box) {
      parts.push(`**Size:** ${ec.bounding_box.w}x${ec.bounding_box.h}`);
    }
    if (ec.attributes && typeof ec.attributes === 'object') {
      // `value` mirrors what was typed into a control.
      const attrs = Object.entries(ec.attributes)
        .filter(([k]) => k.toLowerCase() !== 'value')
        .map(([k, v]) => `\`${k}="${v}"\``)
        .join(', ');
      if (attrs) parts.push(`**Attributes:** ${attrs}`);
    }
    if (ec.computed_styles && typeof ec.computed_styles === 'object') {
      const styles = Object.entries(ec.computed_styles)
        .filter(([, v]) => v && v !== 'none' && v !== 'normal' && v !== '0px')
        .slice(0, 10)
        .map(([k, v]) => `\`${k}: ${v}\``)
        .join(', ');
      if (styles) parts.push(`**Key Styles:** ${styles}`);
    }
    if (ec.page) {
      if (ec.page.url) parts.push(`**Page URL:** ${pageAddress(ec.page.url)}`);
      if (ec.page.viewport) parts.push(`**Viewport:** ${ec.page.viewport.w}x${ec.page.viewport.h}`);
    }

    // Pendo analytics (captured by extension at thread creation time)
    if (ec.pendo_analytics) {
      const pa = ec.pendo_analytics;
      parts.push('', '**Pendo Analytics:**');
      if (pa.page_views != null) parts.push(`- Page views (30d): ${pa.page_views}`);
      if (pa.unique_visitors != null) parts.push(`- Unique visitors (30d): ${pa.unique_visitors}`);
      if (pa.feature_usage != null) parts.push(`- Feature clicks (30d): ${pa.feature_usage}`);
      if (pa.active_guides && Array.isArray(pa.active_guides) && pa.active_guides.length > 0) {
        parts.push(`- Active guides: ${pa.active_guides.map((g: any) => g.name).join(', ')}`);
      }
    }
  }

  // Iteration context
  if (thread.parent_thread_id || (thread.iterations && thread.iterations.length > 0)) {
    parts.push('', '## Iteration History', '');

    if (thread.parent_thread) {
      parts.push(`**Parent thread:** ${thread.parent_thread.id}`);
      parts.push(`**Original request:** ${thread.parent_thread.first_message_content || 'N/A'}`);
      parts.push(`**Parent status:** ${thread.parent_thread.status}`);
      if (thread.parent_thread.pr_url) parts.push(`**Parent PR:** ${thread.parent_thread.pr_url}`);
      parts.push('');

      // Include ALL parent thread messages so iteration context is complete
      if (thread.parent_thread.messages && thread.parent_thread.messages.length > 0) {
        parts.push('### Full parent thread conversation:');
        parts.push('');
        for (const msg of thread.parent_thread.messages) {
          parts.push(`**${msg.author_name}** (${msg.created_at}):`);
          parts.push(msg.content);
          parts.push('');
        }
      }
    }

    if (thread.iteration_type) {
      parts.push(`**This is a ${thread.iteration_type}** (iteration #${thread.iteration_number})`);
      if (thread.iteration_type === 'refinement') {
        parts.push('**Instructions:** This is a minor refinement. Commit to the SAME working branch/PR as the parent thread. Do NOT create a new branch.');
      } else {
        parts.push('**Instructions:** This is a major revision. The previous approach was wrong. Create a NEW working branch and PR with a different approach.');
      }
      parts.push('');
    }

    if (thread.iterations && thread.iterations.length > 0) {
      parts.push('### Previous iterations:');
      for (const iter of thread.iterations) {
        parts.push(`- Iteration ${iter.iteration_number} (${iter.iteration_type}): ${(iter.first_message_content || 'N/A').substring(0, 100)} [${iter.status}]`);
      }
      parts.push('');
    }
  }

  // Jira / PR info
  if (thread.jira_issue_key) parts.push(`**Jira:** ${thread.jira_issue_key}`);
  if (thread.pr_url) parts.push(`**PR:** ${thread.pr_url}`);

  // Messages
  parts.push('', '## Messages', '');
  if (thread.messages && thread.messages.length > 0) {
    for (const msg of thread.messages) {
      parts.push(`**${msg.author_name}** (${msg.created_at}):`);
      parts.push(msg.content);
      parts.push('');
    }
  } else {
    parts.push('No messages found.');
  }

  // Build response content blocks
  const content: ContentBlock[] = [
    { type: 'text' as const, text: parts.join('\n') },
  ];

  // Include screenshot as image content block if available
  if (thread.screenshot_url) {
    // Screenshots are stored as data URIs (data:image/png;base64,...)
    const dataUriMatch = thread.screenshot_url.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
    if (dataUriMatch) {
      content.push({
        type: 'image' as const,
        data: dataUriMatch[2],
        mimeType: `image/${dataUriMatch[1]}`,
      });
    }
  }

  return { content };
}
