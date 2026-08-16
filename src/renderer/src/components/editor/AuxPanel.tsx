// src/renderer/src/components/editor/AuxPanel.tsx
// 辅助面板（右侧抽屉，挤占布局不遮挡正文）：
// ①引用块备注统计 ②代码块备注统计 ③表格统计(h6) ④图表统计(h5)

import { useMemo, useState, type JSX, type ReactNode } from 'react'
import { PanelRight, ChevronDown, ChevronRight, X, TextQuote, Code2, Table2, Image as ImageIcon } from 'lucide-react'
import type { Value } from 'platejs'
import { useAppStore, type EditorInstance } from '../../store/appStore'
import { useUiStore } from '../../store/uiStore'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface BlockquoteInfo {
  note: string
  text: string
  path: number[]
}

/** 递归遍历收集引用块/代码块信息（备注 + 首行文本） */
function collectNotedBlocks(
  nodes: Value,
  type: string,
  parentPath: number[] = [],
  out: BlockquoteInfo[] = []
): BlockquoteInfo[] {
  nodes.forEach((node, i) => {
    const path = [...parentPath, i]
    if (typeof node === 'object' && node !== null && 'type' in node) {
      const el = node as { type?: string; note?: string; children?: unknown[]; aiPreview?: boolean }
      // AI 生成预览框（blockquote + aiPreview 标记）不属于文档内容，不计入引用块列表
      if (el.type === type && !el.aiPreview) {
        // 取第一行文本作为预览（引用块取全部文本，代码块取首个 code_line）
        const text = (el.children ?? [])
          .map((c) => {
            const t = c as { text?: string }
            return t.text ?? ''
          })
          .join('')
        out.push({ note: el.note ?? '', text: text.trim(), path })
      }
      if (Array.isArray(el.children)) {
        collectNotedBlocks(el.children as Value, type, path, out)
      }
    }
  })
  return out
}

interface HeadingInfo {
  level: number
  text: string
  path: number[]
}

/** 递归遍历收集指定级别标题（h5=图表/图片样式，h6=表格样式） */
function collectHeadingsByLevel(nodes: Value, level: number, parentPath: number[] = [], out: HeadingInfo[] = []): HeadingInfo[] {
  const type = `h${level}`
  nodes.forEach((node, i) => {
    const path = [...parentPath, i]
    if (typeof node === 'object' && node !== null && 'type' in node) {
      const el = node as { type?: string; children?: unknown[] }
      if (el.type === type) {
        const text = (el.children ?? [])
          .map((c) => {
            const t = c as { text?: string }
            return t.text ?? ''
          })
          .join('')
        if (text.trim()) out.push({ level, text: text.trim(), path })
      }
      const children = el.children
      if (Array.isArray(children)) {
        collectHeadingsByLevel(children as Value, level, path, out)
      }
    }
  })
  return out
}

/** 选中并滚动到某 path（跳转） */
function scrollToPath(editor: EditorInstance, path: number[]): void {
  const start = editor.api.start(path)
  if (!start) return
  editor.tf.select({ anchor: start, focus: start })
  editor.api.redecorate()
  const contentEl = document.querySelector('.plate-content') as HTMLElement | null
  contentEl?.focus()
  const domRange = editor.api.toDOMRange?.({ anchor: start, focus: start })
  domRange?.startContainer?.parentElement?.scrollIntoView({ block: 'center' })
}

/** 折叠区块标题（下拉展开/收起）：左侧功能图标 + 标题 + 右侧折叠箭头 */
function Section({
  icon,
  title,
  open,
  onToggle,
  children
}: {
  icon: JSX.Element
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <div className="aux-section">
      <button className={`aux-section-btn ${open ? 'aux-section-btn-open' : ''}`} onClick={onToggle}>
        <span className="aux-section-icon">{icon}</span>
        {title}
        <span className="aux-section-caret">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
      </button>
      {open && <div className="aux-section-body">{children}</div>}
    </div>
  )
}

