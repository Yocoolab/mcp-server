#!/usr/bin/env node

import { runInit } from './init.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { YocoolabApiClient } from './api-client.js';
import { GitHubClient } from './github-client.js';
import { SelectionStore } from './selection-store.js';
import { startHttpBridge } from './http-bridge.js';
import { handleListThreads } from './tools/list-threads.js';
import { handleGetContext } from './tools/get-context.js';
import { handleCreatePr } from './tools/create-pr.js';
import { handleMarkAddressed } from './tools/mark-addressed.js';
import { handleGetDeploymentPreview } from './tools/get-deployment-preview.js';
import { handleAddThreadMessage } from './tools/add-thread-message.js';
import { registerGetLatestSelection } from './tools/get-latest-selection.js';
import { registerGetSelectionHistory } from './tools/get-selection-history.js';
import { registerFindSourceForSelection } from './tools/find-source-for-selection.js';
import { registerGetElementContext } from './tools/get-element-context.js';
import { handleAiAnalyzePage } from './tools/ai-analyze-page.js';
import { handleGetAiConversations } from './tools/ai-conversations.js';
import { PendoClient } from './pendo-client.js';
import { handlePendoFeatureUsage } from './tools/pendo-feature-usage.js';
import { handlePendoPageAnalytics } from './tools/pendo-page-analytics.js';
import { handlePendoTrackEvent } from './tools/pendo-track-event.js';
import { handlePendoListGuides } from './tools/pendo-list-guides.js';

// Activity monitor imports
import { ActivityEventStore } from './event-store.js';
import { SessionManager } from './session-manager.js';
import { attachActivityWs } from './ws-activity.js';
import { ensureHooksInstalled } from './hook-installer.js';
import { handleGetActivitySummary } from './tools/activity-summary.js';
import { handleGetRecentEvents } from './tools/activity-recent.js';
import { handleGetFilesTouched } from './tools/activity-files.js';
import { handleGetDashboardUrl } from './tools/activity-dashboard.js';

const SUBCOMMAND = process.argv[2];

if (SUBCOMMAND === 'init') {
  runInit()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
} else if (SUBCOMMAND === '--help' || SUBCOMMAND === '-h' || SUBCOMMAND === 'help') {
  console.log(`@yocoolab/mcp-server

Usage:
  yocoolab-mcp           Run the MCP server (used by Claude Code via .mcp.json)
  yocoolab-mcp init      Interactive setup — writes ~/.mcp.json
  yocoolab-mcp --help    Show this help

Environment variables (when running the server):
  YOCOOLAB_TOKEN              required — your Yocoolab JWT
  YOCOOLAB_API_URL            default https://app.yocoolab.com
  GITHUB_TOKEN                optional — enables PR tools
  YOCOOLAB_BRIDGE_PORT        default 9800
  YOCOOLAB_BRIDGE_WORKSPACE   default current working directory
`);
  process.exit(0);
} else {
  startServer();
}

