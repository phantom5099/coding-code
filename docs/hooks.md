# 钩子系统

Coding Code 提供可插拔的钩子点，用户可以在关键节点注入自定义逻辑。本文档介绍所有钩子点、回调签名、注册 API 和用户钩子配置。

---

## 钩子点

### 工具执行

| 钩子点 | 触发时机 | 类型 |
|--------|---------|------|
| `tool.execute.before` | 工具执行前 | observer |
| `tool.execute.after` | 工具执行成功后 | observer |
| `tool.execute.error` | 工具执行失败后 | observer |
| `tool.execute.denied` | 工具被审批拒绝后 | observer |
| `tool.approval.pre` | 审批决策前 | decision |
| `tool.approval.post` | 审批决策后 | observer |

### LLM 调用

| 钩子点 | 触发时机 | 类型 |
|--------|---------|------|
| `llm.request.before` | LLM 调用前 | observer |
| `llm.response.after` | LLM 响应成功后 | observer |
| `llm.response.error` | LLM 调用失败后 | observer |

### 会话

| 钩子点 | 触发时机 | 类型 |
|--------|---------|------|
| `session.save.before` | 会话保存前 | observer |
| `session.save.after` | 会话保存后 | observer |

### Agent 生命周期

| 钩子点 | 触发时机 | 类型 |
|--------|---------|------|
| `agent.turn.start` | Agent 轮次开始 | observer |
| `agent.step.before` | Agent 步骤执行前 | observer |
| `agent.turn.stop` | Agent 轮次停止 | observer |
| `agent.turn.end` | Agent 轮次结束 | observer |

### 子智能体

| 钩子点 | 触发时机 | 类型 |
|--------|---------|------|
| `agent.subagent.spawn.before` | 子智能体创建前 | decision（可 deny） |
| `agent.subagent.spawn.after` | 子智能体创建后 | observer |
| `agent.subagent.complete` | 子智能体完成时 | observer |

---

## 回调函数签名

### Observer 钩子

```typescript
type ObserverHandler = (payload: Record<string, unknown>) => void | Promise<void>;
```

Observer 钩子只观察事件，不返回决策。适用于日志、监控、通知等场景。

### Decision 钩子

```typescript
type DecisionHandler = (payload: Record<string, unknown>) => HookDecision | null | Promise<HookDecision | null>;

interface HookDecision {
  decision?: 'allow' | 'deny' | 'ask' | 'continue';
  reason?: string;
  injection?: string;                    // 注入到 LLM 上下文的文本
  modifiedInput?: Record<string, unknown>;  // 修改工具调用参数
  modifiedOutput?: unknown;              // 修改工具输出
}
```

Decision 钩子可以返回决策，影响后续流程：

- `allow`：直接放行，跳过后续审批层
- `deny`：拒绝执行，附带 reason
- `ask`：要求用户确认
- `continue`：继续到下一层
- `null`：不干预，继续正常流程

---

## HookRegistry API

`HookService` 是 Effect.Service，提供以下方法：

### 注册钩子

```typescript
// 注册 observer 钩子，返回取消函数
const unsubscribe = hookService.register('tool.execute.after', async (payload) => {
  console.log(`工具 ${payload.toolName} 执行完成，耗时 ${payload.duration}ms`);
});

// 注册 decision 钩子，支持 priority
const unsub = hookService.registerDecision('tool.approval.pre', async (payload) => {
  if (payload.toolName === 'execute_command' && payload.args.command.includes('rm')) {
    return { decision: 'ask', reason: '删除命令需要确认' };
  }
  return null; // 不干预
}, { priority: 100 });
```

### 生命周期管理

| 方法 | 说明 |
|------|------|
| `register(point, handler, opts?)` | 注册 observer 钩子，返回取消函数 |
| `registerDecision(point, handler, opts?)` | 注册 decision 钩子，支持 priority |
| `emit(point, payload)` | 触发 observer 钩子 |
| `emitDecision(point, payload)` | 触发 decision 钩子，返回第一个非 null 决策 |
| `reloadUserHooks(projectPath)` | 重新加载项目级用户钩子配置 |
| `attachSessionHooks(sessionId, hooks)` | 附加会话级钩子 |
| `disableHook(projectPath, name)` | 禁用指定钩子 |
| `enableHook(projectPath, name)` | 启用指定钩子 |
| `disposeSession(sessionId)` | 清理会话级钩子 |
| `disposeProject(projectPath)` | 清理项目级钩子 |

### 钩子作用域

钩子按作用域分层，优先级从高到低：

1. **session** — 会话级，通过 `attachSessionHooks` 附加
2. **project** — 项目级，从 `.codingcode/hooks.yaml` 加载
3. **global** — 全局级，从 `~/.codingcode/hooks.yaml` 加载

同一作用域内按 `priority` 排序，数值越大优先级越高。

---

## 用户钩子配置

通过 YAML 文件配置钩子，无需编写代码：

### 配置文件位置

| 级别 | 路径 |
|------|------|
| 全局 | `~/.codingcode/hooks.yaml` |
| 项目 | `.codingcode/hooks.yaml` |

### 配置格式

```yaml
hooks:
  - name: log-llm-calls
    description: 记录所有 LLM 调用
    point: llm.request.before
    type: observer
    command: node
    args: ["./scripts/log-llm.js"]
    priority: 10
    enabled: true

  - name: block-dangerous-commands
    description: 阻止危险命令
    point: tool.approval.pre
    type: decision
    command: node
    args: ["./scripts/check-command.js"]
    env:
      BLOCKED_COMMANDS: "rm,rmdir,format"
    priority: 100
    enabled: true
```

### UserHookConfig 完整字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 钩子名称，用于 enable/disable |
| `description` | `string` | 否 | 钩子描述 |
| `point` | `HookPoint` | 是 | 钩子点名称 |
| `type` | `'observer' \| 'decision'` | 是 | 钩子类型 |
| `command` | `string` | 是 | 执行命令 |
| `args` | `string[]` | 否 | 命令参数 |
| `env` | `Record<string, string>` | 否 | 环境变量 |
| `priority` | `number` | 否 | 优先级，默认 0 |
| `enabled` | `boolean` | 是 | 是否启用 |

### 执行机制

用户钩子通过子进程执行：

- payload 通过 stdin 传入 JSON
- decision 钩子从 stdout 读取 JSON 响应（需符合 `HookDecision` 格式）
- 超时时间 30 秒
- 非零退出码视为错误，decision 钩子错误时返回 `continue`

---

## 使用示例

### 记录 LLM 调用 token 估算

```typescript
hookService.register('llm.request.before', async (payload) => {
  const messages = payload.messages as unknown[];
  const estimatedTokens = JSON.stringify(messages).length / 4;
  console.log(`[Hook] 即将调用 LLM，预估 ${Math.round(estimatedTokens)} tokens`);
});
```

### 拦截危险命令

```typescript
hookService.registerDecision('tool.approval.pre', async (payload) => {
  if (payload.toolName === 'execute_command') {
    const command = payload.args?.command as string;
    if (command?.includes('rm -rf')) {
      return { decision: 'deny', reason: '禁止递归强制删除' };
    }
  }
  return null;
});
```

### 修改工具参数

```typescript
hookService.registerDecision('tool.approval.pre', async (payload) => {
  if (payload.toolName === 'execute_command') {
    // 强制所有命令在项目目录下执行
    return {
      decision: 'continue',
      modifiedInput: { ...payload.args, cwd: '/safe/directory' }
    };
  }
  return null;
});
```
