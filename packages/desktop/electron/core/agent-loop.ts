import type { BrowserWindow } from 'electron'
import type { Item, Turn } from '@shared/types'
import type { StreamChunk } from '@codingcode/core'
import { getOrCreateClient, setActiveGen, abortAndClear, deleteClient } from './backend'
import { storeService } from './store.service'

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
  win: BrowserWindow
}): Promise<void> {
  const { threadId, turnId, userMessage, cwd, win } = opts

  abortAndClear(threadId)

  let thread = storeService.getThread(threadId)
  if (!thread) {
    thread = {
      id: threadId,
      projectId: '',
      title: userMessage.slice(0, 60),
      cwd,
      turns: [],
      model: '',
      approvalPolicy: storeService.getApprovalPolicy(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  const turn: Turn = { id: turnId, items: [], status: 'running' }
  thread.turns.push(turn)

  const userItem: Item = { id: randomId(), type: 'message', role: 'user', content: userMessage }
  turn.items.push(userItem)
  send(win, 'agent:chunk', { threadId, turnId, chunk: userItem })

  let client
  try {
    client = await getOrCreateClient(threadId)
    const existingSessionId = storeService.getSessionId(threadId)
    if (existingSessionId && !client.getSessionId()) {
      await client.resumeSession(existingSessionId)
    }
  } catch (err) {
    const errItem: Item = { id: randomId(), type: 'error', message: String(err) }
    turn.items.push(errItem)
    turn.status = 'error'
    send(win, 'agent:chunk', { threadId, turnId, chunk: errItem })
    send(win, 'agent:done', { threadId, turnId, error: String(err) })
    storeService.upsertThread(thread)
    return
  }

  const gen = client.sendMessage(userMessage)
  setActiveGen(threadId, gen)

  // Track current assistant message being built up
  let currentMsgId: string | null = null
  let currentMsgContent = ''

  const flushMsg = () => {
    if (currentMsgId === null) return
    const finalItem: Item = { id: currentMsgId, type: 'message', role: 'assistant', content: currentMsgContent, partial: false }
    const idx = turn.items.findLastIndex((i: Item) => i.id === currentMsgId)
    if (idx >= 0) turn.items[idx] = finalItem
    send(win, 'agent:chunk', { threadId, turnId, chunk: finalItem })
    currentMsgId = null
    currentMsgContent = ''
  }

  try {
    for await (const chunk of gen) {
      if (typeof chunk === 'string') {
        if (!currentMsgId) {
          currentMsgId = randomId()
          currentMsgContent = ''
          const startItem: Item = { id: currentMsgId, type: 'message', role: 'assistant', content: '', partial: true }
          turn.items.push(startItem)
          send(win, 'agent:chunk', { threadId, turnId, chunk: startItem })
        }
        currentMsgContent += chunk
        const deltaItem: Item = { id: currentMsgId, type: 'message', role: 'assistant', content: chunk, partial: true }
        send(win, 'agent:chunk', { threadId, turnId, chunk: deltaItem })
      } else {
        flushMsg()
        handleStructuredChunk(chunk, threadId, turnId, turn, win)
      }
    }
    flushMsg()
    turn.status = 'completed'
  } catch (err) {
    flushMsg()
    const errItem: Item = { id: randomId(), type: 'error', message: String(err) }
    turn.items.push(errItem)
    turn.status = 'error'
    send(win, 'agent:chunk', { threadId, turnId, chunk: errItem })
  } finally {
    abortAndClear(threadId)
    thread.updatedAt = Date.now()
    const sessionId = client.getSessionId()
    if (sessionId) storeService.setSessionId(threadId, sessionId)
    storeService.upsertThread(thread)
    send(win, 'agent:done', { threadId, turnId })
  }
}

function handleStructuredChunk(
  chunk: Exclude<StreamChunk, string>,
  threadId: string,
  turnId: string,
  turn: Turn,
  win: BrowserWindow,
): void {
  switch (chunk.type) {
    case 'tool_start': {
      const item: Item = { id: randomId(), type: 'tool_call', name: chunk.name, args: chunk.args, status: 'running' }
      turn.items.push(item)
      send(win, 'agent:chunk', { threadId, turnId, chunk: item })
      break
    }
    case 'approval_request': {
      const item: Item = { id: chunk.id, type: 'tool_call', name: chunk.tool, args: chunk.args, status: 'pending' }
      turn.items.push(item)
      send(win, 'agent:chunk', { threadId, turnId, chunk: item })
      break
    }
    case 'tool_result': {
      // Update matching tool_call status to done
      const tcIdx = turn.items.findLastIndex((i: Item) => i.type === 'tool_call' && i.name === chunk.name)
      if (tcIdx >= 0) {
        const existing = turn.items[tcIdx] as Item & { type: 'tool_call' }
        const updated: Item = { ...existing, status: 'approved' }
        turn.items[tcIdx] = updated
        send(win, 'agent:chunk', { threadId, turnId, chunk: updated })
      }
      const item: Item = { id: randomId(), type: 'tool_result', callId: chunk.id, output: chunk.output, exitCode: chunk.ok ? 0 : 1 }
      turn.items.push(item)
      send(win, 'agent:chunk', { threadId, turnId, chunk: item })
      break
    }
    case 'tool_denied': {
      const tcIdx = turn.items.findLastIndex((i: Item) => i.type === 'tool_call' && i.name === chunk.name)
      if (tcIdx >= 0) {
        const existing = turn.items[tcIdx] as Item & { type: 'tool_call' }
        const rejected: Item = { ...existing, status: 'rejected' }
        turn.items[tcIdx] = rejected
        send(win, 'agent:chunk', { threadId, turnId, chunk: rejected })
      }
      break
    }
    case 'error': {
      const item: Item = { id: randomId(), type: 'error', message: chunk.message }
      turn.items.push(item)
      send(win, 'agent:chunk', { threadId, turnId, chunk: item })
      break
    }
    case 'todo_update':
      // not rendered in desktop for now
      break
    case 'done':
      // signals natural completion, handled in loop exit
      break
  }
}

export function abortAgent(threadId: string): void {
  abortAndClear(threadId)
  deleteClient(threadId)
}

export async function approveToolCall(threadId: string, callId: string): Promise<void> {
  const client = await getOrCreateClient(threadId)
  await client.sendApprovalResponse(callId, 'y')
}

export async function rejectToolCall(threadId: string, callId: string): Promise<void> {
  const client = await getOrCreateClient(threadId)
  await client.sendApprovalResponse(callId, 'n')
}
