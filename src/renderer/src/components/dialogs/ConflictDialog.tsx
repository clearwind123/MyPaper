// src/renderer/src/components/dialogs/ConflictDialog.tsx
// 重名冲突对话框：覆盖 / 保留两者 / 重命名（三选一）+ 取消本次粘贴
// 取消（按钮/ESC/点外部）→ resolve(null) 通知 pasteLoop 清剪贴板并停止粘贴

import { useEffect, useState, type JSX } from 'react'
import { useUiStore, type ConflictRequest } from '../../store/uiStore'
import type { ConflictResolution } from '../../../../shared/types'

export default function ConflictDialog({ request }: { request: ConflictRequest }): JSX.Element {
  const setConflict = useUiStore((s) => s.setConflict)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(request.name)

  const finish = (kind: ConflictResolution, renameTo?: string): void => {
    request.resolve({ kind, renameTo })
    setConflict(null)
  }

  /** 取消本次粘贴：resolve(null) 让 pasteLoop 清剪贴板并停止 */
  const cancel = (): void => {
    request.resolve(null)
    setConflict(null)
  }

  // ESC 取消整个粘贴（重命名输入态下 ESC 只退回三选一，不取消）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !renaming) cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [renaming])

  return (
    <div className="dialog-overlay" onClick={cancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">目标位置已存在同名文件/文件夹</div>
        <div className="dialog-text">
          <span className="dialog-path">{request.name}</span> 已存在，请选择处理方式：
        </div>

        {renaming ? (
          <input
            className="dialog-input"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finish('rename', newName)
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <div className="conflict-actions">
            <button className="btn-primary" onClick={() => finish('overwrite')}>
              覆盖
            </button>
            <button className="btn-plain" onClick={() => finish('keep-both')}>
              保留两者
            </button>
            <button className="btn-plain" onClick={() => setRenaming(true)}>
              重命名
            </button>
            <button className="btn-plain conflict-cancel" onClick={cancel}>
              取消本次粘贴
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
