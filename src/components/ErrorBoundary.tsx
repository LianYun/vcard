// React error boundary that surfaces render-time errors instead of showing a
// blank screen. Falls back to a panel with the error and stack trace.

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Render error:', error)
    console.error('[ErrorBoundary] Component stack:', info.componentStack)
    this.setState({ error, info })
  }

  reset = () => {
    this.setState({ error: null, info: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-rose-50 p-6 text-slate-900">
          <div className="mx-auto max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow ring-1 ring-rose-200">
            <h2 className="text-lg font-bold text-rose-700">⚠️ 应用崩溃了</h2>
            <p className="text-sm text-slate-600">{this.state.error.message}</p>
            <details className="rounded-lg bg-slate-50 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-slate-700">查看堆栈</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-slate-600">
                {this.state.error.stack}
                {this.state.info?.componentStack && '\n\nComponent stack:'}
                {this.state.info?.componentStack}
              </pre>
            </details>
            <button
              onClick={this.reset}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
            >
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
