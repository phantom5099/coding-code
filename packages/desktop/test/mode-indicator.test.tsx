/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ModeIndicator from '../src/agent/ModeIndicator';
import { useAgentStore } from '../src/stores/agent.store';

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

describe('ModeIndicator (with live session)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchModeMock.mockResolvedValue(baseMode);
    switchModeMock.mockResolvedValue({ profileName: 'plan', permissionMode: 'plan' });
    // Reset pendingProfile between tests
    useAgentStore.setState({ pendingProfile: 'build' });
  });

  afterEach(() => {
    cleanup();
  });

  it('fetches the current mode on mount and shows the build label', async () => {
    const { getByTestId, getByText } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    expect(fetchModeMock).toHaveBeenCalledWith('s-1', '/tmp');
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('构建模式');
    });
    expect(getByText('构建模式')).toBeInTheDocument();
  });

  it('shows the plan label when the current profile is plan', async () => {
    fetchModeMock.mockResolvedValue({
      ...baseMode,
      profileName: 'plan',
      permissionMode: 'plan',
    });
    const { getByTestId, getByText } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('计划模式');
    });
    expect(getByText('计划模式')).toBeInTheDocument();
  });

  it('toggles directly to the other mode on click (no popover)', async () => {
    const { getByTestId } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('构建模式');
    });
    expect(document.querySelector('[data-testid="mode-popover"]')).toBeNull();
    fireEvent.click(getByTestId('mode-indicator'));
    await waitFor(() => {
      expect(switchModeMock).toHaveBeenCalledWith('s-1', 'plan', '/tmp');
    });
  });

  it('toggles from plan to build when current is plan', async () => {
    fetchModeMock.mockResolvedValue({
      ...baseMode,
      profileName: 'plan',
      permissionMode: 'plan',
    });
    const { getByTestId } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('计划模式');
    });
    fireEvent.click(getByTestId('mode-indicator'));
    await waitFor(() => {
      expect(switchModeMock).toHaveBeenCalledWith('s-1', 'build', '/tmp');
    });
  });

  it('refetches mode after a successful switch and updates the label', async () => {
    fetchModeMock
      .mockResolvedValueOnce(baseMode)
      .mockResolvedValueOnce({ ...baseMode, profileName: 'plan', permissionMode: 'plan' });
    const { getByTestId } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('构建模式');
    });
    fireEvent.click(getByTestId('mode-indicator'));
    await waitFor(() => {
      expect(fetchModeMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('计划模式');
    });
  });

  it('ignores clicks while a switch is in flight', async () => {
    let resolveSwitch!: (v: unknown) => void;
    switchModeMock.mockReturnValue(new Promise((res) => (resolveSwitch = res)));
    const { getByTestId } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('构建模式');
    });
    fireEvent.click(getByTestId('mode-indicator'));
    fireEvent.click(getByTestId('mode-indicator'));
    expect(switchModeMock).toHaveBeenCalledTimes(1);
    resolveSwitch({ profileName: 'plan' });
  });
});

describe('ModeIndicator (welcome screen, no session)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({ pendingProfile: 'build' });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the pill even when sessionId is null (regression: previously returned null)', () => {
    const { getByTestId } = render(<ModeIndicator sessionId={null} cwd="/tmp" />);
    expect(getByTestId('mode-indicator')).toBeInTheDocument();
  });

  it('reads the current label from pendingProfile (default: build)', () => {
    useAgentStore.setState({ pendingProfile: 'build' });
    const { getByTestId } = render(<ModeIndicator sessionId={null} cwd="/tmp" />);
    expect(getByTestId('mode-indicator')).toHaveTextContent('构建模式');
  });

  it('reads the current label from pendingProfile when set to plan', () => {
    useAgentStore.setState({ pendingProfile: 'plan' });
    const { getByTestId } = render(<ModeIndicator sessionId={null} cwd="/tmp" />);
    expect(getByTestId('mode-indicator')).toHaveTextContent('计划模式');
  });

  it('toggles pendingProfile locally without calling the server', () => {
    useAgentStore.setState({ pendingProfile: 'build' });
    const { getByTestId } = render(<ModeIndicator sessionId={null} cwd="/tmp" />);
    fireEvent.click(getByTestId('mode-indicator'));
    expect(useAgentStore.getState().pendingProfile).toBe('plan');
    expect(switchModeMock).not.toHaveBeenCalled();
    expect(fetchModeMock).not.toHaveBeenCalled();
    fireEvent.click(getByTestId('mode-indicator'));
    expect(useAgentStore.getState().pendingProfile).toBe('build');
  });

  it('toggles back and forth and label updates after each click', () => {
    useAgentStore.setState({ pendingProfile: 'build' });
    const { getByTestId } = render(<ModeIndicator sessionId={null} cwd="/tmp" />);
    const pill = getByTestId('mode-indicator');
    expect(pill).toHaveTextContent('构建模式');
    fireEvent.click(pill);
    expect(pill).toHaveTextContent('计划模式');
    fireEvent.click(pill);
    expect(pill).toHaveTextContent('构建模式');
  });
});
