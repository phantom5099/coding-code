import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PanelItem } from '../types.js';

interface InlinePanelProps<T = string> {
  title: string;
  items: PanelItem<T>[];
  activeValue?: T;
  onSelect: (value: T) => void;
  onCancel: () => void;
  width: number;
  maxHeight?: number;
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
      const idx = items.findIndex(i => i.value === activeValue);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });

  useEffect(() => {
    setSearchText('');
    if (activeValue) {
      const idx = items.findIndex(i => i.value === activeValue);
      setSelectedIdx(idx >= 0 ? idx : 0);
    } else {
      setSelectedIdx(0);
    }
  }, [items, activeValue]);

  const filtered = useMemo(() => {
    if (!searchText) return items;
    const q = searchText.toLowerCase();
    return items.filter(i =>
      i.label.toLowerCase().includes(q) ||
      (i.description ?? '').toLowerCase().includes(q)
    );
  }, [items, searchText]);

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.return) {
      const item = filtered[selectedIdx];
      if (item) onSelect(item.value);
      return;
    }
    if (key.upArrow || (key.tab && key.shift)) {
      setSelectedIdx(prev => (prev <= 0 ? Math.max(0, filtered.length - 1) : prev - 1));
      return;
    }
    if (key.downArrow || key.tab) {
      setSelectedIdx(prev => (prev >= filtered.length - 1 ? 0 : prev + 1));
      return;
    }
    if (key.backspace || key.delete) {
      setSearchText(s => s.slice(0, -1));
      setSelectedIdx(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setSearchText(s => (s + input).slice(0, 50));
      setSelectedIdx(0);
    }
  });

  const panelWidth = Math.min(60, width - 4);
  const innerW = Math.max(1, panelWidth - 2);
  const lineStr = '─'.repeat(innerW);
  const visibleHeight = Math.min(filtered.length, maxHeight);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="magenta" width={panelWidth} paddingX={1}>
      <Box>
        <Text bold color="magenta">{title}</Text>
        <Text color="gray"> · {filtered.length}/{items.length}</Text>
        {searchText !== '' && <Text color="yellow"> · 筛选: {searchText}_</Text>}
      </Box>

      <Box><Text color="gray">{lineStr}</Text></Box>

      <Box flexDirection="column" height={visibleHeight}>
        {filtered.length === 0 ? (
          <Box>
            <Text color="red">没有匹配的选项</Text>
          </Box>
        ) : (
          filtered.map((item, i) => {
            const isSelected = i === selectedIdx;
            const isActive = item.value === activeValue;
            const indicator = isSelected ? '▸' : ' ';
            const dot = isActive ? '●' : ' ';
            const desc = item.description ? ` · ${item.description}` : '';
            const line = `${indicator} ${dot} ${item.label}${desc}`;

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

      <Box><Text color="gray">{lineStr}</Text></Box>

      <Box>
        <Text color="gray">
          ↑↓选择 · Enter确认 · Esc取消{searchText !== '' ? ' · 退格清除筛选' : ' · 输入筛选'}
        </Text>
      </Box>
    </Box>
  );
}
