// src/renderer/src/components/dialogs/AlertDialog.tsx
// 提示对话框：绿色主题单按钮（替代原生 window.alert，避免系统默认样式与焦点丢失）。
// 点击遮罩 / 按钮 / Enter 关闭；关闭后执行 onClose 回调（用于把焦点还给调用方输入框）。

import { type JSX } from 'react'
import { Info } from 'lucide-react'
import { useUiStore } from '../../store/uiStore'

export default function AlertDialog(): JSX.Element | null {
  const alert = useUiStore((s) => s.alert)
  const closeAlert = useUiStore((s) => s.closeAlert)
  if (!alert) return null

  const close = (): void => {
    closeAlert()
    alert.onClose?.()
  }

  return (
    <div className="dialog-overlay" onClick={close}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">
          <span className="dialog-title-text">
            <Info size={15} className="dialog-confirm-icon" /> 提示
          </span>
        </div>
        <div className="dialog-confirm-message">{alert.message}</div>
        <div className="dialog-actions">
          <button className="btn-primary" autoFocus onClick={close}>
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
