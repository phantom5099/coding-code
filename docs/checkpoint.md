# Checkpoint 系统

Coding Code 记录所有文件变更，支持查看历史和回滚。本文档介绍 Shadow Git、Ledger、Diff 视图和回滚功能。

---

## 工作原理

Checkpoint 系统基于 Shadow Git 实现——一个独立于用户 `.git` 的变更日志系统：

- **存储位置**：`~/.codingcode/project/{encodedProjectPath}/checkpoint/repo.git`
- **隔离机制**：使用 `--git-dir` 和 `--work-tree` 分离，不影响用户仓库
- **大小上限**：1024 MB
- **文件锁**：`repo.lock` 防止并发写入

### 忽略规则

以下目录和文件不会被跟踪：

- `node_modules/`、`.venv/`、`dist/`、`build/`
- `*.log`、`.env`、`.DS_Store`

### 提交格式

Shadow Git 的提交消息格式为：

- `turn-{shortSid}-{turnId}-baseline`：轮次开始前的快照
- `turn-{shortSid}-{turnId}-final`：轮次结束后的快照

---

## API 接口

所有路由挂载在 `/api/sessions` 下。

### 查看 Diff

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/sessions/:id/checkpoints/latest/diff` | GET | 获取最新 checkpoint 的 diff |
| `/api/sessions/:id/checkpoints/:turnId/diff` | GET | 获取指定 turn 的 diff |

响应格式：

```typescript
interface CheckpointDiff {
  turnId: number;
  files: Array<{
    path: string;
    status: string;       // added / modified / deleted
    diff: string;         // unified diff
    insertions: number;
    deletions: number;
  }>;
}
```

### 回退文件

| 路由 | 方法 | Body | 说明 |
|------|------|------|------|
| `/api/sessions/:id/checkpoints/latest/revert-file` | POST | `{ cwd, file }` | 回退最新 checkpoint 的单个文件 |
| `/api/sessions/:id/checkpoints/latest/revert-files` | POST | `{ cwd, files }` | 回退最新 checkpoint 的多个文件 |

### 回滚到指定轮次

| 路由 | 方法 | Body | 说明 |
|------|------|------|------|
| `/api/sessions/:id/rollback-preview` | GET | query: `throughTurnId` | 预览回退到指定 turn 的 diff |
| `/api/sessions/:id/rollback-code-to-turn` | POST | `{ cwd, throughTurnId }` | 代码回退到指定 turn |
| `/api/sessions/:id/rollback-context` | POST | `{ cwd, throughTurnId }` | 上下文回退到指定 turn |
| `/api/sessions/:id/rollback-both-to-turn` | POST | `{ cwd, throughTurnId }` | 代码 + 上下文同时回滚 |

### 撤销回滚

| 路由 | 方法 | Body | 说明 |
|------|------|------|------|
| `/api/sessions/:id/undo-code-rollback` | POST | `{ cwd, force?, files? }` | 撤销上次代码回滚 |
| `/api/sessions/:id/rollback-state` | GET | - | 获取当前回退状态 |

---

## Ledger 数据结构

每次回滚操作记录为 `CodeRestoreEntry`：

```typescript
interface CodeRestoreEntry {
  id: string;                    // 唯一标识
  sessionId: string;             // 会话 ID
  action: 'checkpoint-files' | 'rollback-to-turn';  // 操作类型
  throughTurnId: number;         // 回退到的轮次
  affectedTurns: number[];       // 受影响的轮次列表
  selectedFiles: string[];       // 受影响的文件列表
  safetyCommit: string;          // 安全提交的 SHA
  timestamp: string;             // 操作时间
}
```

存储位置：`{gitDir}/../last-restore-{shortSid}.json`

---

## 回退状态查询

通过 `GET /api/sessions/:id/rollback-state` 获取当前回退状态：

```typescript
interface RollbackState {
  context: {
    active: boolean;
    currentThroughTurnId: number | null;
  };
  code: {
    canUndoLast: boolean;
    lastEntry: CodeRestoreEntry | null;
    revertedFiles: string[];
    lastEntryId: string | null;
  };
}
```
