import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SelectionStore } from '../selection-store.js';

export function registerGetSelectionHistory(
  server: McpServer,
  store: SelectionStore
): void {
  server.tool(
    'get_selection_history',
    'Returns the last N element selections from the Chrome extension, newest first. Useful for comparing multiple elements or reviewing recent selections.',
    {
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe('Number of selections to return (max 50)'),
    },
    async ({ limit }) => {
      const history = store.history(limit);

      if (history.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No elements have been selected yet.',
            },
          ],
        };
      }

      const summary = history.map((p, i) => ({
        index: i + 1,
        timestamp: new Date(p.timestamp).toISOString(),
        url: p.page.url,
        tag: p.element.tag,
        text: p.element.text?.slice(0, 50),
        selector: p.element.selector,
        id: p.element.id || null,
        correlationId: p.correlationId,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );
}
