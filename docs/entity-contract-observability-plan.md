# 数据实体统一 + 可观测性治理方案（v4：照 worldbook 拆多包）

> 状态：规划稿 v4
> 结构参照：`../worldbook`（平铺多包、exports 指 TS 源、index 只 re-export、依赖 DAG）

---

## 1. 根因（不变）

数据实体被 sdk 与 core 各复制一份，已漂移；会话定位四元组散落成裸位置参数；关键边界缺日志。

---

## 2. 目标结构（照 worldbook 拆多包）

### 2.1 仓库布局

```
coding code/
├── packages/              # 平铺的独立包，pnpm workspace 根在仓库根
│   ├── util/              # 叶子：error/result/path/enums
│   ├── todo/              # 叶子：todo 类型 + 读写
│   ├── sandbox/           # 依赖 util
│   ├── askuser/           # 叶子：提问
│   ├── logger/            # 平级基础设施：pino 封装（依赖 util）
│   ├── config/            # 平级基础设施：config.yaml/models.json（依赖 util）
│   ├── model/             # LLM 调用（对应 worldbook model；依赖 util）
│   ├── mcp/               # MCP 集成（依赖 util）
│   ├── hook/              # 钩子（依赖 util）
│   ├── checkpoint/        # Shadow Git（依赖 util）
│   ├── rules/             # 规则装载（依赖 util）
│   ├── skill/             # 技能装载（依赖 util）
│   ├── session/           # 会话事件/存储（依赖 util + model 类型）
│   ├── turn/              # 回合状态机（独立）
│   ├── sink/              # 帧队列（依赖 session + turn，仅类型）
│   ├── approval/          # 审批（依赖 hook + sink + util）
│   ├── memory/            # 记忆（依赖 session + model + util）
│   ├── context/           # 上下文投影（依赖 session + model + turn + util）
│   ├── tool/              # 工具（依赖 hook + sandbox + util）
│   ├── agent/             # loop 编排（组合下层）
│   ├── subagent/          # 子代理（依赖 agent + 下层）
│   ├── scheduler/         # 调度（依赖 agent + 下层）
│   ├── http/              # HTTP/SSE（对应 server；依赖 approval + askuser + …）
│   ├── app/               # 组合根（新建；Effect Layer 装配，对应 worldbook app）
│   ├── sdk/               # 客户端：类型一律 re-export 上述包，不复制
│   └── desktop/           # 消费 sdk（不变）
├── packages/<包>/src/     # 源码（index.ts 只 re-export）
├── packages/<包>/test/    # 单测（与 src 同级）
├── packages/<包>/testing/ # 测试替身，经 ./testing 子路径导出（按需）
└── pnpm-workspace.yaml    # packages: [packages/*]
```

### 2.2 包模板（照 worldbook）

```jsonc
// packages/sink/package.json
{
  "name": "@codingcode/sink",
  "private": true,
  "version": "0.2.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },   // 直接指 TS 源，无构建
  "dependencies": {
    "@codingcode/session": "workspace:*",
    "@codingcode/turn": "workspace:*"
  }
}
```

```ts
// packages/sink/src/index.ts —— 只 re-export，公共 API 边界
export * from './sink.js';
```

规则（照 worldbook `packages/AGENTS.md`）：
- 跨包 import 一律用包名（`@codingcode/session`），包内相对导入保留 `.js` 后缀；
- 基础设施包（logger/config/db）与业务包平级，不设 infra 目录；
- 仅被其他包引用的符号才进 `index.ts` 导出面，不加无用 export。

---

## 3. 依赖 DAG（核心：先 DAG 化，再拆）

worldbook 的依赖是严格无环 DAG；coding code 现状有类型环，拆前必须打破：

| 环 | 现状 | 处理 |
|---|---|---|
| `sink -type→ approval/llm/todo`，而 `approval -runtime→ sink`、`turn -runtime→ sink` | sink 帧协议 `RuntimeEvent` 强类型引用了 `ApprovalAction`/`TodoItem`/`TokenUsage` | 照 worldbook：**sink 帧瘦身**，payload 弱化/下沉，sink 只依赖 session + turn |
| `turn -type→ sink`（TurnCommand 用 `FrameError`/`ResponseMeta`） | turn 依赖 sink | 照 worldbook：**turn 独立**，`FrameError` 等帧类型下沉到 sink 或更低，sink 反向引用 turn 的 `TurnPhase` |

目标 DAG（照 worldbook 方向）：

```text
util ← todo / sandbox / askuser / logger / config / model / mcp / hook / checkpoint / rules / skill
session ← memory / context / sink / subagent / http / app
turn（独立）  sink ← session、turn（仅类型）
approval ← hook、sink、util
tool ← hook、sandbox、util
agent ← context / model / session / sink / tool / turn / approval / memory / … 
subagent ← agent + 下层
http ← agent / subagent / approval / askuser / …
app ← 全部（Effect Layer 组合根）
```

- `sdk` 单向依赖：`desktop → sdk → @codingcode/*`（re-export 类型 + 校验，不复制，零运行时依赖）；
- 拆包执行顺序：**叶子 → 中层 → 组合根**（util/todo/sandbox/askuser 先行，sink/turn 需先完成 DAG 化再拆）。

---

## 4. 收口已漂移实体（改拥有者，一处生效）

