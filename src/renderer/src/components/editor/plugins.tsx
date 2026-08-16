// src/renderer/src/components/editor/plugins.tsx
// 编辑器自定义元素组件：图片、表格（三线表）、数学公式（KaTeX 渲染 + 可编辑输入）、引用块/代码块（备注）

import { useEffect, useRef, useState, type JSX, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Sparkles, StickyNote, X } from 'lucide-react'
import { useEquationElement, useEquationInput } from '@platejs/math/react'
import { useEditorRef, useEditorSelector, useReadOnly, useSelected } from 'platejs/react'
import type { TEquationElement } from 'platejs'

/* ---------- 通用元素 props ---------- */

interface ElementProps {
  attributes: Record<string, unknown>
  children: ReactNode
  element: Record<string, unknown>
}

/** KaTeX 渲染选项（与官网 equation-node 一致：渲染不抛错） */
const KATEX_OPTIONS = {
  errorColor: '#cc0000',
  throwOnError: false,
  strict: 'warn',
  trust: false
} as const

/** useEquationElement 要求 katexRef 为 HTMLDivElement，统一从 span ref 断言 */
function asKatexRef(ref: { current: HTMLSpanElement | null }): MutableRefObject<HTMLDivElement | null> {
  return ref as unknown as MutableRefObject<HTMLDivElement | null>
}

/* ---------- 图片 ---------- */

/** 图片元素：渲染 <img>（url 为 data URL 或普通 URL） */
export function ImageElement({ attributes, children, element }: ElementProps): JSX.Element {
  const url = element.url as string | undefined
  return (
    <div {...attributes}>
      <div contentEditable={false} className="editor-image-wrap">
        {url ? <img src={url} alt="" className="editor-image" /> : <span className="editor-image-empty">图片</span>}
      </div>
      {children}
    </div>
  )
}

/* ---------- 表格 ---------- */

interface TableElementProps {
  attributes: Record<string, unknown>
  children: ReactNode
  element: { threeLine?: boolean }
}

/** 表格元素组件：支持三线表样式（节点 threeLine 属性） */
export function TableElement({ attributes, children, element }: TableElementProps): JSX.Element {
  const threeLine = element.threeLine === true
  return (
    <div {...attributes} className={`plate-table-wrap ${threeLine ? 'plate-table-three' : ''}`}>
      <table className={threeLine ? 'table-three-line' : 'table-normal'}>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** 表格行：渲染为真正的 <tr>（默认组件渲染 div 会导致非法 HTML 表格不可见） */
export function TableRowElement({ attributes, children }: ElementProps): JSX.Element {
  return <tr {...attributes}>{children}</tr>
}

/** 表格单元格：渲染为 <td> */
export function TableCellElement({ attributes, children }: ElementProps): JSX.Element {
  return <td {...attributes}>{children}</td>
}

/** 表头单元格：渲染为 <th> */
export function TableCellHeaderElement({ attributes, children }: ElementProps): JSX.Element {
  return <th {...attributes}>{children}</th>
}

/* ---------- 备注控件（引用块/代码块共用） ---------- */

interface NoteBadgeProps {
  element: Record<string, unknown> & { note?: string }
}

/**
 * 备注标签：默认显示 图标+备注文字（无备注显示"备注"，点击直接编辑）；
 * 编辑态：输入框 + √ 保存 / × 取消。文字超长省略号。
 */
function NoteBadge({ element }: NoteBadgeProps): JSX.Element | null {
  const editor = useEditorRef()
  const readOnly = useReadOnly()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // 备注输入浮层位置（点击按钮时的屏幕坐标；Portal 到 body，脱离 contenteditable）
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const note = element.note ?? ''

  const saveNote = (): void => {
    // 用元素自身找 path（findPath 不依赖 selection，避免按钮 stopPropagation 后选不到块）
    const path = editor.api.findPath(element as never)
    if (path) {
      editor.tf.setNodes({ note: draft.trim() }, { at: path })
    }
    setEditing(false)
  }

  const cancelNote = (): void => setEditing(false)

  if (readOnly) {
    return note ? (
      <span className="note-tag-readonly">
        <StickyNote size={12} />
        <span className="note-text">{note}</span>
      </span>
    ) : null
  }

  return (
    <span className="note-badge" onMouseDown={(e) => e.stopPropagation()}>
      {editing && pos ? (
        // 输入框替换按钮（视觉原位：Portal 浮层定位在按钮左上角，看起来就是按钮变成了输入框）。
        // Portal 到 body 是为了彻底隔离 Enter/beforeinput/composition 与编辑器的交互
        // （修复 2026-08-13：内嵌 input 时中文输入法确认 Enter 的 insertParagraph 穿透到
        // 编辑器旧 selection，导致引用块/代码块插行、选中文字被替换）
        createPortal(
          <span
            className="note-edit note-edit-float"
            style={{ left: pos.x, top: pos.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              className="note-input"
              type="text"
              placeholder="输入备注…"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={cancelNote}
              onKeyDown={(e) => {
                // 阻止冒泡（输入框已脱离编辑器，双保险）
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveNote()
                }
                if (e.key === 'Escape') cancelNote()
              }}
            />
            <button
              className="note-ok"
              data-tip="保存"
              onMouseDown={(e) => e.preventDefault()}
              onClick={saveNote}
            >
              <Check size={13} />
            </button>
            <button
              className="note-cancel"
              data-tip="取消"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancelNote}
            >
              <X size={13} />
            </button>
          </span>,
          document.body
        )
      ) : (
        <button
          className={`note-btn ${note ? 'note-btn-has' : ''}`}
          data-tip={note ? `备注：${note}` : '添加备注'}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            // 原位：输入框从按钮位置展开（视觉=按钮变成输入框）。
            // 按钮固定在引用块/代码块右上角（右侧无空间），输入框从按钮右缘向左展开，
            // 左侧可用空间不足时贴 8px 边距，保证不延伸出可见区
            const INLINE_W = 120
            setPos({ x: Math.max(8, r.right - INLINE_W), y: r.top })
            setDraft(note)
            setEditing(true)
          }}
        >
          <StickyNote size={13} />
          <span className="note-text">{note || '备注'}</span>
        </button>
      )}
    </span>
  )
}

