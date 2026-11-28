import { z } from 'zod';
import { Effect } from 'effect';
import { defineTool } from '@codingcode/tool';
import { AgentError } from '@codingcode/util';
import { EventSinkService, type AskQuestionType } from '@codingcode/sink';
import { AskWaitService, type AskAnswer } from '@codingcode/askuser';

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
  question: { readonly questiontype: AskQuestionType; readonly options: readonly string[] },
  answer: AskAnswer
): string | undefined {
  if (answer.status === 'no_answer') return undefined;

  if (question.questiontype === 'text') {
    const text = trimOrNull(answer.custom);
    return text ? `用户回答：${text}` : undefined;
  }

  const picked = answer.options
    .filter((letter) => /^[A-D]$/.test(letter))
    .map((letter) => {
      const index = letter.charCodeAt(0) - 65;
      return question.options[index] !== undefined ? `${letter}:${question.options[index]}` : null;
    })
    .filter((item): item is string => item !== null);
  const custom = trimOrNull(answer.custom);
  if (picked.length === 0 && custom === null) return undefined;

  const items = picked.length > 0 ? picked : [`自定义：${custom}`];
  let out = `用户选择了：[${items.map((item) => JSON.stringify(item)).join(',')}]`;
  if (picked.length > 0 && custom !== null) out += `；用户补充输入：${custom}`;
  return out;
}

export const askUserTool = defineTool<AskWaitService | EventSinkService, typeof askUserSchema>({
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
  execute: ({ questiontype, question, options }, ctx) =>
    Effect.gen(function* () {
      if (questiontype !== 'text' && (!options || options.length < 2)) {
        return yield* Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', 'ask_user choice questions require 2-4 options')
        );
      }

      const sessionId = ctx?.session?.sessionId;
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

      const answer = yield* waitSvc
        .waitForAsk({ callId, sessionId })
        .pipe(Effect.ensuring(waitSvc.forget(callId)));

      const choices = questiontype === 'text' ? [] : (options ?? []);
      return formatOutput({ questiontype, options: choices }, answer) ?? NO_ANSWER_OUTPUT;
    }),
});
