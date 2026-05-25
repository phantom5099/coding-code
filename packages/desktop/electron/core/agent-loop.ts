import type { BrowserWindow } from 'electron'
import type { Item, Thread, Turn } from '@shared/types'
import { streamCompletion } from './llm.client'
import type { LLMMessage } from './llm.client'
import { getProviderConfig } from './model-config'
import { getLLMTools, executeTool } from './tools'
import { requiresApproval } from './approval.service'
import { storeService } from './store.service'

const SYSTEM_PROMPT = `You are a coding assistant. You have access to tools that let you read files, write files, run shell commands, and search code.
When the user asks you to do something, think step by step and use the appropriate tools.
Always be concise and helpful. When you complete a task, summarize what you did.`

interface ThreadContext {
  abort: AbortController
  pendingApprovals: Map<string, (approved: boolean) => void>
}

const activeContexts = new Map<string, ThreadContext>()

function send(win: BrowserWindow, channel: string, payload: unknown): void {
  if (!win.isDestroyed()) win.webContents.send(channel, payload)
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 11)
}

export async function runAgent(opts: {
  threadId: string
  turnId: string
  userMessage: string
  cwd: string
  model: string
  policy: 'suggest' | 'auto-edit' | 'full-auto'
  win: BrowserWindow
}): Promise<void> {
  const { threadId, turnId, userMessage, cwd, model, policy, win } = opts

  activeContexts.get(threadId)?.abort.abort()
  const abort = new AbortController()
  const pendingApprovals = new Map<string, (approved: boolean) => void>()
  activeContexts.set(threadId, { abort, pendingApprovals })

  let thread = storeService.getThread(threadId)
  if (!thread) {
    thread = {
      id: threadId,
      projectId: '',
      title: userMessage.slice(0, 60),
      cwd,
      turns: [],
      model,
      approvalPolicy: policy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  const userItem: Item = { id: randomId(), type: 'message', role: 'user', content: userMessage }
  const turn: Turn = { id: turnId, items: [userItem], status: 'running' }
  thread.turns.push(turn)

  // Load message history from store
  const messages: LLMMessage[] = storeService.getMessageHistory(threadId) as LLMMessage[]
  messages.push({ role: 'user', content: userMessage })

  const providerConfig = getProviderConfig(model)
  if (!providerConfig) {
    const errItem: Item = { id: randomId(), type: 'error', message: `Model not found: ${model}` }
    turn.items.push(errItem)
    turn.status = 'error'
    send(win, 'agent:chunk', { threadId, turnId, chunk: errItem })
    send(win, 'agent:done', { threadId, turnId, error: 'Model not configured' })
    storeService.upsertThread(thread)
    activeContexts.delete(threadId)
    return
  }

  const tools = getLLMTools()
  const MAX_STEPS = 50
  let step = 0

  while (step < MAX_STEPS) {
    step++
    if (abort.signal.aborted) break

    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
    let textContent = ''
    const assistantMsgId = randomId()
    let hasText = false

    const streamError = await new Promise<string | null>((resolve) => {
      streamCompletion(
        providerConfig.baseUrl,
        providerConfig.apiKey,
        providerConfig.modelId,
        [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        tools,
        {
          onText(delta) {
            if (!hasText) {
              hasText = true
              const startItem: Item = { id: assistantMsgId, type: 'message', role: 'assistant', content: '', partial: true }
              send(win, 'agent:chunk', { threadId, turnId, chunk: startItem })
            }
            textContent += delta
            const deltaItem: Item = { id: assistantMsgId, type: 'message', role: 'assistant', content: delta, partial: true }
            send(win, 'agent:chunk', { threadId, turnId, chunk: deltaItem })
          },
          onToolCall(call) {
            toolCalls.push(call)
          },
          onError(err) {
            resolve(err)
          },
          onDone() {
            resolve(null)
          },
        },
        abort.signal
      )
    })

    if (abort.signal.aborted) break

    if (streamError) {
      const errItem: Item = { id: randomId(), type: 'error', message: streamError }
      turn.items.push(errItem)
      send(win, 'agent:chunk', { threadId, turnId, chunk: errItem })
      break
    }

    // Commit accumulated text as complete message item
    if (hasText) {
      const msgItem: Item = { id: assistantMsgId, type: 'message', role: 'assistant', content: textContent, partial: false }
      turn.items.push(msgItem)
      send(win, 'agent:chunk', { threadId, turnId, chunk: msgItem })
    }

    if (toolCalls.length === 0) break

    // Build assistant message with tool_calls for history
    messages.push({
      role: 'assistant',
      content: textContent,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    })

    for (const tc of toolCalls) {
      if (abort.signal.aborted) break

      const needsApproval = requiresApproval(tc.name, tc.args, policy)
      const toolItem: Item = {
        id: tc.id,
        type: 'tool_call',
        name: tc.name,
        args: tc.args,
        status: needsApproval ? 'pending' : 'running',
      }
      turn.items.push(toolItem)
      send(win, 'agent:chunk', { threadId, turnId, chunk: toolItem })

      if (needsApproval) {
        const approved = await new Promise<boolean>((resolve) => {
          pendingApprovals.set(tc.id, resolve)
        })

        if (!approved) {
          const rejectedItem: Item = { id: tc.id, type: 'tool_call', name: tc.name, args: tc.args, status: 'rejected' }
          const idx = turn.items.findLastIndex((i) => i.id === tc.id)
          if (idx >= 0) turn.items[idx] = rejectedItem
          send(win, 'agent:chunk', { threadId, turnId, chunk: rejectedItem })
          messages.push({ role: 'tool', content: 'Tool call rejected by user.', tool_call_id: tc.id, name: tc.name })
          continue
        }

        const runningItem: Item = { id: tc.id, type: 'tool_call', name: tc.name, args: tc.args, status: 'running' }
        const idx = turn.items.findLastIndex((i) => i.id === tc.id)
        if (idx >= 0) turn.items[idx] = runningItem
        send(win, 'agent:chunk', { threadId, turnId, chunk: runningItem })
      }

      const result = await executeTool(tc.name, tc.args as Record<string, unknown>, cwd, abort.signal)
      const resultItem: Item = {
        id: randomId(),
        type: 'tool_result',
        callId: tc.id,
        output: result.output,
        exitCode: result.exitCode,
      }
      turn.items.push(resultItem)
      send(win, 'agent:chunk', { threadId, turnId, chunk: resultItem })
      messages.push({ role: 'tool', content: result.output, tool_call_id: tc.id, name: tc.name })
    }
  }

  turn.status = abort.signal.aborted ? 'error' : 'completed'
  thread.updatedAt = Date.now()
  storeService.upsertThread(thread)
  storeService.setMessageHistory(threadId, messages)
  activeContexts.delete(threadId)
  send(win, 'agent:done', { threadId, turnId })
}

export function abortAgent(threadId: string): void {
  activeContexts.get(threadId)?.abort.abort()
  activeContexts.delete(threadId)
}

export function approveTool(threadId: string, callId: string): void {
  const ctx = activeContexts.get(threadId)
  const fn = ctx?.pendingApprovals.get(callId)
  if (fn) {
    ctx!.pendingApprovals.delete(callId)
    fn(true)
  }
}

export function rejectTool(threadId: string, callId: string): void {
  const ctx = activeContexts.get(threadId)
  const fn = ctx?.pendingApprovals.get(callId)
  if (fn) {
    ctx!.pendingApprovals.delete(callId)
    fn(false)
  }
}
