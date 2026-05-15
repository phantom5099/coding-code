import { createHash, randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
} from "fs";
import { homedir } from "os";
import { join, dirname, basename } from "path";
import type {
  SessionEvent,
  SessionMetaEvent,
  UserEvent,
  AssistantEvent,
  ToolResultEvent,
  RoleSwitchEvent,
  CompactBoundaryEvent,
  SessionIndex,
} from "./types";

const CODINGCODE_DIR = join(homedir(), ".codingcode");
const SESSIONS_DIR = join(CODINGCODE_DIR, "sessions");

export function makeProjectSlug(cwd: string): string {
  const safeCwd = cwd || process.cwd();
  const hash = createHash("sha256").update(safeCwd).digest("hex");
  return hash.slice(0, 16);
}

export class SessionStore {
  private sessionId: string;
  private projectSlug: string;
  private cwd: string;
  private transcriptPath: string;
  private indexPath: string;
  private messageCount: number = 0;
  private sessionMeta: SessionMetaEvent | null = null;

  constructor(cwd: string, sessionId?: string) {
    this.cwd = cwd;
    this.projectSlug = makeProjectSlug(cwd);
    this.sessionId = sessionId ?? randomUUID();
    this.transcriptPath = join(
      SESSIONS_DIR,
      this.projectSlug,
      `${this.sessionId}.jsonl`
    );
    this.indexPath = this.transcriptPath.replace(".jsonl", ".index.json");
    this.ensureDirs();
  }