function startServer() {
// Configuration from environment
const YOCOOLAB_API_URL = process.env.YOCOOLAB_API_URL || 'http://localhost:3000';
const YOCOOLAB_TOKEN = process.env.YOCOOLAB_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PENDO_INTEGRATION_KEY = process.env.PENDO_INTEGRATION_KEY;
const YOCOOLAB_BRIDGE_PORT = parseInt(process.env.YOCOOLAB_BRIDGE_PORT || process.env.UX_BRIDGE_PORT || '9800', 10);
const YOCOOLAB_BRIDGE_WORKSPACE = process.env.YOCOOLAB_BRIDGE_WORKSPACE || process.env.UX_BRIDGE_WORKSPACE || process.cwd();

if (!YOCOOLAB_TOKEN) {
  console.error('Error: YOCOOLAB_TOKEN environment variable is required');
  console.error('Hint: run `npx @yocoolab/mcp-server init` to set up your config interactively.');
  process.exit(1);
}

// Initialize clients
const api = new YocoolabApiClient(YOCOOLAB_API_URL, YOCOOLAB_TOKEN);
const github = GITHUB_TOKEN ? new GitHubClient(GITHUB_TOKEN) : null;
const pendo = PENDO_INTEGRATION_KEY ? new PendoClient(PENDO_INTEGRATION_KEY) : null;

// ─── Activity monitor setup ──────────────────────────────────────────
try {
  ensureHooksInstalled();
} catch (err) {
  process.stderr.write(`[yocoolab] Hook installation failed (non-fatal): ${err}\n`);
}

const activityEventStore = new ActivityEventStore(1000);
activityEventStore.loadFromDisk();

const sessionManager = new SessionManager();
// Replay loaded events through session manager to restore session state
for (const event of activityEventStore.recent(activityEventStore.count())) {
  sessionManager.processEvent(event);
}

// Initialize Bridge infrastructure (now includes activity stores)
const selectionStore = new SelectionStore(50);
const bridge = startHttpBridge(YOCOOLAB_BRIDGE_PORT, selectionStore, activityEventStore, sessionManager);
const { emitThreadUpdate, getCompanionMessages, postCompanionReply } = bridge;

// ─── Companion auto-inject: prepend pending messages to every tool response ──

type ToolContent = Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
type ToolResult = { content: ToolContent; isError?: boolean; _meta?: Record<string, unknown> };

/** Drain companion queue and return formatted content blocks (or null if empty) */
function drainCompanionQueue(): ToolContent | null {
  const msgs = getCompanionMessages();
  if (msgs.length === 0) return null;

  const lines: string[] = [
    '',
    `⚡ COMPANION CHAT — ${msgs.length} new message(s) from Chrome extension:`,
    '',
  ];
  for (const msg of msgs) {
    lines.push(`[${msg.id}] "${msg.content}"`);
    const pc = msg.pageContext as Record<string, unknown> | undefined;
    if (pc?.url) lines.push(`    Page: ${pc.url}`);
    const ec = msg.elementContext as Record<string, unknown> | undefined;
    if (ec?.selector) lines.push(`    Element: ${ec.selector}`);
    if (msg.voice) lines.push('    (voice input)');
    lines.push('');
  }
  lines.push('→ REPLY to each with reply_to_companion(message="...") BEFORE continuing your current task.');
  lines.push('─'.repeat(50));
  lines.push('');

  const content: ToolContent = [{ type: 'text' as const, text: lines.join('\n') }];

  // Attach screenshots if any
  for (const msg of msgs) {
    if (msg.screenshot) {
      const match = msg.screenshot.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
      if (match) {
        content.push({ type: 'image' as const, data: match[2], mimeType: `image/${match[1]}` });
      }
    }
  }

  return content;
}

/** Wrap any tool handler so companion messages get prepended to its result */
function withCompanion<T>(handler: (args: T) => Promise<ToolResult>): (args: T) => Promise<ToolResult> {
  return async (args: T) => {
    const result = await handler(args);
    const alert = drainCompanionQueue();
    if (!alert) return result;
    return { ...result, content: [...alert, ...result.content] };
  };
}

// Attach WebSocket for activity streaming
const activityWs = attachActivityWs(bridge.server, activityEventStore, sessionManager);

// Wire activity events to WS broadcast
bridge.onActivityEvent((event) => {
  activityWs.broadcast(event);
  const session = sessionManager.getSession(event.session_id);
  if (session) {
    activityWs.broadcastSessionUpdate(session);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  activityEventStore.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  activityEventStore.close();
  process.exit(0);
});

// Create MCP server
const server = new McpServer({
  name: 'yocoolab',
  version: '1.0.0',
});

// Companion message arrival notification (macOS desktop notification handles UX;
// actual message delivery happens via tool-response injection in withCompanion())

// ─── Yocoolab feedback tools ───────────────────────────────────────────

server.tool(
  'list_open_threads',
  'List unresolved feedback threads for a repository. Returns thread summaries with context about what UI element each comment is attached to. Use claude_code_pending=true to only show threads that users have sent to Claude Code.',
  {
    repo: z.string().describe('Repository identifier (e.g., "org/repo-name")'),
    branch: z.string().optional().describe('Optional branch filter (e.g., "main", "feature/xyz")'),
    claude_code_pending: z.boolean().optional().describe('Filter for threads pending Claude Code review (true = only pending threads)'),
  },
  withCompanion(async (args) => {
    return handleListThreads(api, args);
  })
);

server.tool(
  'get_thread_context',
  'Get full details of a feedback thread including all messages, UI element context (selector, coordinates, element tag), view state, and the annotated screenshot. The screenshot is returned as an image so you can visually see the feedback location.',
  {
    thread_id: z.string().describe('The UUID of the thread to fetch'),
  },
  withCompanion(async (args) => {
    return handleGetContext(api, args);
  })
);

server.tool(
  'create_pr_for_thread',
  'Create a GitHub pull request (or add a commit to the existing working branch) with code changes that address a feedback thread. All fixes for a repo accumulate on a single working branch with one PR.',
  {
    thread_id: z.string().describe('The UUID of the feedback thread this fix addresses'),
    branch_name: z.string().optional().describe('Name for the working branch (only used if no working branch exists yet; defaults to "yocoolab/feedback")'),
    title: z.string().describe('Short description of the fix (used as commit message)'),
    body: z.string().describe('Detailed fix description (Markdown)'),
    files: z.array(z.object({
      path: z.string().describe('File path relative to repo root'),
      content: z.string().describe('Full file content (replaces entire file)'),
    })).describe('Array of file changes to include in the commit'),
  },
  withCompanion(async (args) => {
    if (!github) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Error: GITHUB_TOKEN environment variable is required to create pull requests.',
          },
        ],
        isError: true,
      };
    }
    return handleCreatePr(api, github, args, emitThreadUpdate);
  })
);

