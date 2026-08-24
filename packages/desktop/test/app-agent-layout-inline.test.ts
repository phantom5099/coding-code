import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const srcRoot = resolve(__dirname, '..', 'src');
const appSource = readFileSync(resolve(srcRoot, 'App.tsx'), 'utf8');

describe('App agent layout', () => {
  it('owns the agent view routing after removing AgentLayout', () => {
    expect(existsSync(resolve(srcRoot, 'layouts', 'AgentLayout.tsx'))).toBe(false);
    expect(appSource).not.toContain('AgentLayout');
    expect(appSource).toContain('useAgentCore()');
    expect(appSource).toContain('<ProjectStrip />');
    expect(appSource).toContain('<AgentSidebar />');
    expect(appSource).toContain('<AgentWorkspace sendMessage={sendMessage} abort={abort} />');
  });
});
