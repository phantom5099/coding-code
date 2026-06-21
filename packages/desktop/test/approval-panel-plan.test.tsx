/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useAgentStore } from '../src/stores/agent.store';
import ApprovalPanel from '../src/agent/ApprovalPanel';

const submitPlanChoiceMock = vi.fn();
const approveToolMock = vi.fn();
const rejectToolMock = vi.fn();

vi.mock('../src/hooks/useAgent', () => ({
  useAgentApproval: () => ({
    approveTool: (...args: unknown[]) => approveToolMock(...args),
    rejectTool: (...args: unknown[]) => rejectToolMock(...args),
    submitPlanChoice: (...args: unknown[]) => submitPlanChoiceMock(...args),
  }),
}));

vi.mock('../src/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copiedId: null, copy: vi.fn() }),
}));

const PLAN = '# 计划\n\n正文';

function seedSubmitPlan(threadId: string) {
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
                id: 'plan-1',
                type: 'tool_call',
                name: 'submit_plan',
                args: { plan_content: PLAN },
                status: 'pending',
                payload: { plan_content: PLAN, path: '/tmp/.codingcode/plans/abc.md' },
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

describe('ApprovalPanel — submit_plan handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({
      currentThreadId: null,
      threads: {},
      approvalPolicy: 'ask-all',
      model: '',
      models: [],
      contextUsage: null,
      todoByThreadId: {},
      pendingInput: null,
      usageByThreadId: {},
      isCompressing: false,
      automations: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the PlanApprovalModal when a submit_plan is pending', () => {
    seedSubmitPlan('t-1');
    const { getByTestId, getByText } = render(<ApprovalPanel threadId="t-1" />);
    expect(getByTestId('plan-approval-modal')).toBeInTheDocument();
    // Should display plan file path from payload
    expect(getByText(/计划文件/)).toBeInTheDocument();
  });

  it('dispatches "allow" to submitPlanChoice on implement', () => {
    seedSubmitPlan('t-1');
    const { getByTestId } = render(<ApprovalPanel threadId="t-1" />);
    fireEvent.click(getByTestId('plan-implement'));
    expect(submitPlanChoiceMock).toHaveBeenCalledWith('t-1', 'plan-1', { type: 'allow' });
  });

  it('dispatches "canceled" to submitPlanChoice on cancel', () => {
    seedSubmitPlan('t-1');
    const { getByTestId } = render(<ApprovalPanel threadId="t-1" />);
    fireEvent.click(getByTestId('plan-cancel'));
    expect(submitPlanChoiceMock).toHaveBeenCalledWith('t-1', 'plan-1', { type: 'canceled' });
  });

  it('dispatches "modified" with the revised content', () => {
    seedSubmitPlan('t-1');
    const { getByTestId, getByRole } = render(<ApprovalPanel threadId="t-1" />);
    fireEvent.click(getByTestId('plan-modify-tab'));
    act(() => {
      fireEvent.change(getByRole('textbox'), { target: { value: '# 新计划' } });
    });
    fireEvent.click(getByTestId('plan-modify-submit'));
    expect(submitPlanChoiceMock).toHaveBeenCalledWith('t-1', 'plan-1', {
      type: 'modified',
      input: { plan_content: '# 新计划' },
    });
  });

  it('falls back to the regular approval card list for non-submit_plan tools', () => {
    seedRegularApproval('t-2');
    const { queryByTestId, getByText } = render(<ApprovalPanel threadId="t-2" />);
    expect(queryByTestId('plan-approval-modal')).not.toBeInTheDocument();
    // The ToolCallCard should render the tool name
    expect(getByText('bash')).toBeInTheDocument();
  });

  it('returns null when there are no pending items', () => {
    const { container } = render(<ApprovalPanel threadId="t-empty" />);
    expect(container.firstChild).toBeNull();
  });
});
