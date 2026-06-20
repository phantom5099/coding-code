import { Effect } from 'effect';
import type { ObserverHandler } from '../types.js';
import { ApprovalService } from '../../approval/index.js';
import { ProjectRuntimeService } from '../../runtime/project-runtime.js';
import { SessionService } from '../../session/store.js';
import { createLogger } from '@codingcode/infra/logger';
import { BUILD_PROFILE } from '../../subagent/registry.js';

const logger = createLogger();

/**
 * System observer hook: when submit_plan finishes successfully, switch the
 * session's main agent from plan → build so the user can immediately start
 * implementing. Also persists the active profile change.
 *
 * Returns an Effect so it can yield* services in the emit fiber's context
 * (the tool executor's fiber already provides ProjectRuntimeService /
 * SessionService / ApprovalService). Error isolation is handled by
 * `HookService.emit`, so a failure here does not propagate to the caller.
 */
export const afterPlanSubmittedObserver: ObserverHandler = (payload) =>
  Effect.gen(function* () {
    const toolName = payload.toolName as string | undefined;
    if (toolName !== 'submit_plan') return;
    const result = payload.result as { output?: string } | undefined;
    if (!result?.output?.startsWith('Plan written to ')) return;
    const sessionId = payload.sessionId as string | undefined;
    const projectPath = payload.projectPath as string | undefined;
    const args = (payload.args ?? {}) as { plan_content?: string };
    if (!sessionId || !projectPath) return;
    if (!args.plan_content) return;

    // Inner gen uses services that can fail (AgentError). Wrap in a
    // catchAll so the outer Effect's E stays `never`, matching the
    // ObserverHandler contract; log + swallow.
    yield* Effect.gen(function* () {
      const runtime = yield* ProjectRuntimeService;
      const session = yield* SessionService;

      // Switch to build profile (resolve build from runtime, fallback to built-in)
      const buildProfile =
        runtime.resolveSubagentProfile(projectPath, 'build') ??
        runtime.resolveSubagentProfile(projectPath, BUILD_PROFILE.name) ??
        BUILD_PROFILE;
      yield* runtime.setSessionProfile(projectPath, sessionId, buildProfile);

      // Persist activeProfile in the session index
      try {
        const state = yield* session.load(projectPath, sessionId);
        session.updateActiveProfile(state, buildProfile.name);
      } catch (err) {
        logger.warn('afterPlanSubmitted: failed to persist activeProfile:', err);
      }

      // Sync approval permission mode
      const approval = yield* ApprovalService;
      yield* approval.setPermissionMode(buildProfile.permissionMode ?? 'default');
    }).pipe(
      Effect.catchAll((err) => Effect.sync(() => logger.error('afterPlanSubmitted error:', err)))
    );
  });
