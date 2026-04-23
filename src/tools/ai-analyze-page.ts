import { YocoolabApiClient } from '../api-client.js';

export interface AiAnalyzePageArgs {
  url: string;
  question: string;
  page_title?: string;
  headings?: string[];
  body_text?: string;
  screenshot_base64?: string;
  element_selector?: string;
  element_tag?: string;
  element_text?: string;
}

export async function handleAiAnalyzePage(
  api: YocoolabApiClient,
  args: AiAnalyzePageArgs
) {
  try {
    const result = await api.analyzePageWithAI({
      message: args.question,
      pageContext: {
        url: args.url,
        title: args.page_title || args.url,
        headings: args.headings,
        bodyText: args.body_text,
        elementContext: args.element_selector ? {
          selector: args.element_selector,
          tag: args.element_tag,
          text: args.element_text,
        } : undefined,
      },
      screenshot: args.screenshot_base64,
    });

    const parts: string[] = [result.reply];

    if (result.model) {
      parts.push('', `---`, `Model: ${result.model} | Tokens: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: parts.join('\n'),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error analyzing page: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}
