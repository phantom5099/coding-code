# PR: Architecture cleanup — SDK/client 层重组 + 路径统一 + 死代码清除

## 变更概述

73 文件改动（-3603 / +1141），净删约 2462 行。零通信架构变更，桌面端行为不变，全部 1290 测试通过。

---

## 核心目标

- 消除 `client/direct/` 与 `client/http/` 之间的实现冗余
- 将进程内 facade 从 `client/` 目录剥离（TUI 不走 SDK 包装）
- 计算路径统一由 `core/paths.ts` 提供，清除 routes 手搓替代
- 错误处理协议统一，消除 `approvalOverride` latent bug

---

## 1. `client/` 目录重组

### 1a. 删除 `createDirectClient`（`client/direct.ts`）

516 行组合层工厂，把 4 个子客户端摊平成 `AgentClient` 50-method 接口。TUI 是唯一消费者，但 TUI 不应经过 SDK 包装——它可直接组合 4 个进程内 facade。

- **删**: `packages/codingcode/src/client/direct.ts`
- **删**: `packages/codingcode/src/client/direct/index.ts`（`createDirectClients` 工厂，22 行）
- **删**: `packages/codingcode/src/client/direct/agent-runtime.ts`
- **删**: `packages/codingcode/src/client/direct/sessions.ts`
- **删**: `packages/codingcode/src/client/direct/settings.ts`
- **删**: `packages/codingcode/src/client/direct/models.ts`

### 1b. 进程内 facade 搬至 `src/direct/`

4 个文件从 `client/direct/` 搬到 `src/direct/`，import 路径修正（`../../` → `../`）。TUI 通过 `createTuiClientFromFacades`（`index.tsx`）直接组合。

- **新**: `packages/codingcode/src/direct/agent-runtime.ts`
- **新**: `packages/codingcode/src/direct/sessions.ts`
- **新**: `packages/codingcode/src/direct/settings.ts`
- **新**: `packages/codingcode/src/direct/models.ts`

`AgentRuntimeClient` 接口在此次重构中补全了 checkpoint/rollback/fork 方法（之前是空壳 stub）。

### 1c. TUI 重写 `index.tsx` + `App.tsx`

- **新**: `packages/tui/src/index.tsx` — 定义 `TuiClient` 接口（17 方法，非 50）、导出 `createTuiClientFromFacades(llm, rt)`、`runTui({client})`
- **改**: `packages/tui/src/components/App.tsx` — `AgentClient` → `TuiClient` 类型（24 处调用签名不变）
- **改**: `packages/codingcode/src/cli.ts` — 调用 `createTuiClientFromFacades` 而非 `createDirectClient`

### 1d. `package.json` exports 更新

**删**:
- `./client/direct`
- `./client/direct-clients`

**增**:
- `./direct/agent-runtime`
- `./direct/sessions`
- `./direct/settings`
- `./direct/models`
- `./agent/stream-adapter`

### 1e. 桌面端零修改

desktop 一直使用 `createHttpClients`（`client/http/index.ts`）走 HTTP sub-clients，不受 `client/direct/` 重组影响。

---

## 2. HTTP SDK 侧清理

### 2a. checkpoint 空壳改转发（修复 `createHttpClient` 假数据 bug）

`client/http.ts:136-215` 的 10 个 checkpoint/rollback/fork 方法从硬编码空返回改为转发 `clients.agent.*`，与其他方法一致风格。

- `getCheckpoints`, `getCheckpointDiff`, `revertCheckpointFiles`, `previewRollbackDiff`, `rollbackCodeToTurn`, `rollbackContext`, `rollbackBothToTurn`, `undoLastCodeRollback`, `getRollbackState`, `forkSession`

### 2b. `AgentRuntimeClient` 接口补全

`http/agent-runtime.ts` 和 `direct/agent-runtime.ts` 的 `AgentRuntimeClient` 接口同步添加了 10 个 checkpoint/rollback/fork 方法声明和实现。之前只有 `sendMessage`/`sendApprovalResponse`/`compact`。

---

## 3. 计算路径统一

### 3a. `core/paths.ts`（新建）

将 `computePaths`、`projectSessionsDir`、`sessionJsonlPathFromCwd` 从 `session/file-ops.ts` 搬至 `core/paths.ts`，定义独立 `SessionPaths` 接口避免 `core → session` 反向依赖。

### 3b. server routes 清手搓 `replace`

- `server/routes/messages.ts` `:45` `sessionJsonlPathFromCwd(...).replace('.jsonl','.index.json')` → `computePaths(normalizedCwd, sessionId).indexPath`
- `server/routes/sessions.ts` `:300` 同上 + `:618` `sessionJsonlPathFromCwd(cwd, newSessionId)` → `computePaths(cwd, newSessionId).transcriptPath`

### 3c. 9 处调用方 import 路径更新

`session/store.ts`、`runtime/project-runtime.ts`、`tools/domains/subagent/dispatch.ts`、`plan/index.ts`、`memory/index.ts`、`session/ui-history.ts` 改从 `core/paths.js` import。

---

## 4. 会话层审计 + IO 合并

### 4a. `parentSessionId` 进 `SessionIndex`

`session/types.ts` `:SessionIndex` + `SessionStoreState` 加 `parentSessionId?: string`。`create` 的 opts 接收并写入 state 和 index file。

### 4b. create + activeProfile 一次写

`create` opts 扩展 `activeProfile?: string`，`updateIndex` 同时写入 activeProfile（通过 `writeIndexAtomic` merge 写，避免 record 流 stale 覆盖）。4 个调用方（agent.ts、sessions.ts、dispatch.ts、direct/sessions.ts）删除后续 `setActiveProfile` 二次写。

