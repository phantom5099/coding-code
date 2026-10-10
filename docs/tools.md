# 工具系统

Coding Code 的工具系统是 Agent 与外部世界交互的核心机制。本文档介绍内置工具、加载机制、自定义工具开发和审批流水线。

---

## 内置工具

### 文件操作 (fs)

| 工具 | 功能 | 关键参数 |
|---|---|---|
| `read_file` | 读取文件内容 | `path: string`（文件路径），`offset: number`（起始行，默认 1），`limit: number`（行数，默认 200，最大 500） |
| `write_file` | 写入/创建文件 | `path: string`，`content: string` |
| `edit_file` | 编辑文件中的特定代码段 | `path: string`，`old_string: string`（被替换的文本，至少 1 字符），`new_string: string`（替换后的文本） |
| `search_code` | 正则搜索项目代码 | `pattern: string`（正则表达式），`glob: string`（文件匹配模式，默认 `**/*`），`max_results: number`（默认 30，最大 100） |
| `search_files` | 模式匹配查找文件 | `pattern: string`（glob 模式），`path: string`（搜索目录，默认 `.`），`max_results: number`（默认 50，最大 500） |

### 命令执行

| 工具 | 功能 | 关键参数 |
|---|---|---|
| `execute_command` | 执行 shell 命令 | `command: string`，`cwd: string`（可选，工作目录），`timeout_ms: number`（超时毫秒，默认 30000） |

### 网络

| 工具 | 功能 | 关键参数 |
|---|---|---|
| `fetch_url` | HTTP GET 请求 | `url: string`（合法 URL），`max_length: number`（最大响应长度，默认 100000，最大 500000） |
| `web_search` | Web 搜索 | `query: string`，`max_results: number`（默认 8，最大 20） |

### 代理状态

| 工具 | 功能 | 关键参数 |
|---|---|---|
| `todo_write` | 修改代理的任务列表 | `plan: Array<{ step: string, status: 'pending' \| 'in_progress' \| 'completed' }>`（最大条目数有限制） |

### 子智能体

| 工具 | 功能 | 关键参数 |
|---|---|---|
| `spawn_agent` | 启动一个后台子智能体并立即返回其会话 id，结果完成后自动注入本会话 | `agentName: string`, `prompt: string`, `model?: string`, `systemPrompt?: string` |
| `wait_agent` | 等待子智能体到达终态，返回 `completed` / `failed` / `timeout` | `sessionId: string`, `timeoutMs?: number`（夹在 `[10000, 3600000]`，默认 `30000`） |

---

## 工具加载机制

工具按加载时机分为两类：

- **Core 工具**：始终可用，在启动时注册。包括上述所有内置工具。
- **MCP 工具**：从 MCP 服务自动导入和注册。名称空间化为 `serverName:toolName` 格式，避免不同服务间的工具名冲突。

Agent 在一次运行开始时按 profile 组装工具目录：`approval/tool-policy.ts` 的 `getToolNames(profile)` 返回该 profile 的工具名单，`build` 为 `BUILD_TOOL_NAMES`，`plan` 为 `PLAN_TOOL_NAMES`（`read_file` / `search_files` / `search_code` / `fetch_url` / `submit_plan`）。随后注册项目 MCP 工具。

---

## 自定义工具

工具通过 `ToolService` 注册，每个工具实现 `ToolDefinition` 接口：

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;         // Zod schema 定义参数
  execute: (args: unknown, ctx?: ToolExecCtx) => Effect.Effect<string, AgentError, never>;
}

interface ToolExecCtx {
  signal?: AbortSignal;    // 取消信号
  sessionId?: string;      // 当前会话 ID
  turnId?: number;         // 当前轮次
  projectPath?: string;    // 项目路径
}
```

`execute` 保留在 `ToolDefinition` 中，因为执行器需要通过同一个定义完成参数校验、审批、取消和 hook，再调用工具的实际实现。`ToolExecCtx` 中，`signal` 用于取消；`sessionId` 用于会话级工具状态和子智能体关联，`projectPath` 用于限定工作目录，`turnId` 只用于执行 hook 的轮次追踪。

在 `cli.ts` 中向 `ToolService` 注册新工具，Agent 会自动将其暴露给 LLM。

### 工具可见性策略

工具可见性由 profile 工具名单控制。`getToolNames(profile)` 给出名单，`ToolRegistry.describe(allowedTools?)` / `get(name, allowedTools?)` 按该名单过滤。名单定义在 `approval/tool-policy.ts`：

```typescript
export const PLAN_TOOL_NAMES: readonly string[] = [
  'read_file', 'search_files', 'search_code', 'fetch_url', 'submit_plan',
];

export const BUILD_TOOL_NAMES: readonly string[] = [
  'read_file', 'write_file', 'edit_file', 'execute_command',
  'search_code', 'search_files', 'fetch_url', 'web_search',
  'todo_write', 'spawn_agent', 'wait_agent',
];
```

---

## 审批流水线

所有工具执行经过五层审批保护。

### 决策链（始终生效）

五层决策链，按顺序执行，任一层返回 deny/allow 即终止：

| 层级 | 名称 | 逻辑 |
|------|------|------|
| 1 | **RuleEngine** | 规则引擎匹配，支持 glob / regex 匹配工具名和参数，按优先级降序取首个命中 |
| 2 | **PermissionMode** | 权限模式驱动的自动放行：`bypass`（展示名「完全放行」）全部放行；`askBeforeExec`（展示名「执行前询问」）非破坏性工具放行，仅 `execute_command` 这类破坏性工具继续下一层。plan profile 在此层强制：`PLAN_ALLOWED_TOOLS` 内的工具放行，其余直接 deny（提示用 `submit_plan`） |
| 3 | **HookPreToolUse** | 钩子决策，可返回 allow/deny/ask/continue，支持 `modifiedInput` 修改参数 |
| 4 | **UserConfirmation** | 异步用户确认，支持 allow/deny/always/never 四种响应，always/never 会持久化为规则 |
| 5 | **AuditLog** | 每一层决策后记录审计日志，通过 `tool.approval.post` 钩子发出 |

### 权限规则

**当前没有内置默认规则**：`createRuleEngine()` 以空集合启动，规则只来自两条途径：

- 用户在确认弹窗里选择 `always` / `never` 时，由 `approval.ts` 的 `onAlways` / `onNever` 注册为持久规则（`addRule`）。
- 钩子（`tool.approval.pre`）返回 `ask` 无法直接落成规则，需经上面的用户确认流程。

规则支持三种动作与两种匹配：

| 字段 | 说明 |
|------|------|
| `action` | `deny` / `allow` / `ask` |
| `toolPattern` | 工具名的 glob 模式 |
| `argPattern` | 参数（字符串值拼接后）的 glob 模式 |
| `argRegex` | 参数的 regex 模式（与 `argPattern` 二选一） |
| `priority` | 数值大的先匹配 |

### 权限模式

```typescript
type PermissionMode = 'askBeforeExec' | 'bypass';
```

- `askBeforeExec`（展示名「执行前询问」）：非破坏性工具自动放行（涵盖只读工具与编辑类工具），破坏性工具（`execute_command`）仍需确认
- `bypass`（展示名「完全放行」）：全部放行，跳过所有审批（慎用）
