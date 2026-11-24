import { AgentError } from '../util/error.js';
import type { SandboxPolicy } from './types.js';

export function assertNetworkTarget(policy: SandboxPolicy, url: string): void {
  const parsed = new URL(url);
  if (policy.mode === 'unrestricted' || policy.network.mode === 'unrestricted') return;
  if (policy.network.mode === 'none') {
    throw new AgentError(
      'SANDBOX_NETWORK_DENIED',
      `Network access is disabled: ${parsed.hostname}`
    );
  }
  if (!policy.network.hosts.includes(parsed.hostname)) {
    throw new AgentError(
      'SANDBOX_NETWORK_DENIED',
      `Network host is not allowlisted: ${parsed.hostname}`
    );
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (!policy.network.ports.includes(port)) {
    throw new AgentError('SANDBOX_NETWORK_DENIED', `Network port is not allowlisted: ${port}`);
  }
}
