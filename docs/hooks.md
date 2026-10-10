# 钩子系统

Coding Code 提供可插拔的钩子点，用户可以在关键节点注入自定义逻辑。本文档介绍所有钩子点、回调签名、触发 API 和用户钩子配置。

---

## 钩子点

共 12 个。**表里列出的每个点在生产代码里都有真实触发点**；`type` 列是该点有意义的钩子类型（用户配置里写错类型不会报错，但决策不会被消费）。

### 工具执行

| 钩子点 | 触发时机 | type |
|--------|---------|------|
| `tool.execute.before` | 工具执行前（已通过审批） | observer |
| `tool.execute.after` | 工具执行成功后 | observer |
| `tool.execute.error` | 工具执行失败后 | observer |
| `tool.approval.pre` | 审批决策前（第 3 层） | **decision** |
| `tool.approval.post` | 审批决策后（审计，含 `decision` 与 `layers`） | observer |

工具被拒绝时不触发 `tool.execute.*`（工具没被执行），拒绝结果从 `tool.approval.post` 的 `decision.type === 'deny'` 读取。

### Agent 生命周期

| 钩子点 | 触发时机 | type |
|--------|---------|------|
| `agent.turn.start` | 轮次开始 | observer |
| `agent.step.before` | 每个推理步骤前 | **decision**（返回值当前未被消费） |
| `agent.turn.stop` | 本轮无工具调用、准备停止时裁决 | **decision** |
| `agent.turn.end` | 轮次最终结束（`status`: done/error/aborted/maxSteps） | observer |

### 子智能体

| 钩子点 | 触发时机 | type |
|--------|---------|------|
| `agent.subagent.spawn.before` | 子智能体创建前 | **decision**（可 deny） |
| `agent.subagent.spawn.after` | 子智能体创建后 | observer |
| `agent.subagent.complete` | 子智能体完成时 | observer |

---

## 回调签名

钩子以子进程形式运行，payload 是一份 JSON，所以签名只描述数据的形状：

```typescript
type ObserverHandler = (payload: Record<string, unknown>) => Effect.Effect<void, never, any>;

type DecisionHandler = (
  payload: Record<string, unknown>
) => HookDecision | null | Promise<HookDecision | null>;

interface HookDecision {
  decision?: 'allow' | 'deny' | 'ask' | 'continue';
  reason?: string;
  injection?: string;                       // 注入到 LLM 上下文的文本
  modifiedInput?: Record<string, unknown>;  // 修改工具调用参数
}
```

Decision 钩子的返回语义：

- `allow`：直接放行，跳过后续审批层
- `deny`：拒绝，附带 `reason`
- `ask`：要求用户确认
- `continue`：在 `tool.approval.pre` 上表示「不干预，继续到下一层」
- `null`：不干预（多个 decision 钩子按 priority 升序取**首个非 null**）

**每个 payload 都带 `projectPath`** —— 它是钩子作用域的定位键（见下），也是 hook 脚本判断「我在哪个项目里跑」的依据。

---

## 触发 API

`HookService` 是 Effect Service，只有三个方法：

| 方法 | 说明 |
|------|------|
| `emit(point, payload)` | 触发该点上所有 **observer** 钩子；单个钩子抛错只记日志，不带垮整轮 |
| `emitDecision(point, payload)` | 触发该点上所有 **decision** 钩子，按 priority 升序取首个非 null |
| `reloadUserHooks(projectPath)` | 重新解析该项目的 YAML 配置并重建注册表 |

没有代码级注册 API：钩子只有 YAML 一个来源。运行时**每次 `emit` 都用 payload 里的 `projectPath` 查注册表**，查不到就是空表（no-op）。

### 作用域

钩子按层解析，**字段级合并**：

1. **project** — `.codingcode/hooks.yaml`
2. **global** — `~/.codingcode/hooks.yaml`

两层都用 `name` 对齐。项目层只覆盖它**显式声明**的字段，其余字段继承全局。所以「在项目里关掉一个只在全局定义的钩子」只需写一条最小补丁：

```yaml
hooks:
  - name: log-llm-calls
    enabled: false
```

同一层内按 `priority` **升序**执行，**数值小的先跑**。

---

## 用户钩子配置

### 配置文件位置

| 级别 | 路径 |
|------|------|
| 全局 | `~/.codingcode/hooks.yaml` |
| 项目 | `.codingcode/hooks.yaml` |

### 配置格式

```yaml
hooks:
  - name: audit-log
    description: 记录每次审批结果
    point: tool.approval.post
    type: observer
    command: node
    args: ["./scripts/audit.js"]
    priority: 10

  - name: block-dangerous-commands
    description: 阻止危险命令
    point: tool.approval.pre
    type: decision
    command: node
    args: ["./scripts/check-command.js"]
    env:
      BLOCKED_COMMANDS: "rm,rmdir,format"
    priority: 100
```

### UserHookConfig 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 钩子名称，跨层对齐与开关都靠它 |
| `description` | `string` | 否 | 描述 |
| `point` | `HookPoint` | 是 | 钩子点名称（上表 12 个之一） |
| `type` | `'observer' \| 'decision'` | 是 | 决定是否读 stdout |
| `command` | `string` | 是 | 可执行文件 |
| `args` | `string[]` | 否 | 命令参数 |
| `env` | `Record<string, string>` | 否 | 追加到 `process.env` 之上 |
| `priority` | `number` | 否 | 升序执行，默认 0 |
| `enabled` | `boolean` | 否 | **缺省（不写）等于启用**；`false` 表示禁用 |

### 执行机制

- payload 以 JSON 写入子进程 stdin，随后关闭 stdin
- `type: decision` 时读 stdout 并 `JSON.parse`；退出码非 0、超时（30 秒）、解析失败一律降级为 `null`
- `type: observer` 忽略 stdout 与退出码，只保证跑完
- `command` / `args` / `env` 里的 `${VAR}` 目前**不做展开**（`mcp.yaml` 会展开，两者不一致）

---

## 使用示例

### 记录每次工具调用的耗时

```yaml
hooks:
  - name: slow-tool-alert
    point: tool.execute.after
    type: observer
    command: node
    args: ["./scripts/slow.js"]
```

```javascript
// scripts/slow.js
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  const { toolName, durationMs, projectPath } = JSON.parse(raw);
  if (durationMs > 5000) console.error(`[slow] ${toolName} took ${durationMs}ms in ${projectPath}`);
});
```

### 拦截危险命令

```yaml
hooks:
  - name: block-rm-rf
    point: tool.approval.pre
    type: decision
    command: node
    args: ["./scripts/check-command.js"]
```

```javascript
// scripts/check-command.js
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  const { toolName, args } = JSON.parse(raw);
  if (toolName === 'execute_command' && String(args?.command ?? '').includes('rm -rf')) {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: '禁止递归强制删除' }));
  }
  // 否则什么都不输出 ⇒ 视为 null，不干预
});
```

### 让 Agent 继续跑

`agent.turn.stop` 返回 `continue` 且带 `injection` 时，`injection` 会作为 system 消息写入会话并续行（受 `maxStopContinuations` 限制，默认 2）：

```javascript
process.stdout.write(JSON.stringify({ decision: 'continue', injection: '还没跑测试，继续。' }));
```
