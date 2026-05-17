import { Layer } from 'effect';
import { AgentService } from './agent/agent';
import { SessionService } from './session/store';
import { ContextService } from './context/context';

export const AgentLayer = AgentService.Default;
export const SessionLayer = SessionService.Default;
export const ContextLayer = ContextService.Default;

export const AppLayer = Layer.mergeAll(
  AgentLayer,
  SessionLayer,
  ContextLayer,
);
