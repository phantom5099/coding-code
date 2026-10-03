import { describe, it, expect } from 'vitest';
import { COMPACTION_SYSTEM_PROMPT } from '../../../src/context/compaction-prompt.js';

// 断言直接读真实提示词常量，避免测试与实现各写一份而悄悄漂移。
describe('L5 compaction prompt contract', () => {
  const SECTIONS = [
    '## 1. Primary Request and Intent',
    '## 2. Key Technical Concepts',
    '## 3. Files and Code Sections',
    '## 4. Errors and Fixes',
    '## 5. Problem Solving',
    '## 6. Decision Rationale and Rejected Approaches',
    '## 7. All User Messages',
    '## 8. Pending Tasks',
    '## 9. Current Work',
    '## 10. Optional Next Step',
  ];

  it('requests all ten sections in order', () => {
    let cursor = -1;
    for (const section of SECTIONS) {
      const at = COMPACTION_SYSTEM_PROMPT.indexOf(section);
      expect(at, `missing or out-of-order section: ${section}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('no longer asks for a separate analysis block', () => {
    expect(COMPACTION_SYSTEM_PROMPT).not.toMatch(/<\/?analysis>/);
  });

  it('no longer wraps the summary in tags', () => {
    expect(COMPACTION_SYSTEM_PROMPT).not.toMatch(/<\/?summary>/);
  });
});
