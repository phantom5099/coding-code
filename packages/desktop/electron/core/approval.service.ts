type Policy = 'suggest' | 'auto-edit' | 'full-auto'

// Commands that are always blocked regardless of policy
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /git\s+push\s+--force/,
  /DROP\s+TABLE/i,
  /format\s+[a-z]:/i,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
  /shutdown/i,
  /reboot/i,
]

const FILE_TOOLS = new Set(['file_read', 'apply_patch', 'list_dir', 'search'])

export function requiresApproval(
  toolName: string,
  args: Record<string, unknown>,
  policy: Policy
): boolean {
  // Always check for dangerous commands in shell tool
  if (toolName === 'shell') {
    const cmd = (args.command as string) || ''
    if (DANGEROUS_PATTERNS.some((p) => p.test(cmd))) return true
  }

  switch (policy) {
    case 'suggest':
      return true
    case 'auto-edit':
      return toolName === 'shell'
    case 'full-auto':
      return false
    default:
      return true
  }
}
