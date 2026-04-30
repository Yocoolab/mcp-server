import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';

interface AgentConfig {
  name: string;
  type: string;
  configPath: string;
  detected: boolean;
  global: boolean;
}

const HOME = os.homedir();
const CWD = process.cwd();

function detectAgents(): AgentConfig[] {
  const agents: AgentConfig[] = [
    {
      name: 'Claude Code',
      type: 'claude-code',
      configPath: path.join(CWD, '.mcp.json'),
      detected: fs.existsSync(path.join(HOME, '.claude')) || !!process.env.CLAUDE_AGENT_ID,
      global: false,
    },
    {
      name: 'Roo Code',
      type: 'roo',
      configPath: path.join(CWD, '.roo', 'mcp.json'),
      detected: fs.existsSync(path.join(HOME, '.roo')) || checkVSCodeExtension('rooveterinaryinc.roo-cline'),
      global: false,
    },
    {
      name: 'Cline',
      type: 'cline',
      configPath: getClineConfigPath(),
      detected: checkVSCodeExtension('saoudrizwan.claude-dev'),
      global: true,
    },
    {
      name: 'Cursor',
      type: 'cursor',
      configPath: path.join(CWD, '.cursor', 'mcp.json'),
      detected: fs.existsSync(path.join(HOME, '.cursor')) || checkProcess('Cursor'),
      global: false,
    },
    {
      name: 'Windsurf',
      type: 'windsurf',
      configPath: getWindsurfConfigPath(),
      detected: fs.existsSync(path.join(HOME, '.codeium')) || checkProcess('Windsurf'),
      global: true,
    },
  ];

  return agents;
}

function getClineConfigPath(): string {
  if (process.platform === 'darwin') {
    return path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  } else if (process.platform === 'win32') {
    return path.join(HOME, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  }
  return path.join(HOME, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
}

function getWindsurfConfigPath(): string {
  return path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json');
}

function checkVSCodeExtension(extensionId: string): boolean {
  const extensionsDir = process.platform === 'darwin'
    ? path.join(HOME, '.vscode', 'extensions')
    : process.platform === 'win32'
    ? path.join(HOME, '.vscode', 'extensions')
    : path.join(HOME, '.vscode', 'extensions');

  if (!fs.existsSync(extensionsDir)) return false;
  try {
    const dirs = fs.readdirSync(extensionsDir);
    return dirs.some(d => d.startsWith(extensionId));
  } catch {
    return false;
  }
}

function checkProcess(name: string): boolean {
  try {
    const { execSync } = require('node:child_process');
    const result = execSync(`pgrep -f "${name}" 2>/dev/null || true`, { encoding: 'utf-8' });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

interface SetupTokens {
  yocoolabToken?: string;
  githubToken?: string;
}

function buildMcpConfig(
  agentName: string,
  agentType: string,
  tokens: SetupTokens = {}
): Record<string, unknown> {
  return {
    command: 'npx',
    args: ['-y', '@yocoolab/mcp-server@2'],
    env: {
      YOCOOLAB_API_URL: 'https://app.yocoolab.com',
      YOCOOLAB_TOKEN: tokens.yocoolabToken || '<your token — get from Chrome extension settings>',
      GITHUB_TOKEN: tokens.githubToken || '<your GitHub PAT — for PR creation>',
      YOCOOLAB_BRIDGE_PORT: '9800',
      YOCOOLAB_BRIDGE_WORKSPACE: CWD,
      YOCOOLAB_AGENT_NAME: agentName,
      YOCOOLAB_AGENT_TYPE: agentType,
    },
  };
}

/** Parse --token=VAL / --github-token=VAL CLI flags from process.argv. */
function parseTokenFlags(argv: readonly string[]): SetupTokens {
  const tokens: SetupTokens = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--token' && argv[i + 1]) {
      tokens.yocoolabToken = argv[i + 1];
      i++;
    } else if (arg.startsWith('--token=')) {
      tokens.yocoolabToken = arg.slice('--token='.length);
    } else if (arg === '--github-token' && argv[i + 1]) {
      tokens.githubToken = argv[i + 1];
      i++;
    } else if (arg.startsWith('--github-token=')) {
      tokens.githubToken = arg.slice('--github-token='.length);
    }
  }
  return tokens;
}

function writeConfig(
  configPath: string,
  agentName: string,
  agentType: string,
  tokens: SetupTokens = {}
): boolean {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Merge with existing config
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // If we can't parse it, start fresh
    }
  }

  const servers = (existing.mcpServers || {}) as Record<string, unknown>;
  servers.yocoolab = buildMcpConfig(agentName, agentType, tokens);
  existing.mcpServers = servers;

  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
  return true;
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runSetup(): Promise<void> {
  const tokens = parseTokenFlags(process.argv.slice(2));

  console.log('\n  🔮 Yocoolab MCP Setup\n');
  if (tokens.yocoolabToken) {
    console.log('  Using token from --token flag (no manual paste needed).\n');
  }
  console.log('  Detecting AI coding agents...\n');

  const agents = detectAgents();
  const detected = agents.filter(a => a.detected);
  const notDetected = agents.filter(a => !a.detected);

  // Show detected agents
  if (detected.length > 0) {
    console.log('  ✅ Detected:');
    detected.forEach(a => {
      console.log(`     • ${a.name}`);
    });
    console.log('');
  }

  if (notDetected.length > 0) {
    console.log('  ○  Not detected:');
    notDetected.forEach(a => {
      console.log(`     • ${a.name}`);
    });
    console.log('');
  }

  // If nothing detected, ask which to configure
  const toConfigure = detected.length > 0 ? detected : agents;

  if (detected.length === 0) {
    console.log('  No agents auto-detected. Which would you like to configure?\n');
    agents.forEach((a, i) => {
      console.log(`    ${i + 1}. ${a.name}`);
    });
    console.log(`    a. All of them`);
    console.log('');

    const answer = await prompt('  Enter number(s) separated by commas, or "a" for all: ');

    if (answer.toLowerCase() === 'a') {
      toConfigure.length = 0;
      toConfigure.push(...agents);
    } else {
      const indices = answer.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < agents.length);
      if (indices.length === 0) {
        console.log('\n  No valid selection. Exiting.\n');
        return;
      }
      toConfigure.length = 0;
      indices.forEach(i => toConfigure.push(agents[i]));
    }
  }

  // Configure each detected agent
  console.log('  Writing configs...\n');

  for (const agent of toConfigure) {
    try {
      writeConfig(agent.configPath, agent.name, agent.type, tokens);
      const relativePath = path.relative(CWD, agent.configPath);
      const displayPath = relativePath.startsWith('.') || !relativePath.startsWith('/') ? relativePath : agent.configPath;
      console.log(`  ✅ ${agent.name} → ${displayPath}`);
    } catch (err) {
      console.log(`  ❌ ${agent.name} — failed: ${err}`);
    }
  }

  console.log('\n  Next steps:');
  let stepNumber = 1;
  if (!tokens.yocoolabToken) {
    console.log(`  ${stepNumber}. Replace <your token> with your Yocoolab JWT`);
    console.log('     (find it in Chrome extension → Settings → API Token)');
    stepNumber++;
  }
  if (!tokens.githubToken) {
    console.log(`  ${stepNumber}. (Optional) Replace <your GitHub PAT> with a GitHub personal access token`);
    console.log('     (needs repo write permissions for PR-creation tools)');
    stepNumber++;
  }
  console.log(`  ${stepNumber}. Restart your agent — Yocoolab tools load automatically`);
  console.log('\n  Docs: https://yocoolab.com/docs/ai-agents\n');
}
