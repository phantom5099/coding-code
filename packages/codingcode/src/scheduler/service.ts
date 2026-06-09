import { Effect } from 'effect';
import { CronJob } from 'cron';
import { randomUUID } from 'crypto';
import { createLogger } from '@codingcode/infra';
import type { Automation, CreateAutomationInput, UpdateAutomationInput } from './types.js';
import { readAutomations, writeAutomations } from './store.js';
import { SessionService } from '../session/store.js';
import { sendMessage, type AgentEvent } from '../agent/agent.js';
import { getLLMClient } from '../llm/factory.js';
import { AgentError } from '../core/error.js';
import { AppLayer } from '../layer.js';

const logger = createLogger();

const TIMEOUT_MS = 5 * 60 * 1000;

export class SchedulerService extends Effect.Service<SchedulerService>()('Scheduler', {
  effect: Effect.gen(function* () {
    const session = yield* SessionService;
    const jobs = new Map<string, CronJob>();

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
      logger.info(`Running automation: ${auto.name} (${auto.id})`);

      const llmResult = await getLLMClient();
      if (!llmResult.ok) {
        logger.error(`Failed to get LLM client for automation ${auto.id}:`, llmResult.error);
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const { stream, sessionId } = await Effect.runPromise(
          sendMessage(undefined, auto.description, auto.projectCwd, llmResult.value, {
            signal: controller.signal,
            approvalOverride: { permissionMode: 'bypass' },
          }).pipe(Effect.provide(AppLayer))
        );

        let lastContent = '';
        for await (const event of stream) {
          if (event._tag === 'Done') {
            lastContent = event.content;
          } else if (event._tag === 'Error') {
            logger.error(`Automation ${auto.id} agent error:`, event.error);
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

    function initialize(): void {
      const automations = readAutomations();
      for (const auto of automations) {
        scheduleAutomation(auto);
      }
      logger.info(`Scheduler initialized with ${jobs.size} automations`);
    }

    function list(): Automation[] {
      return readAutomations();
    }

    function add(input: CreateAutomationInput): Automation {
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
    }

    function update(id: string, patch: UpdateAutomationInput): Automation | null {
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
    }

    function remove(id: string): boolean {
      const automations = readAutomations();
      const idx = automations.findIndex((a) => a.id === id);
      if (idx < 0) return false;

      automations.splice(idx, 1);
      writeAutomations(automations);

      jobs.get(id)?.stop();
      jobs.delete(id);
      return true;
    }

    async function runOnce(id: string): Promise<string | null> {
      const automations = readAutomations();
      const auto = automations.find((a) => a.id === id);
      if (!auto) return null;

      const llmResult = await getLLMClient();
      if (!llmResult.ok) {
        throw new AgentError('CONFIG_MISSING', 'Failed to get LLM client');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const { stream, sessionId } = await Effect.runPromise(
          sendMessage(undefined, auto.description, auto.projectCwd, llmResult.value, {
            signal: controller.signal,
            approvalOverride: { permissionMode: 'bypass' },
          }).pipe(Effect.provide(AppLayer))
        );

        for await (const event of stream) {
          if (event._tag === 'Error') {
            logger.error(`Manual run for ${id} agent error:`, event.error);
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
    }

    function stopAll(): void {
      for (const [id, job] of jobs) {
        job.stop();
      }
      jobs.clear();
    }

    return {
      initialize,
      list,
      add,
      update,
      remove,
      runOnce,
      stopAll,
    };
  }),
}) {}
