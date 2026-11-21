import { Home, Settings, Clock3 } from 'lucide-react';
import { useUIStore } from '../stores/ui.store';

export default function ProjectStrip() {
  const view = useUIStore((s) => s.view);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const setView = useUIStore((s) => s.setView);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const handleNavigation = (target: 'agent' | 'automation') => {
    if (view === target) {
      toggleSidebar();
      return;
    }
    setView(target);
  };

  return (
    <nav className="cc-project-strip-shell flex w-[56px] shrink-0 flex-col items-center border-r border-[var(--border-default)] px-1 pb-3 pt-3 select-none">
      <button
        type="button"
        title={view === 'agent' ? (sidebarCollapsed ? '展开主页侧栏' : '收起主页侧栏') : '主页'}
        onClick={() => handleNavigation('agent')}
        className={`cc-rail-button ${view === 'agent' ? 'cc-rail-button-active' : ''}`}
        aria-label={view === 'agent' ? (sidebarCollapsed ? '展开主页侧栏' : '收起主页侧栏') : '主页'}
      >
        <Home size={18} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        title={view === 'automation' ? (sidebarCollapsed ? '展开自动化侧栏' : '收起自动化侧栏') : '自动化'}
        onClick={() => handleNavigation('automation')}
        className={`cc-rail-button ${view === 'automation' ? 'cc-rail-button-active' : ''}`}
        aria-label={view === 'automation' ? (sidebarCollapsed ? '展开自动化侧栏' : '收起自动化侧栏') : '自动化'}
      >
        <Clock3 size={18} strokeWidth={1.7} />
      </button>
      <div className="flex-1" />
      <button
        type="button"
        title="全局设置"
        onClick={() => setView('global-settings')}
        className={`cc-rail-button ${view === 'global-settings' ? 'cc-rail-button-active' : ''}`}
        aria-label="全局设置"
      >
        <Settings size={18} strokeWidth={1.6} />
      </button>
    </nav>
  );
}
