<div align="center">

# Coding Code

**手写 ReAct Loop · 零框架依赖 · 多端统一 · 深度可配置**

[![npm version](https://img.shields.io/npm/v/@codingcode/core.svg)](https://www.npmjs.com/package/@codingcode/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js->=18-green.svg)](https://nodejs.org/)

终端原生的 AI 编程助手。核心引擎纯手写 ReAct 循环，通过 HTTP 服务化对外暴露，TUI / Web / SDK 等所有端共享同一份编排逻辑。没有黑盒，所有行为都可定制。

</div>

---

## 核心特性

- 🔄 **手写 ReAct 循环** — 无框架依赖，完全可控的 Agent 引擎
- 🌐 **HTTP 服务化** — Agent 作为独立 HTTP 服务运行，任何端平等接入
- 🔧 **深度可配置** — 子智能体、工具、提示词、钩子、模型全部可定制
- 🛡️ **双层安全** — 审批流水线（开箱即用）+ OS 级沙箱（可选）
- 🧠 **长期记忆** — 跨会话自动提取和加载用户/项目上下文
- 🔌 **MCP 集成** — 通过 Model Context Protocol 扩展工具能力
- 📡 **实时流式** — SSE 推送，多端同步响应
- 💾 **Checkpoint** — Shadow Git 变更跟踪与一键回滚

---

## 快速开始

### 前置要求

- Node.js >= 18
- 一个 LLM API Key（支持 DeepSeek、OpenAI 等厂商）

### 安装与启动

```bash
# 1. 克隆并安装
git clone https://github.com/<org>/coding-code.git
cd coding-code
npm install

# 2. 配置 API Key
export DEEPSEEK_API_KEY=sk-xxx

# 3. 启动（server + TUI）
npm start
```

启动成功后，终端会显示交互式 TUI 界面，默认以 **Coder** 角色运行。

### 其他启动方式

```bash
npm start serve    # 仅启动 HTTP server（供 Web / SDK 调用）
npm start tui      # 仅启动 TUI（连接已有 server）
```

### SDK 调用示例

```typescript
import { CodingCodeClient } from '@codingcode/core';

const client = new CodingCodeClient('http://localhost:3000');
const session = await client.createSession();

for await (const chunk of client.sendMessage(session.id, '帮我写一个快排')) {
  process.stdout.write(chunk);
}
```

---

## 架构

```
┌─────────────────────────────────────────────────────┐
│                     客户端层                          │
│  @codingcode/tui (Ink/React)  ·  Web  ·  SDK        │
└────────────────────────┬────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────┴────────────────────────────┐
│                    核心引擎层                         │
│  @codingcode/core                                    │
│  ReAct Loop · 工具系统 · MCP · 上下文 · 记忆 · 持久化 │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────┐
│                    基础设施层                         │
│  @codingcode/infra                                   │
│  配置加载 · 日志 · 共享类型                            │
└─────────────────────────────────────────────────────┘
```

**设计原则**：Agent 是纯 ReAct 循环，不持有 Session、不感知传输协议。编排逻辑写死在 `orchestration/bootstrap.ts`，所有端走同一份代码。Effect TS 托管依赖注入，编译期强制处理错误。

---

## 配置

所有行为都可配置。核心配置文件：

| 配置文件 | 作用 | 详见 |
|---------|------|------|
| `models.json` | 模型厂商、模型列表、API 地址 | [→ configuration.md](docs/configuration.md) |
| `codingcode.yaml` | 应用级配置（并发数、超时等） | [→ configuration.md](docs/configuration.md) |
| `~/.codingcode/rules.md` + `./AGENTS.md` | 全局 + 项目级规则，注入 system prompt | [→ configuration.md](docs/configuration.md) |
| `mcp.json` (可选) | MCP 服务配置 | [→ mcp.md](docs/mcp.md) |

快速配置模型（`models.json`）：

```json
{
  "active": "deepseek",
  "providers": [{
    "name": "deepseek",
    "driver": "deepseek",
    "base_url": "https://api.deepseek.com",
    "api_key_env": "DEEPSEEK_API_KEY",
    "default_model": "deepseek-v4-flash",
    "models": [
      { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash" }
    ]
  }]
}
```

`driver` 支持 `"deepseek"`（原生 SDK）和 `"openai"`（OpenAI 兼容 API）。运行时可通过 `/model` 命令切换。

---

## 功能导航

| 功能 | 说明 | 文档 |
|------|------|------|
| 🛠️ 工具系统 | 内置文件/命令/网络工具 + 自定义工具注册 + 双层安全隔离 | [→ tools.md](docs/tools.md) |
| 🧠 长期记忆 | 跨会话自动提取用户偏好、项目上下文，支持手动编辑 | [→ memory.md](docs/memory.md) |
| 🔌 MCP 集成 | 通过 Model Context Protocol 连接外部工具服务 | [→ mcp.md](docs/mcp.md) |
| 💾 Checkpoint | Shadow Git 变更跟踪、Diff 视图、一键回滚 | [→ checkpoint.md](docs/checkpoint.md) |
| 🪝 钩子系统 | 8 个可插拔钩子点，在关键节点注入自定义逻辑 | [→ hooks.md](docs/hooks.md) |
| 🤖 子智能体 | 独立 ReAct 实例，受限工具集，可并行委派任务 | [→ subagent.md](docs/subagent.md) |
| 📦 上下文压缩 | 超预算自动压缩，截断/总结两种策略 | [→ context.md](docs/context.md) |

---

## 工作流

```
用户输入 → System Prompt（角色 + 规则 + 记忆）→ LLM 调用 → ReAct Loop
  ├── Tool Call → Approval → Execution → Hook
  ├── Subagent Delegation（可选，并行）
  └── Context Compression（自动触发）
→ SSE 流式响应 → 会话持久化 → Checkpoint → Memory 提取
```

每个环节都可配置，没有黑盒。

---

## 技术栈

| 关注点 | 选型 |
|---|---|
| 语言 | TypeScript 5.8 |
| 运行时 | Node.js (tsx) |
| DI / 错误追踪 | Effect TS 3.x |
| LLM SDK | Vercel AI SDK v6 + @ai-sdk/deepseek + @ai-sdk/openai |
| HTTP 框架 | Hono 4.x |
| TUI | Ink 7.x + React 19 |
| MCP | @modelcontextprotocol/sdk 1.29.x |
| 校验 | Zod 4.x |
| 日志 | pino 9.x + pino-pretty 13.x |
| 配置 | YAML |
| 测试 | vitest |
| 包管理 | npm workspaces (monorepo) |

---

## 开发

```bash
npm install
npm run typecheck    # 类型检查
npm test             # 运行测试
npm run dev          # 开发模式（watch）
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解：

- 如何提交 Issue 和 PR
- 开发环境搭建
- 代码规范和提交约定

## 安全

如发现安全漏洞，请通过 [GitHub Security Advisories](https://github.com/<org>/coding-code/security/advisories/new) 私密报告，请勿公开提交 Issue。

## License

[MIT](LICENSE)
