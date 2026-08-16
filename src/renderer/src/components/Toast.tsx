// src/renderer/src/components/Toast.tsx
// 轻提示 toast：绿色主题，右下角弹出，成功/错误/信息三种样式，自动消失

import { type JSX } from 'react'
import { CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { useUiStore, type ToastState } from '../store/uiStore'

export default function Toast({ toast }: { toast: ToastState }): JSX.Element {
  const closeToast = useUiStore((s) => s.closeToast)
  const isSuccess = toast.type === 'success'
  const isError = toast.type === 'error'
  return (
    <div className={`toast toast-${toast.type}`} onClick={closeToast}>
      {isSuccess ? <CheckCircle2 size={16} /> : isError ? <AlertCircle size={16} /> : <Info size={16} />}
      <span>{toast.message}</span>
    </div>
  )
}
