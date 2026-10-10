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
| `enabled` | `boolean` | `true` | 开关；`false` 表示禁用，缺省等同启用 |
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

MCP 连接按**项目**隔离，由 `syncConnections(projectPath)` 在每个回合开始时对齐：

- 每个项目持有自己的一份 `client` 映射（`projectPath → serverName → client`）。
- `syncConnections` 对比配置与现有连接：新增的配置项建立连接，已移除的配置项断开并清理，连接的服务器按配置的 `enabled` 过滤（`enabled: false` 不连接）。
- 服务器连接失败只记日志，不影响回合继续。
- `autoReconnect: true` 时，断线后自动重连；`concurrency` 控制对该服务器的最大并发工具调用数（`TSemaphore`，默认 3）。
- 工具是否可见还受该服务器当前是否被禁用约束（`isDisabledFn` 在调用时实时判断）。

---

## 子智能体

子智能体不再通过 profile 文件配置 MCP 服务或工具白名单。MCP 工具由当前项目的 MCP 配置提供；`plan` 模式仅由其独立工具策略限制。