  private ensureDirs(): void {
    if (!existsSync(CODINGCODE_DIR)) mkdirSync(CODINGCODE_DIR, { recursive: true });
    if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
    const projectDir = dirname(this.transcriptPath);
    if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });
  }

  /** 初始化新会话（写入 session_meta） */
  init(model: string, role: string, version: string): void {
    if (existsSync(this.transcriptPath)) {
      // 已存在，读取 meta
      const history = this.readHistory();
      const meta = history.find((e) => e.type === "session_meta") as SessionMetaEvent | undefined;
      if (meta) {
        this.sessionMeta = meta;
        this.messageCount = history.filter((e) => e.type !== "session_meta").length;
      }
      return;
    }

    const meta: SessionMetaEvent = {
      type: "session_meta",
      sessionId: this.sessionId,
      projectSlug: this.projectSlug,
      cwd: this.cwd,
      model,
      role,
      createdAt: new Date().toISOString(),
      version,
    };
    this.sessionMeta = meta;
    this.appendLine(meta);
    this.updateIndex();
  }

  // ── 记录事件 ──

  recordUser(content: string): UserEvent {
    const event: UserEvent = {
      type: "user",
      uuid: randomUUID(),
      content,
      timestamp: new Date().toISOString(),
    };
    this.appendEvent(event);
    return event;
  }

  recordAssistant(
    content: string,
    toolCalls: AssistantEvent["toolCalls"],
    model: string
  ): AssistantEvent {
    const event: AssistantEvent = {
      type: "assistant",
      uuid: randomUUID(),
      content,
      toolCalls,
      model,
      timestamp: new Date().toISOString(),
    };
    this.appendEvent(event);
    return event;
  }

  recordToolResult(
    parentUuid: string,
    toolName: string,
    toolCallId: string,
    output: string
  ): ToolResultEvent {
    const event: ToolResultEvent = {
      type: "tool_result",
      uuid: randomUUID(),
      parentUuid,
      toolName,
      toolCallId,
      output,
      timestamp: new Date().toISOString(),
    };
    this.appendEvent(event);
    return event;
  }

  recordRoleSwitch(fromRole: string, toRole: string): RoleSwitchEvent {
    const event: RoleSwitchEvent = {
      type: "role_switch",
      uuid: randomUUID(),
      fromRole,
      toRole,
      timestamp: new Date().toISOString(),
    };
    this.appendEvent(event);
    return event;
  }

  recordCompactBoundary(
    summary: string,
    replacedRange: [number, number],
    messageCount: number
  ): CompactBoundaryEvent {
    const event: CompactBoundaryEvent = {
      type: "compact_boundary",
      uuid: randomUUID(),
      summary,
      replacedRange,
      messageCount,
      timestamp: new Date().toISOString(),
    };
    this.appendEvent(event);
    return event;
  }

  // ── 读取 ──

  readHistory(): SessionEvent[] {
    if (!existsSync(this.transcriptPath)) return [];
    const content = readFileSync(this.transcriptPath, "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as SessionEvent);
  }

  getMessageCount(): number {
    return this.messageCount;
  }

  getSessionMeta(): SessionMetaEvent | null {
    return this.sessionMeta;
  }

  getTranscriptPath(): string {
    return this.transcriptPath;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getProjectSlug(): string {
    return this.projectSlug;
  }

  // ── 静态方法：列出所有会话 ──

  static listSessions(projectSlug?: string): SessionIndex[] {
    const results: SessionIndex[] = [];
    const projects = projectSlug
      ? [projectSlug]
      : existsSync(SESSIONS_DIR)
      ? readdirSync(SESSIONS_DIR)
      : [];

    for (const slug of projects) {
      const dir = join(SESSIONS_DIR, slug);
      if (!existsSync(dir)) continue;

      const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files) {
        const id = file.replace(".jsonl", "");
        const jsonlPath = join(dir, file);
        const idxPath = jsonlPath.replace(".jsonl", ".index.json");

        // 优先读取索引
        let index: SessionIndex | null = null;
        if (existsSync(idxPath)) {
          try {
            index = JSON.parse(readFileSync(idxPath, "utf8")) as SessionIndex;
          } catch {
            // 索引损坏，回退到扫描 JSONL
          }
        }

        if (index) {
          results.push(index);
        } else {
          const meta = SessionStore.quickReadMeta(jsonlPath);
          if (meta && meta.cwd && meta.sessionId) {
            const history = new SessionStore(meta.cwd, meta.sessionId).readHistory();
            const msgCount = history.filter((e) => e.type !== "session_meta").length;
            results.push({
              sessionId: meta.sessionId,
              projectSlug: meta.projectSlug,
              cwd: meta.cwd,
              model: meta.model,
              role: meta.role,
              createdAt: meta.createdAt,
              updatedAt: meta.createdAt,
              messageCount: msgCount,
            });
          }
        }
      }
    }
    return results;
  }

  private static quickReadMeta(path: string): SessionMetaEvent | null {
    try {
      const fd = openSync(path, "r");
      const buffer = Buffer.alloc(4096);
      const bytesRead = readSync(fd, buffer, 0, 4096, 0);
      closeSync(fd);
      const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n")[0];
      if (!firstLine) return null;
      return JSON.parse(firstLine) as SessionMetaEvent;
    } catch {
      return null;
    }
  }

  // ── 内部 ──

  private appendEvent(event: SessionEvent): void {
    this.appendLine(event);
    this.messageCount++;
    this.updateIndex();
  }

  private appendLine(event: object): void {
    const line = JSON.stringify(event) + "\n";
    appendFileSync(this.transcriptPath, line, "utf8");
  }

  private updateIndex(): void {
    if (!this.sessionMeta) return;
    const index: SessionIndex = {
      sessionId: this.sessionId,
      projectSlug: this.projectSlug,
      cwd: this.cwd,
      model: this.sessionMeta.model,
      role: this.sessionMeta.role,
      createdAt: this.sessionMeta.createdAt,
      updatedAt: new Date().toISOString(),
      messageCount: this.messageCount,
    };
    try {
      writeFileSync(this.indexPath, JSON.stringify(index, null, 2), "utf8");
    } catch {
      // 索引写入失败不影响主流程
    }
  }
}
