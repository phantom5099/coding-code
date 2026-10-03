import type { Frame, FrameBody } from './frame.js';

export interface FrameAssembler {
  stamp(body: FrameBody): Frame;
}

export function createFrameAssembler(opts: { readonly sessionId: string }): FrameAssembler {
  const { sessionId } = opts;
  let turnId: number | null = null;
  let seq = 0;

  return {
    stamp(body: FrameBody): Frame {
      if (body.family === 'transition' && body.transition.to === 'start') {
        turnId = body.transition.turnId;
      }
      seq += 1;
      return { sessionId, turnId, seq, ...body };
    },
  };
}

export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}
