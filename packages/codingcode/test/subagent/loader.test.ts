import { expect, it, describe, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  loadAgentProfiles,
  writeAgentProfile,
  updateAgentProfile,
  deleteAgentProfile,
} from '../../src/subagent/loader';

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

  it('should parse mcpServers array', () => {
    const profile = `---
name: mcp-agent
description: Agent with MCP servers
mcpServers: [postgres, redis]
---
System prompt.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'mcp.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].mcpServers).toEqual(['postgres', 'redis']);
  });

  it('should leave mcpServers undefined when not specified', () => {
    const profile = `---
name: no-mcp-agent
description: Agent without MCP
---
System prompt.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'no-mcp.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].mcpServers).toBeUndefined();
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
    expect(results.map((r) => r.name)).toEqual(expect.arrayContaining(['agent1', 'agent2']));
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

  it('should parse model field from frontmatter', () => {
    const profile = `---
name: model-agent
description: Agent with specific model
model: gpt-4o@openai
---
System prompt.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'model.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].model).toBe('gpt-4o@openai');
  });

  it('should leave model undefined when not specified in frontmatter', () => {
    const profile = `---
name: no-model-agent
description: Agent without model
---
System prompt.`;

    writeFileSync(join(testDir, '.codingcode', 'agents', 'no-model.md'), profile);

    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].model).toBeUndefined();
  });
});

describe('writeAgentProfile', () => {
  const testDir = join(process.cwd(), '.test-agents-write');

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should write and read back a profile', () => {
    writeAgentProfile(testDir, {
      name: 'test-agent',
      description: 'Agent for testing',
      systemPrompt: 'You are a test agent.',
    });
    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('test-agent');
    expect(results[0].description).toBe('Agent for testing');
    expect(results[0].systemPrompt).toBe('You are a test agent.');
  });

  it('should write profile with all optional fields', () => {
    writeAgentProfile(testDir, {
      name: 'full-agent',
      description: 'Full agent',
      systemPrompt: 'You are full.',
      tools: ['read_file', 'glob'],
      mcpServers: ['postgres', 'redis'],
      readonly: true,
      maxSteps: 50,
      model: 'sonnet',
    });
    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].tools).toEqual(['read_file', 'glob']);
    expect(results[0].mcpServers).toEqual(['postgres', 'redis']);
    expect(results[0].readonly).toBe(true);
    expect(results[0].maxSteps).toBe(50);
    expect(results[0].model).toBe('sonnet');
  });

  it('should overwrite existing profile with same name', () => {
    writeAgentProfile(testDir, {
      name: 'dup-agent',
      description: 'Original',
      systemPrompt: 'Original.',
    });
    writeAgentProfile(testDir, {
      name: 'dup-agent',
      description: 'Updated',
      systemPrompt: 'Updated.',
    });
    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe('Updated');
  });
});

describe('updateAgentProfile', () => {
  const testDir = join(process.cwd(), '.test-agents-update');

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should rename a profile', () => {
    writeAgentProfile(testDir, {
      name: 'old-name',
      description: 'Test',
      systemPrompt: 'Test.',
    });
    updateAgentProfile(testDir, 'old-name', {
      name: 'new-name',
      description: 'Test',
      systemPrompt: 'Test.',
    });
    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('new-name');
  });
});

describe('deleteAgentProfile', () => {
  const testDir = join(process.cwd(), '.test-agents-delete');

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should delete a profile by name', () => {
    writeAgentProfile(testDir, {
      name: 'to-delete',
      description: 'Will be deleted',
      systemPrompt: 'Bye.',
    });
    writeAgentProfile(testDir, {
      name: 'keep',
      description: 'Stays',
      systemPrompt: 'Hi.',
    });
    deleteAgentProfile(testDir, 'to-delete');
    const results = loadAgentProfiles(testDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('keep');
  });
});
