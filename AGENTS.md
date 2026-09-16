## 项目定位

Coding Code 是 AI 编程助手。

## 模块划分

包级（pnpm workspace）：

| 包 | 目录 | 职责 |
|---|---|---|
| `@codingcode/core` | `packages/codingcode` | 核心引擎：agent loop 与全部编排能力 |
| `@codingcode/infra` | `packages/infra` | 基础设施：配置加载、日志、禁用项存储 |
| `@codingcode/tui` | `packages/tui` | 终端界面（Ink + React） |
| `@codingcode/desktop` | `packages/desktop` | 桌面端（Electron + React） |

`packages/sdk`、`packages/web` 目前只有空 `src/`，尚无实现。

`@codingcode/core` 内部特性目录：

- `agent`：本项目核心，手写 ReAct loop 与编排；不持有 Session、不感知传输协议
- `tools`：工具系统，`domains/` 下分 fs / bash / web / self / subagent 五个域
- `llm`：模型调用与 provider 适配
- `mcp`：Model Context Protocol 集成
- `context`：上下文预算与压缩
- `memory`：跨会话长期记忆
- `checkpoint`：Shadow Git 变更跟踪与回滚
- `hooks`：可插拔钩子点
- `subagent`：子智能体委派
- `skills`：Markdown 技能包装载
- `approval`：审批决策链
- `session`：会话持久化
- `scheduler`：定时调度
- `todo`：任务清单
- `rules`：全局 / 项目级规则装载
- `workspace`：工作区信息
- `server`：HTTP / SSE 入口
- `client`：HTTP 客户端（`AgentClient` 的实现）
- `direct`：进程内直连端口，免 HTTP 的 runtime / sessions / settings / models 接口
- `core`：通用件（`error` / `result` / `path`），不指向任何功能模块
- `contracts`：跨领域共享契约
- `layer.ts`：组合根，全量装配

## 架构要求

**依赖倒置**：所有非叶子模块利用 `port.ts`（宽契约；agent 自持的装配端口也在 `agent/port.ts`）声明自己需要的接口和类型定义，使调用者不需要依赖实现方；只允许依赖下层模块。

**分层与允许依赖**：

| 层 | 落点 | 允许依赖 |
|---|---|---|
| L0 通用件 | `core/` | node 内置 + 同目录 |
| L1 共享契约 | `contracts/` | `core/` + 同目录 + 第三方（type-only） |
| L1' 端口契约 | 各 `xxx/port.ts`（含 `agent/port.ts` 的装配端口） | `core/` + `contracts/` |
| L2 实现 | `tools/`、`hooks/`、`session/`、`approval/`、`llm/`、`mcp/`、`context/`、`workspace/` … | L0 + L1 |
| L3 组合根 | `layer.ts`、`agent/tool-env.ts` | 全部 |

**架构边界硬规则**（由 `packages/codingcode/test/architecture/boundaries.test.ts` 静态断言，共 29 项）：

- **R1** 契约不得 import 实现：`contracts/` 与 `**/port.ts` 的相对 import 只能落在 `core/`、`contracts/` 或同目录
- **R2** 实现不得依赖消费者模块：agent 自持的装配端口 `ToolEnvPort` 只在 `agent/` 内部出现
- **R3** `core/` 零内部依赖：不引用 `core/` 之外的任何 src 模块
- **R4** 一个概念只允许一处类型定义，canonical 落点为 `contracts/`
- **准入**：`core/` 的 import 只能是 node 内置与同目录；`contracts/` 只引用 `core/`、同目录与第三方
- **可解析**：`src/**` 的每条相对 import 都必须能在仓库内找到落点

**类型落点判据**（先判归属，再判引用面）：

- 判据一 —— 有无领域归属：不指向任何功能模块的（错误基类、结果容器、路径运算）→ `core/`；指向某功能模块的 → 判据二
- 判据二 —— 引用面，**只作用于领域件**：仅 1 个 src 领域引用 → 回该领域**已有**的归属文件；只出现在某调用方接口签名里 → 内联进调用方；≥2 个 src 领域，或 ≥1 个跨包 → `contracts/`

**机制形状例外**：`z.ZodTypeAny`、SDK client、Effect 的 R 通道类型必须留在叶子模块，不得进 `contracts/`。契约只暴露窄的纯数据描述——MCP 契约返回 `McpToolSpec`，`z.fromJSONSchema` 的转换由拥有机制的 `tools/catalog.ts` 自己做。

## 开发规则

- 禁止用户当前轮未明确要求就主动修改仓库中任何内容，包括源代码、配置文件、文档等
- 禁止用户当前轮未明确要求就主动进行 reset、commit、push 等相关会影响 git 历史或者当前仓库代码的操作，仅用户显式要求进行某类操作才能进行；仅允许 `git diff`、`git log` 等无副作用的操作可以自主进行
- 禁止未在用户指示下补充测试，当开发任务完成后，给用户报告完成程度，由用户决定针对哪些部分写测试
- 禁止将工具执行细节泄漏到 agent 编排层及其他模块，agent 只依赖端口契约，不得 import 工具实现
- 禁止将传输协议细节（HTTP / SSE）泄漏到 agent 核心及其他模块，agent 不得依赖 `server/`、`client/`、`direct/`
- 不允许假设“这是未来需要扩展的”，所以现在就不做，应该贴合用户的实际要求
- 不允许总是有阶段性计划，分阶段完成很容易导致过程产生一堆没用的死代码
- 不许兼容、兜底旧代码
- 修改过程中发现错误，如果是本次范围就修改（包括测试），否则要在最后指出
- 仅允许使用简短注释

## 其他规则

- 用户要求回答问题时，必须清晰回答每一点问题，不得遗漏
- 禁止编造任何证据、方案或者代码现状等内容
- 关于 TypeScript 规范，参考 TypeScript 官方文档，不得使用非官方推荐的方案
- 设计方案后，须深入解释每一步的理由
- 关于方案设计，禁止自己编造，只允许查找社区中的成熟实现，且输出时必须贴出相应来源，来源必须真实，保证用户能够打开链接、经得起二次验证
