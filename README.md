<div align="center">

# Coding Code

**手写 ReAct Loop · 零框架依赖**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/)

面向终端的 AI 编程助手。核心引擎纯手写 ReAct 循环，不依赖任何 Agent 框架。没有黑盒，所有行为都可定制。

</div>

---

## 核心特性

- 🔄 **手写 ReAct 循环** — 不依赖外部 Agent 框架，完全可控的 Agent 引擎
- 🤖 **多子智能体后台委派** — 父智能体通过 `spawn_agent` 派生子会话，立即返回、继续并行工作；`wait_agent` 只在结果阻塞下一步时等待
- 📬 **会话级 Mailbox** — 子智能体终态异步回注父会话，在回合边界统一吸收，不打断当前推理
- 🎛️ **完整回合状态机** — 状态轴（running / complete / interrupt / error）与终态原因分离，出生登记、相位转移、幂等终结、级联停止全部显式管理
- 🛡️ **审批流水线** — 五层决策链，规则引擎 + 权限模式 + 钩子 + 用户确认 + 审计
- 🧠 **长期记忆** — 跨会话自动提取和加载用户/项目上下文
- 🔌 **MCP 集成** — 通过 Model Context Protocol 扩展工具能力
- 🪝 **可插拔钩子** — 12 个钩子点，在工具执行、回合生命周期、子智能体派发等关键节点注入自定义逻辑
- 🎯 **技能系统** — 可复用的 Markdown 技能包，按需加载
- 💾 **Checkpoint** — Shadow Git 变更跟踪与一键回滚

---

## 快速开始

### 前置要求

- Node.js >= 18
- 一个 LLM API Key

### 安装与启动

```bash
# 1. 克隆并安装
git clone https://github.com/phantom5099/coding-code.git
cd coding-code
pnpm install

# 2. 配置 API Key
export DEEPSEEK_API_KEY=sk-xxx

# 3. 启动
pnpm start
```

启动成功后，HTTP server 开始监听并打印 `CODINGCODE_SERVER_READY:<port>`。

### SDK 调用示例

```typescript
import { createHttpClients } from '@codingcode/sdk';

const clients = createHttpClients('http://localhost:8080');

for await (const frame of clients.agent.sendMessage('帮我写一个快排', {
  cwd: process.cwd(),
})) {
  if (frame.family === 'event' && frame.event.type === 'text_delta') {
    process.stdout.write(frame.event.text);
  }
}
```

---

## 架构

```
┌──────────────────────────────────────────────────────────┐
│                       客户端层                            │
│  @codingcode/desktop (Electron)                          │
│  @codingcode/sdk（契约 + HTTP/SSE 实现）                  │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────┴───────────────────────────────┐
│                       核心引擎层                           │
│  @codingcode/core                                         │
│  ReAct Loop · 工具 · MCP · 上下文 · 记忆 · Checkpoint     │
│  钩子 · 子智能体 · 技能 · 审批 · 会话 · 回合 · 调度        │
│  模型清单 · 应用配置 · YAML 存取 · 日志 · 共享类型       │
└──────────────────────────────────────────────────────────┘
```

**设计原则**：Agent 是纯 ReAct 循环，不持有 Session、不感知传输协议。核心作为独立 HTTP 服务运行，帧流经 SSE 推送。Effect TS 托管依赖注入，编译期强制处理错误。

---

## 配置

用户可配置项：