/* ---------- 引用块（含备注） ---------- */

interface BlockElementProps {
  attributes: Record<string, unknown>
  children: ReactNode
  element: Record<string, unknown> & { note?: string }
}

/** 引用块元素：右上角备注按钮（NoteBadge）；aiPreview 标记时显示 AI 生成预览样式 */
export function BlockquoteElement({ attributes, children, element }: BlockElementProps): JSX.Element {
  const isAi = element.aiPreview === true
  return (
    <div {...attributes} className={`blockquote-wrap ${isAi ? 'blockquote-ai' : ''}`}>
      <blockquote>{children}</blockquote>
      {isAi ? (
        <span className="ai-quote-label">
          <Sparkles size={12} /> AI 生成
        </span>
      ) : (
        <NoteBadge element={element} />
      )}
    </div>
  )
}

/* ---------- 代码块（含备注） ---------- */

/** 代码块元素：保持 pre>code>div.code_line 结构（normalize 强制），右上角备注按钮 */
export function CodeBlockElement({ attributes, children, element }: BlockElementProps): JSX.Element {
  return (
    <div {...attributes} className="code-block-wrap">
      <pre className="code-block-pre">
        <code>{children}</code>
      </pre>
      <NoteBadge element={element} />
    </div>
  )
}

/* ---------- 数学公式 ---------- */

/**
 * 公式输入框（官网 equation-node 模式）：
 * useEquationInput 负责 textarea 值同步（实时写入 texExpression）、Enter 提交、Escape 取消（行内恢复初始值）
 */
function EquationInputBox({
  isInline,
  onClose
}: {
  isInline: boolean
  onClose: () => void
}): JSX.Element {
  const input = useEquationInput({ isInline, open: true, onClose })
  return (
    <div className="equation-input-wrap" contentEditable={false}>
      <textarea
        ref={input.ref}
        {...input.props}
        className="equation-input"
        rows={isInline ? 1 : 3}
        placeholder={isInline ? '行内公式，如 E = mc^2' : '块级公式，如 \\int_a^b f(x) dx'}
        autoFocus
        onKeyDown={(e) => {
          // 阻止冒泡到编辑器（否则 Backspace/方向键会被 Plate 拦截），再执行官方 Enter/Escape 逻辑
          e.stopPropagation()
          input.props.onKeyDown?.(e)
        }}
      />
      <button className="btn-plain equation-input-done" onClick={input.onSubmit}>
        完成
      </button>
    </div>
  )
}

/** 块级公式元素：KaTeX 渲染 + 点击打开输入框（readOnly 时仅展示） */
export function EquationElement({ attributes, children, element }: ElementProps): JSX.Element {
  const selected = useSelected()
  const readOnly = useReadOnly()
  const [open, setOpen] = useState(selected)
  const katexRef = useRef<HTMLSpanElement | null>(null)
  const tex = (element.texExpression as string | undefined) ?? ''

  // 官网 useEquationElement：把 texExpression 渲染成 KaTeX（块级 display 模式）
  useEquationElement({
    element: element as TEquationElement,
    katexRef: asKatexRef(katexRef),
    options: { ...KATEX_OPTIONS, displayMode: true }
  })

  return (
    <div {...attributes} className="equation-block" contentEditable={false}>
      <div
        className={`equation-display ${selected ? 'equation-selected' : ''}`}
        onClick={() => {
          if (!readOnly) setOpen(true)
        }}
      >
        {tex ? (
          <span ref={katexRef} />
        ) : (
          <span className="equation-placeholder">点击输入 LaTeX 公式</span>
        )}
      </div>
      {open && !readOnly && <EquationInputBox isInline={false} onClose={() => setOpen(false)} />}
      {children}
    </div>
  )
}

/** 行内公式元素：选中（折叠选区）时自动打开输入框 */
export function InlineEquationElement({ attributes, children, element }: ElementProps): JSX.Element {
  const selected = useSelected()
  const readOnly = useReadOnly()
  const isCollapsed = useEditorSelector((editor) => editor.api.isCollapsed(), [])
  const [open, setOpen] = useState(selected && isCollapsed)
  const katexRef = useRef<HTMLSpanElement | null>(null)
  const tex = (element.texExpression as string | undefined) ?? ''

  // 行内公式：非 display 模式（行内渲染）
  useEquationElement({
    element: element as TEquationElement,
    katexRef: asKatexRef(katexRef),
    options: { ...KATEX_OPTIONS, displayMode: false }
  })

  // 官网逻辑：编辑器选区进入行内公式（且折叠）时自动打开输入
  useEffect(() => {
    if (selected && isCollapsed) setOpen(true)
  }, [selected, isCollapsed])

  return (
    <span {...attributes} className="equation-inline" contentEditable={false}>
      <span className="equation-inline-display" onClick={() => !readOnly && setOpen(true)}>
        {tex ? (
          <span ref={katexRef} />
        ) : (
          <span className="equation-placeholder equation-placeholder-inline">公式</span>
        )}
      </span>
      {open && !readOnly && <EquationInputBox isInline onClose={() => setOpen(false)} />}
      {children}
    </span>
  )
}
