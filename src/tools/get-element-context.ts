import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SelectionStore } from '../selection-store.js';
import type { YocoolabApiClient } from '../api-client.js';
import type { ElementSelectedPayload } from '../types.js';
import { mapElementToSource } from '../mapper.js';
import { generateClaudePrompt } from '../prompt-template.js';

/**
 * Converts a thread's stored element_context into an ElementSelectedPayload.
 */
function threadContextToPayload(thread: Record<string, any>): ElementSelectedPayload | null {
  const ec = thread.element_context;
  if (!ec) return null;

  return {
    type: 'ELEMENT_SELECTED',
    timestamp: Date.now(),
    correlationId: `thread-${thread.id}`,
    page: ec.page || { url: thread.page_url || '', title: '', viewport: { w: 1920, h: 1080 }, devicePixelRatio: 1 },
    element: {
      selector: ec.full_selector || thread.selector || '',
      tag: thread.element_tag || 'div',
      id: ec.attributes?.id || '',
      classList: ec.class_list || [],
      text: thread.element_text || '',
      attributes: ec.attributes || {},
      domPath: ec.dom_path || [],
      boundingBox: ec.bounding_box || { x: 0, y: 0, w: 0, h: 0 },
    },
    styles: {
      computed: (ec.computed_styles || {}) as any,
    },
    hints: ec.framework_hints || { frameworkGuess: 'unknown', devServer: 'unknown' },
  };
}

export function registerGetElementContext(
  server: McpServer,
  store: SelectionStore,
  workspaceRoot: string,
  api: YocoolabApiClient | null
): void {
  server.tool(
    'get_element_context',
    'Returns a comprehensive summary of a UI element, including its DOM context, computed styles, and ranked source code candidates. Works with live Chrome selections or stored thread element_context. This is the primary tool to use when the user wants to modify a UI element.',
    {
      correlationId: z
        .string()
        .optional()
        .describe(
          'The correlationId of a specific selection. If omitted, uses the latest selection.'
        ),
      thread_id: z
        .string()
        .optional()
        .describe(
          'A Yocoolab thread ID to use stored element_context instead of a live selection.'
        ),
      includePrompt: z
        .boolean()
        .default(true)
        .describe(
          'Whether to include a pre-built edit prompt with constraints (default: true).'
        ),
    },
    async ({ correlationId, thread_id, includePrompt }) => {
      let payload: ElementSelectedPayload | null | undefined;
      let threadData: Record<string, any> | undefined;

      if (thread_id) {
        if (!api) {
          return {
            content: [{ type: 'text' as const, text: 'Error: YOCOOLAB_TOKEN is required to look up thread context.' }],
            isError: true,
          };
        }
        try {
          threadData = await api.getThread(thread_id);
          payload = threadContextToPayload(threadData);
          if (!payload) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Thread "${thread_id}" does not have element_context data.`,
                },
              ],
            };
          }
        } catch (e: any) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to fetch thread: ${e.message}`,
              },
            ],
            isError: true,
          };
        }
      } else if (correlationId) {
        payload = store.getByCorrelationId(correlationId);
        if (!payload) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No selection found with correlationId "${correlationId}".`,
              },
            ],
          };
        }
      } else {
        payload = store.latest();
        if (!payload) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No element has been selected yet. Use the Chrome extension to click an element, or pass a thread_id.',
              },
            ],
          };
        }
      }

      const candidates = await mapElementToSource(payload, workspaceRoot);

      const sections: string[] = [];

      // Element summary
      const el = payload.element;
      sections.push('## Selected Element\n');
      sections.push(`- **Tag**: \`<${el.tag.toLowerCase()}>\``);
      sections.push(
        `- **Text**: "${el.text?.slice(0, 100) || '(empty)'}"`
      );
      sections.push(`- **Selector**: \`${el.selector}\``);
      if (el.id) sections.push(`- **ID**: \`${el.id}\``);
      if (el.classList.length > 0)
        sections.push(
          `- **Classes**: ${el.classList.map((c) => `\`${c}\``).join(', ')}`
        );

      const attrEntries = Object.entries(el.attributes || {});
      if (attrEntries.length > 0) {
        sections.push(
          `- **Attributes**: ${attrEntries.map(([k, v]) => `\`${k}="${v}"\``).join(', ')}`
        );
      }

      // Page context
      sections.push('\n## Page Context\n');
      sections.push(`- **URL**: ${payload.page.url}`);
      sections.push(`- **Title**: ${payload.page.title}`);
      sections.push(
        `- **Viewport**: ${payload.page.viewport.w}x${payload.page.viewport.h}`
      );
      sections.push(
        `- **Framework**: ${payload.hints.frameworkGuess} (dev server: ${payload.hints.devServer})`
      );

      // Key computed styles
      const styleEntries = Object.entries(payload.styles.computed).filter(
        ([, v]) =>
          v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'auto'
      );
      if (styleEntries.length > 0) {
        sections.push('\n## Computed Styles\n');
        for (const [k, v] of styleEntries.slice(0, 12)) {
          sections.push(`- \`${k}\`: \`${v}\``);
        }
      }

      // Source candidates
      sections.push(`\n## Source Candidates (${candidates.length} found)\n`);
      if (candidates.length > 0) {
        for (const [i, c] of candidates.slice(0, 5).entries()) {
          const relPath = c.filePath.startsWith(workspaceRoot)
            ? c.filePath.slice(workspaceRoot.length).replace(/^\//, '')
            : c.filePath;
          sections.push(
            `${i + 1}. **${relPath}** (lines ${c.lineStart}-${c.lineEnd}) -- ` +
              `${(c.confidence * 100).toFixed(0)}% confidence -- ${c.reason}`
          );
        }
      } else {
        sections.push(
          'No source candidates found. Search the workspace manually.'
        );
      }

      // Optionally include the full prompt template
      if (includePrompt) {
        sections.push('\n## Edit Prompt\n');
        const prompt = generateClaudePrompt({
          elementPayload: payload,
          candidates,
          workspaceRoot,
          threadContext: threadData
            ? {
                threadId: threadData.id,
                repo: threadData.repo,
                branch: threadData.branch,
                messages: threadData.messages?.map((m: any) => ({
                  author_name: m.author_name,
                  content: m.content,
                })) || [],
              }
            : undefined,
        });
        sections.push(prompt);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: sections.join('\n'),
          },
        ],
      };
    }
  );
}
