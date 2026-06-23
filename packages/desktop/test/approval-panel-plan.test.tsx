/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useAgentStore } from '../src/stores/agent.store';
import ApprovalPanel from '../src/agent/ApprovalPanel';

const sendMessageMock = vi.fn();
const switchModeMock = vi.fn();
const fetchPlanMock = vi.fn();

vi.mock('../src/hooks/useAgent', () => ({
  useAgentApproval: () => ({
    approveTool: vi.fn(),
    rejectTool: vi.fn(),
  }),
  useAgentCore: () => ({
    sendMessage: sendMessageMock,
    abort: vi.fn(),
  }),
  useAgentMode: () => ({
    switchMode: switchModeMock,
    fetchPlan: fetchPlanMock,
  }),
}));

const PLAN = '# 计划\n\n正文';

function seedPendingPlan(threadId: string, title = '测试计划') {
  act(() => {
    useAgentStore.getState().setPendingPlan(threadId, {
      sessionId: threadId,
      title,
    });
  });
  // Default: fetchPlan returns the test plan content
  fetchPlanMock.mockResolvedValue({
    content: PLAN,
    path: '/tmp/.codingcode/plans/abc.md',
    directory: '/tmp/.codingcode/plans',
  });
}

function seedRegularApproval(threadId: string) {
  act(() => {
    useAgentStore.setState((s) => {
      s.threads[threadId] = {
        id: threadId,
        projectId: '',
        title: 't',
        cwd: '/test/cwd',
        turns: [
          {
            id: 'turn-1',
            status: 'running',
            items: [
              {
                id: 'bash-1',
                type: 'tool_call',
                name: 'bash',
                args: { command: 'ls' },
                status: 'pending',
              } as any,
            ],
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
  });
}

describe('ApprovalPanel — pendingPlan handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useAgentStore.setState({
        currentThreadId: null,
        threads: {},
        approvalPolicy: 'ask-all',
        model: '',
        models: [],
        contextUsage: null,
        todoByThreadId: {},
        pendingInput: null,
        pendingPlanByThreadId: {},
        usageByThreadId: {},
        isCompressing: false,
        automations: [],
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the PlanApprovalModal when pendingPlan is set', async () => {
    seedPendingPlan('t-1');
    const { findByTestId } = render(<ApprovalPanel threadId="t-1" />);
    const modal = await findByTestId('plan-approval-modal');
    expect(modal).toBeInTheDocument();
  });

  it('clears pendingPlan and sends an implement message on execute', async () => {
    seedPendingPlan('t-1');
    const { findByTestId } = render(<ApprovalPanel threadId="t-1" />);
    const implementBtn = await findByTestId('plan-implement');
    await act(async () => {
      fireEvent.click(implementBtn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(switchModeMock).toHaveBeenCalledWith('t-1', 'build', expect.any(String));
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('Plan approved'),
      expect.any(String)
    );
    expect(useAgentStore.getState().pendingPlanByThreadId['t-1']).toBeUndefined();
  });

  it('clears pendingPlan without sending any message on cancel', async () => {
    seedPendingPlan('t-1');
    const { findByTestId } = render(<ApprovalPanel threadId="t-1" />);
    const cancelBtn = await findByTestId('plan-cancel');
    await act(async () => {
      fireEvent.click(cancelBtn);
      await Promise.resolve();
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(switchModeMock).not.toHaveBeenCalled();
    expect(useAgentStore.getState().pendingPlanByThreadId['t-1']).toBeUndefined();
  });

  it('sends the opinion text as a new message on submit-opinion', async () => {
    seedPendingPlan('t-1');
    const { findByTestId, findByRole } = render(<ApprovalPanel threadId="t-1" />);
    const textarea = (await findByRole('textbox')) as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '请加上错误处理' } });
    });
    const submitBtn = await findByTestId('plan-submit-opinion');
    await act(async () => {
      fireEvent.click(submitBtn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(switchModeMock).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('请加上错误处理'),
      expect.any(String)
    );
    expect(useAgentStore.getState().pendingPlanByThreadId['t-1']).toBeUndefined();
  });

  it('does not call switchMode on cancel (profile stays in plan)', async () => {
    seedPendingPlan('t-1');
    const { findByTestId } = render(<ApprovalPanel threadId="t-1" />);
    await act(async () => {
      fireEvent.click(await findByTestId('plan-cancel'));
      await Promise.resolve();
    });
    expect(switchModeMock).not.toHaveBeenCalled();
  });

  it('falls back to the regular approval card list when only tool_calls are pending', () => {
    seedRegularApproval('t-2');
    const { queryByTestId, getByText } = render(<ApprovalPanel threadId="t-2" />);
    expect(queryByTestId('plan-approval-modal')).not.toBeInTheDocument();
    expect(getByText('bash')).toBeInTheDocument();
  });

  it('returns null when there are no pending items', () => {
    const { container } = render(<ApprovalPanel threadId="t-empty" />);
    expect(container.firstChild).toBeNull();
  });
});
