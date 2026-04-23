import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SelectionStore } from '../selection-store.js';

export function registerGetLatestSelection(
  server: McpServer,
  store: SelectionStore
): void {
  server.tool(
    'get_latest_selection',
    'Returns the most recent element selection from the Chrome extension. Includes element selector, tag, text content, classes, attributes, computed styles, and page context.',
    {},
    async () => {
      const latest = store.latest();

      if (!latest) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No element has been selected yet. Use the Yocoolab Chrome extension to click an element on a page.',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(latest, null, 2),
          },
        ],
      };
    }
  );
}
