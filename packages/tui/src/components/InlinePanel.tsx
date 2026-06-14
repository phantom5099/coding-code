import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PanelItem } from '../types.js';

interface InlinePanelProps<T = string> {
  title: string;
  items: PanelItem<T>[];
  activeValue?: T | null;
  onSelect: (value: T) => void;
  onCancel: () => void;
  width: number;
  maxHeight?: number;
}

function charWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  ) {
    return 2;
  }
  return 1;
}

export function truncateToDisplayWidth(value: string, maxWidth: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (maxWidth <= 0) return '';

  let width = 0;
  let result = '';
  for (const char of normalized) {
    const nextWidth = width + charWidth(char);
    if (nextWidth > maxWidth) {
      while (result && width + 1 > maxWidth) {
        const last = Array.from(result).pop() ?? '';
        result = result.slice(0, -last.length);
        width -= charWidth(last);
      }
      return result + '…';
    }
    result += char;
    width = nextWidth;
  }

  return result;
}

export function getVisiblePanelRange(
  selectedIdx: number,
  itemCount: number,
  maxHeight: number
): [number, number] {
  if (itemCount <= 0 || maxHeight <= 0) return [0, 0];
  const visibleHeight = Math.min(itemCount, maxHeight);
  const selected = Math.max(0, Math.min(selectedIdx, itemCount - 1));
  const start = Math.min(
    Math.max(0, selected - visibleHeight + 1),
    Math.max(0, itemCount - visibleHeight)
  );
  return [start, start + visibleHeight];
}

export function InlinePanel<T extends string>({
  title,
  items,
  activeValue,
  onSelect,
  onCancel,
  width,
  maxHeight = 10,
}: InlinePanelProps<T>) {
  const [searchText, setSearchText] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(() => {
    if (activeValue) {
      const idx = items.findIndex((i) => i.value === activeValue);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });

  useEffect(() => {
    setSearchText('');
    if (activeValue) {
      const idx = items.findIndex((i) => i.value === activeValue);
      setSelectedIdx(idx >= 0 ? idx : 0);
    } else {
      setSelectedIdx(0);
    }
  }, [items, activeValue]);

  const filtered = useMemo(() => {
    if (!searchText) return items;
    const q = searchText.toLowerCase();
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q)
    );
  }, [items, searchText]);

  useEffect(() => {
    if (selectedIdx >= filtered.length) {
      setSelectedIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIdx]);

  const clampedSelectedIdx = Math.max(0, Math.min(selectedIdx, filtered.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const item = filtered[clampedSelectedIdx];
      if (item) onSelect(item.value);
      return;
    }
    if (key.upArrow || (key.tab && key.shift)) {
      setSelectedIdx((prev) => (prev <= 0 ? Math.max(0, filtered.length - 1) : prev - 1));
      return;
    }
    if (key.downArrow || key.tab) {
      setSelectedIdx((prev) => (prev >= filtered.length - 1 ? 0 : prev + 1));
      return;
    }
    if (key.backspace || key.delete) {
      setSearchText((s) => s.slice(0, -1));
      setSelectedIdx(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setSearchText((s) => (s + input).slice(0, 50));
      setSelectedIdx(0);
    }
  });

  const panelWidth = Math.max(10, width);
  const innerW = Math.max(1, panelWidth - 4);
  const lineStr = '─'.repeat(innerW);
  const visibleHeight = Math.min(filtered.length, maxHeight);
  const [visibleStart, visibleEnd] = getVisiblePanelRange(
    clampedSelectedIdx,
    filtered.length,
    maxHeight
  );
  const visibleItems = filtered.slice(visibleStart, visibleEnd);
  const itemWidth = Math.max(1, innerW - 1);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="magenta"
      width={panelWidth}
      paddingX={1}
    >
      <Box>
        <Text bold color="magenta">
          {title}
        </Text>
        <Text color="gray">
          {' '}
          · {filtered.length}/{items.length}
        </Text>
        {searchText !== '' && <Text color="yellow"> · 筛选: {searchText}_</Text>}
      </Box>

      <Box>
        <Text color="gray">{lineStr}</Text>
      </Box>

      <Box flexDirection="column" height={visibleHeight}>
        {filtered.length === 0 ? (
          <Box>
            <Text color="red">没有匹配的选项</Text>
          </Box>
        ) : (
          visibleItems.map((item, offset) => {
            const index = visibleStart + offset;
            const isSelected = index === clampedSelectedIdx;
            const isActive = item.value === activeValue;
            const indicator = isSelected ? '▸' : ' ';
            const dot = isActive ? '●' : ' ';
            const desc = item.description ? ` · ${item.description}` : '';
            const line = truncateToDisplayWidth(
              `${indicator} ${dot} ${item.label}${desc}`,
              itemWidth
            );

            return (
              <Box key={item.value}>
                <Text
                  backgroundColor={isSelected ? 'magenta' : undefined}
                  color={isSelected ? 'black' : 'white'}
                  bold={isSelected}
                >
                  {line}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      <Box>
        <Text color="gray">{lineStr}</Text>
      </Box>

      <Box>
        <Text color="gray">
          ↑↓选择 · Enter确认 · Esc取消{searchText !== '' ? ' · 退格清除筛选' : ' · 输入筛选'}
        </Text>
      </Box>
    </Box>
  );
}
