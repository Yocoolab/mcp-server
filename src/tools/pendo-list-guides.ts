import { PendoClient } from '../pendo-client.js';

export async function handlePendoListGuides(
  pendo: PendoClient,
  args: { page_url_filter?: string }
) {
  try {
    const guides = await pendo.listGuides();

    if (!Array.isArray(guides) || guides.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No guides found in Pendo.',
          },
        ],
      };
    }

    // Filter to active/staged guides
    let filtered = guides.filter(
      (g: any) => g.state === 'public' || g.state === 'staged'
    );

    // Optionally filter by page URL in targeting rules
    if (args.page_url_filter) {
      const urlLower = args.page_url_filter.toLowerCase();
      filtered = filtered.filter((g: any) => {
        const rules = JSON.stringify(g.audienceUiHint || g.pageRules || g).toLowerCase();
        return rules.includes(urlLower);
      });
    }

    if (filtered.length === 0) {
      const suffix = args.page_url_filter
        ? ` matching "${args.page_url_filter}"`
        : '';
      return {
        content: [
          {
            type: 'text' as const,
            text: `No active guides found${suffix}.`,
          },
        ],
      };
    }

    const lines = [
      `**Active Pendo Guides** (${filtered.length} found)${args.page_url_filter ? ` matching "${args.page_url_filter}"` : ''}`,
      '',
    ];

    for (const guide of filtered.slice(0, 20)) {
      const name = guide.name || 'Untitled';
      const state = guide.state || 'unknown';
      const steps = guide.steps?.length || 0;
      lines.push(`- **${name}** (${state}, ${steps} step${steps !== 1 ? 's' : ''})`);
    }

    if (filtered.length > 20) {
      lines.push(`\n...and ${filtered.length - 20} more`);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: lines.join('\n'),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error listing guides: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}
