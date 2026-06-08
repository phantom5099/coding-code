import { useState, useEffect } from 'react';
import Toggle from './Toggle';
import { useGlobalStore } from '../stores/global.store';
import {
  listMcpServers,
  setMcpDisabled,
  resetMcpDisabled,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  listAgents,
} from '../lib/core-api';

interface McpEntry {
  name: string;
  transport: 'stdio' | 'http';
  disabled: boolean;
  toolCount: number;
  source?: 'global' | 'project';
  hasProjectOverride?: boolean;
}

interface McpForm {
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  args: string;
  url: string;
  headers: string;
  env: string;
  concurrency: number;
  autoReconnect: boolean;
}

const EMPTY_FORM: McpForm = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  headers: '',
  env: '',
  concurrency: 3,
  autoReconnect: true,
};

export default function McpPanel({ global: isGlobal }: { global?: boolean }) {
  const [servers, setServers] = useState<McpEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [form, setForm] = useState<McpForm>(EMPTY_FORM);
  const rootPath = useGlobalStore((s) => s.workspace.rootPath);
  const cwd = isGlobal ? undefined : rootPath;

  const load = async () => {
    setLoading(true);
    try {
      const data = await listMcpServers(cwd);
      setServers(data ?? []);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (name: string, disabled: boolean) => {
    await setMcpDisabled(name, disabled, cwd);
    setServers((prev) => prev.map((s) => (s.name === name ? { ...s, disabled } : s)));
  };

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setIsCreating(true);
    setEditingName(null);
    setDeletingName(null);
  };

  const startEdit = (s: McpEntry) => {
    setForm({
      name: s.name,
      transport: s.transport,
      command: '',
      args: '',
      url: '',
      headers: '',
      env: '',
      concurrency: 3,
      autoReconnect: true,
    });
    setEditingName(s.name);
    setIsCreating(false);
    setDeletingName(null);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setEditingName(null);
  };

  const saveForm = async () => {
    const server: Record<string, unknown> = {
      name: form.name,
      concurrency: form.concurrency,
      autoReconnect: form.autoReconnect,
    };
    if (form.transport === 'stdio') {
      server.command = form.command;
      if (form.args.trim())
        server.args = form.args
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    } else {
      server.url = form.url;
      if (form.headers.trim()) {
        server.headers = Object.fromEntries(
          form.headers
            .split('\n')
            .map((l) => l.split(/:\s*/))
            .filter((a) => a[0])
        );
      }
    }
    if (form.env.trim()) {
      server.env = Object.fromEntries(
        form.env
          .split('\n')
          .map((l) => l.split('='))
          .filter((a) => a[0])
      );
    }

    try {
      if (isCreating) {
        await createMcpServer(cwd, server);
      } else if (editingName) {
        if (editingName !== form.name) {
          const agents = await listAgents(cwd);
          const dependent = agents.filter((a: { mcpServers?: string[] }) =>
            a.mcpServers?.includes(editingName)
          );
          if (dependent.length > 0) {
            const names = dependent.map((a: { name: string }) => a.name).join(', ');
            if (
              !confirm(
                `以下智能体引用了此 MCP 服务器：${names}\n重命名后需要手动更新它们的配置。是否继续？`
              )
            )
              return;
          }
        }
        await updateMcpServer(cwd, editingName, server);
      }
      cancelForm();
      await load();
    } catch (e: any) {
      alert(e.message ?? '操作失败');
    }
  };

  const confirmDelete = async () => {
    if (!deletingName) return;
    try {
      const agents = await listAgents(cwd);
      const dependent = agents.filter((a: { mcpServers?: string[] }) =>
        a.mcpServers?.includes(deletingName)
      );
      if (dependent.length > 0) {
        const names = dependent.map((a: { name: string }) => a.name).join(', ');
        if (
          !confirm(
            `以下智能体引用了此 MCP 服务器：${names}\n删除后需要手动更新它们的配置。是否继续？`
          )
        )
          return;
      }
      await deleteMcpServer(cwd, deletingName);
      setDeletingName(null);
      await load();
    } catch (e: any) {
      alert(e.message ?? '删除失败');
    }
  };

  const inputCls =
    'w-full bg-[var(--bg-hover)] border border-[var(--border-hover)] text-[var(--text-title)] px-3 py-2 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]';
  const labelCls = 'text-[12px] text-[var(--text-placeholder)] mb-1';
  const btnPrimary =
    'px-4 py-2 rounded text-[13px] bg-[var(--btn-primary-bg)] text-[var(--accent-primary)] hover:bg-[var(--btn-primary-hover)]';
  const btnDanger =
    'px-4 py-2 rounded text-[13px] bg-[var(--btn-danger-bg)] text-[var(--accent-danger)] hover:bg-[var(--btn-danger-hover)]';
  const btnCancel =
    'px-4 py-2 rounded text-[13px] bg-[var(--border-card)] text-[var(--text-tertiary)] border border-[var(--border-hover)] hover:bg-[var(--border-hover)] hover:border-[var(--border-strong)]';

  if (loading) {
    return <div className="px-6 py-8 text-[14px] text-[var(--text-disabled)]">加载中…</div>;
  }

  return (
    <div className="px-6 py-5">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={startCreate} className={btnPrimary}>
          + 添加服务器
        </button>
      </div>

      {isCreating && (
        <FormCard
          form={form}
          setForm={setForm}
          onSave={saveForm}
          onCancel={cancelForm}
          inputCls={inputCls}
          labelCls={labelCls}
          btnPrimary={btnPrimary}
          btnCancel={btnCancel}
        />
      )}

      {servers.length === 0 && !isCreating ? (
        <div className="text-[14px] text-[var(--text-disabled)] py-8 text-center leading-loose">
          未找到 MCP 服务器配置
          <br />
          <span className="text-[13px] text-[var(--text-disabled)]">点击上方按钮添加服务器</span>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((s) => {
            if (editingName === s.name) {
              return (
                <FormCard
                  key={s.name}
                  form={form}
                  setForm={setForm}
                  onSave={saveForm}
                  onCancel={cancelForm}
                  inputCls={inputCls}
                  labelCls={labelCls}
                  btnPrimary={btnPrimary}
                  btnCancel={btnCancel}
                />
              );
            }
            if (deletingName === s.name) {
              return (
                <div
                  key={s.name}
                  className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--btn-danger-bg)]"
                >
                  <span className="text-[14px] text-[var(--accent-danger)]">
                    删除服务器 {s.name}？
                  </span>
                  <div className="flex gap-2">
                    <button onClick={confirmDelete} className={btnDanger}>
                      确认
                    </button>
                    <button onClick={() => setDeletingName(null)} className={btnCancel}>
                      取消
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={s.name}
                className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[15px] text-[var(--text-title)] truncate">{s.name}</span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                        s.transport === 'http'
                          ? 'bg-[var(--btn-primary-bg)] text-[var(--accent-primary)]'
                          : 'bg-[var(--tag-mcp-bg)] text-[var(--tag-mcp-text)]'
                      }`}
                    >
                      {s.transport}
                    </span>
                    {s.source === 'global' && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--tag-info-bg)] text-[var(--tag-info-text)]">
                        全局
                      </span>
                    )}
                    {s.source === 'project' && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--tag-action-bg)] text-[var(--tag-action-text)]">
                        项目
                      </span>
                    )}
                    {s.hasProjectOverride && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
                        覆盖全局
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] text-[var(--text-disabled)] mt-1 font-mono">
                    {s.toolCount} 个工具
                  </div>
                </div>
                <button
                  title="编辑"
                  onClick={() => startEdit(s)}
                  className="text-[var(--text-disabled)] hover:text-[var(--text-tertiary)] transition-colors shrink-0"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </button>
                <button
                  title="删除"
                  onClick={() => setDeletingName(s.name)}
                  className="text-[var(--text-disabled)] hover:text-[var(--accent-danger)] transition-colors shrink-0"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <Toggle checked={!s.disabled} onChange={(v) => toggle(s.name, !v)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FormCard({
  form,
  setForm,
  onSave,
  onCancel,
  inputCls,
  labelCls,
  btnPrimary,
  btnCancel,
}: {
  form: McpForm;
  setForm: (f: McpForm) => void;
  onSave: () => void;
  onCancel: () => void;
  inputCls: string;
  labelCls: string;
  btnPrimary: string;
  btnCancel: string;
}) {
  return (
    <div className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--accent-primary)]/30 space-y-3">
      <div>
        <div className={labelCls}>名称</div>
        <input
          className={inputCls}
          value={form.name}
          title="名称"
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div>
        <div className={labelCls}>传输方式</div>
        <div className="flex gap-2">
          <button
            onClick={() => setForm({ ...form, transport: 'stdio' })}
            className={`px-3 py-1.5 rounded text-[13px] font-mono transition-colors ${
              form.transport === 'stdio'
                ? 'bg-[var(--btn-primary-bg)] text-[var(--accent-primary)]'
                : 'bg-[var(--border-card)] text-[var(--text-secondary)] border border-[var(--border-hover)]'
            }`}
          >
            stdio
          </button>
          <button
            onClick={() => setForm({ ...form, transport: 'http' })}
            className={`px-3 py-1.5 rounded text-[13px] font-mono transition-colors ${
              form.transport === 'http'
                ? 'bg-[var(--btn-primary-bg)] text-[var(--accent-primary)]'
                : 'bg-[var(--border-card)] text-[var(--text-secondary)] border border-[var(--border-hover)]'
            }`}
          >
            http
          </button>
        </div>
      </div>
      {form.transport === 'stdio' ? (
        <>
          <div>
            <div className={labelCls}>命令 (command)</div>
            <input
              className={inputCls}
              value={form.command}
              title="命令"
              onChange={(e) => setForm({ ...form, command: e.target.value })}
            />
          </div>
          <div>
            <div className={labelCls}>参数 (args)，逗号分隔</div>
            <input
              className={inputCls}
              value={form.args}
              title="参数"
              onChange={(e) => setForm({ ...form, args: e.target.value })}
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <div className={labelCls}>URL</div>
            <input
              className={inputCls}
              value={form.url}
              title="URL"
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </div>
          <div>
            <div className={labelCls}>请求头 (每行 key: value)</div>
            <textarea
              className={`${inputCls} h-16`}
              value={form.headers}
              title="请求头"
              onChange={(e) => setForm({ ...form, headers: e.target.value })}
            />
          </div>
        </>
      )}
      <div>
        <div className={labelCls}>环境变量 (每行 KEY=value)</div>
        <textarea
          className={`${inputCls} h-16`}
          value={form.env}
          title="环境变量"
          onChange={(e) => setForm({ ...form, env: e.target.value })}
        />
      </div>
      <div className="flex gap-4">
        <div className="flex-1">
          <div className={labelCls}>并发数</div>
          <input
            type="number"
            min={1}
            className={inputCls}
            value={form.concurrency}
            title="并发数"
            onChange={(e) => setForm({ ...form, concurrency: Number(e.target.value) || 1 })}
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-[13px] text-[var(--text-tertiary)] cursor-pointer">
            <input
              type="checkbox"
              checked={form.autoReconnect}
              onChange={(e) => setForm({ ...form, autoReconnect: e.target.checked })}
              className="accent-[var(--accent-primary)]"
            />
            自动重连
          </label>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} className={btnPrimary}>
          保存
        </button>
        <button onClick={onCancel} className={btnCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