| 实体 | 拥有者 | 动作 |
|---|---|---|
| `EndReason` | `turn` | 统一判别联合，sdk 删扁平版 |
| 落盘内容块 | `session` | 统一 `StoredPart`，删 `StoredContentPart` |
| `tool_call` 参数 | `sink`（帧协议） | 统一 `arguments`（协议变更，两端同步） |
| `MAX_MEDIA_BYTES` | `session` | 唯一常量，sdk re-export |

sdk 侧：`protocol.ts`/`dto.ts`/`types.ts` 全部改为 `export type { … } from '@codingcode/<拥有者>'`，`decode.ts` 手写 Set 替换为拥有者提供的校验（或仅保留 envelope/family 外层 shape 校验）。

---

## 5. 可观测性（不变）

- logger `Effect.Layer` 化 + `child({sessionId,turnId,requestId})`；`http` 入口注入 `X-Request-Id` 经 FiberRef 贯穿；
- P0 打点：model（LLM 调用耗时/usage/失败）、http（请求/5xx）、session（落盘/IO）；替换 `console.error/warn` 散点；
- Sentry web + backend，CI 上传 source map。

---

## 5.5 执行进展（M0/M1 实际结果）

M0 实际打破的环有两个（非初判一个）：
1. `sink ↔ approval`：`ApprovalAction` 下沉到 `@codingcode/util`（sink 从 util re-export），approval 引用 util/sink，单向；
2. `sandbox ↔ tools`：`ToolApprovalMetadata` 下沉到 `@codingcode/sandbox`（依赖 util 的 `ApprovalAction` + 本地 `DangerousOperation`），tools 引用 sandbox，单向。

M1 已拆 4 个叶子包：`util` / `todo` / `sandbox` / `askuser`，`tsc -b` + 912 测试通过。

M2–M5 已完成：`packages/codingcode/` 内平铺 22 个子包（util/todo/sandbox/askuser/infra/checkpoint/rules/skill/model/mcp/hook/session/sink/turn/memory/context/tool/approval/agent/subagent/scheduler/http/app），`sdk`/`desktop` 不动；`SubagentToolHostService` 打破 agent→tools→subagent 环；测试 `vi.mock` 改指向物理子模块（memory/mcp/infra 提供子路径 exports）。

M6 已完成（sdk re-export + 漂移收口）：
1. `sdk/src/protocol.ts`/`types.ts`/`dto.ts` 全部改为从 core 拥有者 re-export，零复制定义；`Envelope`/`Frame` 拥有者是 `@codingcode/http`，其余帧体在 `@codingcode/sink`；
2. `EndReason` 扁平版删除：`decode.ts` 用 `Extract<Transition, { to: 'end' }>['reason']` 从权威类型推导；
3. `StoredContentPart` 统一为 `StoredPart`（拥有者 `@codingcode/session`）；
4. `tool_call`/`approval_request` 帧参数统一 `arguments`（协议变更，sink/agent/approval/session/desktop 两端同步）；
5. `MAX_MEDIA_BYTES` 唯一常量下沉 `@codingcode/util`（media.ts），session/assets 与 sdk re-export —— 放 util 而非 session 是为了让 sdk 保持零 effect 依赖（desktop 只引轻量叶子包）；
6. `decode.ts` 手写词汇表 Set 改为 `as const satisfies readonly WireType[]`：漂移即编译错误（顺带修复了存量 bug——sdk 校验集缺 `sandbox` 审批动作）；
7. `RunAutomationResult` 是 sdk 拥有的 API 响应投影（core scheduler 无此实体），保留在 contracts.ts。

---

## 6. 里程碑

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| **M0** 依赖 DAG 化设计 | sink 帧瘦身 + turn 独立 + FrameError 下沉，产出包间依赖表 | 无 |
| **M1** 叶子包 | 拆 `util`/`todo`/`sandbox`/`askuser`，建 package.json/exports | M0 |
| **M2** 基础设施平级包 | 拆 `logger`/`config`/`model`/`mcp`/`hook`/`checkpoint`/`rules`/`skill` | M1 |
| **M3** 核心领域包 | 拆 `session`/`turn`/`sink`（含帧瘦身落地）+ 漂移实体收口 | M2 |
| **M4** 中层包 | 拆 `approval`/`memory`/`context`/`tool` | M3 |
| **M5** 编排 + 入口包 | 拆 `agent`/`subagent`/`scheduler`/`http` + 新建 `app` 组合根 | M4 |
| **M6** sdk re-export | sdk 去复制改 re-export + 校验收敛 | M3 |
| **M7** 可观测性 | logger 服务 + correlation id + P0 打点 + Sentry | M5 |

> 每包拆完即 `tsc -b` + `pnpm test` 通过再进下一包；M0 先产出依赖表再动手，避免边拆边返工。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 依赖环未拆净导致 workspace 循环依赖 | M0 先把 DAG 定死；拆包时 CI 校验依赖方向 |
| 拆包改动面巨大 | 严格按叶子→根顺序，每包独立 commit、独立可回退 |
| `args→arguments` 破坏存量客户端 | 与 M3 同批发布，两端同步 |
| 测试路径/import 批量失效 | 每包迁移 test 到包内 `test/`，跑通再进下一包 |

---

## 8. 待确认

1. 包前缀：现有 `@codingcode/core` 是否废弃，全部拆为 `@codingcode/<领域>`（`core` 不再存在）？
2. 组合根 `app` 是否沿用 Effect 的 `layer.ts` 装配（worldbook 用 cordis，coding code 用 Effect，保留 Effect 即可）？
3. M0 的依赖 DAG 化（sink 帧瘦身、FrameError 下沉）是拆包前置，是否现在先做这一版依赖表？
