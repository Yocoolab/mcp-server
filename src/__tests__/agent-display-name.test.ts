import { describe, it, expect, vi, afterEach } from 'vitest';
import { agentDisplayName } from '../api-client.js';

afterEach(() => vi.unstubAllEnvs());

describe('agentDisplayName', () => {
  it('falls back to "Claude Code" when YOCOOLAB_AGENT_NAME is unset/empty', () => {
    vi.stubEnv('YOCOOLAB_AGENT_NAME', '');
    expect(agentDisplayName()).toBe('Claude Code');
  });

  it('signs with the configured agent name', () => {
    vi.stubEnv('YOCOOLAB_AGENT_NAME', 'Hermes Agent');
    expect(agentDisplayName()).toBe('Hermes Agent');
  });

  it('trims whitespace-only names to the fallback', () => {
    vi.stubEnv('YOCOOLAB_AGENT_NAME', '   ');
    expect(agentDisplayName()).toBe('Claude Code');
  });
});
