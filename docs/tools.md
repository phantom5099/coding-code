# 工具系统

Coding Code 的工具系统是 Agent 与外部世界交互的核心机制。本文档介绍内置工具、加载机制、自定义工具开发和沙箱隔离。

---

## 内置工具

### 文件操作 (fs)
| 工具 | 功能 |
|---|---|
| `read_file` | 读取文件，支持 offset/limit 行号控制 |
| `write_file` | 写入/创建文件 |
| `edit_file` | 编辑文件中的特定代码段 |
| `glob_files` | 模式匹配查找文件 |
| `search_code` | 正则搜索项目代码 |

### 命令执行
| 工具 | 功能 |
|---|---|
| `execute_command` | 执行 shell 命令（带沙箱过滤和超时） |

### 网络
| 工具 | 功能 |
|---|---|
| `fetch_url` | HTTP GET 请求（带超时） |
| `search_web` | Web 搜索（需配置） |

### 代理状态
| 工具 | 功能 |
|---|---|
| `read_todo` | 读取代理的任务列表 |
| `write_todo` | 修改代理的任务列表 |
| `tool_search` | 发现和加载可用工具 |

### 子智能体
| 工具 | 功能 |
|---|---|
| `delegate_to_subagent` | 将任务委派给子智能体 |

## 工具加载机制

- **Core 工具**：始终可用，在启动时注册
- **Deferred 工具**：按需加载，通过 `tool_search` 发现后动态加载
- **MCP 工具**：从 MCP 服务自动导入和注册

## 自定义工具

工具通过 `ToolService` 注册，每个工具实现 `ToolDefinition` 接口：

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: ZodSchema | Record<string, unknown>;
  jsonSchema?: Record<string, unknown>;
  deferred?: boolean;
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
}
```

在 `cli.ts` 中向 `ToolService` 注册新工具，Agent 会自动将其暴露给 LLM。

## 沙箱隔离

所有工具执行经过两层安全保护：

**审批流水线**（始终生效）：六层决策链——规则引擎（硬 deny）→ 只读白名单 → 权限模式 → 钩子策略 → 用户确认 → 审计日志。开箱即用，无需额外安装。

**OS 级沙箱**（可选）：需要安装 `@anthropic-ai/sandbox-runtime`，提供文件系统隔离、网络隔离、防绕过等能力。