server.tool(
  'mark_thread_addressed',
  'Mark a feedback thread as resolved. Optionally add a message explaining how it was addressed.',
  {
    thread_id: z.string().describe('The UUID of the thread to resolve'),
    message: z.string().optional().describe('Optional message explaining how the feedback was addressed'),
  },
  withCompanion(async (args) => {
    return handleMarkAddressed(api, args, emitThreadUpdate);
  })
);

server.tool(
  'get_deployment_preview',
  'Check if a preview deployment is available for a specific repo and branch. Returns the preview URL if deployed. Useful after creating a PR to get the live preview link.',
  {
    repo: z.string().describe('Repository identifier (e.g., "org/repo-name")'),
    branch: z.string().describe('Branch name to check for deployments'),
  },
  withCompanion(async (args) => {
    return handleGetDeploymentPreview(api, args);
  })
);

server.tool(
  'add_thread_message',
  'Add a message to a feedback thread without changing its status. Use this to post updates like preview URLs, implementation notes, or questions back to the thread.',
  {
    thread_id: z.string().describe('The UUID of the thread to add a message to'),
    message: z.string().describe('The message content to add (supports Markdown)'),
  },
  withCompanion(async (args) => {
    return handleAddThreadMessage(api, args);
  })
);

// ─── Companion chat tools (AI Companion ↔ Claude Code) ──────────────────

server.tool(
  'get_companion_messages',
  'Check for new messages from the AI Companion panel in the Chrome extension. Returns pending messages and clears the queue. Each message includes the user text, page context, and optional screenshot/element attachments.',
  {},
  async () => {
    const msgs = getCompanionMessages();
    if (msgs.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No new companion messages.' }],
      };
    }

    const parts: string[] = [`# ${msgs.length} new companion message(s)`, ''];
    for (const msg of msgs) {
      parts.push(`## Message #${msg.id} (${new Date(msg.timestamp).toISOString()})`);
      if (msg.voice) parts.push('*[Voice input]*');
      parts.push('', msg.content, '');

      if (msg.pageContext) {
        const pc = msg.pageContext as Record<string, unknown>;
        if (pc.url) parts.push(`**Page:** ${pc.url}`);
        if (pc.title) parts.push(`**Title:** ${pc.title}`);
      }
      if (msg.elementContext) {
        const ec = msg.elementContext as Record<string, unknown>;
        parts.push(`**Element:** \`${ec.selector || ec.tag || 'unknown'}\``);
        if (ec.text) parts.push(`**Text:** "${String(ec.text).slice(0, 100)}"`);
        if (ec.styles) parts.push(`**Styles:** ${JSON.stringify(ec.styles)}`);
      }
      parts.push('---', '');
    }

    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
      { type: 'text' as const, text: parts.join('\n') },
    ];

    // Include screenshot from most recent message if available
    for (const msg of msgs) {
      if (msg.screenshot) {
        const match = msg.screenshot.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
        if (match) {
          content.push({
            type: 'image' as const,
            data: match[2],
            mimeType: `image/${match[1]}`,
          });
        }
      }
    }

    return { content };
  }
);

server.tool(
  'reply_to_companion',
  'Send a reply back to the AI Companion panel in the Chrome extension. The reply will appear as an assistant message in the companion chat UI. Supports Markdown formatting.',
  {
    message: z.string().describe('The reply message to display in the companion panel (supports Markdown)'),
  },
  async (args) => {
    postCompanionReply(args.message);
    return {
      content: [{ type: 'text' as const, text: `Reply sent to companion: "${args.message.slice(0, 100)}${args.message.length > 100 ? '...' : ''}"` }],
    };
  }
);

// ─── Yocoolab Bridge tools (element selection) ─────────────────────────

registerGetLatestSelection(server, selectionStore);
registerGetSelectionHistory(server, selectionStore);
registerFindSourceForSelection(server, selectionStore, YOCOOLAB_BRIDGE_WORKSPACE, api);
registerGetElementContext(server, selectionStore, YOCOOLAB_BRIDGE_WORKSPACE, api);

