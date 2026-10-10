# Checkpoint 系统

Coding Code 记录所有文件变更，支持查看历史和回滚。本文档介绍 Shadow Git、Diff 视图和回滚功能。

---

## 工作原理

Checkpoint 系统基于 Shadow Git 实现——一个独立于用户 `.git` 的变更日志系统：

- **隔离机制**：使用 `--git-dir` 和 `--work-tree` 分离，不影响用户仓库
- **存储位置**：项目的 checkpoint 数据目录下（`projectDataDir` 派生）
- **大小上限**：`SIZE_CAP_MB = 1024`（超过则不继续跟踪）
- **文件锁**：项目锁（`project-lock.ts`）防止并发写入

### 忽略规则

以下目录和文件不会被跟踪（写入 shadow repo 的 `exclude`）：

```
node_modules/  .venv/  venv/  dist/  build/
*.log  .env  .env.*  *.tmp  *.temp
.DS_Store  Thumbs.db
```

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

回滚到指定轮次需要一次预览确认：`rollback-preview` 返回 `RollbackPreviewDiff`，其中列出受影响的 turn 与 diff。

---

## 数据结构

```typescript
interface CodeRollbackResult {
  reverted: boolean;
  throughTurnId: number;
  affectedTurns: number[];
  selectedFiles: string[];
}

interface RollbackPreviewDiff {
  throughTurnId: number;
  affectedTurns: number[];
  diff: string;
}

interface RestorePlan {
  throughTurnId: number;
  affectedTurns: number[];
  baseline: string;
}
```

上下文回退在会话 transcript 中记录为 `RollbackEvent`：

```typescript
interface RollbackEvent {
  type: 'rollback';
  throughTurnId: number;
  reason: string;
}
```

---

## Session Fork

从某个历史 turn 分叉出新会话：

| 路由 | 方法 | Body | 说明 |
|------|------|------|------|
| `/api/sessions/:id/fork` | POST | `{ cwd, atTurnId? }` | 复制到指定 turn 为止的会话历史，生成新会话 |
