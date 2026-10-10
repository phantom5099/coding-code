# 子智能体

子智能体是独立运行的 ReAct 会话：父智能体通过 `spawn_agent` 派生一个子会话，子会话在自己的回合里跑完整套循环，完成后把结果回注到父会话。本文档介绍派发模型、帧流消费、结果回注（Mailbox）、并发控制与生命周期。

---

## 设计取向

参数由**父智能体在调用 `spawn_agent` 时决定**：

| 参数 | 说明 |
|------|------|
| `agentName` | 子智能体短名，用于标识与展示 |
| `prompt` | 任务描述 |
| `model` | 可选。仅在用户明确要求某个模型时设置，省略则继承父回合模型 |
| `systemPrompt` | 可选。替换子智能体 system prompt 的中间段，环境块与系统说明保留 |

工具可见性由 profile 策略决定：子会话沿用父回合的 `activeProfile`，因此 plan profile 的子会话同样受 `PLAN_ALLOWED_TOOLS` 限制；子代理调用点固定 `bypass` 权限模式，不继承父会话的审批链路。

---

## 委派模型

```
父回合 step N
  └─ spawn_agent(agentName, prompt, [model], [systemPrompt])
       ├─ hook: agent.subagent.spawn.before   （decision，可否决）
       ├─ 并发闸检查：runningChildren(parent) < subagent.maxBackground
       ├─ SubagentRunner.runSubagent(...)  → 创建子会话，agent.runTurn 启动子回合
       ├─ hook: agent.subagent.spawn.after
       ├─ emit subagent_event(spawned) → 父会话出站队列
       └─ forkDaemon(drainRun)   后台消费子帧流，立即返回 { sessionId, agentName }
```

要点：

- **立即返回**：`spawn_agent` 返回子会话 id 和名字，父智能体可以继续自己的工作，不必等待。
- **后台消费**：`SubagentRunRegistry.spawn` 用 `Effect.forkDaemon` 起一个后台 fiber 消费子会话的帧流；父回合本身不阻塞。
- **hook 可否决**：`agent.subagent.spawn.before` 是 decision 点，返回 `deny` 会让 spawn 失败并附 `reason`（工具层抛 `TOOL_NOT_ALLOWED`）。

---

## 帧流消费

子会话对父会话而言就是一条帧流。后台 fiber 的 `consume` 只做两件事：

1. 累加 `text_delta` 帧的文本，得到子智能体的最终输出；
2. 遇到 `isTurnEnd`（`transition.to === 'end'`）时取终态。

终态归一到父会话可消费的形状：

| 子会话终态 | 处理 |
|-----------|------|
| `done` | 采用累加的文本；空输出记为 `(subagent completed without output)` |
| `error` | 取 `end.error.message` |
| `maxSteps` | 归一成 error 帧，message 为固定文案 |
| `aborted` | 归一成 error 帧，message 为固定文案 |
| 流结束但无终态帧 | 归一成 error 帧 |

非 `done` 的终态统一经由 `failedEnd()` 变成一条 `reason: 'error'` 的 end 帧，保证父会话始终拿到形状一致的终态。

---

## 结果回注与 Mailbox

子智能体结果**不通过回调透传**，而是走**会话级 Mailbox**（`session/mailbox.ts`）：

- Mailbox 是一个全局单例的易失入站队列，按收件人 `sessionId` 分区；子代理终态进的是**父会话**的队列（嵌套委派下 B 的终态进 `mailbox[A]`）。
- `SubagentRunRegistry.drainRun` 消费完子帧流后，把结果渲染成一条 `subagent_result` 条目 `offer` 给父会话。
- 条目内容 `renderResult()` 组装为：

```
Message Type: FINAL_ANSWER
Task name: {父会话 id}
Sender: {子会话 id}
Payload:
{子智能体输出}
```

`Payload` 部分按 token 预算（900 tokens）二分收敛截断，超出时追加 `…[truncated]`。

### 渲染与终态来源

- **终态由子会话自己写**：子回合的 `finish` 通过 `turn.transition` 落终态；父侧只负责派发与投递。
- **投递信号**：`drainRun` 回注 mailbox 后调用 `turn.markDelivered(childSessionId)`，用于唤醒 `wait_agent`。

---

## 父回合如何吸收结果

父回合在**每个 step 的边界**统一 drain，避免打断流式推理：

```
每个 step:
  1. absorbPendingInputs()          // steer 输入先吸收
  2. if step > 0: mailbox.drain()   // 子代理结果后吸收
  3. 调 LLM、执行工具
```

顺序上 steer（用户中途输入）优先于子代理汇报，避免"用户指令"排在"子代理汇报"之后。每条 mailbox 条目都经 `session.recordSubagentResult` 落盘为 `subagent_result` 事件，再 `context.absorb` 进入上下文。首轮（`step === 0`）不 drain mailbox——此时子代理刚派发，尚无结果。

---

## wait_agent

`wait_agent` 等待子智能体到达终态：

| 参数 | 说明 |
|------|------|
| `sessionId` | `spawn_agent` 返回的子会话 id |
| `timeoutMs` | 可选。夹在 `[10000, 3600000]`，默认 `30000` |

返回 `completed` / `failed` / `timeout`：

- `completed`：子会话 `state === 'complete'`
- `failed`：其余终态（error / maxSteps / aborted）
- `timeout`：超时

语义要点：

- **不要在不需要结果时等待**：子智能体最终输出会自动追加到父会话，`wait_agent` 不用于取文本。
- **只在结果阻塞下一步时等**：且给一个宽松的超时，不要用短超时轮询。
- **等待到"已投递"为止**：委派记录的 wait 会先等终态（`ended`），再等结果进入父会话 mailbox（`delivered`），所以返回 `completed` 时结果已可被父回合 drain 到。

---

## 并发与停止

| 机制 | 说明 |
|------|------|
| 并发闸 | `spawn` 前检查 `turn.runningChildren(parentSessionId) >= subagent.maxBackground`（默认 4），超限报 `Concurrent subagent limit reached` |
| 停止句柄 | 子回合启动后经 `turn.arm(childSessionId, stop)` 登记中断句柄（runTurn 内部 `Fiber.interrupt`） |
| 级联停止 | `stopChildren(parentSessionId)` 停掉该父会话下所有仍在运行的派生子会话；HTTP 路由 `POST /api/sessions/:id/subagents/stop` |
| 终结清理 | `SubagentRunRegistry` 的 layer finalizer 对本层派发过的父会话请求 `stopChildren` |

---

## 钩子点

| 钩子点 | 触发时机 | 类型 |
|--------|---------|------|
| `agent.subagent.spawn.before` | 子智能体创建前 | decision（可 deny） |
| `agent.subagent.spawn.after` | 子智能体创建后 | observer |
| `agent.subagent.complete` | 子智能体终态投递后 | observer |

---

## 状态与 Mailbox 的关系

完整的状态轴、原因轴与生命周期见 [→ turn.md](turn.md)。子智能体相关的状态要点：

- 派生关系（`parentSessionId`、`agentName`）随 `TurnClaim` 登记进回合记录，`runningChildren` / `stopChildren` 按它过滤。
- 子会话终态条目在父会话 settle 时被回收（父会话结束时删除所有非 running 的派生子条目）。