export default function AuxPanel(): JSX.Element {
  const editor = useAppStore((s) => s.editor)
  const value = useAppStore((s) => (s.activeFile ? s.fileValues[s.activeFile] : undefined))
  // 大文件优化：value 防抖 400ms（同 OutlinePanel：输入停顿才重算统计，
  // 避免每次击键 4 次全树递归收集）
  const debouncedValue = useDebouncedValue(value, 400)
  const auxOpen = useUiStore((s) => s.auxOpen)
  const setAuxOpen = useUiStore((s) => s.setAuxOpen)

  const [openSection, setOpenSection] = useState<string | null>('quote')

  const blockquotes = useMemo(() => (debouncedValue ? collectNotedBlocks(debouncedValue, 'blockquote') : []), [debouncedValue])
  const codeBlocks = useMemo(() => (debouncedValue ? collectNotedBlocks(debouncedValue, 'code_block') : []), [debouncedValue])
  const tables = useMemo(() => (debouncedValue ? collectHeadingsByLevel(debouncedValue, 6) : []), [debouncedValue])
  const charts = useMemo(() => (debouncedValue ? collectHeadingsByLevel(debouncedValue, 5) : []), [debouncedValue])

  const toggleSection = (key: string): void => {
    setOpenSection((k) => (k === key ? null : key))
  }

  if (!auxOpen || !editor) return <></>

  return (
    <div className="aux-drawer">
      <div className="aux-header">
        <span className="aux-header-title">
          <PanelRight size={14} className="aux-header-icon" />
          辅助面板
        </span>
        <button className="icon-btn" data-tip="关闭" onClick={() => setAuxOpen(false)}>
          <X size={14} />
        </button>
      </div>

      <div className="aux-body">
        {/* ① 引用块备注统计 */}
        <Section icon={<TextQuote size={13} />} title="引用块备注" open={openSection === 'quote'} onToggle={() => toggleSection('quote')}>
          <div className="aux-list">
            {blockquotes.length === 0 ? (
              <div className="aux-empty">文档中没有引用块</div>
            ) : (
              blockquotes.map((bq, i) => (
                <button
                  key={`bq-${bq.path.join('-')}-${i}`}
                  className="aux-list-item"
                  data-tip={bq.note ? `备注：${bq.note}` : bq.text}
                  onClick={() => scrollToPath(editor, bq.path)}
                >
                  <span className="aux-list-note">{bq.note || '（无备注）'}</span>
                  <span className="aux-list-text">{bq.text || '引用内容'}</span>
                </button>
              ))
            )}
          </div>
        </Section>

        {/* ①b 代码块备注统计 */}
        <Section icon={<Code2 size={13} />} title="代码块备注" open={openSection === 'code'} onToggle={() => toggleSection('code')}>
          <div className="aux-list">
            {codeBlocks.length === 0 ? (
              <div className="aux-empty">文档中没有代码块</div>
            ) : (
              codeBlocks.map((cb, i) => (
                <button
                  key={`cb-${cb.path.join('-')}-${i}`}
                  className="aux-list-item"
                  data-tip={cb.note ? `备注：${cb.note}` : cb.text}
                  onClick={() => scrollToPath(editor, cb.path)}
                >
                  <span className="aux-list-note">{cb.note || '（无备注）'}</span>
                  <span className="aux-list-text">{cb.text || '代码内容'}</span>
                </button>
              ))
            )}
          </div>
        </Section>

        {/* ② 表格统计（h6 标题） */}
        <Section icon={<Table2 size={13} />} title="表格统计" open={openSection === 'table'} onToggle={() => toggleSection('table')}>
          <div className="aux-list">
            {tables.length === 0 ? (
              <div className="aux-empty">没有"表格"样式的标题</div>
            ) : (
              tables.map((t, i) => (
                <button
                  key={`t-${t.path.join('-')}-${i}`}
                  className="aux-list-item"
                  data-tip={t.text}
                  onClick={() => scrollToPath(editor, t.path)}
                >
                  {t.text}
                </button>
              ))
            )}
          </div>
        </Section>

        {/* ③ 图表统计（h5 标题） */}
        <Section icon={<ImageIcon size={13} />} title="图表统计" open={openSection === 'chart'} onToggle={() => toggleSection('chart')}>
          <div className="aux-list">
            {charts.length === 0 ? (
              <div className="aux-empty">没有"图片"样式的标题</div>
            ) : (
              charts.map((c, i) => (
                <button
                  key={`c-${c.path.join('-')}-${i}`}
                  className="aux-list-item"
                  data-tip={c.text}
                  onClick={() => scrollToPath(editor, c.path)}
                >
                  {c.text}
                </button>
              ))
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}
