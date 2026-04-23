import { YocoolabApiClient } from '../api-client.js';

export async function handleGetContext(
  api: YocoolabApiClient,
  args: { thread_id: string }
) {
  const thread = await api.getThread(args.thread_id);

  // Build text context
  const parts: string[] = [
    `# Thread: ${thread.id}`,
    `**Status:** ${thread.status} | **Priority:** ${thread.priority}`,
    `**Repo:** ${thread.repo} | **Branch:** ${thread.branch}`,
    `**Created by:** ${thread.creator_name} at ${thread.created_at}`,
  ];

  // UI element context
  if (thread.selector) parts.push(`**CSS Selector:** \`${thread.selector}\``);
  if (thread.xpath) parts.push(`**XPath:** \`${thread.xpath}\``);
  if (thread.coordinates) parts.push(`**Coordinates:** (${thread.coordinates.x}, ${thread.coordinates.y})`);
  if (thread.element_tag) {
    parts.push(`**Element:** <${thread.element_tag}>${thread.element_text ? ` "${thread.element_text}"` : ''}`);
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

  if (thread.page_url) parts.push(`**Page URL:** ${thread.page_url}`);

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
      const attrs = Object.entries(ec.attributes)
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
      if (ec.page.url) parts.push(`**Page URL:** ${ec.page.url}`);
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
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  > = [
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
