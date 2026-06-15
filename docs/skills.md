# 技能系统

Coding Code 支持可插拔的 Markdown 技能包，扩展 Agent 在特定场景下的能力。本文档介绍技能的发现、加载和配置机制。

---

## 什么是技能

技能是一组以 Markdown 编写的指令和资源，在 Agent 调用前注入到 system prompt 中。每个技能包含：

- **instruction**：SKILL.md 的 Markdown 正文，作为技能指令注入
- **references**：附带的参考文件（代码片段、文档等）
- **scripts**：附带的脚本文件
- **assets**：附带的二进制资源

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
│   ├── SKILL.md          # 技能指令（必需）
│   ├── review-checklist.md   # 参考文件
│   └── run-review.sh         # 脚本文件
└── api-design/
    ├── SKILL.md
    └── openapi-template.yaml
```

---

## SKILL.md 格式

SKILL.md 是纯 Markdown 文件，正文部分作为技能指令注入 system prompt：

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
  readonly name: string;                              // 技能名称
  readonly description: string;                       // 技能描述
  readonly instruction: string;                       // SKILL.md 的 Markdown body
  readonly references: ReadonlyArray<{                // 参考文件
    path: string;
    content: string;
  }>;
  readonly scripts: ReadonlyArray<{                   // 脚本文件
    path: string;
    content: string;
  }>;
  readonly assets: ReadonlyArray<{                    // 二进制资源
    path: string;
    mimeType: string;
    size: number;
  }>;
  readonly metadata: Record<string, unknown>;         // 自定义元数据
}
```

---

## 技能管理 API

通过 `AgentClient` SDK 管理技能：

```typescript
const client = await createHttpClient('http://localhost:8080');

// 列出所有技能
const skills = await client.listSkills();
// 返回：Array<{ name: string, description: string, enabled: boolean }>

// 启用/禁用技能
await client.toggleSkill({ name: 'code-review', enabled: true });
```

也可通过 HTTP API：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/settings/skills` | GET | 列出所有技能 |
| `/api/settings/skills/toggle` | POST | 启用/禁用技能 |

---

## 配置

技能的启用/禁用状态持久化在项目配置中。禁用的技能不会被注入 system prompt，但仍保留在技能目录中，可随时重新启用。
