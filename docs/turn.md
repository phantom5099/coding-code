# 回合状态机

回合（turn）是"一个会话正在进行的一次执行"，由独立的状态登记表统一管理。本文档介绍状态轴与原因轴、转移集、生命周期 API，以及相位帧的投递方式。

---

## 设计取向

状态登记表不属于 Agent 循环本身，它要回答四类问题：

- **判活**：HTTP 提交同一会话的并发请求时，需要一个权威地方回答"这个会话现在是否正在跑"。
- **可停**：用户点停止、父会话结束、会话删除时，要能一次性停掉还在跑的回合与它派生的子会话。
- **可等**：`wait_agent` 要知道子会话何时到达终态。
- **可观测**：客户端要知道回合走到哪个相位（开始 / 执行中 / 压缩 / 结束）。

因此它落在 `turn/registry.ts`，Agent 只依赖 `turn/port.ts` 的契约。

---

## 状态轴与原因轴

状态被拆成两个正交的轴：

```typescript
// 状态轴：判活只看这一轴
type TurnState = 'running' | 'complete' | 'interrupt' | 'error';

// 原因轴：终态上的属性，不参与判活
type EndReason =
  | { kind: 'done' }
  | { kind: 'maxSteps' }
  | { kind: 'aborted' }
  | { kind: 'error'; error: FrameError };
```

- **状态轴**回答"还在跑吗"：只有 `running` 算活跃，终态记录可被新回合覆盖。
- **原因轴**只挂在终态上，回答"为什么结束"，不参与判活。

这样拆的好处是：并发判定、`wait` 投影、派生条目回收都只看状态轴；"具体因什么结束"对它们无意义，只在展示与诊断时读取。

---

## 转移集

```typescript
type TurnCommand =
  | { kind: 'start' }
  | { kind: 'running'; responded?: ResponseMeta }
  | { kind: 'compressing' }
  | { kind: 'complete'; reason: 'done' | 'maxSteps' }
  | { kind: 'interrupt' }
  | { kind: 'fail'; error: FrameError };
```

所有状态转移都经过唯一的 `transition(sessionId, cmd)`，一个 `switch` 处理全部出口（新增 kind 会在 `default` 处编译报错）。命令到帧与状态的映射：

| `TurnCommand` | 状态轴结果 | 投递的帧 |
|---------------|-----------|---------|
| `start` | 保持 `running` | `transition: start`（带 `turnId`） |
| `running` | 保持 `running` | `transition: executing`（可带 `responded`） |
| `compressing` | 保持 `running` | `transition: compress` |
| `complete` | → `complete` | `transition: end`（reason `done` / `maxSteps`） |
| `interrupt` | → `interrupt` | `transition: end`（reason `aborted`） |
| `fail` | → `error` | `transition: end`（reason `error`，带 `error`） |

`complete` / `interrupt` / `fail` 都走 `settle()`：写状态、写原因、投 end 帧、唤醒 `wait`、回收本回合派生的终态条目。`settle` 是**幂等**的——只有当前记录处于 `running` 时才生效，所以重复终结不会重复投帧。

---

## 生命周期

### 出生登记 claim

```typescript
claim(sessionId, { turnId, parentSessionId?, agentName? }): boolean
```

- 已有 `running` 记录 → 返回 `false`，调用方抛 `TURN_CONFLICT`（HTTP 侧表现为并发冲突）。
- 成功则建记录，初始化两个 `Deferred`：`ended`（终态信号）与 `delivered`（投递完成信号）。
- 登记发生在**任何落盘之前**（不写 transcript、不建 checkpoint），避免并发 loser 产生副作用。
- `parentSessionId` / `agentName` 记录派生关系，供并发闸与级联停止按它过滤。

### 相位转移 transition

见上表。`start` 须在 `sink.attach` 之后调用——出生帧必须排在出站队列已挂载之后，否则帧会丢。

### steer 输入槽 submit / drain

