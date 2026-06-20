/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ModeIndicator from '../src/agent/ModeIndicator';

const fetchModeMock = vi.fn();
const switchModeMock = vi.fn();

// Stable references — the hook returns these on every render so the
// component's useEffect doesn't loop on a changed `fetchMode` identity.
const stableFetchMode = (...args: unknown[]) => fetchModeMock(...args);
const stableSwitchMode = (...args: unknown[]) => switchModeMock(...args);

vi.mock('../src/hooks/useAgent', () => ({
  useAgentMode: () => ({
    fetchMode: stableFetchMode,
    switchMode: stableSwitchMode,
    fetchPlan: vi.fn(),
  }),
}));

const baseMode = {
  profileName: 'build',
  permissionMode: 'default',
  cwd: '/tmp',
  available: [
    { name: 'plan', description: 'plan agent' },
    { name: 'build', description: 'build agent' },
  ],
};

describe('ModeIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchModeMock.mockResolvedValue(baseMode);
    switchModeMock.mockResolvedValue({ profileName: 'plan', permissionMode: 'plan' });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when sessionId is null', () => {
    const { container } = render(<ModeIndicator sessionId={null} cwd="/tmp" />);
    expect(container.firstChild).toBeNull();
  });

  it('fetches the current mode on mount and shows the build label', async () => {
    const { getByTestId, getByText } = render(
      <ModeIndicator sessionId="s-1" cwd="/tmp" />
    );
    expect(fetchModeMock).toHaveBeenCalledWith('s-1', '/tmp');
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('构建模式');
    });
    // The default label "构建模式" appears inside the pill
    expect(getByText('构建模式')).toBeInTheDocument();
  });

  it('shows the plan label when the current profile is plan', async () => {
    fetchModeMock.mockResolvedValue({
      ...baseMode,
      profileName: 'plan',
      permissionMode: 'plan',
    });
    const { getByTestId, getByText } = render(
      <ModeIndicator sessionId="s-1" cwd="/tmp" />
    );
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('计划模式');
    });
    expect(getByText('计划模式')).toBeInTheDocument();
  });

  it('opens the popover and switches to plan mode when clicked', async () => {
    const { getByTestId } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('构建模式');
    });
    // Open popover
    fireEvent.click(getByTestId('mode-indicator'));
    expect(getByTestId('mode-popover')).toBeInTheDocument();
    // Click "计划模式"
    fireEvent.click(getByTestId('mode-option-plan'));
    await waitFor(() => {
      expect(switchModeMock).toHaveBeenCalledWith('s-1', 'plan', '/tmp');
    });
  });

  it('does not call switchMode when the same mode is selected', async () => {
    const { getByTestId } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('构建模式');
    });
    fireEvent.click(getByTestId('mode-indicator'));
    // Click "build" (the current mode) — should be a no-op for the server
    fireEvent.click(getByTestId('mode-option-build'));
    await waitFor(() => {
      expect(switchModeMock).not.toHaveBeenCalled();
    });
  });

  it('invokes onPlanPanelOpen when the "查看当前计划" link is clicked', async () => {
    const onOpen = vi.fn();
    const { getByTestId, getByText } = render(
      <ModeIndicator sessionId="s-1" cwd="/tmp" onPlanPanelOpen={onOpen} />
    );
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toBeInTheDocument();
    });
    fireEvent.click(getByTestId('mode-indicator'));
    fireEvent.click(getByText(/查看当前计划/));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('refetches mode after a successful switch', async () => {
    fetchModeMock
      .mockResolvedValueOnce(baseMode)
      .mockResolvedValueOnce({ ...baseMode, profileName: 'plan', permissionMode: 'plan' });
    const { getByTestId } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('构建模式');
    });
    fireEvent.click(getByTestId('mode-indicator'));
    fireEvent.click(getByTestId('mode-option-plan'));
    await waitFor(() => {
      // second fetch happens after switch
      expect(fetchModeMock).toHaveBeenCalledTimes(2);
    });
    // The pill should now show the plan label
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('计划模式');
    });
  });
});
