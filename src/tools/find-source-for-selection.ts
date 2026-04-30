import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SelectionStore } from '../selection-store.js';
import type { YocoolabApiClient } from '../api-client.js';
import type { ElementSelectedPayload } from '../types.js';
import { mapElementToSource } from '../mapper.js';

/**
 * Converts a thread's stored element_context into an ElementSelectedPayload
 * so we can reuse the mapper for both live selections and stored thread data.
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

export function registerFindSourceForSelection(
  server: McpServer,
  store: SelectionStore,
  workspaceRoot: string,
  api: YocoolabApiClient | null
): void {
  server.tool(
    'find_source_for_selection',
    'Searches the workspace for source files that likely define or render the selected UI element. Returns ranked candidates with file paths, line ranges, confidence scores, and match reasons. Can work with live Chrome selections or stored thread element_context.',
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
    },
    async ({ correlationId, thread_id }) => {
      let payload: ElementSelectedPayload | null | undefined;

      // If thread_id provided, build payload from stored thread context
      if (thread_id) {
        if (!api) {
          return {
            content: [{ type: 'text' as const, text: 'Error: YOCOOLAB_TOKEN is required to look up thread context.' }],
            isError: true,
          };
        }
        try {
          const thread = await api.getThread(thread_id);
          payload = threadContextToPayload(thread);
          if (!payload) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Thread "${thread_id}" does not have element_context data. It may have been created before Yocoolab Bridge was enabled.`,
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
                text: `No selection found with correlationId "${correlationId}". Use get_selection_history to see available selections.`,
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
                text: 'No element has been selected yet. Use the Chrome extension to click an element, or pass a thread_id to search from stored context.',
              },
            ],
          };
        }
      }

      const candidates = await mapElementToSource(payload, workspaceRoot);

      if (candidates.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'No source candidates found for this element. The element may be generated dynamically, ' +
                'from a third-party library, or the workspace root may not contain the relevant source files.\n\n' +
                `Workspace root: ${workspaceRoot}\n` +
                `Element: <${payload.element.tag.toLowerCase()}> "${payload.element.text?.slice(0, 50)}"`,
            },
          ],
        };
      }

      const result = candidates.map((c) => ({
        filePath: c.filePath,
        relativePath: c.filePath.startsWith(workspaceRoot)
          ? c.filePath.slice(workspaceRoot.length).replace(/^\//, '')
          : c.filePath,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
        confidence: `${(c.confidence * 100).toFixed(0)}%`,
        reason: c.reason,
        matchType: c.matchType,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
