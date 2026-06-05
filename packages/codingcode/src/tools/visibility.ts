export interface ToolVisibilityPolicy {
  allowedTools?: Set<string>;
  allowedMcpServers?: Set<string>;
  allowToolSearch?: boolean;
  allowDeferredTools?: boolean;
}
