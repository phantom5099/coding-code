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
  mode: 'build' as const,
  permissionMode: 'default' as const,
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
    switchModeMock.mockResolvedValue({ mode: 'plan', permissionMode: 'default' });
    useAgentStore.setState({ pendingProfile: 'build', modeByThreadId: {} });
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

  it('shows the plan label when the current mode is plan', async () => {
    fetchModeMock.mockResolvedValue({
      ...baseMode,
      mode: 'plan',
      permissionMode: 'default',
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
      mode: 'plan',
      permissionMode: 'default',
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

  it('updates the label from switchMode response without refetching', async () => {
    fetchModeMock.mockResolvedValue(baseMode);
    switchModeMock.mockResolvedValue({ mode: 'plan', permissionMode: 'default' });
    const { getByTestId } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('构建模式');
    });
    fireEvent.click(getByTestId('mode-indicator'));
    await waitFor(() => {
      expect(getByTestId('mode-indicator')).toHaveTextContent('计划模式');
    });
    expect(fetchModeMock).toHaveBeenCalledTimes(1);
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
    resolveSwitch({ mode: 'plan', permissionMode: 'default' });
  });

  it('renders optimistically from pendingProfile while fetch is in flight', async () => {
    useAgentStore.setState({ pendingProfile: 'plan' });
    let resolveFetch!: (v: unknown) => void;
    fetchModeMock.mockReturnValue(new Promise((res) => (resolveFetch = res)));
    const { getByTestId } = render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    expect(getByTestId('mode-indicator')).toHaveTextContent('计划模式');
    resolveFetch(baseMode);
  });

  it('skips fetch when a real mode is already in the store', () => {
    useAgentStore.setState({
      modeByThreadId: {
        's-1': {
          mode: 'plan',
          permissionMode: 'default',
          fetchedAt: Date.now(),
          optimistic: false,
        },
      },
    });
    render(<ModeIndicator sessionId="s-1" cwd="/tmp" />);
    expect(fetchModeMock).not.toHaveBeenCalled();
  });
});

describe('ModeIndicator (welcome screen, no session)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({ pendingProfile: 'build', modeByThreadId: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the pill even when sessionId is null', () => {
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
