/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ProfileIndicator from '../src/agent/ProfileIndicator';
import { useAgentStore } from '../src/stores/agent.store';

const fetchProfileMock = vi.fn();
const switchProfileMock = vi.fn();

const stableFetchProfile = (...args: unknown[]) => fetchProfileMock(...args);
const stableSwitchProfile = (...args: unknown[]) => switchProfileMock(...args);

vi.mock('../src/hooks/useAgent', () => ({
  useAgentProfile: () => ({
    fetchProfile: stableFetchProfile,
    switchProfile: stableSwitchProfile,
    fetchPlan: vi.fn(),
  }),
}));

const baseProfile = {
  activeProfile: 'build' as const,
  permissionMode: 'default' as const,
  cwd: '/tmp',
  available: [
    { name: 'plan', description: 'plan agent' },
    { name: 'build', description: 'build agent' },
  ],
};

describe('ProfileIndicator (with live session)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchProfileMock.mockResolvedValue(baseProfile);
    switchProfileMock.mockResolvedValue({ activeProfile: 'plan', permissionMode: 'default' });
    useAgentStore.setState({ pendingProfile: 'build', profileByThreadId: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it('fetches the current profile on mount and shows the build label', async () => {
    const { getByTestId, getByText } = render(<ProfileIndicator sessionId="s-1" cwd="/tmp" />);
    expect(fetchProfileMock).toHaveBeenCalledWith('s-1', '/tmp');
    await waitFor(() => {
      expect(getByTestId('profile-indicator')).toHaveTextContent('构建模式');
    });
    expect(getByText('构建模式')).toBeInTheDocument();
  });

  it('shows the plan label when the current profile is plan', async () => {
    fetchProfileMock.mockResolvedValue({
      ...baseProfile,
      activeProfile: 'plan',
      permissionMode: 'default',
    });
    const { getByTestId, getByText } = render(<ProfileIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('profile-indicator')).toHaveTextContent('计划模式');
    });
    expect(getByText('计划模式')).toBeInTheDocument();
  });

  it('toggles directly to the other profile on click (no popover)', async () => {
    const { getByTestId } = render(<ProfileIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('profile-indicator')).toHaveTextContent('构建模式');
    });
    expect(document.querySelector('[data-testid="profile-popover"]')).toBeNull();
    fireEvent.click(getByTestId('profile-indicator'));
    await waitFor(() => {
      expect(switchProfileMock).toHaveBeenCalledWith('s-1', 'plan', '/tmp');
    });
  });

  it('toggles from plan to build when current is plan', async () => {
    fetchProfileMock.mockResolvedValue({
      ...baseProfile,
      activeProfile: 'plan',
      permissionMode: 'default',
    });
    const { getByTestId } = render(<ProfileIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('profile-indicator')).toHaveTextContent('计划模式');
    });
    fireEvent.click(getByTestId('profile-indicator'));
    await waitFor(() => {
      expect(switchProfileMock).toHaveBeenCalledWith('s-1', 'build', '/tmp');
    });
  });

  it('updates the label from switchProfile response without refetching', async () => {
    fetchProfileMock.mockResolvedValue(baseProfile);
    switchProfileMock.mockResolvedValue({ activeProfile: 'plan', permissionMode: 'default' });
    const { getByTestId } = render(<ProfileIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('profile-indicator')).toHaveTextContent('构建模式');
    });
    fireEvent.click(getByTestId('profile-indicator'));
    await waitFor(() => {
      expect(getByTestId('profile-indicator')).toHaveTextContent('计划模式');
    });
    expect(fetchProfileMock).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks while a switch is in flight', async () => {
    let resolveSwitch!: (v: unknown) => void;
    switchProfileMock.mockReturnValue(new Promise((res) => (resolveSwitch = res)));
    const { getByTestId } = render(<ProfileIndicator sessionId="s-1" cwd="/tmp" />);
    await waitFor(() => {
      expect(getByTestId('profile-indicator')).toHaveTextContent('构建模式');
    });
    fireEvent.click(getByTestId('profile-indicator'));
    fireEvent.click(getByTestId('profile-indicator'));
    expect(switchProfileMock).toHaveBeenCalledTimes(1);
    resolveSwitch({ activeProfile: 'plan', permissionMode: 'default' });
  });

  it('renders optimistically from pendingProfile while fetch is in flight', async () => {
    useAgentStore.setState({ pendingProfile: 'plan' });
    let resolveFetch!: (v: unknown) => void;
    fetchProfileMock.mockReturnValue(new Promise((res) => (resolveFetch = res)));
    const { getByTestId } = render(<ProfileIndicator sessionId="s-1" cwd="/tmp" />);
    expect(getByTestId('profile-indicator')).toHaveTextContent('计划模式');
    resolveFetch(baseProfile);
  });

  it('skips fetch when a real profile is already in the store', () => {
    useAgentStore.setState({
      profileByThreadId: {
        's-1': {
          activeProfile: 'plan',
          permissionMode: 'default',
          fetchedAt: Date.now(),
          optimistic: false,
        },
      },
    });
    render(<ProfileIndicator sessionId="s-1" cwd="/tmp" />);
    expect(fetchProfileMock).not.toHaveBeenCalled();
  });
});

describe('ProfileIndicator (welcome screen, no session)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({ pendingProfile: 'build', profileByThreadId: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the pill even when sessionId is null', () => {
    const { getByTestId } = render(<ProfileIndicator sessionId={null} cwd="/tmp" />);
    expect(getByTestId('profile-indicator')).toBeInTheDocument();
  });

  it('reads the current label from pendingProfile (default: build)', () => {
    useAgentStore.setState({ pendingProfile: 'build' });
    const { getByTestId } = render(<ProfileIndicator sessionId={null} cwd="/tmp" />);
    expect(getByTestId('profile-indicator')).toHaveTextContent('构建模式');
  });

  it('reads the current label from pendingProfile when set to plan', () => {
    useAgentStore.setState({ pendingProfile: 'plan' });
    const { getByTestId } = render(<ProfileIndicator sessionId={null} cwd="/tmp" />);
    expect(getByTestId('profile-indicator')).toHaveTextContent('计划模式');
  });

  it('toggles pendingProfile locally without calling the server', () => {
    useAgentStore.setState({ pendingProfile: 'build' });
    const { getByTestId } = render(<ProfileIndicator sessionId={null} cwd="/tmp" />);
    fireEvent.click(getByTestId('profile-indicator'));
    expect(useAgentStore.getState().pendingProfile).toBe('plan');
    expect(switchProfileMock).not.toHaveBeenCalled();
    expect(fetchProfileMock).not.toHaveBeenCalled();
    fireEvent.click(getByTestId('profile-indicator'));
    expect(useAgentStore.getState().pendingProfile).toBe('build');
  });

  it('toggles back and forth and label updates after each click', () => {
    useAgentStore.setState({ pendingProfile: 'build' });
    const { getByTestId } = render(<ProfileIndicator sessionId={null} cwd="/tmp" />);
    const pill = getByTestId('profile-indicator');
    expect(pill).toHaveTextContent('构建模式');
    fireEvent.click(pill);
    expect(pill).toHaveTextContent('计划模式');
    fireEvent.click(pill);
    expect(pill).toHaveTextContent('构建模式');
  });
});
