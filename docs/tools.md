# 工具系统

Coding Code 的工具系统是 Agent 与外部世界交互的核心机制。本文档介绍内置工具、加载机制、自定义工具开发和沙箱隔离。

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
| `tool_search` | 发现和加载可用工具 | `query: string`（搜索关键词，至少 1 字符） |

### 子智能体

| 工具 | 功能 | 关键参数 |
|---|---|---|
| `dispatch_agent` | 将任务委派给子智能体 | `agent: string`（子智能体名称），`prompt: string`（任务描述，至少 1 字符） |

---

## 工具加载机制

工具按加载时机分为三类：

- **Core 工具**：始终可用，在启动时注册。包括上述所有内置工具。
- **Deferred 工具**：按需加载，通过 `tool_search` 发现后动态加载。这类工具标记了 `deferred: true`，不会在初始工具列表中暴露给 LLM，只有当 LLM 主动调用 `tool_search` 查询后才会加载。
- **MCP 工具**：从 MCP 服务自动导入和注册。名称空间化为 `serverName:toolName` 格式，避免不同服务间的工具名冲突。

工具解析流程：`createSessionToolResolver()` 合并 builtin + project MCP + tool_search + dispatch_agent，根据 `AgentProfile.tools` 和 `ToolVisibilityPolicy` 过滤后提供给 Agent。

---

## 自定义工具

工具通过 `ToolService` 注册，每个工具实现 `ToolDefinition` 接口：

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  shortDescription?: string;       // 简短描述，用于工具列表展示
  deferred?: boolean;               // 是否延迟加载
  parameters: z.ZodTypeAny;         // Zod schema 定义参数
  jsonSchema?: Record<string, unknown>;  // 可选的 JSON Schema 覆盖
  execute: (args: unknown, ctx?: ToolExecCtx) => Effect.Effect<string, AgentError, never>;
}

interface ToolExecCtx {
  signal?: AbortSignal;    // 取消信号
  sessionId?: string;      // 当前会话 ID
  turnId?: number;         // 当前轮次
  projectPath?: string;    // 项目路径
}
```

在 `cli.ts` 中向 `ToolService` 注册新工具，Agent 会自动将其暴露给 LLM。

### 工具可见性策略

通过 `ToolVisibilityPolicy` 控制工具的可见性：

```typescript
interface ToolVisibilityPolicy {
  allowedTools?: Set<string>;        // 允许的工具白名单
  allowedMcpServers?: Set<string>;   // 允许的 MCP 服务白名单
  allowToolSearch?: boolean;         // 是否允许 tool_search
  allowDeferredTools?: boolean;      // 是否允许延迟工具
}
```

---

## 沙箱隔离

所有工具执行经过两层安全保护：

### 审批流水线（始终生效）

六层决策链，按顺序执行，任一层返回 deny/allow 即终止：

| 层级 | 名称 | 逻辑 |
|------|------|------|
| 1 | **RuleEngine** | 规则引擎匹配，支持 glob 模式匹配工具名和参数，按优先级排序 |
| 2 | **ReadonlyWhitelist** | 只读工具自动放行（read_file, search_code, search_files, fetch_url, web_search, dispatch_agent, todo_write） |
| 3 | **PermissionMode** | 权限模式判断：`plan`（只允许只读）、`bypass`（全部放行）、`acceptEdits`（非破坏性工具放行）、`default`（继续下一层） |
| 4 | **HookPreToolUse** | 钩子决策，可返回 allow/deny/ask/continue，支持 `modifiedInput` 修改参数 |
| 5 | **UserConfirmation** | 异步用户确认，支持 allow/deny/always/never 四种响应，always/never 会持久化为规则 |
| 6 | **AuditLog** | 每一层决策后记录审计日志，通过 `tool.approval.post` 钩子发出 |

### 预设安全规则

系统内置 9 条默认规则（不可删除）：

| 规则 | 动作 | 说明 |
|------|------|------|
| `rm -rf /` | deny | 禁止递归删除根目录 |
| `sudo` | deny | 禁止提权执行 |
| `curl \| sh` | deny | 禁止管道执行远程脚本 |
| `chmod u+s` | deny | 禁止设置 SUID 位 |
| `shutdown` | deny | 禁止系统关机 |
| `/etc/shadow` | deny | 禁止读取影子密码文件 |
| `/etc/passwd` | deny | 禁止读取系统密码文件 |
| `.ssh` | ask | 访问 SSH 目录需确认 |
| `.env` | ask | 访问环境变量文件需确认 |

### 权限模式

```typescript
type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypass';
```

- `default`：逐层审批，危险操作需用户确认
- `acceptEdits`：非破坏性工具自动放行，减少确认弹窗
- `plan`：只允许只读工具，适合纯分析场景
- `bypass`：全部放行，跳过所有审批（慎用）

### OS 级沙箱（预留）

`packages/codingcode/src/sandbox/` 目前是 stub 实现（`SandboxService` 为空类），尚未集成实际的沙箱运行时。审批流水线已提供基本安全保障，OS 级沙箱将在未来版本中实现。
