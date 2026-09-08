/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PlanDecisionModal from '../src/shared/PlanDecisionModal';

describe('PlanDecisionModal', () => {
  let onImplement: ReturnType<typeof vi.fn>;
  let onSubmitOpinion: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  const baseProps = {
    title: 'Add OAuth login',
    sessionId: 'sess-12345678',
    onImplement: () => onImplement(),
    onSubmitOpinion: (t: string) => onSubmitOpinion(t),
    onCancel: () => onCancel(),
  };

  beforeEach(() => {
    onImplement = vi.fn();
    onSubmitOpinion = vi.fn();
    onCancel = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the plan title without rendering plan content', () => {
    const { getByTestId, getByText, queryByText } = render(<PlanDecisionModal {...baseProps} />);
    expect(getByTestId('plan-decision-modal')).toBeInTheDocument();
    expect(getByText(/Add OAuth login/)).toBeInTheDocument();
    // The lightweight panel never fetches or renders the full plan body.
    expect(queryByText('执行')).toBeInTheDocument();
  });

  it('triggers onImplement when the execute button is clicked', () => {
    const { getByTestId } = render(<PlanDecisionModal {...baseProps} />);
    fireEvent.click(getByTestId('plan-implement'));
    expect(onImplement).toHaveBeenCalledTimes(1);
    expect(onSubmitOpinion).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('triggers onCancel when the cancel button is clicked', () => {
    const { getByTestId } = render(<PlanDecisionModal {...baseProps} />);
    fireEvent.click(getByTestId('plan-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables submit-opinion when opinion is empty', () => {
    const { getByTestId } = render(<PlanDecisionModal {...baseProps} />);
    const submit = getByTestId('plan-submit-opinion') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('triggers onSubmitOpinion with the opinion text when submitted', () => {
    const { getByTestId, getByRole } = render(<PlanDecisionModal {...baseProps} />);
    const textarea = getByRole('textbox') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '请加上错误处理' } });
    });
    fireEvent.click(getByTestId('plan-submit-opinion'));
    expect(onSubmitOpinion).toHaveBeenCalledWith('请加上错误处理');
    expect(onImplement).not.toHaveBeenCalled();
  });
});
