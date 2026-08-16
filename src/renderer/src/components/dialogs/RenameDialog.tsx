// src/renderer/src/components/dialogs/RenameDialog.tsx
// 重命名对话框：输入新名称，重名时软件风格提示（替代原生 alert）。
// 点击遮罩不关闭（外部点不动，Esc/取消/确定关闭）；成功后联动迁移打开的标签。

import { useEffect, useRef, useState, type JSX } from 'react'
import { useUiStore, type RenameRequest } from '../../store/uiStore'
import { useAppStore } from '../../store/appStore'
import { refreshCurrentTree } from '../../hooks/useFileOps'

export default function RenameDialog({ request }: { request: RenameRequest }): JSX.Element {
  const setRename = useUiStore((s) => s.setRename)
  const [name, setName] = useState(request.currentName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(request.currentName)
  }, [request])

  /** 软件风格提示（替代原生 window.alert）；关闭后焦点还给输入框 */
  const showAlert = (message: string): void => {
    useUiStore.getState().showAlert(message, () => inputRef.current?.focus())
  }

  const submit = async (): Promise<void> => {
    const finalName = name.trim()
    if (!finalName) return
    const res = await window.api.rename(request.path, finalName)
    if (res.ok) {
      // 重命名成功后联动迁移打开的标签（路径/名字/内容缓存；文件夹重命名按前缀匹配）
      const newPath = `${request.path.slice(0, request.path.lastIndexOf('\\') + 1)}${finalName}`
      useAppStore.getState().renameOpenFile(request.path, newPath, finalName)
      await refreshCurrentTree()
      setRename(null)
    } else if (res.error === 'EXISTS') {
      showAlert(`已存在同名"${finalName}"，请换一个名称`)
    } else {
      showAlert(`重命名失败：${res.error ?? '未知错误'}`)
    }
  }

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-title">重命名</div>
        <input
          className="dialog-input"
          autoFocus
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') setRename(null)
          }}
        />
        <div className="dialog-actions">
          <button className="btn-plain" onClick={() => setRename(null)}>
            取消
          </button>
          <button className="btn-primary" onClick={() => void submit()}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
