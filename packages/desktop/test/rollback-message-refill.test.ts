import { describe, it, expect } from 'vitest';

function refillFromTurns(
  turns: { id: string; items: any[] }[],
  throughTurnId: number,
  setPendingInput: (value: string) => void
) {
  const targetTurn = turns.find((t) => t.id === String(throughTurnId));
  const userMsg = targetTurn?.items.find(
    (i) => i.type === 'message' && (i as any).role === 'user'
  );
  const userContent = userMsg && 'content' in userMsg ? (userMsg as any).content : '';
  if (userContent) {
    setPendingInput(userContent);
  }
}

describe('rollback message refill', () => {
  it('refills the user message from the target turn in existing turns', () => {
    const pendingInputs: string[] = [];

    refillFromTurns(
      [
        {
          id: '1',
          items: [
            { id: 'msg1', type: 'message', role: 'user', content: 'original rolled back prompt' },
          ],
        },
      ],
      1,
      (value) => pendingInputs.push(value)
    );

    expect(pendingInputs).toEqual(['original rolled back prompt']);
  });

  it('does not refill when the target turn is absent from turns', () => {
    const pendingInputs: string[] = [];

    refillFromTurns([], 1, (value) => pendingInputs.push(value));

    expect(pendingInputs).toEqual([]);
  });

  it('does not refill when the target turn has no user message', () => {
    const pendingInputs: string[] = [];

    refillFromTurns(
      [{ id: '1', items: [{ id: 'a1', type: 'message', role: 'assistant', content: 'hi' }] }],
      1,
      (value) => pendingInputs.push(value)
    );

    expect(pendingInputs).toEqual([]);
  });
});
