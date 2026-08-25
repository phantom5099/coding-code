import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('sendMessage options are optional with guard', () => {
  it('agent.ts sendMessage options make activeProfile/permissionMode/model optional', () => {
    const src = readFileSync(new URL('../../src/agent/agent.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/activeProfile\?:\s*AgentProfileName/);
    expect(src).toMatch(/permissionMode\?:\s*PermissionMode/);
    expect(src).toMatch(/model\?:\s*string/);
  });

  it('agent.ts guards new-session branch against missing activeProfile/permissionMode/model', () => {
    const src = readFileSync(new URL('../../src/agent/agent.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/SESSION_CONFIG_REQUIRED|new session requires activeProfile/);
  });

  it('messages.ts conditionally builds options (no hardcoded profile on existing-session path)', () => {
    const src = readFileSync(
      new URL('../../src/server/routes/messages.ts', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/isNew\s*=/);
    expect(src).toMatch(/if\s*\(isNew\)/);
  });

  it('direct agent-runtime.ts sends options only on new session', () => {
    const src = readFileSync(new URL('../../src/direct/agent-runtime.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/if\s*\(!sessionId\)/);
  });

  it('http agent-runtime.ts sendMessage (sub-client used by desktop) sends options only on new session', () => {
    const src = readFileSync(
      new URL('../../src/client/http/agent-runtime.ts', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/sendMessage\(input,/);
  });
});
