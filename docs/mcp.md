# MCP 集成

Coding Code 集成 Model Context Protocol，允许通过外部服务扩展工具能力。本文档介绍 MCP 服务配置和自动集成流程。

---

## 配置 MCP 服务

在项目根目录创建 `mcp.json`：

```json
{
  "mcpServers": [
    {
      "name": "custom-tools",
      "command": "node",
      "args": ["./server.js"],
      "type": "stdio"
    }
  ]
}
```

## 自动集成

启动时，Coding Code 会：
1. 连接所有配置的 MCP 服务
2. 列出各服务提供的工具
3. 自动注册为 Tool Definition
4. Agent 可直接调用，无需额外配置

## MCP 工具白名单

在角色配置中指定工具白名单时，MCP 工具遵循同样规则。
