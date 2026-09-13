import { Context } from 'effect';
import type { ManagedRuntime } from 'effect';
import type { Automation, CreateAutomationInput, UpdateAutomationInput } from './types.js';

export interface SchedulerShape {
  setRuntime(rt: ManagedRuntime.ManagedRuntime<any, any>): void;
  initialize(): void;
  list(): Automation[];
  add(input: CreateAutomationInput): Automation;
  update(id: string, patch: UpdateAutomationInput): Automation | null;
  remove(id: string): boolean;
  runOnce(id: string): Promise<string | null>;
  stopAll(): void;
}

export class SchedulerService extends Context.Tag('Scheduler')<SchedulerService, SchedulerShape>() {}
