interface HookGroup {
  label: string
  points: { name: string; description: string; type: 'observer' | 'decision' }[]
}

const HOOK_GROUPS: HookGroup[] = [
  {
    label: '工具执行',
    points: [
      { name: 'tool.execute.before', description: '工具执行前触发', type: 'decision' },
      { name: 'tool.execute.after', description: '工具执行成功后触发', type: 'observer' },
      { name: 'tool.execute.error', description: '工具执行失败后触发', type: 'observer' },
      { name: 'tool.execute.denied', description: '工具被拒绝执行后触发', type: 'observer' },
      { name: 'tool.approval.pre', description: '工具审批请求前触发', type: 'decision' },
      { name: 'tool.approval.post', description: '工具审批完成后触发', type: 'observer' },
    ],
  },
  {
    label: 'LLM 请求',
    points: [
      { name: 'llm.request.before', description: '向模型发送请求前触发', type: 'decision' },
      { name: 'llm.response.after', description: '收到模型响应后触发', type: 'observer' },
      { name: 'llm.response.error', description: '模型响应出错时触发', type: 'observer' },
    ],
  },
  {
    label: '会话',
    points: [
      { name: 'session.save.before', description: '保存会话前触发', type: 'observer' },
      { name: 'session.save.after', description: '保存会话后触发', type: 'observer' },
    ],
  },
  {
    label: 'Agent 轮次',
    points: [
      { name: 'agent.turn.start', description: '一轮对话开始时触发', type: 'observer' },
      { name: 'agent.step.before', description: '每个推理步骤前触发', type: 'decision' },
      { name: 'agent.turn.stop', description: '对话轮次停止时触发', type: 'observer' },
      { name: 'agent.turn.end', description: '对话轮次结束时触发', type: 'observer' },
    ],
  },
  {
    label: '子智能体',
    points: [
      { name: 'agent.subagent.spawn.before', description: '派生子智能体前触发', type: 'decision' },
      { name: 'agent.subagent.spawn.after', description: '子智能体派生后触发', type: 'observer' },
      { name: 'agent.subagent.complete', description: '子智能体任务完成时触发', type: 'observer' },
    ],
  },
]

export default function HooksPanel() {
  return (
    <div className="px-6 py-5">
      <p className="text-[13px] text-[#444] mb-5">
        钩子通过代码注册到 <span className="font-mono text-[#555]">HookService</span>，以下为所有可用的挂载点。
      </p>

      <div className="space-y-6">
        {HOOK_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="text-[11px] font-medium text-[#444] uppercase tracking-wider mb-2 px-1">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.points.map((point) => (
                <div key={point.name}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#1a1a1a] border border-[#222]">
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-mono text-[#ddd]">{point.name}</span>
                    <div className="text-[12px] text-[#555] mt-0.5">{point.description}</div>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded font-mono shrink-0 ${
                    point.type === 'decision'
                      ? 'bg-[#2a1a10] text-[#ce9178]'
                      : 'bg-[#1a2a1a] text-[#6a9955]'
                  }`}>
                    {point.type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
