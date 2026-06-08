import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('React ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-[var(--bg-base)] text-[var(--text-primary)] p-6">
          <h1 className="text-xl font-semibold mb-2">出错了</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            页面渲染时发生异常，请刷新重试。
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/80 rounded text-[var(--text-inverse)] text-sm"
          >
            刷新页面
          </button>
          {this.state.error && (
            <pre className="mt-4 p-3 bg-[var(--bg-hover)] rounded text-xs text-[var(--text-secondary)] max-w-full overflow-auto whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