// ─── AI Assistant tools (Yocoolab Companion) ────────────────────────

server.tool(
  'ai_analyze_page',
  'Ask the Yocoolab AI assistant to analyze a web page. Supports text questions with optional screenshot (vision) and page context. Useful for getting AI insights about a page layout, accessibility, or code structure.',
  {
    url: z.string().describe('URL of the page being analyzed'),
    question: z.string().describe('What to analyze or ask about the page'),
    page_title: z.string().optional().describe('Page title'),
    headings: z.array(z.string()).optional().describe('Page headings (h1-h3)'),
    body_text: z.string().optional().describe('Page body text snippet (first ~1000 chars)'),
    screenshot_base64: z.string().optional().describe('Base64-encoded screenshot data URL (data:image/png;base64,...)'),
    element_selector: z.string().optional().describe('CSS selector of a focused element'),
    element_tag: z.string().optional().describe('Tag name of the focused element'),
    element_text: z.string().optional().describe('Text content of the focused element'),
  },
  withCompanion(async (args) => {
    return handleAiAnalyzePage(api, args);
  })
);

server.tool(
  'get_ai_conversations',
  'List recent AI assistant conversations. Returns conversation IDs, page URLs, and message counts.',
  {},
  withCompanion(async () => {
    return handleGetAiConversations(api);
  })
);

// ─── Pendo analytics tools (optional) ────────────────────────────────

if (pendo) {
  server.tool(
    'pendo_get_feature_usage',
    'Query Pendo for feature usage analytics (click events, unique visitors) over a time range. Useful for understanding how heavily a feature is used when reviewing feedback threads.',
    {
      feature_name: z.string().describe('Name of the feature to look up in Pendo'),
      days: z.number().optional().describe('Number of days to look back (default: 30)'),
    },
    withCompanion(async (args) => handlePendoFeatureUsage(pendo, args))
  );

  server.tool(
    'pendo_get_page_analytics',
    'Query Pendo for page-level analytics (page views, unique visitors, avg time on page). Use the page_url from thread context to check how popular a page is.',
    {
      page_url_pattern: z.string().describe('Page URL or pattern to match in Pendo'),
      days: z.number().optional().describe('Number of days to look back (default: 30)'),
    },
    withCompanion(async (args) => handlePendoPageAnalytics(pendo, args))
  );

  server.tool(
    'pendo_track_event',
    'Send a custom track event to Pendo. Use this to track actions like feedback resolved, PR created from feedback, or guide suggestions.',
    {
      event_name: z.string().describe('Name of the event (e.g., "feedback_resolved", "pr_created_from_feedback")'),
      visitor_id: z.string().optional().describe('Pendo visitor ID'),
      account_id: z.string().optional().describe('Pendo account ID'),
      properties: z.string().optional().describe('JSON string of additional properties'),
    },
    withCompanion(async (args) => handlePendoTrackEvent(pendo, args))
  );

  server.tool(
    'pendo_list_guides',
    'List active in-app guides from Pendo. Optionally filter by page URL to see what guides are deployed on a specific page.',
    {
      page_url_filter: z.string().optional().describe('Filter guides by page URL (partial match)'),
    },
    withCompanion(async (args) => handlePendoListGuides(pendo, args))
  );
}

// ─── Activity monitor tools ────────────────────────────────────────────

server.tool(
  'get_activity_summary',
  'Get a high-level summary of Claude Code activity: total events, active sessions, tool usage breakdown, files touched, and error count.',
  {},
  withCompanion(async () => {
    return handleGetActivitySummary(activityEventStore, sessionManager);
  })
);

server.tool(
  'get_recent_events',
  'Get the most recent Claude Code activity events (tool calls, prompts, errors). Shows timestamps, tool names, and key details.',
  {
    limit: z.number().optional().describe('Number of recent events to return (default: 10, max: 50)'),
  },
  withCompanion(async (args) => {
    return handleGetRecentEvents(activityEventStore, args.limit);
  })
);

server.tool(
  'get_files_touched',
  'List all files that have been read, written, or edited across Claude Code sessions. Shows file paths with session counts.',
  {},
  withCompanion(async () => {
    return handleGetFilesTouched(sessionManager);
  })
);

server.tool(
  'get_dashboard_url',
  'Get the URL for the real-time activity monitoring dashboard. Open in a browser to see live Claude Code activity, tool usage charts, and session timelines.',
  {},
  withCompanion(async () => {
    return handleGetDashboardUrl(YOCOOLAB_BRIDGE_PORT);
  })
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('MCP server error:', error);
  process.exit(1);
});

}  // end startServer
