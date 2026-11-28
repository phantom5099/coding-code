import type { CodeRollbackResult } from '@codingcode/checkpoint';
import type { AppConfig } from '@codingcode/infra';
import type { TokenUsage } from '@codingcode/model';
import type { UITurn } from '@codingcode/session';
import type { Skill } from '@codingcode/skill';
import type { TextPart } from '@codingcode/util';

/** POST /messages 入站内容部件的线上形状 */
export type WireInputPart =
  | TextPart
  | { type: 'media'; dataUrl: string; filename?: string };

/** GET/POST /api/settings/agent/config 的配置投影 */
export type AgentConfigView = Readonly<
  Pick<AppConfig, 'maxSteps' | 'maxStopContinuations' | 'permissionMode'>
>;

/** GET /api/settings/skills 的条目投影（Skill 已原生承载 source） */
export type SkillEntry = Skill;

/** POST /api/sessions/:id/rollback-context 响应体 */
export interface RollbackContextResult {
  readonly ok: true;
  readonly turns: UITurn[];
  readonly promptEstimate: number;
  readonly usage?: TokenUsage;
}

/** POST /api/sessions/:id/rollback-both-to-turn 响应体 */
export interface RollbackBothResult extends RollbackContextResult {
  readonly codeResult: CodeRollbackResult;
}

/** POST /api/sessions/:id/fork 响应体 */
export interface ForkResult {
  readonly sessionId: string;
  readonly turns: UITurn[];
  readonly promptEstimate: number;
}

/** POST /api/automations/:id/run 响应体 */
export interface RunAutomationResult {
  readonly sessionId: string;
}
