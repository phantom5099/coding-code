/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PlanApprovalModal from '../src/shared/PlanApprovalModal';

vi.mock('../src/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copiedId: null, copy: vi.fn() }),
}));

const PLAN = '# 计划\n\n- 步骤 1\n- 步骤 2';

describe('PlanApprovalModal', () => {
  let onImplement: ReturnType<typeof vi.fn>;
  let onModify: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onImplement = vi.fn();
    onModify = vi.fn();
    onCancel = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the plan content as Markdown in preview view', () => {
    const { getByText, container } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={() => onImplement()}
        onModify={onModify}
        onCancel={onCancel}
      />
    );
    // The header should mention the plan length
    expect(container.textContent).toMatch(/计划审批/);
    // The plan heading should be rendered via MarkdownRenderer
    expect(getByText('计划')).toBeInTheDocument();
    expect(getByText('步骤 1')).toBeInTheDocument();
  });

  it('shows the plan file path when provided', () => {
    const { getByText } = render(
      <PlanApprovalModal
        planContent={PLAN}
        planPath="/tmp/.codingcode/plans/abc.md"
        onImplement={() => onImplement()}
        onModify={onModify}
        onCancel={onCancel}
      />
    );
    expect(getByText(/计划文件/)).toBeInTheDocument();
  });

  it('triggers onImplement when the implement button is clicked', () => {
    const { getByTestId } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={() => onImplement()}
        onModify={onModify}
        onCancel={onCancel}
      />
    );
    fireEvent.click(getByTestId('plan-implement'));
    expect(onImplement).toHaveBeenCalledTimes(1);
    expect(onModify).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('triggers onCancel when the cancel button is clicked', () => {
    const { getByTestId } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={() => onImplement()}
        onModify={onModify}
        onCancel={onCancel}
      />
    );
    fireEvent.click(getByTestId('plan-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('triggers onModify with the new draft content', () => {
    const { getByTestId, getByRole } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={() => onImplement()}
        onModify={(c) => onModify(c)}
        onCancel={onCancel}
      />
    );
    // Switch to edit view via the "提出修改" tab button
    fireEvent.click(getByTestId('plan-modify-tab'));
    // Now find the modify-submit button
    const submit = getByTestId('plan-modify-submit');
    // Replace the draft
    const textarea = getByRole('textbox') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '# 修改后的计划' } });
    });
    fireEvent.click(submit);
    expect(onModify).toHaveBeenCalledWith('# 修改后的计划');
    expect(onImplement).not.toHaveBeenCalled();
  });

  it('treats unchanged draft as implement (no-op modify)', () => {
    const { getByTestId, getByRole } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={() => onImplement()}
        onModify={(c) => onModify(c)}
        onCancel={onCancel}
      />
    );
    fireEvent.click(getByTestId('plan-modify-tab'));
    // Do NOT change the draft
    const submit = getByTestId('plan-modify-submit');
    expect((getByRole('textbox') as HTMLTextAreaElement).value).toBe(PLAN);
    fireEvent.click(submit);
    expect(onImplement).toHaveBeenCalledTimes(1);
    expect(onModify).not.toHaveBeenCalled();
  });

  it('triggers onCancel when pressing Escape', () => {
    const { container } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={() => onImplement()}
        onModify={onModify}
        onCancel={onCancel}
      />
    );
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows line/char count derived from plan content', () => {
    const { container } = render(
      <PlanApprovalModal
        planContent={'line1\nline2\nline3'}
        onImplement={() => onImplement()}
        onModify={onModify}
        onCancel={onCancel}
      />
    );
    // 3 lines (split by \n), 17 chars (5+1+5+1+5)
    expect(container.textContent).toMatch(/3 行/);
    expect(container.textContent).toMatch(/17 字符/);
  });
});
