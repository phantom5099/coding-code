import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { TodoService } from '../../src/todo/port.js';
import { registerBuiltinTools } from '../../src/tools/builtin-tools.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { TodoLayer } from '../../src/todo/todo.js';

describe('registerBuiltinTools', () => {
  it('registers stateless tools and the TodoService-backed todo tool', async () => {
    const registry = new ToolRegistry();
    await Effect.runPromise(
      registerBuiltinTools(registry).pipe(Effect.provide(TodoLayer))
    );

    expect(registry.describe().map((tool) => tool.name)).toEqual([
      'read_file',
      'write_file',
      'edit_file',
      'execute_command',
      'search_code',
      'search_files',
      'fetch_url',
      'web_search',
      'todo_write',
    ]);
  });
});
