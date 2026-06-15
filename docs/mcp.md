# MCP 集成

Coding Code 集成 Model Context Protocol，允许通过外部服务扩展工具能力。本文档介绍 MCP 服务配置、传输类型和自动集成流程。

---

## 配置 MCP 服务

MCP 配置文件使用 YAML 格式，支持项目级和全局级两个层级：

| 级别 | 路径 | 说明 |
|------|------|------|
| 全局 | `~/.codingcode/mcp.yaml` | 所有项目共享 |
| 项目 | `.codingcode/mcp.yaml` | 仅当前项目生效 |

项目级配置与全局级合并时，同名服务器以项目级为准。环境变量支持 `${VAR_NAME}` 插值。

### 配置格式

```yaml
servers:
  - name: custom-tools
    command: node
    args: ["./server.js"]
    env:
      API_KEY: ${MY_API_KEY}
    concurrency: 3
    autoReconnect: true

  - name: remote-api
    url: https://mcp.example.com/api
    headers:
      Authorization: "Bearer ${MCP_TOKEN}"
    concurrency: 5
```

### McpServerConfig 完整字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | `string` | 必填 | 服务器名称，用于工具命名空间化和白名单引用 |
| `command` | `string` | - | stdio 传输：可执行命令 |
| `args` | `string[]` | - | stdio 传输：命令参数 |
| `env` | `Record<string, string>` | - | stdio 传输：环境变量，支持 `${VAR}` 插值 |
| `url` | `string` | - | HTTP 传输：服务器 URL |
| `headers` | `Record<string, string>` | - | HTTP 传输：请求头 |
| `concurrency` | `number` | `3` | 最大并发工具调用数 |
| `autoReconnect` | `boolean` | `true` | 断线自动重连 |

---

## 传输类型

### stdio 传输

通过子进程与 MCP 服务器通信，需要指定 `command` 和 `args`：

```yaml
servers:
  - name: filesystem
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
```

### HTTP 传输 (StreamableHTTP)

通过 HTTP 与远程 MCP 服务器通信，需要指定 `url`：

```yaml
servers:
  - name: remote-tools
    url: https://mcp.example.com/api
    headers:
      Authorization: "Bearer ${MCP_TOKEN}"
```

传输类型自动判断：有 `command` 则为 stdio，否则为 HTTP。

---

## 自动集成

启动时，Coding Code 会：

1. 合并全局 + 项目配置（项目覆盖同名全局）
2. 连接所有配置的 MCP 服务
3. 调用各服务的 `listTools()` 获取工具列表
4. 每个工具通过 `mcpToolToDefinition()` 转换为 `ToolDefinition`，名称空间化为 `serverName:toolName`
5. Agent 可直接调用，无需额外配置

### 连接生命周期

MCP 连接使用 lease 机制管理会话级生命周期：

- 每个会话通过 `addLease` 建立与 MCP 服务器的关联
- 会话结束时通过 `removeLease` 释放关联
- 当某个服务器没有任何活跃 lease 时，自动断开连接
- `autoReconnect: true` 时，断线后自动重连

---

## MCP 工具白名单

在子智能体 profile 中通过 `mcpServers` 字段指定允许的 MCP 服务：

```yaml
# .codingcode/agents/my-agent.md
---
name: my-agent
description: 使用特定 MCP 服务的 Agent
tools: ["read_file", "search_code"]
mcpServers: ["filesystem"]     # 只允许使用 filesystem 服务的工具
---
```

在 `ToolVisibilityPolicy` 中通过 `allowedMcpServers` 控制可见的 MCP 服务。
