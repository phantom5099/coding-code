# 配置

Coding Code 的核心哲学是所有行为都可配置。本文档详细介绍所有配置文件及其选项。

---

## 配置文件总览

| 配置文件 | 位置 | 作用 | 详见 |
|---------|------|------|------|
| `codingcode.yaml` | `~/.codingcode/config.yaml` | 应用级配置 | 本文档 |
| `models.json` | 项目根目录 | 模型厂商、模型列表、API 地址 | 本文档 |
| `rules.md` | `~/.codingcode/rules.md` + `./AGENTS.md` | 全局 + 项目级规则 | 本文档 |
| `mcp.yaml` | `~/.codingcode/mcp.yaml` + `.codingcode/mcp.yaml` | MCP 服务配置 | [→ mcp.md](mcp.md) |
| `hooks.yaml` | `~/.codingcode/hooks.yaml` + `.codingcode/hooks.yaml` | 钩子配置 | [→ hooks.md](hooks.md) |
| `agents/*.md` | `~/.codingcode/agents/` + `.codingcode/agents/` | 子智能体 profile | [→ subagent.md](subagent.md) |
| `memory.md` | `~/.codingcode/memory.md` + `.codingcode/memory.md` | 长期记忆 | [→ memory.md](memory.md) |

---

## codingcode.yaml

应用级主配置文件，存放在 `~/.codingcode/config.yaml`。使用 `deepMerge` 合并默认值。

### 完整配置项

```yaml
server:
  port: 8080              # HTTP 服务端口

maxSteps: 200             # Agent 最大步数
maxStopContinuations: 2   # 最大停止续行次数

activeModel:
  model: ""               # 模型 ID
  apiKeyEnv: ""           # API Key 环境变量名

context:
  compactionModel: ""     # 压缩用模型，空字符串回退主模型

memory:
  enabled: false          # 启用长期记忆
  model: ""               # 记忆提取模型，空字符串回退主模型
  projectFile: ".codingcode/memory.md"    # 项目记忆文件路径
  userFile: "~/.codingcode/memory.md"     # 用户记忆文件路径
  maxBytes: 16384         # 记忆文件最大字节数
  promptMaxBytes: 8192    # 注入提示的最大字节数
  extraTypes: []          # 自定义记忆类型
  disabledTypes: []       # 禁用的记忆类型名
```

### 字段详细说明

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `server.port` | `8080` | HTTP 服务监听端口 |
| `maxSteps` | `200` | 单次 Agent 执行的最大步数限制 |
| `maxStopContinuations` | `2` | Agent 停止后最大续行次数 |
| `activeModel.model` | 无 | 覆盖 models.json 中的默认模型 |
| `activeModel.apiKeyEnv` | 无 | 覆盖 models.json 中的 API Key 环境变量 |
| `context.compactionModel` | `''` | 上下文压缩使用的模型，空字符串回退到主会话 LLM |
| `memory.enabled` | `false` | 是否启用长期记忆系统 |
| `memory.model` | `''` | 记忆提取使用的模型，空字符串回退到主模型 |
| `memory.projectFile` | `'.codingcode/memory.md'` | 项目级记忆文件路径 |
| `memory.userFile` | `'~/.codingcode/memory.md'` | 用户级记忆文件路径 |
| `memory.maxBytes` | `16384` | 单个记忆文件的最大字节数 |
| `memory.promptMaxBytes` | `8192` | 注入 system prompt 的记忆内容最大字节数 |
| `memory.extraTypes` | `[]` | 自定义记忆类型列表 |
| `memory.disabledTypes` | `[]` | 禁用的内置记忆类型名列表 |

### 自定义记忆类型示例

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
    - reference
```

---

## models.json

模型配置文件，存放在项目根目录。定义可用的 LLM 厂商和模型。

### 完整格式

```json
{
  "active": "deepseek",
  "providers": [
    {
      "name": "deepseek",
      "driver": "deepseek",
      "base_url": "https://api.deepseek.com",
      "api_key_env": "DEEPSEEK_API_KEY",
      "default_model": "deepseek-v4-flash",
      "models": [
        { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash" },
        { "id": "deepseek-chat", "name": "DeepSeek V3" }
      ]
    },
    {
      "name": "openai-compatible",
      "driver": "openai",
      "base_url": "https://api.example.com/v1",
      "api_key_env": "CUSTOM_API_KEY",
      "default_model": "gpt-4o",
      "models": [
        { "id": "gpt-4o", "name": "GPT-4o" },
        { "id": "gpt-4o-mini", "name": "GPT-4o Mini" }
      ]
    }
  ]
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `active` | 默认使用的厂商名称，对应 providers 中的 `name` |
| `providers[].name` | 厂商名称，用于切换和引用 |
| `providers[].driver` | 驱动类型：`"deepseek"` 使用原生 SDK，`"openai"` 使用 OpenAI 兼容 API |
| `providers[].base_url` | API 基础 URL |
| `providers[].api_key_env` | 从环境变量读取 API Key 的变量名 |
| `providers[].default_model` | 该厂商的默认模型 ID |
| `providers[].models[]` | 可用模型列表，每项包含 `id` 和 `name` |

### 运行时切换

- TUI 中输入 `/model` 命令可切换模型
- 通过 API `POST /api/models` 切换

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

---

## 项目级子配置

在 `.codingcode/config.yaml` 中可配置项目级子选项：

```yaml
# .codingcode/config.yaml
subagent:
  enabled: true    # 是否允许子智能体
```
