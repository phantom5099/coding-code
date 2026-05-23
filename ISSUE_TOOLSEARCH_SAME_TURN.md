# Issue: tool_search 不支持同轮回调

## 现状

当前 deferred tool 加载流程需要 **两轮** 才能使用：

```
Turn N:   模型看到 <available-deferred-tools> 列表，调用 tool_search
Turn N+1: buildToolsForAgent 把已加载的 deferred tool schema 注入 tools 列表，模型才能调用
```

这导致一次多余的往返，对于 todo_write/todo_read 这类高频工具，用户体验有损。

## 根因

`buildToolsForAgent` 只在每轮开始时构建 tools 列表。`tool_search` 在当前轮执行后只返回文本结果（"Loaded N tool(s)..."），不会触发 tools 列表的重新构建。模型必须等到下一轮 `streamStep` 开始时才能看到新的 schema。

## 改进方向

1. **同轮注入**：`tool_search` 的返回结果中附带匹配到的工具的完整 JSON schema（用 `z.toJSONSchema` 序列化），模型在同一轮就能看到 schema 并直接调用。
2. **缓存 tool_search 响应中的 schema**：扩展 `tool_search` 的 execute 逻辑，在返回结果中列出匹配工具的名称、描述、和 JSON schema。模型侧只需一次 `tool_search` 调用即可在同轮使用所有匹配到的 deferred 工具。

## 影响范围

- `src/agent-state/tool-search/service.ts` — search 方法需返回完整 ToolDefinition 而非仅 name + shortDescription
- `src/agent-state/tool-search/tool.ts` — tool_search 的 execute 输出需附带 JSON schema
- `src/agent/build-tools.ts` — 可能不再需要，或被简化
- `src/agent/agent.ts` — 如果在同轮就能处理，可能不涉及改动

## 优先级

中等。当前两轮模式功能正确，但体验可优化。建议在 web UI 开发前解决。