### 4c. `createSessionWithProfile` helper

SessionService 新增方法，内部 `activeProfile = opts?.activeProfile ?? modeToProfile(options.mode).name`，统一 4 处"create + setActiveProfile"重复模式。

### 4d. 删废参

`setSessionProfile`/`restoreSessionProfile` 第 5 参 `_parentSessionId` 删除（无调用方传，函数体未用）。

---

## 5. 错误处理统一

`NotFoundError` + `AlreadyExistsError` 加 `readonly code` 字段 + `httpStatus()` 方法。`server/index.ts` `app.onError` 合并为统一的 `code`+`httpStatus` 判断，删 3 分支 `instanceof` 硬编码字符串。

---

## 6. scheduler `approvalOverride` 修 latent bug

`scheduler/service.ts` 两个 `approvalOverride: { permissionMode: 'bypass' }` 字面量替换为 `ApprovalService.fork({ permissionMode: 'bypass' })` 真实实例。原字面量无 `.evaluate` 方法，任何工具调用会抛 `not a function`。

同时收紧类型：`agent.ts:125`、`types.ts:101`、`executor.ts:28,135,185` 从 `approvalOverride?: any` → `ApprovalService`。

---

## 7. `sendMessage` options 改可选 + 守卫

`mode`/`permissionMode`/`model` 在 `sendMessage` options 中改为可选。`!sessionId` 新会话分支守卫：三者缺一即抛 `SESSION_CONFIG_REQUIRED`。

3 个调用方条件构造 options：messages.ts（已有会话不传）、direct/agent-runtime.ts（!sessionId 才传）、direct.ts（!currentSessionId 才传）。scheduler 恒传。

---

## 8. 客户端补 4 个缺失方法 + `getMemoryConfig` 类型修复

`http/settings.ts` + `direct/settings.ts` 接口和实现各加：
- `setMemoryModel`
- `getAgentConfig`
- `setCompactionModel`

`http/sessions.ts` + `direct/sessions.ts` 各加：
- `getSessionPlan`

`getMemoryConfig` 返回类型加 `model: string`（服务端实际返回，类型说谎）。

---

## 9. `core-api.ts` 5 处 `api()` 裸调用改 `clients.*`

`packages/desktop/src/lib/core-api.ts`：
- `getMemoryConfig` → `clients.settings.getMemoryConfig()`
- `setMemoryModel` → `clients.settings.setMemoryModel()`
- `getAgentConfig` → `clients.settings.getAgentConfig()`
- `setCompactionModel` → `clients.settings.setCompactionModel()`
- `getSessionPlan` → `clients.sessions.getSessionPlan()`

---

## 10. `clean:out` 脚本

`packages/desktop/package.json` 加 `"clean:out": "node -e \"require('fs').rmSync('out',{recursive:true,force:true})\""`（跨平台零依赖）。

---

## 11. `docs-hidden/` 删除

trade-off 文档目录删除（已 gitignore、从未提交）。

---

## 12. 移动 `agentEventToStreamChunk` 到 `agent/stream-adapter.ts`

70 行 chunk 转换函数从 `client/direct.ts` 搬出为独立文件，`direct/agent-runtime.ts` 改 import 路径。

---

## 测试

### 新增 21 测试文件

| 文件 | 验证 |
|---|---|
| `test/agent/send-message-optional-mode.test.ts` | sendMessage mode 可选 + 守卫 |
| `test/agent/stream-adapter.test.ts` | `agentEventToStreamChunk` 在新位置的正常工作 |
| `test/client/missing-methods.test.ts` | 4 个新 method 存在 |
| `test/client/http-direct-parity.test.ts` | http/direct sendMessage 签名一致 |
| `test/client/get-session-plan.test.ts` | getSessionPlan 双实现 |
| `test/core/paths.test.ts` | computePaths 在 core/paths 正确导出 |
| `test/core/error-code.test.ts` | NotFoundError/AlreadyExistsError code+httpStatus |
| `test/server/routes-use-compute-paths.test.ts` | server routes 使用 computePaths |
| `test/scheduler/approval-bypass.test.ts` | scheduler 使用 real ApprovalService |
| `test/session/parent-session-id.test.ts` | parentSessionId 写 index |
| `test/session/create-active-profile.test.ts` | create 一次写 activeProfile，无 stale 覆盖 |
| `test/session/create-session-with-profile.test.ts` | helper 默认派生 + dispatch 覆盖 |
| `test/desktop/core-api-clients.test.ts` | 5 wrapper 走 clients.* |
| `test/server/messages-fork-permission-mode.test.ts` | messages 路由 permission mode fork |
| `test/approval/fork-permission-mode.test.ts` | approval fork 功能 |
| `test/session/disk-setters.test.ts` | 三个独立 setter |

### 修改 12 测试文件

import 路径更新（`client/direct/*` → `direct/*`）、签名变更（`setSessionProfile` 删第 5 参、`createDirectClient` 换 `createDirectModelClient` 等）。

### 删除 4 测试文件

`agent-client-cwd.test.ts`（依赖已删的 `createDirectClient`）、`agent-routes.test.ts`、`plan-mode-reject-perm-mode.test.ts`、`active-sessions.test.ts`。

---

## 验证

```
pnpm run typecheck   ✅ 零 src/ 错误
pnpm test            ✅ 1290 passed, 184 files
pnpm run lint        ✅ 通过
```

---

## 范围外（最后指出）

- `packages/tui/src/hooks/useAgentRunner.ts:33` typo `pendingTodods`（:102,:139 仍用）——非本议题范围。
- `packages/codingcode/test/ci/tooling-scripts.test.ts` `pnpm run format:check` 失败——预先存在。
