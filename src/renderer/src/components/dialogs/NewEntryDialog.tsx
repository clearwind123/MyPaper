// src/renderer/src/components/dialogs/NewEntryDialog.tsx
// 新建文件/文件夹对话框：标题带图标；点击遮罩不关闭（外部点不动，Esc/取消/确定关闭）；
// 创建文件 = 文件名 + 后缀下拉（默认按全局设置）；创建文件夹 = 名称 + 颜色下拉菜单

import { useEffect, useRef, useState, type JSX } from 'react'
import { ChevronDown, FilePlus2, FolderPlus } from 'lucide-react'
import { useUiStore, type NewEntryRequest } from '../../store/uiStore'
import { useAppStore } from '../../store/appStore'
import { refreshCurrentTree } from '../../hooks/useFileOps'
import { FOLDER_COLORS } from '../../hooks/useTreeActions'
import ExtSelect, { EXTS } from './ExtSelect'

/** 文件夹默认色（浅绿填充） */
const DEFAULT_COLOR = '#d3ecdc'

function defaultBaseName(kind: 'file' | 'folder'): string {
  return kind === 'file' ? '未命名' : '新建文件夹'
}

export default function NewEntryDialog({ request }: { request: NewEntryRequest }): JSX.Element {
  const setNewEntry = useUiStore((s) => s.setNewEntry)
  const defaultExt = useAppStore((s) => s.config?.settings.defaultNewFileExt ?? 'docx')
  // 纯文件名（不含后缀）；文件后缀默认跟随全局设置；文件夹颜色 null = 不设置（默认浅绿）
  const [name, setName] = useState(() => defaultBaseName(request.kind))
  const [ext, setExt] = useState<'docx' | 'md' | 'txt'>(defaultExt)
  const [color, setColor] = useState<string | null>(null)
  // 颜色下拉开关（点击外部关闭）
  const [colorOpen, setColorOpen] = useState(false)
  const colorWrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /** 软件风格提示（替代原生 window.alert）；关闭后焦点还给名称输入框 */
  const showAlert = (message: string): void => {
    useUiStore.getState().showAlert(message, () => inputRef.current?.focus())
  }

  useEffect(() => {
    setName(defaultBaseName(request.kind))
    setExt(defaultExt)
    setColor(null)
    setColorOpen(false)
  }, [request, defaultExt])

  // 点击颜色下拉外部任意处关闭
  useEffect(() => {
    if (!colorOpen) return
    const onDown = (e: MouseEvent): void => {
      if (colorWrapRef.current && !colorWrapRef.current.contains(e.target as Node)) {
        setColorOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [colorOpen])

  const submit = async (): Promise<void> => {
    const base = name.trim()
    if (!base) return
    const finalName = request.kind === 'file' ? `${base}.${ext}` : base
    try {
      const res =
        request.kind === 'file'
          ? await window.api.createFile(request.parentPath, finalName)
          : await window.api.createFolder(request.parentPath, finalName)
      if (res.ok) {
        // 创建文件夹且选了颜色：立即写入 folderColors（新路径 = 父目录 + 名称）
        if (request.kind === 'folder' && color) {
          const config = useAppStore.getState().config
          if (config) {
            const next = await window.api.updateConfig({
              folderColors: {
                ...config.folderColors,
                [`${request.parentPath}\\${finalName}`]: color
              }
            })
            useAppStore.setState({ config: next })
          }
        }
        await refreshCurrentTree()
        setNewEntry(null)
      } else if (res.error === 'EXISTS') {
        showAlert(`已存在同名"${finalName}"，请换一个名称`)
      } else {
        showAlert(`创建失败：${res.error ?? '未知错误'}`)
      }
    } catch (err) {
      showAlert(`创建失败：${String(err)}`)
    }
  }

  return (
    <div className="dialog-overlay">
      <div
        className="dialog dialog-new-entry"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setNewEntry(null)
        }}
      >
        <div className="dialog-title">
          <span className="dialog-title-text">
            {request.kind === 'file' ? (
              <FilePlus2 size={16} className="dialog-title-icon" />
            ) : (
              <FolderPlus size={16} className="dialog-title-icon" />
            )}
            {request.kind === 'file' ? '新建文件' : '新建文件夹'}
          </span>
        </div>

        <div className="new-entry-merged">
          <input
            className="new-entry-merged-input"
            autoFocus
            ref={inputRef}
            value={name}
            placeholder={request.kind === 'file' ? '文件名（不含后缀）' : '文件夹名称'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          {request.kind === 'file' ? (
            <>
              <span className="new-entry-merged-sep" />
              <ExtSelect value={ext} onChange={setExt} options={EXTS} />
            </>
          ) : (
            <>
              <span className="new-entry-merged-sep" />
              {/* 文件夹颜色下拉：在合并框内占小部分，箭头在最右边 */}
              <div className="new-entry-color-wrap" ref={colorWrapRef}>
                <button
                  type="button"
                  className="new-entry-merged-color"
                  onClick={() => setColorOpen((v) => !v)}
                >
                  <span
                    className="new-entry-color-dot"
                    style={{
                      background: color
                        ? FOLDER_COLORS.find((c) => c.name === color)?.value
                        : DEFAULT_COLOR
                    }}
                  />
                  <span className="new-entry-color-label">
                    {color ? FOLDER_COLORS.find((c) => c.name === color)?.label ?? '' : '默认'}
                  </span>
                  <ChevronDown size={14} className="new-entry-color-arrow" />
                </button>
                {colorOpen && (
                  <div className="new-entry-color-panel">
                    <button
                      type="button"
                      className={`new-entry-color-item ${color === null ? 'active' : ''}`}
                      onClick={() => {
                        setColor(null)
                        setColorOpen(false)
                      }}
                    >
                      <span className="new-entry-color-dot" style={{ background: DEFAULT_COLOR }} />
                      默认
                    </button>
                    {FOLDER_COLORS.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        className={`new-entry-color-item ${color === c.name ? 'active' : ''}`}
                        onClick={() => {
                          setColor(c.name)
                          setColorOpen(false)
                        }}
                      >
                        <span className="new-entry-color-dot" style={{ background: c.value }} />
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="dialog-hint">
          {request.kind === 'file'
            ? `默认后缀 .${defaultExt}（跟随全局设置，可下拉选择）`
            : '文件夹名称不可包含 \\ / : * ? " < > |'}
        </div>

        <div className="dialog-actions">
          <button className="btn-plain" onClick={() => setNewEntry(null)}>
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
