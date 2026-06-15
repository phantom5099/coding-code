# 子智能体系统

每个子 Agent 是独立的 ReAct 引擎实例，拥有受限的工具集和独立的上下文。本文档介绍子 Agent 的特性、模板定义和使用方法。

---

## 特性

- **独立执行**: 子 Agent 在独立的 Effect Context 中运行
- **受限工具集**: 每个子 Agent 模板定义自己的工具白名单
- **独立上下文**: 不共享主 Agent 的消息历史
- **自由定义**: 用户可配置任意数量的子 Agent 模板

## 子 Agent 模板

在 `subagents.json` 中定义（或在代码中注册）：

```typescript
{
  name: "code-searcher",
  description: "专门搜索代码库的子 Agent",
  tools: ["search_code", "read_file"],
  systemPrompt: "You are a code search specialist...",
  maxSteps: 10,
  timeoutMs: 60000
}
```

## 使用

主 Agent 通过 `delegate_to_subagent` 工具委派任务：

```typescript
// Agent 调用
await agent.executeTool('delegate_to_subagent', {
  subagent: 'code-searcher',
  task: 'Find all usages of getUserById function'
});
```
