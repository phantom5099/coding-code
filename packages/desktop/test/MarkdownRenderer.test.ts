import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownRenderer from '../src/shared/MarkdownRenderer';

vi.mock('prismjs', () => ({
  default: {
    languages: { javascript: {}, typescript: {}, python: {}, bash: {}, json: {}, text: {} },
    highlightElement: vi.fn(),
  },
}));

vi.mock('prismjs/components/prism-typescript', () => ({}));
vi.mock('prismjs/components/prism-javascript', () => ({}));
vi.mock('prismjs/components/prism-python', () => ({}));
vi.mock('prismjs/components/prism-bash', () => ({}));
vi.mock('prismjs/components/prism-json', () => ({}));
vi.mock('prismjs/components/prism-css', () => ({}));
vi.mock('prismjs/components/prism-markup', () => ({}));
vi.mock('prismjs/components/prism-jsx', () => ({}));
vi.mock('prismjs/components/prism-tsx', () => ({}));
vi.mock('prismjs/components/prism-go', () => ({}));
vi.mock('prismjs/components/prism-rust', () => ({}));
vi.mock('prismjs/components/prism-java', () => ({}));
vi.mock('prismjs/components/prism-c', () => ({}));
vi.mock('prismjs/components/prism-cpp', () => ({}));

function render(el: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(el);
}

describe('MarkdownRenderer', () => {
  it('renders plain text', () => {
    const html = render(createElement(MarkdownRenderer, { content: 'hello world' }));
    expect(html).toContain('hello world');
  });

  it('renders inline code', () => {
    const html = render(createElement(MarkdownRenderer, { content: 'use `npm install`' }));
    expect(html).toContain('md-inline-code');
    expect(html).toContain('npm install');
  });

  it('renders headings', () => {
    const html = render(createElement(MarkdownRenderer, { content: '# Title\n## Subtitle' }));
    expect(html).toContain('md-h1');
    expect(html).toContain('md-h2');
    expect(html).toContain('Title');
    expect(html).toContain('Subtitle');
  });

  it('renders bold and italic', () => {
    const html = render(createElement(MarkdownRenderer, { content: '**bold** and *italic*' }));
    expect(html).toContain('md-strong');
    expect(html).toContain('md-em');
  });

  it('renders links with target=_blank', () => {
    const html = render(createElement(MarkdownRenderer, { content: '[click](https://example.com)' }));
    expect(html).toContain('md-link');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('https://example.com');
  });

  it('renders unordered list', () => {
    const html = render(createElement(MarkdownRenderer, { content: '- item1\n- item2' }));
    expect(html).toContain('md-ul');
    expect(html).toContain('item1');
    expect(html).toContain('item2');
  });

  it('renders blockquote', () => {
    const html = render(createElement(MarkdownRenderer, { content: '> quote text' }));
    expect(html).toContain('md-blockquote');
    expect(html).toContain('quote text');
  });

  it('renders GFM table', () => {
    const html = render(createElement(MarkdownRenderer, { content: '| A | B |\n|---|---|\n| 1 | 2 |' }));
    expect(html).toContain('md-table');
    expect(html).toContain('<th>');
    expect(html).toContain('<td>');
  });

  it('renders code block', () => {
    const html = render(createElement(MarkdownRenderer, { content: '```js\nconsole.log(\'hi\')\n```' }));
    expect(html).toContain('language-');
  });

  it('renders hr', () => {
    const html = render(createElement(MarkdownRenderer, { content: 'above\n\n---\n\nbelow' }));
    expect(html).toContain('md-hr');
  });

  it('renders task list checkbox', () => {
    const html = render(createElement(MarkdownRenderer, { content: '- [x] done\n- [ ] todo' }));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
  });
});
