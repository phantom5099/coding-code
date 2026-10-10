import { Layer, Effect, ManagedRuntime } from 'effect';
import { CronJob } from 'cron';
import { randomUUID } from 'crypto';
import { createLogger } from '../infra/logger.js';
import type {
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
} from './types.js';
import { readAutomations, writeAutomations } from './store.js';
import { AgentService } from '../agent/port.js';
import { activeModelId } from '../infra/models.js';
import { textPart } from '../llm/types.js';
import { SchedulerService } from './port.js';
import { BYPASS_PERMISSION_MODE, BUILD_PROFILE_NAME } from '../util/enums.js';

const logger = createLogger();

const TIMEOUT_MS = 5 * 60 * 1000;

export const SchedulerLayer = Layer.effect(
  SchedulerService,
  Effect.sync(() => {
    const jobs = new Map<string, CronJob>();
    let _rt: ManagedRuntime.ManagedRuntime<any, any> | null = null;

    function scheduleAutomation(auto: Automation): void {
      if (!auto.enabled) return;

      const job = new CronJob(
        auto.cron,
        () => {
          runAutomation(auto).catch((e) => logger.error(`Automation ${auto.id} failed:`, e));
        },
        null,
        true,
        auto.timezone
      );

      jobs.set(auto.id, job);
    }

    async function runAutomation(auto: Automation): Promise<void> {
      if (!_rt) return;
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
              // 自动化没有独立的模型配置，统一用 config.yaml 的活动模型
              model: activeModelId(),
              activeProfile: BUILD_PROFILE_NAME,
              permissionMode: BYPASS_PERMISSION_MODE,
            });
          })
        );
        // 自动化不开已有会话，不可能命中活跃回合
        if (turnResult.kind === 'queued') return;
        const { stream, sessionId } = turnResult;

        let lastContent = '';
        for await (const body of stream) {
          if (body.family === 'event' && body.event.type === 'text_delta') {
            lastContent += body.event.text;
          } else if (
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

          if (auto.runOnce) {
            automations.splice(idx, 1);
            jobs.get(auto.id)?.stop();
            jobs.delete(auto.id);
          }

          writeAutomations(automations);
        }

        logger.info(`Automation ${auto.id} completed. Session: ${sessionId}`);
      } catch (e) {
        logger.error(`Automation ${auto.id} execution failed:`, e);
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      setRuntime(rt: ManagedRuntime.ManagedRuntime<any, any>): void {
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
        const now = Date.now();
        const auto: Automation = {
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

        automations.push(auto);
        writeAutomations(automations);
        scheduleAutomation(auto);
        return auto;
      },

      update(id: string, patch: UpdateAutomationInput): Automation | null {
        const automations = readAutomations();
        const idx = automations.findIndex((a) => a.id === id);
        if (idx < 0) return null;

        const auto = automations[idx]!;
        Object.assign(auto, patch, { updatedAt: Date.now() });
        automations[idx] = auto;
        writeAutomations(automations);

        jobs.get(id)?.stop();
        jobs.delete(id);
        scheduleAutomation(auto);

        return auto;
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
        const automations = readAutomations();
        const auto = automations.find((a) => a.id === id);
        if (!auto) return null;

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
                activeProfile: BUILD_PROFILE_NAME,
                permissionMode: BYPASS_PERMISSION_MODE,
              });
            })
          );
          // 同上：自动化不开已有会话，queued 不可达
          if (turnResult.kind === 'queued') return null;
          const { stream, sessionId } = turnResult;

          for await (const body of stream) {
            if (
              body.family === 'transition' &&
              body.transition.to === 'end' &&
              body.transition.reason === 'error'
            ) {
              logger.error(`Manual run for ${id} agent error:`, body.transition.error);
            }
          }

          const allAutomations = readAutomations();
          const idx = allAutomations.findIndex((a) => a.id === id);
          if (idx >= 0) {
            const automation = allAutomations[idx]!;
            automation.lastRunAt = Date.now();
            automation.lastSessionId = sessionId;
            writeAutomations(allAutomations);
          }

          return sessionId;
        } finally {
          clearTimeout(timeout);
        }
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
