/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PlanPanel from '../src/shared/PlanPanel';

const fetchPlanMock = vi.fn();

// Stable references — the mock returns the same wrapper on every render so
// the component's useEffect/useCallback don't loop on a changed identity.
const stableFetchPlan = (...args: unknown[]) => fetchPlanMock(...args);
const stableFetchMode = vi.fn();
const stableSwitchMode = vi.fn();

vi.mock('../src/hooks/useAgent', () => ({
  useAgentMode: () => ({
    fetchPlan: stableFetchPlan,
    fetchMode: stableFetchMode,
    switchMode: stableSwitchMode,
  }),
}));

describe('PlanPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('fetches the plan on mount and renders its Markdown', async () => {
    fetchPlanMock.mockResolvedValue({
      content: '# Hello\n\n- a\n- b',
      path: '/tmp/.codingcode/plans/abc.md',
      directory: '/tmp/.codingcode/plans',
      exists: true,
    });
    const { getByText } = render(
      <PlanPanel sessionId="s-1" cwd="/tmp" onClose={() => {}} />
    );
    expect(fetchPlanMock).toHaveBeenCalledWith('s-1', '/tmp');
    await waitFor(() => {
      expect(getByText('Hello')).toBeInTheDocument();
    });
    expect(getByText('a')).toBeInTheDocument();
  });

  it('shows the plan file path in the header', async () => {
    fetchPlanMock.mockResolvedValue({
      content: '# X',
      path: '/tmp/plan.md',
      directory: '/tmp',
      exists: true,
    });
    const { getByText } = render(
      <PlanPanel sessionId="s-1" cwd="/tmp" onClose={() => {}} />
    );
    await waitFor(() => {
      expect(getByText('/tmp/plan.md')).toBeInTheDocument();
    });
  });

  it('shows an empty-state when the plan file does not exist', async () => {
    fetchPlanMock.mockResolvedValue({
      content: '',
      path: '/tmp/.codingcode/plans/missing.md',
      directory: '/tmp/.codingcode/plans',
      exists: false,
    });
    const { getByText } = render(
      <PlanPanel sessionId="s-1" cwd="/tmp" onClose={() => {}} />
    );
    await waitFor(() => {
      expect(getByText(/暂无计划/)).toBeInTheDocument();
    });
  });

  it('renders an error message when fetchPlan rejects', async () => {
    fetchPlanMock.mockRejectedValue(new Error('boom'));
    const { getByText } = render(
      <PlanPanel sessionId="s-1" cwd="/tmp" onClose={() => {}} />
    );
    await waitFor(() => {
      expect(getByText(/加载失败/)).toBeInTheDocument();
    });
    expect(getByText('boom')).toBeInTheDocument();
  });

  it('reloads when the refresh button is clicked', async () => {
    fetchPlanMock.mockResolvedValue({
      content: '# X',
      path: '/tmp/plan.md',
      directory: '/tmp',
      exists: true,
    });
    const { getByLabelText } = render(
      <PlanPanel sessionId="s-1" cwd="/tmp" onClose={() => {}} />
    );
    // Wait for the initial mount fetch to land
    await waitFor(() => expect(fetchPlanMock).toHaveBeenCalledTimes(1));
    // Click refresh; the component should re-invoke fetchPlan even though
    // sessionId/cwd haven't changed.
    fireEvent.click(getByLabelText('刷新计划'));
    await waitFor(
      () => expect(fetchPlanMock).toHaveBeenCalledTimes(2),
      { timeout: 2000 }
    );
  });

  it('invokes onClose when the close button is clicked', async () => {
    fetchPlanMock.mockResolvedValue({
      content: '# X',
      path: '/tmp/plan.md',
      directory: '/tmp',
      exists: true,
    });
    const onClose = vi.fn();
    const { getByLabelText } = render(
      <PlanPanel sessionId="s-1" cwd="/tmp" onClose={onClose} />
    );
    fireEvent.click(getByLabelText('关闭计划面板'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when pressing Escape', async () => {
    fetchPlanMock.mockResolvedValue({
      content: '# X',
      path: '/tmp/plan.md',
      directory: '/tmp',
      exists: true,
    });
    const onClose = vi.fn();
    render(<PlanPanel sessionId="s-1" cwd="/tmp" onClose={onClose} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
