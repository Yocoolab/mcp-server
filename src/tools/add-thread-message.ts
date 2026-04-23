import { YocoolabApiClient } from '../api-client.js';

export async function handleAddThreadMessage(
  api: YocoolabApiClient,
  args: { thread_id: string; message: string }
) {
  // Fetch thread to get repo (required by the messages endpoint)
  const thread = await api.getThread(args.thread_id);
  await api.addMessage(args.thread_id, args.message, thread.repo);
  return {
    content: [
      {
        type: 'text' as const,
        text: `Message added to thread ${args.thread_id}: "${args.message}"`,
      },
    ],
  };
}
