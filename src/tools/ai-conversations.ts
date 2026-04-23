import { YocoolabApiClient } from '../api-client.js';

export async function handleGetAiConversations(
  api: YocoolabApiClient
) {
  try {
    const result = await api.getAiConversations();
    const conversations = result.conversations || [];

    if (conversations.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No AI conversations found.',
          },
        ],
      };
    }

    const lines: string[] = [`# AI Conversations (${conversations.length})`, ''];

    for (const conv of conversations) {
      lines.push(`- **${conv.id}** — ${conv.page_url || '(no page)'} — ${conv.message_count} messages — last: ${conv.last_message_at}`);
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
          text: `Error fetching AI conversations: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}
