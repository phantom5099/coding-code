/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useAgentStore } from '../src/stores/agent.store';
import ApprovalPanel from '../src/agent/ApprovalPanel';

const sendMessageMock = vi.fn();
const sendPlanDecisionMock = vi.fn();
const approveToolMock = vi.fn();
const rejectToolMock = vi.fn();

vi.mock('../src/hooks/useAgent', () => ({
  useAgentApproval: () => ({
    approveTool: (...args: unknown[]) => approveToolMock(...args),
    rejectTool: (...args: unknown[]) => rejectToolMock(...args),
    sendPlanDecision: (
      threadId: string,
      callId: string,
      message: string,
      sendMessage: (m: string) => Promise<void>
    ) => {
      useAgentStore.getState().setPendingPlan(threadId, null);
      return sendPlanDecisionMock(threadId, callId, message, sendMessage);
    },
  }),
  useAgentCore: () => ({
    sendMessage: sendMessageMock,
    abort: vi.fn(),
  }),
}));

vi.mock('../src/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copiedId: null, copy: vi.fn() }),
}));

const PLAN = '# 计划\n\n正文';

function seedPendingPlan(threadId: string) {
  act(() => {
    useAgentStore.getState().setPendingPlan(threadId, {
      sessionId: threadId,
      title: '测试计划',
      path: '/tmp/.codingcode/plans/abc.md',
      content: PLAN,
    });
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

  it('renders the PlanApprovalModal when pendingPlan is set', () => {
    seedPendingPlan('t-1');
    const { getByTestId, getByText } = render(<ApprovalPanel threadId="t-1" />);
    expect(getByTestId('plan-approval-modal')).toBeInTheDocument();
    expect(getByText(/计划文件/)).toBeInTheDocument();
  });

  it('clears pendingPlan and sends an implement message on implement', async () => {
    seedPendingPlan('t-1');
    const { getByTestId } = render(<ApprovalPanel threadId="t-1" />);
    await act(async () => {
      fireEvent.click(getByTestId('plan-implement'));
      // wait microtasks for the async chain
      await Promise.resolve();
    });
    expect(sendPlanDecisionMock).toHaveBeenCalledWith(
      't-1',
      't-1',
      expect.stringContaining('proceed with implementing'),
      sendMessageMock
    );
    expect(useAgentStore.getState().pendingPlanByThreadId['t-1']).toBeUndefined();
  });

  it('clears pendingPlan and sends a cancel message on cancel', async () => {
    seedPendingPlan('t-1');
    const { getByTestId } = render(<ApprovalPanel threadId="t-1" />);
    await act(async () => {
      fireEvent.click(getByTestId('plan-cancel'));
      await Promise.resolve();
    });
    expect(sendPlanDecisionMock).toHaveBeenCalledWith(
      't-1',
      't-1',
      expect.stringContaining('Cancel the plan'),
      sendMessageMock
    );
    expect(useAgentStore.getState().pendingPlanByThreadId['t-1']).toBeUndefined();
  });

  it('sends a modified message with the revised content', async () => {
    seedPendingPlan('t-1');
    const { getByTestId, getByRole } = render(<ApprovalPanel threadId="t-1" />);
    fireEvent.click(getByTestId('plan-modify-tab'));
    act(() => {
      fireEvent.change(getByRole('textbox'), { target: { value: '# 新计划' } });
    });
    await act(async () => {
      fireEvent.click(getByTestId('plan-modify-submit'));
      await Promise.resolve();
    });
    expect(sendPlanDecisionMock).toHaveBeenCalledWith(
      't-1',
      't-1',
      expect.stringContaining('# 新计划'),
      sendMessageMock
    );
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
