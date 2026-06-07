import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { render } from 'ink-testing-library';
import { MarkdownText } from '../../src/components/MarkdownText.js';

vi.mock('cli-highlight', () => ({
  highlight: (code: string) => code,
}));

const mk = (content: string, width: number = 80) => createElement(MarkdownText, { content, width });

describe('MarkdownText', () => {
  it('renders plain text', () => {
    const { lastFrame } = render(mk('hello world'));
    expect(lastFrame()).toContain('hello world');
  });

  it('renders heading with prefix', () => {
    const { lastFrame } = render(mk('# Title'));
    expect(lastFrame()).toContain('# Title');
  });

  it('renders inline code', () => {
    const { lastFrame } = render(mk('use `npm install`'));
    expect(lastFrame()).toContain('npm install');
  });

  it('renders code block', () => {
    const { lastFrame } = render(mk('```js\nconsole.log(\'hi\')\n```'));
    expect(lastFrame()).toContain("console.log('hi')");
    expect(lastFrame()).toContain('js');
  });

  it('renders unordered list', () => {
    const { lastFrame } = render(mk('- item1\n- item2'));
    expect(lastFrame()).toContain('item1');
    expect(lastFrame()).toContain('item2');
  });

  it('renders blockquote', () => {
    const { lastFrame } = render(mk('> quoted'));
    expect(lastFrame()).toContain('quoted');
  });

  it('renders hr separator', () => {
    const { lastFrame } = render(mk('above\n\n---\n\nbelow'));
    expect(lastFrame()).toContain('─');
  });

  it('renders bold text', () => {
    const { lastFrame } = render(mk('**bold**'));
    expect(lastFrame()).toContain('bold');
  });

  it('renders link with URL', () => {
    const { lastFrame } = render(mk('[click](https://example.com)'));
    expect(lastFrame()).toContain('click');
    expect(lastFrame()).toContain('https://example.com');
  });

  it('handles empty content', () => {
    const { lastFrame } = render(mk(''));
    expect(lastFrame()).toBe('');
  });
});
