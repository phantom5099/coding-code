import { z } from 'zod';
import { Effect } from 'effect';
import type { ToolDefinition } from '../../types.js';
import { AgentError } from '../../../util/error.js';
import { EventSinkService } from '../../../sink/port.js';
import { AskWaitService, type AskAnswer } from '../../../askuser/port.js';

type AskQuestionType = 'single' | 'multiple' | 'text';

const askUserSchema = z.object({
  questiontype: z.enum(['single', 'multiple', 'text']),
  question: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(200)).max(4).optional(),
});

const NO_ANSWER_OUTPUT = '用户未回答（用户取消或连接中断）';

function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function formatOutput(
  questiontype: AskQuestionType,
  options: readonly string[],
  answer: AskAnswer
): string | undefined {
  if (answer.status === 'no_answer') return undefined;

  if (questiontype === 'text') {
    const text = trimOrNull(answer.custom);
    return text ? `用户回答：${text}` : undefined;
  }

  const picked = answer.options
    .filter((letter) => /^[A-D]$/.test(letter))
    .map((letter) => {
      const index = letter.charCodeAt(0) - 65;
      return options[index] !== undefined ? `${letter}:${options[index]}` : null;
    })
    .filter((item): item is string => item !== null);
  const custom = trimOrNull(answer.custom);
  if (picked.length === 0 && custom === null) return undefined;

  const items = picked.length > 0 ? picked : [`自定义：${custom}`];
  let out = `用户选择了：[${items.map((item) => JSON.stringify(item)).join(',')}]`;
  if (picked.length > 0 && custom !== null) out += `；用户补充输入：${custom}`;
  return out;
}

export const askUserTool: ToolDefinition<AskWaitService | EventSinkService> = {
  name: 'ask_user',
  concurrencySafe: true,
  description:
    'Ask the end user a structured question and block until they answer. Use when missing information ' +
    'blocks the correct next action. questiontype: single (radio), multiple (checkbox), text (free input). ' +
    'options: 2-4 choice texts for single/multiple, ignored for text; letters A-D are assigned by order ' +
    'automatically. The user may also type a custom answer besides the options. Returns e.g. ' +
    '用户选择了：["A:红色"] or 用户回答：.... Multiple ask_user calls may be batched, each blocks on its ' +
    'own answer. If it returns 用户未回答, proceed with reasonable assumptions, state them explicitly, ' +
    'and re-ask at most once.',
  parameters: askUserSchema,
  execute: (args, ctx) =>
    Effect.gen(function* () {
      const { questiontype, question, options } = args as {
        questiontype: AskQuestionType;
        question: string;
        options?: string[];
      };

      if (questiontype !== 'text' && (!options || options.length < 2)) {
        return yield* Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', 'ask_user choice questions require 2-4 options')
        );
      }

      const sessionId = ctx?.sessionId;
      if (!sessionId) {
        return yield* Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', 'ask_user requires sessionId')
        );
      }
      const callId = ctx?.callId;
      if (!callId) {
        return yield* Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', 'ask_user requires callId')
        );
      }

      const waitSvc = yield* AskWaitService;
      const sink = yield* EventSinkService;

      yield* sink.emit(sessionId, {
        family: 'event',
        event: {
          type: 'ask_user',
          id: callId,
          question,
          questiontype,
          options: questiontype === 'text' ? undefined : options,
        },
      });

      const answer = yield* waitSvc.waitForAsk(callId, sessionId).pipe(
        Effect.ensuring(waitSvc.forget(callId))
      );

      const choices = questiontype === 'text' ? [] : (options ?? []);
      return formatOutput(questiontype, choices, answer) ?? NO_ANSWER_OUTPUT;
    }),
};
