import { describe, expect, it } from 'vitest';
import { getVisiblePanelRange, truncateToDisplayWidth } from '../../src/components/InlinePanel.js';

describe('InlinePanel', () => {
  it('truncates long session labels to one display line', () => {
    const label = '修复一个非常长的会话标题，避免会话选择列表发生换行重叠 2026/5/21 02:30:00';

    expect(truncateToDisplayWidth(label, 20)).toBe('修复一个非常长的会…');
  });

  it('normalizes whitespace before rendering a row', () => {
    expect(truncateToDisplayWidth('session\nwith\tspaces', 30)).toBe('session with spaces');
  });

  it('keeps the selected session inside the visible window', () => {
    expect(getVisiblePanelRange(0, 12, 5)).toEqual([0, 5]);
    expect(getVisiblePanelRange(6, 12, 5)).toEqual([2, 7]);
    expect(getVisiblePanelRange(11, 12, 5)).toEqual([7, 12]);
  });
});
