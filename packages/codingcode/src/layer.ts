import { Layer } from 'effect';
import { AgentService } from './agent/agent';
import { SessionService } from './session/store';
import { ContextService } from './context/context';
import { ToolService } from './tools/registry';
import { HookService } from './hooks/registry';
import { McpService } from './mcp/index';
import { SkillService } from './skills/index';

export const AgentLayer = AgentService.Default;
export const SessionLayer = SessionService.Default;
export const ContextLayer = ContextService.Default;
export const ToolLayer = ToolService.Default;
export const HookLayer = HookService.Default;
export const SkillLayer = SkillService.Default;

const InfraLayer = Layer.mergeAll(ToolLayer, HookLayer);
export const McpLayer = McpService.Default.pipe(Layer.provide(InfraLayer));

export const AppLayer = Layer.mergeAll(
  AgentLayer,
  SessionLayer,
  ContextLayer,
  InfraLayer,
  McpLayer,
  SkillLayer,
);
