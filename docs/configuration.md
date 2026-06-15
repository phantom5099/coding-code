# 配置

Coding Code 的核心哲学是所有行为都可配置。本文档详细介绍所有配置文件及其选项。

---

## 配置文件总览

| 配置文件 | 作用 |
|---|---|
| `models.json` | 模型厂商、模型列表、API 地址 |
| `codingcode.yaml` | 应用级配置（并发数、超时、token 预算等） |
| `~/.codingcode/rules.md` + `./AGENTS.md` | 全局 + 项目级规则，注入 system prompt |
| `mcp.json` (可选) | MCP 服务配置 |
| `~/.codingcode/memory.yaml` (可选) | 长期记忆配置 |

## 模型配置 (`models.json`)

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
    }
  ]
}
```

- `driver`: `"deepseek"` 使用原生 SDK，`"openai"` 使用 OpenAI 兼容 API
- `active`: 指定默认使用的厂商
- `api_key_env`: 从环境变量读取 API Key
- 运行时可通过 `/model` 命令或 API 切换模型

## 规则配置

```
~/.codingcode/rules.md        # 全局规则，所有项目生效
./AGENTS.md                   # 项目级规则，自动注入 system prompt
```

规则以 Markdown 编写，在每次 LLM 调用时自动注入到 system prompt 中。可以在这里定义编码规范、项目约定、安全策略等。