```typescript
submit(sessionId, { id, parts }): { kind: 'attached', turnId } | { kind: 'no-active-turn' }
drain(sessionId): PendingUserInput[]
```

- `submit` 判定一条新输入应并入当前回合还是开新回合：命中 `running` 则入槽并返回 `attached`，否则返回 `no-active-turn`。
- 回合在每个 step 边界 `drain` 取走全部待投递输入（steer），吸收进上下文并在帧流上回显 `user_input`。
- `id` 由前端在入队时生成，drain 吸收时回显在 `user_input` 帧上，便于前端对齐。

### 等待 wait / markDelivered

```typescript
wait(sessionId, timeoutMs): 'completed' | 'failed' | 'timeout' | undefined
markDelivered(sessionId): void
```

- 未知 id → `undefined`；超时 → `timeout`。
- 委派记录（有 `parentSessionId`）会先 `await ended`，再 `await delivered`——即等到结果确实进了父会话 mailbox 才返回。`markDelivered` 由子代理投递方调用，完成 `delivered` 这个 `Deferred`。
- `wait` 的对外投影是**有损的**：`complete` → `completed`，其余终态 → `failed`。

### 停止 arm / runningChildren / stopChildren

```typescript
arm(sessionId, stop): void               // 登记中断句柄（runFork 之后紧邻调用）
runningChildren(parentSessionId): number // 该父会话下仍在跑的派生会话数
stopChildren(parentSessionId): number    // 停掉该父会话下所有派生子会话
```

- `arm` 登记的是 `runTurn` 内部的 `Fiber.interrupt` 回调。
- `stopChildren` 只停 `running` 且已 `arm`、未 `stopping` 的记录，避免重复计数。
- 并发闸用 `runningChildren` 实现（见 [→ subagent.md](subagent.md) 的 `maxBackground`）。

### 清理 dispose

```typescript
dispose(sessionId): void
```

会话删除时清空该会话记录，并连带删除以它为父会话的派生条目。

---

## 相位帧与 Sink

状态机的所有帧都通过 `EventSink` 投递（`turn/registry.ts` 的 `frame()` 是相位帧的唯一投递口）：

```typescript
interface EventSinkShape {
  attach(sessionId): Queue<FrameBody>;   // 建队列并挂载；调用者即唯一读者
  detach(sessionId): void;               // 摘挂载；此后 emit 静默丢弃
  emit(sessionId, body): void;           // 任何模块投帧，插在同一队尾
}
```

`FrameBody` 分三族：

```typescript
type FrameBody =
  | { family: 'transition'; transition: Transition }
  | { family: 'event'; event: RuntimeEvent }
  | { family: 'fatal'; fatal: Fatal };
```

- **全序保证**：任何模块（回合、审批、子代理、状态机）都往同一会话队列 `emit`，插在同一队尾，与回合自身的帧严格全序。
- **队列即帧流**：`sink.attach` 返回的队列被搬帧器（`Stream.fromQueue` → `AsyncIterable`）消费，直到 `isTurnEnd` 才结束，结束时 `detach`。
- **SSE 出口**：这条帧流最终经 HTTP/SSE 推送给客户端（见 SDK）。

`Transition` 的帧定义在 `sink/types.ts`，与上文转移集一一对应；`isTurnEnd` 用于判定 end 帧，也是子代理消费帧流的终止条件。

---

## 与其他模块的关系

| 模块 | 关系 |
|------|------|
| `agent/agent.ts` | `runTurn` 是唯一的回合驱动方：claim → start → 循环（transition running / compressing / complete / fail / interrupt） |
| `sink/` | 状态机的相位帧出口，见上 |
| `subagent/registry.ts` | 用 `runningChildren` 做并发闸，用 `markDelivered` 唤醒 `wait`，用 `stopChildren` 级联停止 |
| `session/mailbox.ts` | 子代理结果入站队列，与回合的 drain 节奏配合 |
| `server/` | 并发提交经 `submit` 判定；`/api/sessions/:id/subagents/stop` 走 `stopChildren` |
