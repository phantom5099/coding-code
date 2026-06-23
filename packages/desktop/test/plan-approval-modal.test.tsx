/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PlanApprovalModal from '../src/shared/PlanApprovalModal';

const PLAN = '# 计划\n\n- 步骤 1\n- 步骤 2';

describe('PlanApprovalModal', () => {
  let onImplement: ReturnType<typeof vi.fn>;
  let onSubmitOpinion: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onImplement = vi.fn();
    onSubmitOpinion = vi.fn();
    onCancel = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the plan content as Markdown', () => {
    const { getByText } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={onImplement}
        onSubmitOpinion={onSubmitOpinion}
        onCancel={onCancel}
      />
    );
    expect(getByText('计划')).toBeInTheDocument();
    expect(getByText('步骤 1')).toBeInTheDocument();
  });

  it('shows the plan file path when provided', () => {
    const { getByText } = render(
      <PlanApprovalModal
        planContent={PLAN}
        planPath="/tmp/.codingcode/plans/abc.md"
        onImplement={onImplement}
        onSubmitOpinion={onSubmitOpinion}
        onCancel={onCancel}
      />
    );
    expect(getByText(/计划文件/)).toBeInTheDocument();
  });

  it('shows loading placeholder when content is empty and loading=true', () => {
    const { getByText } = render(
      <PlanApprovalModal
        planContent=""
        loading
        onImplement={onImplement}
        onSubmitOpinion={onSubmitOpinion}
        onCancel={onCancel}
      />
    );
    expect(getByText(/加载中/)).toBeInTheDocument();
  });

  it('triggers onImplement when the execute button is clicked', () => {
    const { getByTestId } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={onImplement}
        onSubmitOpinion={onSubmitOpinion}
        onCancel={onCancel}
      />
    );
    fireEvent.click(getByTestId('plan-implement'));
    expect(onImplement).toHaveBeenCalledTimes(1);
    expect(onSubmitOpinion).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('triggers onCancel when the cancel button is clicked', () => {
    const { getByTestId } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={onImplement}
        onSubmitOpinion={onSubmitOpinion}
        onCancel={onCancel}
      />
    );
    fireEvent.click(getByTestId('plan-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables submit-opinion when opinion is empty', () => {
    const { getByTestId } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={onImplement}
        onSubmitOpinion={onSubmitOpinion}
        onCancel={onCancel}
      />
    );
    const submit = getByTestId('plan-submit-opinion') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('triggers onSubmitOpinion with the opinion text when submitted', () => {
    const { getByTestId, getByRole } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={onImplement}
        onSubmitOpinion={(c) => onSubmitOpinion(c)}
        onCancel={onCancel}
      />
    );
    const textarea = getByRole('textbox') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '请加上错误处理' } });
    });
    fireEvent.click(getByTestId('plan-submit-opinion'));
    expect(onSubmitOpinion).toHaveBeenCalledWith('请加上错误处理');
    expect(onImplement).not.toHaveBeenCalled();
  });

  it('disables all action buttons while submitting', () => {
    const { getByTestId, getByRole } = render(
      <PlanApprovalModal
        planContent={PLAN}
        onImplement={onImplement}
        onSubmitOpinion={onSubmitOpinion}
        onCancel={onCancel}
      />
    );
    act(() => {
      fireEvent.change(getByRole('textbox'), { target: { value: 'feedback' } });
    });
    fireEvent.click(getByTestId('plan-submit-opinion'));
    expect((getByTestId('plan-cancel') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('plan-implement') as HTMLButtonElement).disabled).toBe(true);
  });
});
