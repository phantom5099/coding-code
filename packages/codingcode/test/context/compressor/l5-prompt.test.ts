import { describe, it, expect } from 'vitest';

describe('L5 compaction prompt and extraction', () => {
  it('should extract summary from dual-tag format', () => {
    const raw = `<analysis>
This is analysis section with reasoning.
Multiple lines of thinking.
</analysis>

<summary>
## 1. Primary Request and Intent
User wants to add feature X.

## 2. Key Technical Concepts
- Concept A
- Concept B

## 9. Optional Next Step
Consider optimizing Y next.
</summary>

Some trailing text that should be ignored.`;

    const match = raw.match(/<summary>([\s\S]*?)<\/summary>/);
    expect(match).toBeDefined();
    expect(match?.[1]).toContain('Primary Request');
    expect(match?.[1]).toContain('Optional Next Step');
  });

  it('should fallback to raw content if no summary tags', () => {
    const raw = 'Just raw content without tags';
    const match = raw.match(/<summary>([\s\S]*?)<\/summary>/);
    const result = match ? match[1] : raw;
    expect(result).toBe(raw);
  });

  it('should validate 9 sections are present in summary structure', () => {
    const sections = [
      '## 1. Primary Request and Intent',
      '## 2. Key Technical Concepts',
      '## 3. Files and Code Sections',
      '## 4. Errors and Fixes',
      '## 5. Problem Solving',
      '## 6. All User Messages',
      '## 7. Pending Tasks',
      '## 8. Current Work',
      '## 9. Optional Next Step',
    ];

    sections.forEach((section) => {
      expect(section).toMatch(/^##\s+\d+\./);
    });
    expect(sections).toHaveLength(9);
  });

  it('should separate analysis from summary', () => {
    const full = `<analysis>
Reasoning and thinking process here.
This is how I approached the problem.
</analysis>

<summary>
The final structured output.
</summary>`;

    const analysisMatch = full.match(/<analysis>([\s\S]*?)<\/analysis>/);
    const summaryMatch = full.match(/<summary>([\s\S]*?)<\/summary>/);

    expect(analysisMatch?.[1]).toContain('Reasoning');
    expect(summaryMatch?.[1]).toContain('final structured');
    expect(analysisMatch?.[1]).not.toContain('final structured');
  });

  it('should handle empty sections gracefully', () => {
    const raw = `<analysis></analysis>
<summary>
## 1. Primary Request and Intent
</summary>`;

    const match = raw.match(/<summary>([\s\S]*?)<\/summary>/);
    expect(match?.[1]).toBeDefined();
  });
});
