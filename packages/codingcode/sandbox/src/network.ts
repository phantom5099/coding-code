import { AgentError } from '@codingcode/util';
import type { NetworkTarget, SandboxPolicy } from './types.js';

export function parseNetworkTarget(url: string): NetworkTarget {
  const parsed = new URL(url);
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  return { host: parsed.hostname, port };
}

export function assertNetworkTarget(policy: SandboxPolicy, url: string): void {
  const target = parseNetworkTarget(url);
  if (policy.mode === 'unrestricted' || policy.network.mode === 'unrestricted') return;
  if (policy.network.mode === 'none') {
    throw new AgentError(
      'SANDBOX_NETWORK_DENIED',
      `Network access is disabled: ${target.host}`
    );
  }
  if (!policy.network.hosts.includes(target.host)) {
    throw new AgentError(
      'SANDBOX_NETWORK_DENIED',
      `Network host is not allowlisted: ${target.host}`
    );
  }
  if (!policy.network.ports.includes(target.port)) {
    throw new AgentError('SANDBOX_NETWORK_DENIED', `Network port is not allowlisted: ${target.port}`);
  }
}
