// src/renderer/src/components/dialogs/ConfirmDialog.tsx
// 确认对话框：绿色主题，确认/取消两个按钮（恢复快照等覆盖类操作前确认）

import { type JSX } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useUiStore, type ConfirmRequest } from '../../store/uiStore'

export default function ConfirmDialog({ request }: { request: ConfirmRequest }): JSX.Element {
  const closeConfirm = useUiStore((s) => s.closeConfirm)

  const confirm = (): void => {
    closeConfirm()
    request.onConfirm()
  }

  const cancel = (): void => {
    closeConfirm()
    request.onCancel?.()
  }

  return (
    <div className="dialog-overlay" onClick={cancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">
          <span className="dialog-title-text">
            <AlertTriangle size={15} className="dialog-confirm-icon" /> 确认操作
          </span>
        </div>
        <div className="dialog-confirm-message">{request.message}</div>
        <div className="dialog-actions">
          <button className="btn-plain" onClick={cancel}>
            取消
          </button>
          <button className="btn-primary" onClick={confirm}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
