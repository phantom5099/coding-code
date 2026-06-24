import { describe, it, expect } from 'vitest';
import { slug } from '../../src/tools/domains/subagent/submit-plan.js';

describe('slug()', () => {
  it('lowercases and joins with dashes', () => {
    expect(slug('Add telemetry')).toBe('add-telemetry');
  });

  it('lowercases all-caps', () => {
    expect(slug('FOO')).toBe('foo');
  });

  it('collapses runs of non-alphanumeric characters into a single dash', () => {
    expect(slug('Foo!!@#Bar')).toBe('foo-bar');
  });

  it('trims leading and trailing whitespace and dashes', () => {
    expect(slug('  Foo  ')).toBe('foo');
    expect(slug('---foo---')).toBe('foo');
  });

  it('handles multi-word titles with spaces as separators', () => {
    expect(slug('Foo Bar Baz')).toBe('foo-bar-baz');
  });

  it('strips diacritics', () => {
    expect(slug('Café déjà vu')).toBe('cafe-deja-vu');
  });

  it('preserves CJK characters in the slug', () => {
    expect(slug('写一篇《如果AI有了工资》幽默短文')).toBe('写一篇-如果ai有了工资-幽默短文');
  });

  it('preserves mixed CJK + ASCII', () => {
    expect(slug('添加 OAuth support')).toBe('添加-oauth-support');
  });

  it('preserves hiragana and katakana', () => {
    expect(slug('こんにちは')).toBe('こんにちは');
    expect(slug('カタカナ')).toBe('カタカナ');
  });

  it('preserves digits', () => {
    expect(slug('OAuth 2.0 support')).toBe('oauth-2-0-support');
  });

  it('is deterministic for the same input', () => {
    expect(slug('Same Title')).toBe(slug('Same Title'));
  });

  it('truncates to 80 characters', () => {
    const long = 'a'.repeat(200);
    expect(slug(long).length).toBe(80);
  });

  it('falls back to "plan" only when input is purely whitespace/punctuation', () => {
    expect(slug('!!!')).toBe('plan');
    expect(slug('   ')).toBe('plan');
  });
});
