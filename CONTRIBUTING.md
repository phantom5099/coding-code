# 贡献指南

感谢你对 Coding Code 的关注！本文档介绍如何参与项目贡献。

## 开发环境

```bash
git clone https://github.com/phantom5099/coding-code.git
cd coding-code
pnpm install
```

## 开发命令

```bash
pnpm run typecheck    # 类型检查
pnpm test             # 运行测试
pnpm run dev          # 开发模式（watch）
```

## 目录结构

```
coding-code/
├── packages/
│   ├── codingcode/src/           # @codingcode/core — 核心引擎
│   │   ├── agent/                #   ReAct Loop（纯引擎，无副作用）
│   │   ├── llm/                  #   LLM 客户端工厂（多厂商）
│   │   ├── mcp/                  #   MCP 服务集成
│   │   ├── context/              #   上下文管理 + 自动压缩
│   │   ├── session/              #   JSONL 会话持久化
│   │   ├── memory/               #   长期记忆（用户/项目级）
│   │   ├── checkpoint/           #   变更跟踪 + Shadow Git
│   │   ├── tools/                #   工具注册表 + 执行器
│   │   │   └── domains/          #     按域分类的工具实现
│   │   ├── approval/             #   执行前审批流水线
│   │   ├── hooks/                #   可插拔钩子系统
│   │   ├── skills/               #   技能系统（Markdown 技能包）
│   │   ├── subagent/             #   子智能体加载和注册
│   │   ├── scheduler/            #   调度服务
│   │   ├── rules/                #   规则注入
│   │   ├── client/               #   客户端（HTTP / Direct / SSE）
│   │   ├── core/                 #   核心工具类型和路径
│   │   ├── runtime/              #   项目运行时
│   │   ├── sandbox/              #   沙箱（stub，预留）
│   │   ├── server/               #   Hono HTTP 服务 + SSE
│   │   ├── cli.ts                #   CLI 入口
│   │   └── layer.ts              #   Effect Layer 入口
│   ├── tui/src/                  # @codingcode/tui — Ink 终端 UI
│   │   ├── components/           #   App, InputBox, MessageItem 等
│   │   └── hooks/                #   useAgentRunner, useTerminalSize
│   ├── desktop/                  # @codingcode/desktop — Electron 桌面应用
│   │   ├── electron/             #   主进程（IPC、文件服务、Git 服务）
│   │   └── src/                  #   React 前端（Agent UI、设置面板）
│   └── infra/src/                # @codingcode/infra — 基础设施
├── config/                        # 模型配置
│   └── models.json               # 模型/厂商目录
├── docs/                         # 项目文档
└── package.json                  # pnpm workspaces monorepo
```

## 提交 PR

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/my-feature`
3. 提交变更：请确保通过 `pnpm run typecheck` 和 `pnpm test`
4. 推送分支：`git push origin feature/my-feature`
5. 创建 Pull Request

## 代码规范

- TypeScript 严格模式
- Effect TS 管理依赖注入和错误处理
- 新功能需附带测试

## 报告问题

- 使用 [GitHub Issues](https://github.com/phantom5099/coding-code/issues) 提交 Bug 报告或功能建议
- 请包含复现步骤、预期行为和实际行为
