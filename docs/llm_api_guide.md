# 主流 LLM API 格式与 SDK 接入指南

> **版本**: 2025年6月  
> **适用场景**: TypeScript Coding Agent 开发、多厂商 LLM 统一接入  
> **覆盖厂商**: OpenAI、Anthropic、DeepSeek、智谱 AI(GLM)、Kimi、Google Gemini、Mistral、Azure、xAI 等

---

## 目录

1. [API 格式概览](#一api-格式概览)
2. [各厂商 API 详细格式](#二各厂商-api-详细格式)
3. [SDK 覆盖程度分析](#三sdk-覆盖程度分析)
4. [第三方统一 SDK 方案](#四第三方统一-sdk-方案)
5. [Vercel AI SDK 接入指南](#五vercel-ai-sdk-接入指南)
6. [Coding Agent 实战架构](#六coding-agent-实战架构)
7. [选型决策与建议](#七选型决策与建议)

---

## 一、API 格式概览

当前大模型 API 市场呈现 **"OpenAI 格式事实标准"** 与 **"各厂原生协议并存"** 的格局。OpenAI 的 Chat Completions API 凭借先发优势和简洁设计，已成为业界通用协议。DeepSeek、智谱 GLM、Mistral、Google Gemini 等主流厂商均提供 OpenAI 兼容层，开发者仅需修改 `base_url` 和 `api_key` 即可切换模型。与此同时，Anthropic 的 Messages API 凭借独特的 `system` 参数设计和 `max_tokens` 强制要求，建立了差异化但同样成熟的技术生态。

| 厂商 | 原生 API 格式 | OpenAI 兼容 | 主要端点 | 认证方式 |
|------|------------|------------|---------|---------|
| **OpenAI** | Chat Completions | 原生标准 | `POST /v1/chat/completions` | `Authorization: Bearer` |
| **Anthropic** | Messages API | 不兼容 | `POST /v1/messages` | `x-api-key` header |
| **DeepSeek** | OpenAI 兼容 | 完全兼容 | `POST /chat/completions` | `Authorization: Bearer` |
| **智谱 GLM** | OpenAI 兼容+原生 | 完全兼容 | `POST /api/paas/v4/chat/completions` | `Authorization: Bearer` |
| **Google Gemini** | generateContent | 兼容层 | `POST /v1beta/openai/chat/completions` | `Authorization: Bearer` |
| **Mistral** | OpenAI 兼容 | 完全兼容 | `POST /v1/chat/completions` | `Authorization: Bearer` |
| **Kimi (Moonshot)** | OpenAI 兼容 | 完全兼容 | `POST /v1/chat/completions` | `Authorization: Bearer` |
| **Azure OpenAI** | OpenAI 兼容 | 完全兼容 | `POST /openai/deployments/{deployment}/chat/completions` | `api-key` header + Entra ID |
| **xAI (Grok)** | OpenAI 兼容 | 兼容 | `POST /v1/chat/completions` | `Authorization: Bearer` |

---

## 二、各厂商 API 详细格式

### 2.1 OpenAI Chat Completions API

OpenAI 的 Chat Completions API 是整个行业的奠基者，其设计理念以 **简单、通用、可扩展** 为核心。

**核心端点与认证**

API 基础地址为 `https://api.openai.com/v1`，核心聊天端点为 `POST /v1/chat/completions`。认证采用 HTTP Header 中的 `Authorization: Bearer <API_KEY>` 标准 Bearer Token 方案。OpenAI 的 SDK 会自动从环境变量 `OPENAI_API_KEY` 中读取密钥。

**请求体核心字段**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `model` | string | **是** | 模型 ID，如 `gpt-4o`、`gpt-4o-mini`、`o1` |
| `messages` | array | **是** | 消息数组，包含 `system`/`user`/`assistant`/`tool` 角色 |
| `temperature` | float | 否 | 采样温度 (0-2)，默认 1 |
| `max_tokens` | integer | 否 | 最大生成 token 数（可选） |
| `stream` | boolean | 否 | 是否启用 SSE 流式传输 |
| `tools` | array | 否 | 可用的工具/函数列表 |
| `tool_choice` | string/object | 否 | 工具调用策略 (`auto`/`none`/`required`) |
| `response_format` | object | 否 | 输出格式 (`json_object`/`json_schema`) |
| `presence_penalty` | float | 否 | 主题重复惩罚 (-2.0 到 2.0) |
| `frequency_penalty` | float | 否 | 频率重复惩罚 (-2.0 到 2.0) |

**消息格式**

每条消息是一个包含 `role` 和 `content` 的对象。`role` 支持四种类型：`system`（系统指令）、`user`（用户输入）、`assistant`（模型输出）和 `tool`（工具执行结果）。

```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is the capital of France?"},
    {"role": "assistant", "content": "The capital of France is Paris."},
    {"role": "user", "content": "What is its population?"}
  ],
  "temperature": 0.7,
  "max_tokens": 150
}
```

**响应结构**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Paris has a population of approximately 2.1 million people."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 35,
    "completion_tokens": 15,
    "total_tokens": 50
  }
}
```

**关键设计特点**: `system` 消息是消息数组的一部分，与其他消息地位平等。`max_tokens` 为可选参数。工具调用结果通过 `tool` 角色的消息返回。流式传输采用 SSE 格式，以 `data: [DONE]` 标记结束。

---

### 2.2 Anthropic Messages API

Anthropic 的 Messages API 是与 OpenAI 并列的另一大主流协议，其设计哲学强调 **安全对齐** 和 **结构化控制**。

**核心端点与认证**

API 基础地址为 `https://api.anthropic.com`，核心端点为 `POST /v1/messages`。认证方式独具特色，使用 `x-api-key: <API_KEY>` 自定义 Header，而非 `Authorization: Bearer`。此外还需要 `anthropic-version: 2023-06-01` Header 来指定 API 版本。

**请求体核心字段**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `model` | string | **是** | 模型 ID，如 `claude-opus-4`、`claude-sonnet-4-6` |
| `messages` | array | **是** | 消息数组（仅含 `user` 和 `assistant` 角色） |
| `max_tokens` | integer | **是** | 最大输出 token 数（**强制必填**） |
| `system` | string | 否 | 系统提示（**独立顶层参数**，非消息数组的一部分） |
| `temperature` | float | 否 | 采样温度 (0-1.0) |
| `top_p` | float | 否 | 核采样概率质量 (0-1.0) |
| `top_k` | integer | 否 | Top-K 采样限制 |
| `stop_sequences` | array | 否 | 停止序列字符串数组 |
| `stream` | boolean | 否 | SSE 流式传输 |
| `tools` | array | 否 | 可用工具列表 |
| `tool_choice` | object | 否 | 工具选择策略 |

**消息格式**

Messages API 的消息数组 **只包含 `user` 和 `assistant` 角色**。系统提示通过独立的 `system` 顶层参数传递。

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1024,
  "system": "You are a helpful assistant.",
  "messages": [
    {"role": "user", "content": "Hello, Claude."},
    {"role": "assistant", "content": "Hello! How can I help you today?"},
    {"role": "user", "content": "What is the capital of France?"}
  ]
}
```

**响应结构**

```json
{
  "id": "msg_01Xxxxxx",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-6",
  "content": [
    {
      "type": "text",
      "text": "The capital of France is Paris."
    }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 25,
    "output_tokens": 12
  }
}
```

**关键设计特点**: `system` 是独立顶层参数，不在 `messages` 数组中。`max_tokens` 是强制参数。内容采用块结构（content blocks），支持文本块、图像块、工具使用块等多种类型。

---

### 2.3 DeepSeek API

DeepSeek 采用 **完全 OpenAI 兼容** 的策略，开发者从 OpenAI 迁移到 DeepSeek 仅需更换 `base_url` 和 `api_key`。

**核心端点与认证**

- 基础地址: `https://api.deepseek.com`
- 兼容端点: `POST /chat/completions`（完全复刻 OpenAI 路径）
- 认证: `Authorization: Bearer <API_KEY>`
- 额外支持 Anthropic 兼容层: `https://api.anthropic_compatible.deepseek.com/v1`

**模型标识符**

| 模型 ID | 说明 |
|---------|------|
| `deepseek-chat` | 通用对话模型（V3 系列） |
| `deepseek-reasoner` | 推理增强模型（R1 系列） |
| `deepseek-v4-flash` | V4 快速模型（高吞吐场景） |
| `deepseek-v4-pro` | V4 专业模型（复杂推理） |

**Python SDK 调用示例**

```python
from openai import OpenAI

client = OpenAI(api_key="YOUR_DEEPSEEK_API_KEY", base_url="https://api.deepseek.com")

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain quantum computing."}
    ],
    extra_body={"thinking": {"type": "disabled"}}
)
print(response.choices[0].message.content)
```

**独有特性: Thinking Mode（思考模式）**

DeepSeek 引入了独特的 `thinking` 机制，通过 `extra_body` 控制。当思考模式启用时，响应中的 `message.reasoning_content` 字段包含模型的推理过程，而 `message.content` 包含最终答案。

**关键设计特点**: DeepSeek 没有自己的官方 SDK，完全依赖 OpenAI SDK 的兼容层。支持提示缓存（Prompt Cache），缓存命中价格仅为正常价格的 10%。

---

### 2.4 智谱 AI (GLM) API

智谱 AI 的 GLM 系列采用 **"双轨制"** 策略：既提供 OpenAI 兼容端点，也提供原生 `zhipuai` SDK。

**核心端点与认证**

| 区域 | 基础地址 |
|------|---------|
| 中国大陆 | `https://open.bigmodel.cn/api/paas/v4` |
| 国际 | `https://api.z.ai/api/paas/v4` |

**模型家族**

| 模型 | 定位 | 上下文窗口 |
|------|------|-----------|
| GLM-5 | 旗舰模型 | 200K |
| GLM-5-Turbo | 高速版本 | 200K |
| GLM-4.7 | 主力模型 | 200K |
| GLM-4.5-Air | 开源高效版本 | 128K |

**原生 SDK 调用示例**

```python
from zhipuai import ZhipuAI

client = ZhipuAI(api_key="your_api_key")
response = client.chat.completions.create(
    model="glm-5",
    messages=[{"role": "user", "content": "写一篇关于AI的短文"}]
)
print(response.choices[0].message.content)
```

**关键设计特点**: `zhipuai` 原生 SDK 在接口命名上与 OpenAI 保持高度一致（如 `chat.completions.create`）。GLM-4.5 系列采用 MoE 架构，总参数量 355B 但每轮仅激活 32B。GLM-4.5 和 GLM-5 系列均开源（MIT 许可证）。

---

### 2.5 Kimi (Moonshot) API

Kimi 是月之暗面科技有限公司（Moonshot AI）推出的 LLM，其 API 完全兼容 OpenAI 格式。

- 基础地址: `https://api.moonshot.cn/v1`
- 端点: `POST /v1/chat/completions`
- 认证: `Authorization: Bearer <API_KEY>`
- 最大特色: 超长上下文窗口（支持 200 万字符）
- 中文处理能力和对话理解优秀

**Python 调用示例**

```python
from openai import OpenAI

client = OpenAI(api_key="YOUR_MOONSHOT_API_KEY", base_url="https://api.moonshot.cn/v1")

response = client.chat.completions.create(
    model="moonshot-v1-8k",
    messages=[
        {"role": "system", "content": "You are Kimi."},
        {"role": "user", "content": "Hello, Kimi!"}
    ]
)
print(response.choices[0].message.content)
```

---

### 2.6 Google Gemini API

Google Gemini 采用双轨 API 策略：原生 `generateContent` API 提供完整功能，同时提供 OpenAI 兼容端点降低迁移成本。

- OpenAI 兼容端点: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- 认证: `Authorization: Bearer <GEMINI_API_KEY>`
- 支持文本、图像、音频和视频多模态理解
- 上下文窗口可达 100 万 token

---

### 2.7 消息格式核心差异总结

| 维度 | OpenAI 格式 | Anthropic Messages API |
|------|------------|----------------------|
| **System 处理** | `messages` 数组的一部分 | 独立顶层 `system` 参数 |
| **max_tokens** | 可选 | **强制必填** |
| **消息角色** | `system`/`user`/`assistant`/`tool` | 仅 `user`/`assistant` |
| **认证 Header** | `Authorization: Bearer` | `x-api-key` |
| **内容格式** | 字符串或 content 数组 | 块结构（content blocks） |
| **流式格式** | SSE `data: [DONE]` | SSE 多事件类型 |

---

## 三、SDK 覆盖程度分析

### 3.1 官方 SDK 语言覆盖

| 厂商 | 官方 SDK 语言 | SDK 包名 |
|------|-------------|---------|
| **OpenAI** | Python, TypeScript, .NET, Java, Go | `openai`, `openai` (npm), `OpenAI` (NuGet) |
| **Anthropic** | Python, TypeScript, Java, Go, Ruby, C#, PHP | `anthropic`, `@anthropic-ai/sdk` |
| **Google Gemini** | Python, JavaScript/TypeScript | `google-generativeai`, `@google/generative-ai` |
| **Mistral** | Python, JavaScript/TypeScript | `mistralai`, `@mistralai/mistralai` |
| **智谱 AI** | Python, JavaScript, Java, Go | `zhipuai` |
| **DeepSeek** | 无官方 SDK（使用 OpenAI SDK） | 使用 `openai` + 自定义 `base_url` |
| **Moonshot** | Python, JavaScript | `openai` + 自定义 `base_url` |

### 3.2 SDK 功能完整度对比

| 功能特性 | OpenAI SDK | Anthropic SDK | 智谱 SDK | Mistral SDK | DeepSeek |
|---------|-----------|---------------|---------|-------------|----------|
| 同步调用 | 是 | 是 | 是 | 是 | 兼容 |
| 异步/流式 | 是 | 是 | 是 | 是 | 兼容 |
| 工具调用 | 是 | 是 | 是 | 是 | 兼容 |
| JSON 模式 | 是 | 是 | 是 | 是 | 兼容 |
| 多模态输入 | 是 | 是 | 是 | 是 | 否 |
| 提示缓存 | 是 | 是 | 部分 | 否 | 是 |
| 结构化输出 | 是 | 是 | 部分 | 部分 | 部分 |

---

## 四、第三方统一 SDK 方案

如果你不想为每个厂商单独集成 SDK，以下方案可以用 **一套统一接口** 调用所有主流 LLM。

### 4.1 方案总览

| 方案 | 类型 | 支持语言 | 支持厂商 | 核心特点 |
|------|------|---------|---------|---------|
| **LiteLLM** | Python SDK + Gateway | Python（SDK）、任意（Gateway） | **100+** | 将任何厂商转为 OpenAI 格式，内置成本追踪 |
| **Vercel AI SDK** | JavaScript SDK | TypeScript/JavaScript | **24+ 官方 + 社区** | 统一 Provider API + React Hooks + 内置 Agent 循环 |
| **LangChain** | 应用框架 | Python, TypeScript, Java | **70+** | 链式编排、Agent、RAG 集成 |
| **Portkey** | AI Gateway | 任意（兼容 OpenAI SDK） | **250+** | 企业级路由、缓存、监控、安全护栏 |
| **OpenRouter** | API 网关 | 任意（REST API） | **300+** | 一个 API Key 访问所有模型 |

### 4.2 LiteLLM

**LiteLLM** 是最成熟的开源 LLM 统一接入方案，提供 Python SDK 和 Proxy Server 两种使用方式。

```python
import litellm

# 调用 OpenAI
response = litellm.completion(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)

# 切换到 Claude —— 代码完全不变
response = litellm.completion(
    model="anthropic/claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Hello!"}]
)

# 切换到 DeepSeek
response = litellm.completion(
    model="deepseek/deepseek-v4-pro",
    messages=[{"role": "user", "content": "Hello!"}]
)

# 切换到智谱 GLM
response = litellm.completion(
    model="zhipu/glm-5",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### 4.3 Vercel AI SDK

**Vercel AI SDK** 是 JavaScript/TypeScript 生态中最流行的多厂商 AI SDK，设计理念是 **"同一个接口，任意厂商"**。

```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

// 统一接口，切换只改 model 参数
const { text: t1 } = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Explain quantum computing',
});

const { text: t2 } = await generateText({
  model: anthropic('claude-sonnet-4-6'),
  prompt: 'Explain quantum computing',
});
```

---

## 五、Vercel AI SDK 接入指南

### 5.1 安装核心依赖

```bash
# 基础包（必须）
npm install ai zod

# 官方维护的 Provider（按需安装）
npm install @ai-sdk/openai      # OpenAI + 兼容模式
npm install @ai-sdk/deepseek    # DeepSeek 官方
npm install @ai-sdk/moonshotai  # Moonshot Kimi 官方
npm install @ai-sdk/anthropic   # Claude
npm install @ai-sdk/google      # Google Gemini
npm install @ai-sdk/mistral     # Mistral
npm install @ai-sdk/azure       # Azure OpenAI
npm install @ai-sdk/xai         # xAI Grok

# 社区 Provider（国产模型）
npm install zhipu-ai-provider   # 智谱 AI
npm install @openrouter/ai-sdk-provider  # OpenRouter 统一网关
```

### 5.2 国产模型接入方式

#### 方式 A：官方 Provider（推荐）

**DeepSeek** 和 **Kimi** 有 Vercel 官方维护的 Provider：

```typescript
// providers.ts
import { deepseek } from '@ai-sdk/deepseek';
import { moonshotai } from '@ai-sdk/moonshotai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

// 所有 provider 接口完全一致
export const primaryModel = deepseek('deepseek-chat');
// export const primaryModel = moonshotai('kimi-k2.5');
// export const primaryModel = openai('gpt-4o');
// export const primaryModel = anthropic('claude-opus-4');
```

环境变量：
```bash
DEEPSEEK_API_KEY=sk-xxx
MOONSHOT_API_KEY=sk-xxx
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
```

#### 方式 B：OpenAI 兼容模式（通义千问、MiniMax、硅基流动等）

```typescript
import { createOpenAI } from '@ai-sdk/openai';

// 通义千问
export const qwen = createOpenAI({
  name: 'qwen',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY!,
})('qwen-turbo');

// MiniMax
export const minimax = createOpenAI({
  name: 'minimax',
  baseURL: 'https://api.minimax.chat/v1',
  apiKey: process.env.MINIMAX_API_KEY!,
})('abab6.5-chat');

// 硅基流动 (SiliconFlow)
export const siliconflow = createOpenAI({
  name: 'siliconflow',
  baseURL: 'https://api.siliconflow.cn/v1',
  apiKey: process.env.SILICONFLOW_API_KEY!,
})('deepseek-ai/DeepSeek-V2.5');

// 百川智能
export const baichuan = createOpenAI({
  name: 'baichuan',
  baseURL: 'https://api.baichuan-ai.com/v1',
  apiKey: process.env.BAICHUAN_API_KEY!,
})('Baichuan4');
```

#### 方式 C：智谱 GLM（社区 Provider）

```typescript
import { zhipu } from 'zhipu-ai-provider';

// 默认实例（自动读 ZHIPU_API_KEY 环境变量）
export const glm = zhipu('glm-4.7');

// 或自定义实例
import { createZhipu } from 'zhipu-ai-provider';
export const glmCustom = createZhipu({
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: process.env.ZHIPU_API_KEY!,
})('glm-5');
```

#### 方式 D：OpenRouter 统一网关

```typescript
import { openrouter } from '@openrouter/ai-sdk-provider';

// 一个 Provider 访问 300+ 模型
const model = openrouter('anthropic/claude-sonnet-4.6');
// const model = openrouter('deepseek/deepseek-chat');
// const model = openrouter('google/gemini-2.0-flash');
```

### 5.3 国产模型选型速查

| 国产模型 | 接入方式 | 推荐场景 | 优势 |
|---------|---------|---------|------|
| **DeepSeek** | `@ai-sdk/deepseek`（官方） | Coding Agent 主力 | 编程能力极强，$0.14/百万输入 token |
| **Kimi (k2.5)** | `@ai-sdk/moonshotai`（官方） | 长上下文任务 | 256K 上下文，适合处理大代码库 |
| **智谱 GLM-4.7** | `zhipu-ai-provider`（社区） | 中文任务 | 中文理解和生成能力强 |
| **通义千问** | `createOpenAI` 兼容模式 | 阿里云生态 | 与阿里云产品深度集成 |
| **MiniMax** | `createOpenAI` 兼容模式 | 多模态 | 语音/文本/图像多模态 |
| **百川** | `createOpenAI` 兼容模式 | 通用任务 | 国内老牌厂商 |
| **硅基流动** | `createOpenAI` 兼容模式 | 开源模型聚合 | 一个 Key 调用多种开源模型 |

---

## 六、Coding Agent 实战架构

### 6.1 项目结构

```
your-coding-agent/
├── .env                           # API Keys
├── package.json
├── tsconfig.json
├── src/
│   ├── providers/
│   │   ├── index.ts               # 统一导出所有模型
│   │   ├── deepseek.ts            # DeepSeek 配置
│   │   ├── kimi.ts                # Kimi 配置
│   │   ├── glm.ts                 # 智谱配置
│   │   └── qwen.ts                # 通义千问配置
│   ├── tools/
│   │   ├── index.ts               # 工具注册
│   │   ├── filesystem.ts          # 文件读写
│   │   ├── shell.ts               # Shell 执行（带权限控制）
│   │   └── search.ts              # 代码搜索
│   ├── agent/
│   │   ├── index.ts               # Agent 主逻辑
│   │   └── system-prompt.ts       # System prompt
│   └── index.ts                   # CLI 入口
```

### 6.2 核心代码示例

#### providers/index.ts

```typescript
import { deepseek } from '@ai-sdk/deepseek';
import { moonshotai } from '@ai-sdk/moonshotai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { zhipu } from 'zhipu-ai-provider';
import { createOpenAI } from '@ai-sdk/openai';

// DeepSeek（推荐主力，性价比最高）
export const ds = deepseek('deepseek-chat');

// Kimi（长上下文优势）
export const kimi = moonshotai('kimi-k2.5');

// 智谱 GLM（中文能力强）
export const glm = zhipu('glm-4.7');

// OpenAI GPT-4o（兜底）
export const gpt4o = openai('gpt-4o');

// Claude Opus（代码能力最强）
export const claude = anthropic('claude-opus-4');

// 通义千问
const qwenProvider = createOpenAI({
  name: 'qwen',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY!,
});
export const qwen = qwenProvider('qwen-turbo');

// 模型选择器
export const models = {
  coding: ds,
  review: claude,
  fast: ds,
  longContext: kimi,
  chinese: glm,
  fallback: gpt4o,
} as const;
```

#### tools/filesystem.ts

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

export const readFile = tool({
  description: 'Read the contents of a file at the given path',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the file'),
  }),
  execute: async ({ path }) => {
    try {
      const content = readFileSync(path, 'utf-8');
      return { success: true, content, path };
    } catch (error) {
      return { success: false, error: String(error), path };
    }
  },
});

export const writeFile = tool({
  description: 'Write content to a file at the given path',
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  needsApproval: true,
  execute: async ({ path, content }) => {
    try {
      writeFileSync(path, content, 'utf-8');
      return { success: true, path, bytesWritten: content.length };
    } catch (error) {
      return { success: false, error: String(error), path };
    }
  },
});

export const listFiles = tool({
  description: 'List files in a directory',
  inputSchema: z.object({
    path: z.string(),
    recursive: z.boolean().default(false),
  }),
  execute: async ({ path, recursive }) => {
    try {
      const entries = readdirSync(path, { withFileTypes: true, recursive });
      return {
        success: true,
        files: entries
          .filter(e => e.isFile())
          .map(e => join(e.parentPath || path, e.name)),
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});
```

#### agent/index.ts

```typescript
import { generateText } from 'ai';
import { models } from '../providers';
import { readFile, writeFile, listFiles } from '../tools';
import { tool } from 'ai';
import { z } from 'zod';
import { execSync } from 'child_process';

const codingTools = {
  readFile,
  writeFile,
  listFiles,
  runShell: tool({
    description: 'Run a shell command in the project directory',
    inputSchema: z.object({
      command: z.string(),
      cwd: z.string().optional(),
    }),
    needsApproval: true,
    execute: async ({ command, cwd }) => {
      try {
        const output = execSync(command, { cwd, encoding: 'utf-8', timeout: 30000 });
        return { success: true, output };
      } catch (error: any) {
        return { success: false, error: error.stderr || error.message };
      }
    },
  }),
};

const SYSTEM_PROMPT = `You are an expert coding assistant. You can read files,
write and modify files, and run shell commands. Always explain your changes
before making them. Only modify files within the project directory.`;

export async function runCodingAgent(prompt: string) {
  const result = await generateText({
    model: models.coding,
    system: SYSTEM_PROMPT,
    tools: codingTools,
    maxSteps: 15,
    prompt,
  });

  return {
    response: result.text,
    steps: result.steps,
    usage: result.usage,
  };
}
```

#### index.ts (CLI 入口)

```typescript
import { runCodingAgent } from './agent';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const prompt = process.argv.slice(2).join(' ')
    || 'Read the src/index.ts file and explain what it does';

  const result = await runCodingAgent(prompt);

  console.log('\n--- Response ---');
  console.log(result.response);

  console.log('\n--- Usage ---');
  console.log(`Prompt tokens: ${result.usage?.promptTokens}`);
  console.log(`Completion tokens: ${result.usage?.completionTokens}`);
}

main().catch(console.error);
```

### 6.3 流式传输示例

```typescript
import { streamText } from 'ai';
import { models } from './providers';

const stream = streamText({
  model: models.coding,
  prompt: 'Refactor the utils folder',
});

for await (const part of stream.fullStream) {
  if (part.type === 'text-delta') {
    process.stdout.write(part.textDelta);
  }
  if (part.type === 'tool-call') {
    console.log(`Tool: ${part.toolName}(${JSON.stringify(part.args)})`);
  }
  if (part.type === 'tool-result') {
    console.log(`Result: ${JSON.stringify(part.result)}`);
  }
}
```

### 6.4 环境变量模板 (.env)

```bash
# 至少配一个即可工作，多配几个可以切换
DEEPSEEK_API_KEY=sk-xxx
MOONSHOT_API_KEY=sk-xxx
ZHIPU_API_KEY=xxx
DASHSCOPE_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
```

### 6.5 TypeScript 配置

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

---

## 七、选型决策与建议

### 7.1 按场景选择 SDK 方案

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| **TypeScript Coding Agent** | Vercel AI SDK | 原生 TS，内置 Agent 循环和工具调用 |
| **Python 应用开发** | LiteLLM 或 LangChain | 生态最成熟，功能最全 |
| **前端项目 (React/Vue)** | Vercel AI SDK | React Hooks 流式 UI 体验最佳 |
| **企业级生产环境** | Portkey | 安全治理、审计日志、负载均衡 |
| **快速实验多模型** | OpenRouter | 一个 Key 访问 300+ 模型 |
| **本地部署开源模型** | Ollama + LiteLLM/Vercel AI SDK | 私有化，无 API 费用 |

### 7.2 按厂商选择 API 接入方式

| 厂商 | Vercel AI SDK 接入方式 | 包名 |
|------|----------------------|------|
| OpenAI | 官方 Provider | `@ai-sdk/openai` |
| Anthropic (Claude) | 官方 Provider | `@ai-sdk/anthropic` |
| DeepSeek | 官方 Provider | `@ai-sdk/deepseek` |
| Kimi (Moonshot) | 官方 Provider | `@ai-sdk/moonshotai` |
| Google Gemini | 官方 Provider | `@ai-sdk/google` |
| Mistral | 官方 Provider | `@ai-sdk/mistral` |
| Azure OpenAI | 官方 Provider | `@ai-sdk/azure` |
| xAI (Grok) | 官方 Provider | `@ai-sdk/xai` |
| 智谱 GLM | 社区 Provider | `zhipu-ai-provider` |
| 通义千问 | OpenAI 兼容模式 | `@ai-sdk/openai` + `createOpenAI` |
| MiniMax | OpenAI 兼容模式 | `@ai-sdk/openai` + `createOpenAI` |
| 百川 | OpenAI 兼容模式 | `@ai-sdk/openai` + `createOpenAI` |
| 硅基流动 | OpenAI 兼容模式 | `@ai-sdk/openai` + `createOpenAI` |
| OpenRouter | 社区 Provider | `@openrouter/ai-sdk-provider` |

### 7.3 关键结论

1. **OpenAI 格式是事实标准**。除 Anthropic 外，几乎所有主流厂商都提供 OpenAI 兼容端点。
2. **Vercel AI SDK 是 TypeScript 生态的首选**。24+ 官方 Provider + 社区 Provider，统一接口零转换成本。
3. **DeepSeek 是 Coding Agent 的性价比之王**。$0.14/百万输入 token，编程能力可媲美 Claude/GPT-4o。
4. **国产模型全覆盖**。DeepSeek（官方）、Kimi（官方）、智谱（社区）、通义千问（兼容模式）均可通过 Vercel AI SDK 接入。
5. **不需要手动处理格式转换**。Vercel AI SDK 自动处理不同厂商的响应格式、tool_calls、流式数据等差异。

---

## 参考来源

1. [OpenAI API Official Documentation](https://platform.openai.com/docs/api-reference)
2. [Anthropic Messages API Reference](https://docs.anthropic.com/en/api/messages)
3. [DeepSeek API Documentation](https://api-docs.deepseek.com/)
4. [智谱 AI Open Platform Documentation](https://open.bigmodel.cn/)
5. [Moonshot AI API Documentation](https://platform.moonshot.cn/docs)
6. [Vercel AI SDK Official Documentation](https://sdk.vercel.ai/docs)
7. [Vercel AI SDK Providers Registry](https://sdk.vercel.ai/providers)
8. [Google Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
9. [LiteLLM Documentation](https://docs.litellm.ai/)
10. [OpenRouter Documentation](https://openrouter.ai/docs)
