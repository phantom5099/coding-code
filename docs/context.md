# 上下文管理与压缩

上下文管理是独立域，不耦合在 Agent 内部。本文档介绍两层压缩机制、触发条件、压缩策略和手动触发方式。

---

## 两层压缩机制

Coding Code 采用两层压缩策略，在不同阈值下自动触发：

### 微压缩 (Micro Compact)

轻量级压缩，对旧工具输出进行截断：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 触发阈值 | `promptEstimate > contextWindow * 0.25` | prompt 估算超过上下文窗口 25% 时触发 |
| 压缩对象 | 旧 turn（`< currentTurnId - 1`）中的长工具输出 | 只压缩可压缩工具的输出 |
| 最小字符数 | 120 字符 | 短于 120 字符的输出不会被截断 |
| 压缩方式 | 生成 `CompactEvent` 写入 JSONL | 保留前后部分，中间省略 |

**可压缩工具**：`read_file`、`execute_command`、`search_code`、`search_files`、`web_search`、`fetch_url`、`write_file`、`edit_file`

### LLM 压缩 (LLM Compaction)

深度压缩，调用 LLM 生成结构化摘要：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 触发阈值 | `promptEstimate > modelMaxTokens * 0.85` | prompt 估算超过模型最大 token 85% 时触发 |
| 保留最近 turn | 1 | 保留最近 1 个 turn 不压缩 |
| 压缩方式 | 调用 LLM 生成摘要 | 整段输出即摘要（全量替换，不做标签抽取） |
| 增量压缩 | 是 | 找到已有 SummaryEvent，只压缩 `endTurnId` 之后的事件 |
| 自动压缩轮次 | 最多 3 轮 | 单次自动压缩最多连续尝试 `MAX_AUTO_COMPACT_PASSES` 轮，直到不再需要压缩或无可释放为止 |

---

## 压缩输出格式

LLM 压缩要求模型按 10 个固定小节输出；**模型的整段输出即摘要文本**，不做标签抽取：

```
## 1. Primary Request and Intent
用户的核心请求

## 2. Key Technical Concepts
涉及的关键技术概念

## 3. Files and Code Sections
相关文件和代码段

## 4. Errors and Fixes
遇到的错误和修复

## 5. Problem Solving
问题解决过程

## 6. Decision Rationale and Rejected Approaches
决策理由与被否决的方案

## 7. All User Messages
所有用户消息

## 8. Pending Tasks
待处理任务

## 9. Current Work
当前工作内容

## 10. Optional Next Step
可选的下一步
```

---

## 事件类型

压缩操作在 JSONL 会话文件中记录为以下事件类型：

```typescript
// 微压缩事件
interface CompactEvent {
  type: 'compact';
  uuid: string;
  startTurnId: number;
  endTurnId: number;
}

// LLM 压缩摘要事件
interface SummaryEvent {
  type: 'summary';
  uuid: string;
  startTurnId: number;  // 摘要覆盖的起始 turn ID
  endTurnId: number;    // 摘要覆盖的结束 turn ID
  summaryText: string;  // 摘要文本
}
```

---

## 配置

在 `codingcode.yaml` 中配置上下文压缩：

```yaml
context:
  compactionModel: ""    # 压缩用模型，空字符串回退到主会话 LLM
```

### 硬编码常量

以下常量当前硬编码在 `context/context.ts` 中：

| 常量 | 值 | 说明 |
|------|-----|------|
| `MICRO_COMPACT_THRESHOLD` | `0.25` | 微压缩触发比例 |
| `MICRO_COMPACT_MIN_CHARS` | `120` | 微压缩最小字符数 |
| `COMPACTION_THRESHOLD` | `0.85` | LLM 压缩触发比例 |
| `KEEP_RECENT_TURNS` | `1` | 保留最近 turn 数 |
| `MAX_AUTO_COMPACT_PASSES` | `3` | 单次自动压缩的最大轮次 |

---

## 手动触发

通过 API 手动触发 LLM 压缩：

| 路由 | 方法 | Body | 说明 |
|------|------|------|------|
| `/api/sessions/:id/compact` | POST | `{ cwd }` | 手动触发上下文压缩 |

返回：

```typescript
interface CompressResult {
  didCompress: boolean;    // 是否执行了压缩
  released: number;        // 释放的 token 数
  promptEstimate: number;  // 压缩后的 prompt 估算
}
```

手动触发会强制执行 LLM 压缩，不受阈值限制。

也可通过 `AgentClient` SDK 调用：

```typescript
const client = await createHttpClient('http://localhost:8080');
await client.compact();
```
