import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMcpConfig, writeConfig } from '../../commands/setup.js';

// The setup command writes the version pin every agent then runs with
// (`npx -y @yocoolab/mcp-server@<major>`). A hardcoded "@2" on the 3.x line
// sent every install — and every `npx …@3 setup` — back to 2.5.0.
const pkg = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { name: string; version: string };
const MAJOR = pkg.version.split('.')[0];

describe('setup pins the package\'s own major', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('buildMcpConfig runs `npx -y <this package>@<its major>`', () => {
    const config = buildMcpConfig('Claude Code', 'claude-code') as { command: string; args: string[] };
    expect(config.command).toBe('npx');
    expect(config.args).toEqual(['-y', `${pkg.name}@${MAJOR}`]);
  });

  it('writeConfig writes that pin, and keeps the other servers in the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-setup-'));
    dirs.push(dir);
    const file = path.join(dir, '.mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'other-mcp' }, yocoolab: { command: 'npx', args: ['-y', '@yocoolab/mcp-server@2'] } } }));

    writeConfig(file, 'Claude Code', 'claude-code', { yocoolabToken: 'test-token' });

    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(written.mcpServers.yocoolab.args).toEqual(['-y', `${pkg.name}@${MAJOR}`]);
    expect(written.mcpServers.yocoolab.env.YOCOOLAB_TOKEN).toBe('test-token');
    expect(written.mcpServers.other).toEqual({ command: 'other-mcp' });
  });
});
