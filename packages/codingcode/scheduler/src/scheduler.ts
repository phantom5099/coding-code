import { Layer, Effect, ManagedRuntime } from 'effect';
import { CronJob } from 'cron';
import { randomUUID } from 'crypto';
import { createLogger } from '@codingcode/infra';
import type {
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
} from './types.js';
import { readAutomations, writeAutomations } from './store.js';
import { AgentService } from '@codingcode/agent';
import { activeModelId, textPart } from '@codingcode/model';
import { SchedulerService } from './port.js';
import { BYPASS_PERMISSION_MODE } from '@codingcode/util';

const logger = createLogger();

const TIMEOUT_MS = 5 * 60 * 1000;

function createAutomation(input: CreateAutomationInput): Automation {
  const now = Date.now();
  return {
    id: randomUUID().slice(0, 8),
    name: input.name,
    description: input.description,
    cron: input.cron,
    timezone: input.timezone ?? 'Asia/Shanghai',
    sandbox: input.sandbox ?? 'workspace-write',
    enabled: true,
    projectCwd: input.projectCwd,
    runOnce: input.runOnce ?? false,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastSessionId: null,
  };
}

/** 仅合入白名单可变字段，防止 HTTP patch 覆盖 id / projectCwd / createdAt */
function applyAutomationPatch(auto: Automation, patch: UpdateAutomationInput): Automation {
  return {
    ...auto,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.cron !== undefined ? { cron: patch.cron } : {}),
    ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
    ...(patch.sandbox !== undefined ? { sandbox: patch.sandbox } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.runOnce !== undefined ? { runOnce: patch.runOnce } : {}),
    updatedAt: Date.now(),
  };
}

export const SchedulerLayer = Layer.effect(
  SchedulerService,
  Effect.sync(() => {
    const jobs = new Map<string, CronJob>();
    let _rt: ManagedRuntime.ManagedRuntime<AgentService, unknown> | null = null;

    function scheduleAutomation(auto: Automation): void {
      if (!auto.enabled) return;

      const job = new CronJob(
        auto.cron,
        () => {
          executeAutomation(auto, { removeIfRunOnce: true }).catch((e) =>
            logger.error(`Automation ${auto.id} failed:`, e)
          );
        },
        null,
        true,
        auto.timezone
      );

      jobs.set(auto.id, job);
    }

    async function executeAutomation(
      auto: Automation,
      opts: { readonly removeIfRunOnce: boolean }
    ): Promise<string | null> {
      if (!_rt) return null;
      logger.info(`Running automation: ${auto.name} (${auto.id})`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const turnResult = await _rt.runPromise(
          Effect.gen(function* () {
            const agent = yield* AgentService;
            return yield* agent.runTurn([textPart(auto.description)], {
              cwd: auto.projectCwd,
              signal: controller.signal,
              model: activeModelId(),
              permissionMode: BYPASS_PERMISSION_MODE,
              sandbox: { mode: auto.sandbox },
            });
          })
        );
        if (turnResult.kind === 'queued') return null;
        const { stream, sessionId } = turnResult;

        for await (const body of stream) {
          if (
            body.family === 'transition' &&
            body.transition.to === 'end' &&
            body.transition.reason === 'error'
          ) {
            logger.error(`Automation ${auto.id} agent error:`, body.transition.error);
          }
        }

        const automations = readAutomations();
        const idx = automations.findIndex((a) => a.id === auto.id);
        if (idx >= 0) {
          const automation = automations[idx]!;
          automation.lastRunAt = Date.now();
          automation.lastSessionId = sessionId;

          if (opts.removeIfRunOnce && auto.runOnce) {
            automations.splice(idx, 1);
            jobs.get(auto.id)?.stop();
            jobs.delete(auto.id);
          }

          writeAutomations(automations);
        }

        logger.info(`Automation ${auto.id} completed. Session: ${sessionId}`);
        return sessionId;
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      setRuntime(rt: ManagedRuntime.ManagedRuntime<AgentService, unknown>): void {
        _rt = rt;
      },

      initialize(): void {
        const automations = readAutomations();
        for (const auto of automations) {
          scheduleAutomation(auto);
        }
        logger.info(`Scheduler initialized with ${jobs.size} automations`);
      },

      list(): Automation[] {
        return readAutomations();
      },

      add(input: CreateAutomationInput): Automation {
        const automations = readAutomations();
        const auto = createAutomation(input);
        automations.push(auto);
        writeAutomations(automations);
        scheduleAutomation(auto);
        return auto;
      },

      update(id: string, patch: UpdateAutomationInput): Automation | null {
        const automations = readAutomations();
        const idx = automations.findIndex((a) => a.id === id);
        if (idx < 0) return null;

        const next = applyAutomationPatch(automations[idx]!, patch);
        automations[idx] = next;
        writeAutomations(automations);

        jobs.get(id)?.stop();
        jobs.delete(id);
        scheduleAutomation(next);

        return next;
      },

      remove(id: string): boolean {
        const automations = readAutomations();
        const idx = automations.findIndex((a) => a.id === id);
        if (idx < 0) return false;

        automations.splice(idx, 1);
        writeAutomations(automations);

        jobs.get(id)?.stop();
        jobs.delete(id);
        return true;
      },

      async runOnce(id: string): Promise<string | null> {
        if (!_rt) return null;
        const auto = readAutomations().find((a) => a.id === id);
        if (!auto) return null;
        return executeAutomation(auto, { removeIfRunOnce: false });
      },

      stopAll(): void {
        for (const [, job] of jobs) {
          job.stop();
        }
        jobs.clear();
      },
    };
  })
);
