import { describe, it, expect } from 'vitest';
import { createRuleEngine } from '../../src/approval/rule-engine.js';
import {
  DEFAULT_DENY_RULES,
  READONLY_TOOL_NAMES,
  DESTRUCTIVE_TOOL_NAMES,
} from '../../src/approval/presets.js';

describe('Presets', () => {
  it('should have system-source rules', () => {
    expect(DEFAULT_DENY_RULES.length).toBeGreaterThan(0);
    for (const rule of DEFAULT_DENY_RULES) {
      expect(rule.source).toBe('system');
    }
  });

  it('should deny rm -rf /', () => {
    const engine = createRuleEngine(DEFAULT_DENY_RULES);
    const result = engine.evaluate('*', { command: 'rm -rf /var/log' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('deny');
  });

  it('should deny sudo commands', () => {
    const engine = createRuleEngine(DEFAULT_DENY_RULES);
    const result = engine.evaluate('*', { command: 'sudo apt install' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('deny');
  });

  it('should ask for SSH key reads', () => {
    const engine = createRuleEngine(DEFAULT_DENY_RULES);
    const result = engine.evaluate('read_file', { path: '/home/user/.ssh/id_rsa' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('ask');
  });

  it('should ask for .env file reads', () => {
    const engine = createRuleEngine(DEFAULT_DENY_RULES);
    const result = engine.evaluate('read_file', { path: '/project/.env.production' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('ask');
  });

  it('should define read-only tools', () => {
    expect(READONLY_TOOL_NAMES).toContain('read_file');
    expect(READONLY_TOOL_NAMES).toContain('search_code');
    expect(READONLY_TOOL_NAMES).toContain('search_files');
    expect(READONLY_TOOL_NAMES).toContain('fetch_url');
    expect(READONLY_TOOL_NAMES).toContain('web_search');
    expect(READONLY_TOOL_NAMES).toContain('tool_search');
    expect(READONLY_TOOL_NAMES).toContain('todo_write');
  });

  it('should define destructive tools', () => {
    expect(DESTRUCTIVE_TOOL_NAMES).toContain('execute_command');
    expect(DESTRUCTIVE_TOOL_NAMES).not.toContain('Bash');
  });
});
