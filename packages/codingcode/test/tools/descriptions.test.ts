import { describe, it, expect } from 'vitest';
import { readFileTool } from '../../src/tools/domains/fs/read.js';
import { writeFileTool } from '../../src/tools/domains/fs/write.js';
import { bashTool } from '../../src/tools/domains/bash/exec.js';
import { searchTool } from '../../src/tools/domains/fs/grep.js';
import { webFetchTool } from '../../src/tools/domains/web/fetch.js';
import { z } from 'zod';
import type { ToolDefinition } from '../../src/tools/types.js';

const allTools: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  bashTool,
  searchTool,
  webFetchTool,
];

describe('tool descriptions', () => {
  it('should not mention tool name in description', () => {
    for (const tool of allTools) {
      expect(tool.description).not.toMatch(
        /tool name is/i,
      );
      expect(tool.description).not.toContain(tool.name);
    }
  });

  it('should not inline parameter docs in description', () => {
    for (const tool of allTools) {
      // Description should describe behavior, not list params
      expect(tool.description).not.toMatch(
        /parameters?\s*:/i,
      );
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

describe('tool jsonSchema override', () => {
  it('should not have hand-written jsonSchema on built-in tools', () => {
    for (const tool of allTools) {
      expect(tool.jsonSchema).toBeUndefined();
    }
  });
});
