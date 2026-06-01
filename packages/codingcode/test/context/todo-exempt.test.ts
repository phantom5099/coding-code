import { describe, it, expect } from 'vitest';
import { getContextConfig } from '../../src/context/config.js';

describe('Todo/ToolSearch tools exempt from microcompact', () => {
  it('toolsExemptFromMicrocompact includes todo_write', () => {
    expect(getContextConfig().toolsExemptFromMicrocompact).toContain('todo_write');
  });

  it('toolsExemptFromMicrocompact includes todo_read', () => {
    expect(getContextConfig().toolsExemptFromMicrocompact).toContain('todo_read');
  });

  it('toolsExemptFromMicrocompact includes tool_search', () => {
    expect(getContextConfig().toolsExemptFromMicrocompact).toContain('tool_search');
  });

  it('toolsExemptFromMicrocompact still includes Read', () => {
    expect(getContextConfig().toolsExemptFromMicrocompact).toContain('Read');
  });
});
