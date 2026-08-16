// src/renderer/src/components/ErrorBoundary.tsx
// 错误边界：捕获子组件渲染/生命周期错误，显示错误信息而非整屏崩溃

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="editor-loading editor-error">
          <div className="editor-error-title">编辑器发生错误：</div>
          <pre className="editor-error-message">{String(this.state.error.message || this.state.error)}</pre>
          <button
            className="btn-plain"
            onClick={() => {
              this.setState({ error: null })
            }}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
