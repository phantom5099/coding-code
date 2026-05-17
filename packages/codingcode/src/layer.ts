import { Layer } from 'effect';
import { AgentService } from './agent/agent';
import { SessionService } from './session/store';
import { ContextService } from './context/context';
import { Bus } from './bus/bus';

// 域 Layer
export const AgentLayer = AgentService.Default;
export const SessionLayer = SessionService.Default;
export const ContextLayer = ContextService.Default;
// HookRegistry is a plain class, not an Effect Service. Wired via constructor injection.
export const BusLayer = Bus.Default;

// 顶层 Layer
export const AppLayer = Layer.mergeAll(
  AgentLayer,
  SessionLayer,
  ContextLayer,
  BusLayer,
);
