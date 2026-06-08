import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { canonicalizeSchema } from '../../src/tools/utils/canonicalize-schema.js';

function sha256(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v)).digest('hex');
}

describe('canonicalizeSchema', () => {
  it('sorts top-level object keys alphabetically', () => {
    const result = canonicalizeSchema({ b: 1, a: 2, c: 3 }) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
  });

  it('recursively sorts nested object keys', () => {
    const result = canonicalizeSchema({
      b: { d: 1, c: 2 },
      a: { z: 1, y: 2 },
    }) as Record<string, any>;
    expect(Object.keys(result)).toEqual(['a', 'b']);
    expect(Object.keys(result.b)).toEqual(['c', 'd']);
    expect(Object.keys(result.a)).toEqual(['y', 'z']);
  });

  it('preserves array element order', () => {
    const result = canonicalizeSchema([3, 1, 2]) as unknown[];
    expect(result).toEqual([3, 1, 2]);
  });

  it('recursively canonicalizes array elements', () => {
    const result = canonicalizeSchema([
      { b: 1, a: 2 },
      { d: 4, c: 3 },
    ]) as any[];
    expect(Object.keys(result[0])).toEqual(['a', 'b']);
    expect(Object.keys(result[1])).toEqual(['c', 'd']);
  });

  it('passes primitives through unchanged', () => {
    expect(canonicalizeSchema(42)).toBe(42);
    expect(canonicalizeSchema('hello')).toBe('hello');
    expect(canonicalizeSchema(null)).toBe(null);
    expect(canonicalizeSchema(true)).toBe(true);
  });

  it('handles null without treating it as object', () => {
    const result = canonicalizeSchema({ a: null, b: { c: null } }) as Record<string, any>;
    expect(Object.keys(result)).toEqual(['a', 'b']);
    expect(result.a).toBe(null);
    expect(result.b.c).toBe(null);
  });

  it('produces identical output for zod schemas with same shape but different declaration order', () => {
    const schemaA = z.object({ path: z.string(), limit: z.number().optional() });
    const schemaB = z.object({ limit: z.number().optional(), path: z.string() });

    const canonicalA = canonicalizeSchema(z.toJSONSchema(schemaA));
    const canonicalB = canonicalizeSchema(z.toJSONSchema(schemaB));

    expect(sha256(canonicalA)).toBe(sha256(canonicalB));
  });

  it('produces identical output for nested zod schemas with reordered fields', () => {
    const schemaA = z.object({
      name: z.string(),
      meta: z.object({ version: z.string(), author: z.string() }),
    });
    const schemaB = z.object({
      meta: z.object({ author: z.string(), version: z.string() }),
      name: z.string(),
    });

    const canonicalA = canonicalizeSchema(z.toJSONSchema(schemaA));
    const canonicalB = canonicalizeSchema(z.toJSONSchema(schemaB));

    expect(sha256(canonicalA)).toBe(sha256(canonicalB));
  });

  it('is deterministic across multiple invocations', () => {
    const input = { z: 1, a: { y: 2, b: 3 }, m: [1, { d: 4, c: 5 }] };
    const hashes = Array.from({ length: 5 }, () => sha256(canonicalizeSchema(input)));
    expect(new Set(hashes).size).toBe(1);
  });
});
