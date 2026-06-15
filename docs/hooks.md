# 钩子系统

Coding Code 提供 8 个可插拔钩子点，用户可以在关键节点注入自定义逻辑。本文档介绍所有钩子点和使用示例。

---

## 钩子点

| 钩子点 | 触发时机 |
|---|---|
| `tool.execute.before` | 工具执行前 |
| `tool.execute.after` | 工具执行成功后 |
| `tool.execute.error` | 工具执行失败后 |
| `llm.request.before` | LLM 调用前 |
| `llm.response.after` | LLM 响应成功后 |
| `llm.response.error` | LLM 调用失败后 |
| `session.save.before` | 会话保存前 |
| `session.save.after` | 会话保存后 |

## 使用示例

```typescript
hookRegistry.on('llm.request.before', async (messages) => {
  const estimatedTokens = JSON.stringify(messages).length / 4;
  console.log(`[Hook] 即将调用 LLM，预估 ${Math.round(estimatedTokens)} tokens`);
});
```
