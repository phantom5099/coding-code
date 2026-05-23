import { expect, it, describe, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { loadAgentProfiles } from '../../src/subagent/loader';

describe('loadAgentProfiles', () => {
  const testDir = join(process.cwd(), '.test-agents');

  beforeEach(() => {
    mkdirSync(join(testDir, '.codingcode', 'agents'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return empty array when agents directory does not exist', () => {
    const result = loadAgentProfiles(join(process.cwd(), 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('should load basic profile from markdown file', () => {
    const profile = `---
name: basic-agent
description: A basic agent for testing
---
You are a basic test agent.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'basic.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('basic-agent');
    expect(results[0].description).toBe('A basic agent for testing');
    expect(results[0].systemPrompt).toBe('You are a basic test agent.');
  });

  it('should parse readonly and maxSteps fields', () => {
    const profile = `---
name: advanced-agent
description: Advanced agent
readonly: true
maxSteps: 50
---
Advanced system prompt.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'advanced.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].readonly).toBe(true);
    expect(results[0].maxSteps).toBe(50);
  });

  it('should parse tools array', () => {
    const profile = `---
name: tool-agent
description: Agent with tools
tools: [read_file, write_file, bash]
---
System prompt.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'tools.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].tools).toEqual(['read_file', 'write_file', 'bash']);
  });

  it('should skip files without name or description', () => {
    const profile = `---
description: Missing name
---
Incomplete profile.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'incomplete.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(0);
  });

  it('should load multiple profiles from different files', () => {
    const profile1 = `---
name: agent1
description: First agent
---
System 1`;

    const profile2 = `---
name: agent2
description: Second agent
---
System 2`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'agent1.md'), profile1);
    writeFileSync(join(testDir, '.codingcode', 'agents', 'agent2.md'), profile2);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.name)).toEqual(expect.arrayContaining(['agent1', 'agent2']));
  });

  it('should handle profiles without frontmatter', () => {
    const profile = `Just a plain text file without frontmatter.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'plain.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(0);
  });

  it('should handle multiline system prompts', () => {
    const profile = `---
name: multiline-agent
description: Agent with multiline prompt
---
You are a specialized agent.

Your responsibilities:
- Task 1
- Task 2
- Task 3

Always follow these rules.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'multiline.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].systemPrompt).toContain('- Task 1');
    expect(results[0].systemPrompt).toContain('Always follow these rules.');
  });

  it('should ignore non-.md files', () => {
    const profile = `---
name: should-ignore
description: This should be ignored
---
Content.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'ignore.txt'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(0);
  });

  it('should parse false value for readonly', () => {
    const profile = `---
name: writable-agent
description: Agent that can write
readonly: false
---
System prompt.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'writable.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].readonly).toBe(false);
  });
});
