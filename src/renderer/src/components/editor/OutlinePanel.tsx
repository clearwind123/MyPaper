// src/renderer/src/components/editor/OutlinePanel.tsx
// 大纲列表抽屉：按标题（h1-h6）生成大纲，点击跳转到对应标题（无页码，层级缩进）

import { useMemo, type JSX } from 'react'
import { ListTree, X } from 'lucide-react'
import type { Value } from 'platejs'
import { useAppStore } from '../../store/appStore'
import { useUiStore } from '../../store/uiStore'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface OutlineItem {
  level: number
  text: string
  /** 标题节点在文档中的 path */
  path: number[]
}

/** 递归遍历 value 收集标题节点（含嵌套块：表格/引用块内的标题） */
function collectHeadings(nodes: Value, parentPath: number[] = [], out: OutlineItem[] = []): OutlineItem[] {
  nodes.forEach((node, i) => {
    const path = [...parentPath, i]
    if (typeof node === 'object' && node !== null && 'type' in node) {
      const type = (node as { type?: string }).type ?? ''
      if (/^h[1-6]$/.test(type)) {
        const text = (node.children ?? [])
          .map((c: { text?: string } | { children?: unknown[] }) => {
            const t = c as { text?: string }
            return t.text ?? ''
          })
          .join('')
        if (text.trim()) {
          out.push({ level: Number(type.slice(1)), text, path })
        }
      }
      const children = (node as { children?: unknown[] }).children
      if (Array.isArray(children)) {
        collectHeadings(children as Value, path, out)
      }
    }
  })
  return out
}

export default function OutlinePanel(): JSX.Element {
  const editor = useAppStore((s) => s.editor)
  // 订阅当前文件内容：编辑器 onChange 更新 fileValues，大纲随之刷新
  const value = useAppStore((s) => (s.activeFile ? s.fileValues[s.activeFile] : undefined))
  // 大文件优化：value 防抖 400ms——每次击键 onChange 都产生新 value 引用，
  // 直接 useMemo 会每次全树递归收集标题；输入停顿才更新（最终值一致，仅显示延迟）
  const debouncedValue = useDebouncedValue(value, 400)
  const outlineOpen = useUiStore((s) => s.outlineOpen)
  const setOutlineOpen = useUiStore((s) => s.setOutlineOpen)

  const items = useMemo(() => (debouncedValue ? collectHeadings(debouncedValue) : []), [debouncedValue])

  /** 点击大纲项：选中标题开头并滚动到可视区 */
  const goTo = (item: OutlineItem): void => {
    if (!editor) return
    const start = editor.api.start(item.path)
    if (!start) return
    editor.tf.select({ anchor: start, focus: start })
    editor.api.redecorate()
    const contentEl = document.querySelector('.plate-content') as HTMLElement | null
    contentEl?.focus()
    const domRange = editor.api.toDOMRange?.({ anchor: start, focus: start })
    domRange?.startContainer?.parentElement?.scrollIntoView({ block: 'center' })
  }

  if (!outlineOpen) return <></>

  return (
    <div className="outline-drawer">
      <div className="outline-header">
        <span className="outline-header-title">
          <ListTree size={14} className="outline-header-icon" />
          大纲列表
        </span>
        <button className="icon-btn" data-tip="关闭" onClick={() => setOutlineOpen(false)}>
          <X size={14} />
        </button>
      </div>
      <div className="outline-body">
        {items.length === 0 ? (
          <div className="outline-empty">当前文档没有标题</div>
        ) : (
          items.map((it, i) => (
            <button
              key={`${it.path.join('-')}-${i}`}
              className={`outline-item outline-lv${Math.min(it.level, 6)}`}
              style={{ paddingLeft: 8 + (it.level - 1) * 8 }}
              data-tip={it.text}
              onClick={() => goTo(it)}
            >
              {it.text}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
