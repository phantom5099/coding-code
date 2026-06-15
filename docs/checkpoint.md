# Checkpoint 系统

Coding Code 记录所有文件变更，支持查看历史和回滚。本文档介绍 Shadow Git、Ledger、Diff 视图和回滚功能。

---

## 功能

- **Shadow Git**: 独立的变更日志，不依赖用户的 .git
- **Ledger**: 按会话记录每个文件操作
- **Diff 视图**: 查看特定会话前后的文件差异
- **回滚**: 恢复到任意检查点

## 使用

```bash
# 查看变更历史
GET /api/sessions/:id/checkpoint

# 恢复到特定检查点
POST /api/sessions/:id/checkpoint/restore
```
