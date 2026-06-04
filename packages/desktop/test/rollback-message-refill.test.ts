import { describe, it, expect } from 'vitest';

function refillFromRollbackResponse(
  res: { turns: any[]; rolledBackMessage?: string },
  setPendingInput: (value: string) => void
) {
  if (res.rolledBackMessage) {
    setPendingInput(res.rolledBackMessage);
  }
}

describe('rollback message refill', () => {
  it('uses rolledBackMessage even when the rolled-back turn is absent from returned turns', () => {
    const pendingInputs: string[] = [];

    refillFromRollbackResponse(
      {
        turns: [
          {
            id: '1',
            items: [{ id: 'msg1', type: 'message', role: 'user', content: 'visible message' }],
            status: 'completed',
          },
        ],
        rolledBackMessage: 'original rolled back prompt',
      },
      (value) => pendingInputs.push(value)
    );

    expect(pendingInputs).toEqual(['original rolled back prompt']);
  });

  it('does not refill when the server has no rolled-back message', () => {
    const pendingInputs: string[] = [];

    refillFromRollbackResponse({ turns: [] }, (value) => pendingInputs.push(value));

    expect(pendingInputs).toEqual([]);
  });
});
