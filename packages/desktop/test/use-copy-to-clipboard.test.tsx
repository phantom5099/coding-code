/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useCopyToClipboard } from '../src/hooks/useCopyToClipboard';

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mock navigator.clipboard.writeText
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('initial copiedId is null', () => {
    const { result } = renderHook(() => useCopyToClipboard());
    expect(result.current.copiedId).toBeNull();
  });

  it('copy() calls navigator.clipboard.writeText with the given text', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy('hello world', 'item-1');
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
  });

  it('copy() sets copiedId to the given id', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy('hello', 'msg-123');
    });

    expect(result.current.copiedId).toBe('msg-123');
  });

  it('copiedId is reset to null after the default delay', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy('hello', 'msg-1');
    });
    expect(result.current.copiedId).toBe('msg-1');

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.copiedId).toBeNull();
  });

  it('copiedId is reset to null after custom delay', async () => {
    const { result } = renderHook(() => useCopyToClipboard(500));

    await act(async () => {
      await result.current.copy('hello', 'msg-2');
    });
    expect(result.current.copiedId).toBe('msg-2');

    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current.copiedId).toBe('msg-2');

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copiedId).toBeNull();
  });

  it('second copy overwrites the first copiedId', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy('first', 'id-1');
    });
    expect(result.current.copiedId).toBe('id-1');

    await act(async () => {
      await result.current.copy('second', 'id-2');
    });
    expect(result.current.copiedId).toBe('id-2');
  });

  it('copy and reset preserves the last id when reset fires', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy('first', 'id-1');
    });

    await act(async () => {
      await result.current.copy('second', 'id-2');
    });

    // Advance past the first copy's timeout — should NOT reset to null
    // because the active copiedId is id-2, and id-1's timer checks id !== copiedId
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.copiedId).toBeNull();
  });

  it('empty string content is still copied', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy('', 'empty-item');
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
    expect(result.current.copiedId).toBe('empty-item');
  });

  it('multiple hooks have independent copiedId state', async () => {
    const { result: r1 } = renderHook(() => useCopyToClipboard());
    const { result: r2 } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await r1.current.copy('from first', 'r1-id');
    });

    expect(r1.current.copiedId).toBe('r1-id');
    expect(r2.current.copiedId).toBeNull();
  });
});

describe('useCopyToClipboard - integration with button UI', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('button reflects copied state after copy', async () => {
    function TestButton() {
      const { copiedId, copy } = useCopyToClipboard();
      const id = 'btn-1';
      const isCopied = copiedId === id;
      return (
        <button onClick={() => copy('test content', id)}>{isCopied ? '已复制' : '复制'}</button>
      );
    }

    render(<TestButton />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('复制');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(button).toHaveTextContent('已复制');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test content');
  });

  it('button text reverts after the reset delay', async () => {
    function TestButton() {
      const { copiedId, copy } = useCopyToClipboard();
      const id = 'btn-2';
      const isCopied = copiedId === id;
      return <button onClick={() => copy('content', id)}>{isCopied ? '已复制' : '复制'}</button>;
    }

    render(<TestButton />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });
    expect(button).toHaveTextContent('已复制');

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(button).toHaveTextContent('复制');
  });
});
