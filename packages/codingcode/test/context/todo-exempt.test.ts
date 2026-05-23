import { describe, it, expect } from 'vitest';
import { getContextConfig } from '../../src/context/config.js';

describe('Todo/ToolSearch tools exempt from prune', () => {
  it('toolsExemptFromPrune includes todo_write', () => {
    expect(getContextConfig().toolsExemptFromPrune).toContain('todo_write');
  });

  it('toolsExemptFromPrune includes todo_read', () => {
    expect(getContextConfig().toolsExemptFromPrune).toContain('todo_read');
  });

  it('toolsExemptFromPrune includes tool_search', () => {
    expect(getContextConfig().toolsExemptFromPrune).toContain('tool_search');
  });

  it('toolsExemptFromPrune still includes Read', () => {
    expect(getContextConfig().toolsExemptFromPrune).toContain('Read');
  });
});
