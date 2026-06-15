# 子智能体系统

每个子 Agent 是独立的 ReAct 引擎实例，拥有受限的工具集和独立的上下文。本文档介绍子 Agent 的特性、配置格式、内置 profile 和执行流程。

---

## 特性

- **独立执行**：子 Agent 在独立的 Effect Context 中运行
- **受限工具集**：每个子 Agent profile 定义自己的工具白名单
- **独立上下文**：不共享主 Agent 的消息历史
- **独立模型**：可指定与主 Agent 不同的模型
- **独立 MCP**：可连接指定的 MCP 服务器
- **独立钩子**：可附加专属的钩子配置
- **自由定义**：用户可配置任意数量的子 Agent profile

---

## AgentProfile 类型定义

```typescript
interface AgentProfile {
  name: string;              // profile 名称，用于 dispatch_agent 引用
  description: string;       // 功能描述，LLM 据此决定是否委派
  systemPrompt?: string;     // 自定义系统提示词
  tools?: string[];          // 允许使用的工具白名单
  mcpServers?: string[];     // 允许连接的 MCP 服务白名单
  readonly?: boolean;        // 是否只读模式
  maxSteps?: number;         // 最大执行步数
  model?: string;            // 使用的模型 ID
  hooks?: UserHookConfig[];  // 专属钩子配置
  disabled?: boolean;        // 是否禁用
}
```

---

## 配置格式

子 Agent 使用 Markdown + frontmatter 格式配置，存放在 `.codingcode/agents/` 目录下：

| 级别 | 路径 | 说明 |
|------|------|------|
| 全局 | `~/.codingcode/agents/*.md` | 所有项目共享 |
| 项目 | `.codingcode/agents/*.md` | 仅当前项目生效 |

项目级同名 profile 覆盖全局级。

### 示例

```markdown
---
name: code-searcher
description: 专门搜索代码库的子 Agent，擅长定位函数定义和引用
tools: ["read_file", "search_code", "search_files"]
readonly: true
maxSteps: 100
model: deepseek-chat
disabled: false
---
You are a code search specialist. Your job is to find specific code patterns, function definitions, and usages in the codebase. Always provide the file path and line numbers in your results.
```

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | `string` | 必填 | profile 名称 |
| `description` | `string` | 必填 | 功能描述，LLM 据此决定是否委派任务 |
| `systemPrompt` | `string` | frontmatter 之后的正文 | 系统提示词 |
| `tools` | `string[]` | 所有内置工具 | 允许使用的工具白名单 |
| `mcpServers` | `string[]` | 无 | 允许连接的 MCP 服务名列表 |
| `readonly` | `boolean` | `false` | 只读模式下只允许只读工具 |
| `maxSteps` | `number` | 继承主 Agent | 最大执行步数 |
| `model` | `string` | 继承主 Agent | 使用的模型 ID |
| `hooks` | `UserHookConfig[]` | 无 | 专属钩子配置 |
| `disabled` | `boolean` | `false` | 禁用此 profile |

---

## 内置 Profile

系统内置两个子 Agent profile：

### explore

只读代码探索 Agent，用于快速浏览和理解代码库：

```yaml
name: explore
description: 只读代码探索
tools: [read_file, search_files, search_code, fetch_url, tool_search]
readonly: true
maxSteps: 180
```

### plan

只读代码研究 + 规划 Agent，可执行命令来验证环境：

```yaml
name: plan
description: 只读代码研究和规划
tools: [read_file, search_files, search_code, execute_command, fetch_url, tool_search]
readonly: true
maxSteps: 180
```

---

## 执行流程

主 Agent 通过 `dispatch_agent` 工具委派任务，完整执行流程如下：

1. **检查开关**：验证全局子智能体开关是否启用 (`resolveSubagentEnabled`)
2. **解析 profile**：查找对应的 AgentProfile (`runtime.resolveSubagentProfile`)
3. **检查禁用**：验证该 profile 是否被禁用 (`resolveAgentDisabled`)
4. **创建 LLM**：如果 profile 指定了 model，创建对应的 LLM 客户端
5. **钩子决策**：触发 `agent.subagent.spawn.before` 决策钩子（可 deny 阻止）
6. **创建子会话**：嵌套在父会话下，设置 `parentSessionId`
7. **Fork 审批**：如果非 readonly，fork 审批服务
8. **附加钩子**：附加 profile 中定义的 hooks
9. **连接 MCP**：连接 profile 中指定的 MCP 服务器（会话级 lease）
10. **构建工具策略**：根据 profile.tools 和 ToolVisibilityPolicy 过滤可用工具
11. **执行**：调用 `runner.runStream()` 执行子智能体
12. **钩子通知**：触发 `agent.subagent.spawn.after` 钩子
13. **收集输出**：提取事件流中的最终输出
14. **清理**：断开 MCP 连接，移除 hooks
15. **完成钩子**：触发 `agent.subagent.complete` 钩子

---

## 使用示例

### 通过 dispatch_agent 工具委派

```typescript
// Agent 自动调用
await agent.executeTool('dispatch_agent', {
  agent: 'explore',
  prompt: 'Find all usages of getUserById function'
});
```

### 自定义子 Agent

创建 `.codingcode/agents/security-auditor.md`：

```markdown
---
name: security-auditor
description: 安全审计 Agent，检查代码中的安全漏洞
tools: ["read_file", "search_code", "search_files"]
readonly: true
maxSteps: 50
model: deepseek-chat
---
You are a security audit specialist. Review code for common vulnerabilities:
- SQL injection
- XSS
- CSRF
- Path traversal
- Command injection
Report findings with severity level and remediation suggestions.
```

然后在对话中请求安全审计时，主 Agent 会自动委派给 `security-auditor`。