| 配置文件 | 位置 | 作用 | 详见 |
|---------|------|------|------|
| `config.yaml` | `~/.codingcode/config.yaml` | 应用级配置（步数、权限模式、记忆、子智能体并发等） | [→ configuration.md](docs/configuration.md) |
| `rules.md` | `~/.codingcode/rules.md` | 全局规则，注入 system prompt | [→ configuration.md](docs/configuration.md) |
| `AGENTS.md` | `./AGENTS.md` | 项目级规则，注入 system prompt | [→ configuration.md](docs/configuration.md) |
| `mcp.yaml` | `~/.codingcode/mcp.yaml` + `.codingcode/mcp.yaml` | MCP 服务配置 | [→ mcp.md](docs/mcp.md) |
| `hooks.yaml` | `~/.codingcode/hooks.yaml` + `.codingcode/hooks.yaml` | 钩子配置 | [→ hooks.md](docs/hooks.md) |
| `memory.md` | `./.codingcode/memory.md` | 长期记忆（项目级） | [→ memory.md](docs/memory.md) |

应用级配置示例（`~/.codingcode/config.yaml`）：

```yaml
maxSteps: 200             # Agent 最大步数
maxStopContinuations: 2   # 最大停止续行次数
activeProfile: build      # agent 模式
permissionMode: askBeforeExec   # 权限模式

context:
  compactionModel: ""     # 压缩用模型，空字符串回退主模型

memory:
  enabled: false          # 启用长期记忆
  model: ""               # 记忆提取模型，空字符串回退主模型
  promptMaxBytes: 8192    # 注入提示的记忆内容最大字节数

subagent:
  maxBackground: 4        # 单父会话并发子智能体上限
```

---

## 功能导航

| 功能 | 说明 | 文档 |
|------|------|------|
| 🛠️ 工具系统 | 内置文件/命令/网络工具 + 审批流水线 | [→ tools.md](docs/tools.md) |
| 🤖 子智能体 | 后台派生独立 ReAct 会话，结果经 mailbox 回注 | [→ subagent.md](docs/subagent.md) |
| 🎛️ 回合状态机 | 会话状态登记、相位转移与生命周期管理 | [→ turn.md](docs/turn.md) |
| 🧠 长期记忆 | 跨会话自动提取用户偏好、项目上下文，支持手动编辑 | [→ memory.md](docs/memory.md) |
| 🔌 MCP 集成 | 通过 Model Context Protocol 连接外部工具服务 | [→ mcp.md](docs/mcp.md) |
| 💾 Checkpoint | Shadow Git 变更跟踪、Diff 视图、一键回滚 | [→ checkpoint.md](docs/checkpoint.md) |
| 🪝 钩子系统 | 12 个可插拔钩子点，在关键节点注入自定义逻辑 | [→ hooks.md](docs/hooks.md) |
| 📦 上下文压缩 | 超预算自动压缩，截断/总结两种策略 | [→ context.md](docs/context.md) |
| 🎯 技能系统 | 可插拔的 Markdown 技能包，扩展 Agent 能力 | [→ skills.md](docs/skills.md) |

---

## 技术栈

| 关注点 | 选型 |
|---|---|
| 语言 | TypeScript 5.8 |
| 运行时 | Node.js (tsx) |
| DI / 错误追踪 | Effect TS 3.x |
| LLM SDK | Vercel AI SDK v6 + @ai-sdk/deepseek + @ai-sdk/openai |
| HTTP 框架 | @effect/platform（HttpRouter + NodeHttpServer） |
| Desktop | Electron 35 + React 19 + Zustand 5 |
| MCP | @modelcontextprotocol/sdk 1.29.x |
| 校验 | Zod 4.x |
| 日志 | pino 9.x + pino-pretty 13.x |
| 配置 | YAML |
| 测试 | vitest |
| 包管理 | pnpm workspaces (monorepo) |

---

## 开发

```bash
pnpm install
pnpm run typecheck    # 类型检查
pnpm test             # 运行测试
pnpm run dev          # 开发模式（watch）
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解：

- 如何提交 Issue 和 PR
- 开发环境搭建
- 代码规范和提交约定

## 安全

如发现安全漏洞，请通过 [GitHub Security Advisories](https://github.com/phantom5099/coding-code/security/advisories/new) 私密报告，请勿公开提交 Issue。

## License

[MIT](LICENSE)
