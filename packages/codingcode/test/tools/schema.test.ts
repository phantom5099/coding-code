import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const toJson = (s: z.ZodTypeAny) => z.toJSONSchema(s) as Record<string, unknown>;

describe('z.toJSONSchema (Zod built-in)', () => {
  it('should convert a simple object with string property', () => {
    const result = toJson(z.object({ name: z.string() }));
    expect(result.type).toBe('object');
    expect((result.properties as any).name.type).toBe('string');
    expect(result.required).toContain('name');
  });

  it('should handle optional properties', () => {
    const result = toJson(z.object({
      required: z.string(),
      optional: z.string().optional(),
    }));
    expect(result.required).toContain('required');
    expect(result.required).not.toContain('optional');
  });

  it('should preserve default values in schema', () => {
    const result = toJson(z.object({ path: z.string().default('.') }));
    expect((result.properties as any).path.default).toBe('.');
  });

  it('should handle number constraints', () => {
    const result = toJson(z.object({ count: z.number().int().min(1).max(100) }));
    const prop = (result.properties as any).count;
    expect(prop.type).toBe('integer');
    expect(prop.minimum).toBe(1);
    expect(prop.maximum).toBe(100);
  });

  it('should include parameter descriptions', () => {
    const result = toJson(z.object({ path: z.string().describe('The file path') }));
    expect((result.properties as any).path.description).toBe('The file path');
  });

  it('should handle url validator', () => {
    const result = toJson(z.object({ url: z.string().url() }));
    expect((result.properties as any).url.format).toBe('uri');
  });
});
