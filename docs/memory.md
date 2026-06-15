# 长期记忆系统

Coding Code 支持跨会话的长期记忆，自动从对话中提取和存储关键信息。本文档介绍记忆类型、内容分类、自动提取机制和手动编辑方法。

---

## 内存类型

| 类型 | 位置 | 作用 |
|---|---|---|
| **用户级** | `~/.codingcode/memory.md` | 跨所有项目的个人知识库 |
| **项目级** | `./.codingcode/memory.md` | 特定项目的上下文 |

路径可在 `codingcode.yaml` 的 `memory.projectFile` 和 `memory.userFile` 中自定义。

---

## 记忆内容

内置三种记忆类型：

| 类型 | 提取来源 | 内容 |
|------|---------|------|
| `user` | `[user]` 标签的消息 | 用户角色、技能栈、工作偏好及对 Agent 的纠正 |
| `project` | `[user]` + `[assistant]` 消息 | 架构决策、技术选型、部署信息 |
| `reference` | `[user]` + `[tool:*]` 消息 | 外部资源、文档、Dashboard 链接 |

可通过 `memory.extraTypes` 添加自定义记忆类型，通过 `memory.disabledTypes` 禁用内置类型。

---

## 自动提取

Agent 在每次会话后自动执行记忆提取：

1. 构建 system prompt，包含各记忆类型的提取指引
2. 发送已有记忆 + 会话记录给 LLM
3. LLM 输出 `<memory>...</memory>` 块
4. 提取块内容，返回新记忆文本（null 表示无新内容）
5. 矛盾时新信息替换旧条目，同一会话以最新为准

提取使用的模型可通过 `memory.model` 配置，留空则回退到主会话模型。

---

## 记忆文件格式

记忆文件使用 Markdown 格式，自动提取内容包裹在标记块中：

```markdown
<!-- auto:begin -->
### user
- 偏好使用函数式编程风格
- 常用技术栈：React + TypeScript

### project
- 采用 monorepo 架构，使用 pnpm workspaces
- 入口文件：packages/codingcode/src/cli.ts

### reference
- [API 文档](https://example.com/api)
<!-- auto:end -->

手动添加的内容可以写在标记块之外，不会被自动提取覆盖。
```

### 标记块机制

- `replaceAutoBlock()`：原子替换 `<!-- auto:begin -->` 和 `<!-- auto:end -->` 之间的内容
- `stripMarkersForPrompt()`：去掉标记后注入系统提示
- `enforceMaxBytes()`：按 `### ` 小节逐个裁剪到字节上限（默认 16384 字节）
- `mergeAutoBlocks()`：以 `### ` 小节名为 key 合并，incoming 覆盖 base

---

## 配置

在 `codingcode.yaml` 中配置记忆系统：

```yaml
memory:
  enabled: true              # 启用长期记忆（默认 false）
  model: ""                  # 记忆提取模型，空字符串回退到主模型
  projectFile: ".codingcode/memory.md"   # 项目记忆文件路径
  userFile: "~/.codingcode/memory.md"    # 用户记忆文件路径
  maxBytes: 16384            # 记忆文件最大字节数
  promptMaxBytes: 8192       # 注入提示的最大字节数
  extraTypes: []             # 自定义记忆类型
  disabledTypes: []          # 禁用的记忆类型名
```

### 自定义记忆类型

```yaml
memory:
  enabled: true
  extraTypes:
    - name: feedback
      description: 工作流程中的教训和已验证的方法
      enabled: true
    - name: decision
      description: 重要的架构和设计决策
      enabled: true
  disabledTypes:
    - reference              # 禁用内置的 reference 类型
```

---

## 手动编辑

记忆文件采用 Markdown 格式，支持手动编辑。手动内容可写在 `<!-- auto:end -->` 标记之后，不会被自动提取覆盖：

```markdown
<!-- auto:begin -->
### user
- 偏好使用函数式编程风格
<!-- auto:end -->

### 手动备注
- 项目部署流程：npm run build -> scp dist/ -> pm2 restart
- 数据库连接字符串在 Vault 中
```
