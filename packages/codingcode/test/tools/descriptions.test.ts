import { describe, it, expect } from 'vitest';
import { readFileTool, writeFileTool, searchTool } from '@codingcode/fs';
import { bashTool } from '@codingcode/bash';
import { webFetchTool } from '@codingcode/web';
import { z } from 'zod';
import type { ToolDefinition } from '@codingcode/tool';

const allTools: ToolDefinition<any, any>[] = [
  readFileTool,
  writeFileTool,
  bashTool,
  searchTool,
  webFetchTool,
];

describe('tool descriptions', () => {
  it('should not mention tool name in description', () => {
    for (const tool of allTools) {
      expect(tool.description).not.toMatch(/tool name is/i);
      expect(tool.description).not.toContain(tool.name);
    }
  });

  it('should not inline parameter docs in description', () => {
    for (const tool of allTools) {
      // Description should describe behavior, not list params
      expect(tool.description).not.toMatch(/parameters?\s*:/i);
    }
  });

  it('should have a non-empty description', () => {
    for (const tool of allTools) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});

describe('tool JSON Schema auto-generation', () => {
  for (const tool of allTools) {
    it(`${tool.name} should generate valid JSON Schema from parameters`, () => {
      const js = z.toJSONSchema(tool.parameters) as Record<string, unknown>;
      expect(js.type).toBe('object');
      expect(js.properties).toBeDefined();
      expect(typeof js.properties).toBe('object');
    });
  }
});

describe('tool parameter schemas', () => {
  it('should expose parameters through generated JSON Schema', () => {
    for (const tool of allTools) {
      const schema = z.toJSONSchema(tool.parameters) as Record<string, unknown>;
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    }
  });
});
