import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_API_URL = 'https://app.yocoolab.com';
const DEFAULT_BRIDGE_PORT = '9800';
const PACKAGE_NAME = '@yocoolab/mcp-server';

interface YocoolabServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface McpConfig {
  mcpServers?: Record<string, YocoolabServerConfig | unknown>;
  [k: string]: unknown;
}

function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.trim());
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(p: string): Promise<McpConfig | null> {
  if (!(await fileExists(p))) return null;
  const raw = await fs.readFile(p, 'utf8');
  try {
    return JSON.parse(raw) as McpConfig;
  } catch (e) {
    throw new Error(`Existing ${p} is not valid JSON: ${(e as Error).message}`);
  }
}

async function ensureGitignoreEntry(dir: string, entry: string): Promise<boolean> {
  const gitDir = path.join(dir, '.git');
  if (!(await fileExists(gitDir))) return false;
  const giPath = path.join(dir, '.gitignore');
  let contents = '';
  if (await fileExists(giPath)) {
    contents = await fs.readFile(giPath, 'utf8');
    const lines = contents.split('\n').map((l) => l.trim());
    if (lines.includes(entry) || lines.includes(`/${entry}`)) return false;
  }
  const trailing = contents.length === 0 || contents.endsWith('\n') ? '' : '\n';
  const block = `${trailing}\n# Yocoolab MCP config (contains JWT — do not commit)\n${entry}\n`;
  await fs.appendFile(giPath, block);
  return true;
}

export async function runInit(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'init requires an interactive terminal (stdin is not a TTY). ' +
        'Run `npx @yocoolab/mcp-server init` directly in your shell, ' +
        'not through a pipe or redirect.',
    );
  }

  const rl = readline.createInterface({ input, output });
  const ask = async (q: string, fallback?: string): Promise<string> => {
    const suffix = fallback ? ` [${fallback}]` : '';
    const answer = (await rl.question(`${q}${suffix}: `)).trim();
    return answer || fallback || '';
  };

  try {
    output.write(`\nYocoolab MCP server — setup\n`);
    output.write(`This will configure ${PACKAGE_NAME} in your Claude Code MCP config.\n\n`);

    const home = os.homedir();
    const mcpPath = path.join(home, '.mcp.json');
    const existing = await readJsonIfExists(mcpPath);

    if (existing?.mcpServers && 'yocoolab' in existing.mcpServers) {
      const overwrite = await ask(
        `An existing "yocoolab" server is already configured in ${mcpPath}. Overwrite? (y/N)`,
        'N',
      );
      if (!/^y(es)?$/i.test(overwrite)) {
        output.write('\nLeaving existing config in place. Nothing changed.\n');
        return;
      }
    }

    let token = '';
    while (!token) {
      token = await ask('Yocoolab JWT (from the Chrome extension settings)');
      if (!token) {
        output.write('  A token is required.\n');
        continue;
      }
      if (!looksLikeJwt(token)) {
        const proceed = await ask(
          "  That doesn't look like a JWT (expected three dot-separated segments). Use it anyway? (y/N)",
          'N',
        );
        if (!/^y(es)?$/i.test(proceed)) token = '';
      }
    }

    const apiUrl = await ask('Yocoolab API URL', DEFAULT_API_URL);
    const githubToken = await ask('GitHub token for PR tools (optional, press Enter to skip)', '');
    const workspace = await ask('Workspace path (used to resolve file references)', process.cwd());
    const bridgePort = await ask('Local bridge port', DEFAULT_BRIDGE_PORT);

    const env: Record<string, string> = {
      YOCOOLAB_API_URL: apiUrl,
      YOCOOLAB_TOKEN: token,
      YOCOOLAB_BRIDGE_PORT: bridgePort,
      YOCOOLAB_BRIDGE_WORKSPACE: workspace,
    };
    if (githubToken) env.GITHUB_TOKEN = githubToken;

    const serverConfig: YocoolabServerConfig = {
      command: 'npx',
      args: ['-y', `${PACKAGE_NAME}@1`],
      env,
    };

    const merged: McpConfig = existing ?? {};
    merged.mcpServers = { ...(merged.mcpServers ?? {}), yocoolab: serverConfig };

    await fs.writeFile(mcpPath, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
    output.write(`\n✓ Wrote ${mcpPath}\n`);

    const cwd = process.cwd();
    if (cwd !== home) {
      const added = await ensureGitignoreEntry(cwd, '.mcp.json');
      if (added) output.write(`✓ Added .mcp.json to ${path.join(cwd, '.gitignore')}\n`);
    }

    output.write('\nNext: restart Claude Code. The "yocoolab" server should appear in your tools list.\n');
    output.write('To verify, ask Claude to run list_open_threads.\n\n');
  } finally {
    rl.close();
  }
}
