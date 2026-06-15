# 长期记忆系统

Coding Code 支持跨会话的长期记忆，自动从对话中提取和存储关键信息。本文档介绍记忆类型、内容分类、自动提取机制和手动编辑方法。

---

## 内存类型

| 类型 | 位置 | 作用 |
|---|---|---|
| **用户级** | `~/.codingcode/memory/` | 跨所有项目的个人知识库 |
| **项目级** | `./.codingcode/memory/` | 特定项目的上下文 |

## 记忆内容

- **user**: 用户角色、技能、偏好
- **feedback**: 工作流程中的教训和已验证的方法
- **project**: 当前项目的目标、deadline、决策
- **reference**: 外部资源和文档链接

## 自动提取

Agent 在每次会话后自动：
1. 从对话中识别值得保存的信息
2. 按类型分类和结构化
3. 存储到对应的内存文件
4. 在下次启动时自动加载到 system prompt

## 手动编辑

记忆文件采用 Markdown 格式，支持手动编辑：

```markdown
---
name: feature-name
description: one-line summary
metadata:
  type: user/feedback/project/reference
---

Memory content here...
```
