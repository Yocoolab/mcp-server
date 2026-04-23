import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const HOOK_SCRIPT = path.resolve(__dirname, '../hooks/send-event.sh');
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'Notification',
];

export function ensureHooksInstalled(): void {
  try {
    // Make hook script executable
    if (fs.existsSync(HOOK_SCRIPT)) {
      try {
        execFileSync('chmod', ['+x', HOOK_SCRIPT]);
      } catch {
        // May already be executable or on Windows
      }
    } else {
      process.stderr.write(`[yocoolab] Warning: Hook script not found at ${HOOK_SCRIPT}\n`);
      return;
    }

    // Read or create settings
    const settingsDir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }

    let settings: Record<string, unknown> = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }

    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {};
    }
    const hooks = settings.hooks as Record<string, unknown[]>;

    let modified = false;

    for (const event of HOOK_EVENTS) {
      if (!hooks[event]) {
        hooks[event] = [];
      }

      const groups = hooks[event] as Array<{ hooks?: Array<{ command?: string }> }>;

      const alreadyInstalled = groups.some((group) =>
        group.hooks?.some((h) => h.command === HOOK_SCRIPT)
      );

      if (!alreadyInstalled) {
        groups.push({
          hooks: [{ type: 'command', command: HOOK_SCRIPT, timeout: 5 } as Record<string, unknown>],
        } as unknown as { hooks: Array<{ command: string }> });
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
      process.stderr.write(`[yocoolab] Installed activity monitor hooks in ${SETTINGS_FILE}\n`);
    } else {
      process.stderr.write(`[yocoolab] Activity monitor hooks already installed\n`);
    }
  } catch (err) {
    process.stderr.write(`[yocoolab] Warning: Could not install hooks: ${err}\n`);
    // Never block MCP startup
  }
}
