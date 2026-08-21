import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { z } from 'zod';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ToolDefinition } from '../../src/tools/types.js';

const readTool: ToolDefinition = {
  name: 'read',
  description: 'Reads a value.',
  parameters: z.object({ path: z.string() }),
  execute: () => Effect.succeed('read'),
};

const writeTool: ToolDefinition = {
  name: 'write',
  description: 'Writes a value.',
  parameters: z.object({ path: z.string(), content: z.string() }),
  execute: () => Effect.succeed('write'),
};

describe('ToolRegistry', () => {
  it('registers tools once and exposes filtered descriptions and lookups', () => {
    const registry = new ToolRegistry();
    registry.register(readTool, writeTool);

    const allowed = new Set(['read']);
    expect(registry.describe(allowed)).toMatchObject([
      {
        name: 'read',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
    expect(registry.get('read', allowed)).toBe(readTool);
    expect(registry.get('write', allowed)).toBeUndefined();
  });

  it('rejects duplicate tool names', () => {
    const registry = new ToolRegistry();
    registry.register(readTool);

    expect(() => registry.register(readTool)).toThrow('Tool already registered: read');
  });
});
