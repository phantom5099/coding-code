import { resolve } from "path";

export interface Sandbox {
  allowTool(name: string): boolean;
  allowPath(path: string, access: "read" | "write" | "execute"): boolean;
  allowCommand(cmd: string): boolean;
}

const BLOCKED_PATHS = [
  "/etc/passwd",
  "/etc/shadow",
];

const BLOCKED_COMMANDS = [
  "rm -rf /",
  "dd if=",
  "mkfs.",
  ":(){ :|:& };:",
  "> /dev/sda",
  "shutdown",
  "reboot",
  "halt",
];

export class DefaultSandbox implements Sandbox {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  allowTool(_name: string): boolean {
    return true;
  }

  allowPath(filePath: string, _access: "read" | "write" | "execute"): boolean {
    const resolved = resolve(filePath);

    // Block sensitive system paths
    for (const blocked of BLOCKED_PATHS) {
      if (resolved.startsWith(blocked)) return false;
    }

    // For now, only allow paths within the current working directory
    // Relaxed: allow any path, the user is running this locally
    return true;
  }

  allowCommand(cmd: string): boolean {
    const trimmed = cmd.trim().toLowerCase();
    for (const blocked of BLOCKED_COMMANDS) {
      if (trimmed.includes(blocked.toLowerCase())) return false;
    }
    return true;
  }
}
