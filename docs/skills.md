# 技能系统

Coding Code 支持可插拔的 Markdown 技能包，扩展 Agent 在特定场景下的能力。本文档介绍技能的发现、加载和配置机制。

---

## 什么是技能

技能是一个包含 `SKILL.md` 的目录。发现阶段只读取少量元数据，具体内容由 Agent 在需要时通过文件工具读取。

发现阶段保存技能名称、描述和 `SKILL.md` 的绝对路径。

---

## 技能发现

技能从两个位置自动发现：

| 级别 | 路径 | 说明 |
|------|------|------|
| 全局 | `~/.codingcode/skills/` | 所有项目共享 |
| 项目 | `.codingcode/skills/` | 仅当前项目生效 |

每个技能是一个目录，目录下必须包含 `SKILL.md` 文件：

```
.codingcode/skills/
├── code-review/
│   └── SKILL.md          # 必需
└── api-design/
    └── SKILL.md
```

---

## SKILL.md 格式

SKILL.md 使用 YAML front matter 提供发现元数据。正文不会在发现阶段读取：

```markdown
# Code Review Skill

You are now performing a code review. Follow these steps:

1. Read the diff carefully
2. Check for security issues
3. Verify error handling
4. Suggest improvements

## Review Checklist
- [ ] No hardcoded secrets
- [ ] All inputs validated
- [ ] Error messages are helpful
```

---

## 技能类型

```typescript
interface Skill {
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
}
```

Agent 判断技能相关后，使用 `read_file` 读取 `skillPath`，再按需读取其他文件或执行脚本。

---

## 技能列表 API

通过 `AgentClient` SDK 读取技能元数据：

```typescript
const client = await createHttpClient('http://localhost:8080');

// 列出所有技能
const skills = await client.listSkills();
// 返回：Array<{ name: string, description: string, skillPath: string }>
```

也可通过 HTTP API：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/settings/skills` | GET | 列出所有技能元数据 |
