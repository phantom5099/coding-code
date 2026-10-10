# 配置

Coding Code 的用户可配置项集中在 `~/.codingcode/` 下的 YAML / Markdown 文件。本文档介绍应用级配置、规则配置及其选项。

---

## 配置文件总览

| 配置文件 | 位置 | 作用 | 详见 |
|---------|------|------|------|
| `config.yaml` | `~/.codingcode/config.yaml` | 应用级配置 | 本文档 |
| `rules.md` | `~/.codingcode/rules.md` | 全局规则 | 本文档 |
| `AGENTS.md` | `./AGENTS.md` | 项目级规则 | 本文档 |
| `mcp.yaml` | `~/.codingcode/mcp.yaml` + `.codingcode/mcp.yaml` | MCP 服务配置 | [→ mcp.md](mcp.md) |
| `hooks.yaml` | `~/.codingcode/hooks.yaml` + `.codingcode/hooks.yaml` | 钩子配置 | [→ hooks.md](hooks.md) |
| `memory.md` | `./.codingcode/memory.md` | 长期记忆（项目级） | [→ memory.md](memory.md) |

---

## config.yaml

应用级主配置文件，存放在 `~/.codingcode/config.yaml`。使用 `deepMerge` 合并默认值。

### 完整配置项

```yaml
maxSteps: 200             # Agent 最大步数
maxStopContinuations: 2   # 最大停止续行次数
activeProfile: build      # 默认 profile
permissionMode: askBeforeExec   # 权限模式

# activeModel:            # 可选，覆盖模型清单中的默认模型
#   model: ""             # 模型 ID
#   apiKeyEnv: ""         # API Key 环境变量名

context:
  compactionModel: ""     # 压缩用模型，空字符串回退主模型

memory:
  enabled: false          # 启用长期记忆
  model: ""               # 记忆提取模型，空字符串回退主模型
  promptMaxBytes: 8192    # 注入提示的记忆内容最大字节数

subagent:
  maxBackground: 4        # 单父会话并发子智能体上限
```

### 字段详细说明

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `maxSteps` | `200` | 单次 Agent 执行的最大步数限制 |
| `maxStopContinuations` | `2` | Agent 停止后最大续行次数 |
| `activeProfile` | `build` | 新会话默认 profile（`build` / `plan`） |
| `permissionMode` | `askBeforeExec` | 默认权限模式 |
| `activeModel` | 无（可选） | 覆盖模型清单中的默认模型，不设置则使用清单中的 `default_model` |
| `context.compactionModel` | `''` | 上下文压缩使用的模型，空字符串回退到主会话 LLM |
| `memory.enabled` | `false` | 是否启用长期记忆系统 |
| `memory.model` | `''` | 记忆提取使用的模型，空字符串回退到主模型 |
| `memory.promptMaxBytes` | `8192` | 注入 system prompt 的记忆内容最大字节数 |
| `subagent.maxBackground` | `4` | 单个父会话同时运行的子智能体上限 |

> **HTTP 端口不可配置**。服务启动时监听端口 `0`，由操作系统原子地分配一个空闲端口，避免多实例或"先探测再绑定"之间的竞态。实际端口通过 stdout 的 `CODINGCODE_SERVER_READY:<port>` 上报给拉起方。

> **模型清单不是用户配置**。可用的厂商、模型与 API 地址由仓库内置的 `config/models.json` 提供，随代码发布，不通过 `~/.codingcode/` 配置。运行时可在客户端切换当前模型。

---

## 规则配置

规则以 Markdown 编写，在每次 LLM 调用时自动注入到 system prompt 中。

### 配置文件位置

| 级别 | 路径 | 说明 |
|------|------|------|
| 全局 | `~/.codingcode/rules.md` | 所有项目生效 |
| 项目 | `./AGENTS.md` | 仅当前项目生效 |

两级规则合并注入，项目级规则追加在全局规则之后。

### 规则内容示例

```markdown
# 项目规则

## 编码规范
- 使用函数式编程风格，避免 class
- 所有公共函数必须包含 JSDoc 注释
- 变量命名使用 camelCase

## 安全策略
- 禁止在代码中硬编码密钥
- 所有外部输入必须校验

## 项目约定
- 测试文件放在 src/ 同级的 __tests__/ 目录
- 提交信息格式：type(scope): description
```
