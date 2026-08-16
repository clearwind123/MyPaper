// src/renderer/src/components/editor/FindReplacePanel.tsx
// 查找替换面板：搜索高亮（FindReplacePlugin + redecorate）、上一个/下一个定位、替换/全部替换

import { useCallback, useEffect, useState, type JSX } from 'react'
import { ElementApi, PathApi, TextApi } from 'platejs'
import type { TRange } from 'platejs'
import { FindReplacePlugin } from '@platejs/find-replace'
import { useAppStore, type EditorInstance } from '../../store/appStore'
import { useUiStore } from '../../store/uiStore'

/**
 * 收集所有匹配区间（与 decorateFindReplace 同规则：
 * 只匹配"直接子节点全是文本"的元素，不区分大小写）
 */
function collectMatches(editor: EditorInstance, search: string): TRange[] {
  const ranges: TRange[] = []
  const q = search.toLowerCase()
  if (!q) return ranges

  for (const [node, path] of editor.api.nodes({
    at: [],
    match: (n: { children?: unknown[] }) =>
      ElementApi.isElement(n) && (n.children ?? []).every(TextApi.isText)
  })) {
    const el = node as { children: { text: string }[] }
    const texts = el.children.map((t) => t.text)
    const str = texts.join('').toLowerCase()
    let start = 0
    const matches: number[] = []
    while (true) {
      start = str.indexOf(q, start)
      if (start === -1) break
      matches.push(start)
      start += q.length
    }
    if (matches.length === 0) continue

    // 与 decorateFindReplace 相同的区间切分：把匹配位置映射回各子文本节点
    let cumulative = 0
    let matchIdx = 0
    for (let ti = 0; ti < texts.length; ti++) {
      const textStart = cumulative
      const textEnd = textStart + texts[ti].length
      while (matchIdx < matches.length && matches[matchIdx] < textEnd) {
        const ms = matches[matchIdx]
        const me = ms + search.length
        if (me <= textStart) {
          matchIdx++
          continue
        }
        const ovS = Math.max(ms, textStart)
        const ovE = Math.min(me, textEnd)
        if (ovS < ovE) {
          ranges.push({
            anchor: { offset: ovS - textStart, path: [...path, ti] },
            focus: { offset: ovE - textStart, path: [...path, ti] }
          })
        }
        if (me <= textEnd) matchIdx++
        else break
      }
      cumulative = textEnd
    }
  }
  return ranges
}

/** 滚动到某 range：选中 + 聚焦编辑器（选区可见=像选中文字）+ 滚动到可视区 */
function scrollToRange(editor: EditorInstance, range: TRange): void {
  editor.tf.select(range)
  editor.api.redecorate()
  // 聚焦编辑器，让选区以"选中文字"样式显示（否则失焦状态选区不可见）
  const contentEl = document.querySelector('.plate-content') as HTMLElement | null
  contentEl?.focus()
  // 滚动到选区所在元素（跨页/超长文档也能定位）
  const domRange = editor.api.toDOMRange?.(range)
  if (domRange?.startContainer?.parentElement) {
    domRange.startContainer.parentElement.scrollIntoView({ block: 'center' })
    return
  }
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  sel.getRangeAt(0).startContainer.parentElement?.scrollIntoView({ block: 'center' })
}

/** 比较两个 point（path 优先，path 相同比 offset）：a 在 b 之后返回 > 0 */
function comparePoints(
  a: { offset: number; path: number[] },
  b: { offset: number; path: number[] }
): number {
  const cmp = PathApi.compare(a.path, b.path)
  if (cmp !== 0) return cmp
  return a.offset - b.offset
}

export default function FindReplacePanel(): JSX.Element {
  const editor = useAppStore((s) => s.editor)
  const findOpen = useUiStore((s) => s.findOpen)
  const setFindOpen = useUiStore((s) => s.setFindOpen)

  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [currentIdx, setCurrentIdx] = useState(-1)
  // 匹配列表用显式 state 管理：替换/输入后手动刷新，避免 useMemo 依赖缺失导致旧数据
  const [matches, setMatches] = useState<TRange[]>([])

  // 刷新匹配列表并返回新列表（供调用方立即使用）
  const refreshMatches = useCallback(
    (search: string): TRange[] => {
      const fresh = editor && search ? collectMatches(editor, search) : []
      setMatches(fresh)
      return fresh
    },
    [editor]
  )

  // 输入变化时：更新插件 search 选项、重新装饰高亮、刷新匹配并自动定位第一个
  const onFindChange = (v: string): void => {
    setFindText(v)
    setCurrentIdx(-1)
    if (!editor) return
    editor.setOption(FindReplacePlugin, 'search', v)
    editor.api.redecorate()
    const fresh = refreshMatches(v)
    if (fresh.length > 0) {
      setCurrentIdx(0)
      scrollToRange(editor, fresh[0])
    }
  }

  // 关闭面板时清空高亮
  const close = useCallback((): void => {
    setFindOpen(false)
    setFindText('')
    setReplaceText('')
    setCurrentIdx(-1)
    setMatches([])
    if (editor) {
      editor.setOption(FindReplacePlugin, 'search', '')
      editor.api.redecorate()
    }
  }, [editor, setFindOpen])

  // 上一个/下一个（-1 时：下一个=第一个，上一个=最后一个）
  const go = (dir: 1 | -1): void => {
    if (!editor || matches.length === 0) return
    const next =
      currentIdx < 0
        ? dir > 0
          ? 0
          : matches.length - 1
        : (currentIdx + dir + matches.length) % matches.length
    setCurrentIdx(next)
    scrollToRange(editor, matches[next])
  }

  // 替换当前匹配：替换后刷新匹配并自动跳到替换位置之后的下一个
  const replaceCurrent = (): void => {
    if (!editor || matches.length === 0) return
    const idx = currentIdx >= 0 ? currentIdx : 0
    const replaced = matches[idx]
    editor.tf.select(replaced)
    editor.tf.insertText(replaceText)
    editor.api.redecorate()
    // 重新收集（文本已变）；下一个匹配 = 起点在替换区间终点之后（path+offset 比较）
    const fresh = refreshMatches(findText)
    const endPoint = replaced.focus
    const next = fresh.find((r) => comparePoints(r.anchor, endPoint) >= 0)
    if (next) {
      setCurrentIdx(fresh.indexOf(next))
      scrollToRange(editor, next)
    } else if (fresh.length > 0) {
      // 后面没有了：循环回第一个（若还有匹配）
      setCurrentIdx(0)
      scrollToRange(editor, fresh[0])
    } else {
      setCurrentIdx(-1)
    }
  }

  // 全部替换：从后往前替换避免位置偏移
  const replaceAll = (): void => {
    if (!editor || matches.length === 0) return
    for (let i = matches.length - 1; i >= 0; i--) {
      editor.tf.select(matches[i])
      editor.tf.insertText(replaceText)
    }
    editor.api.redecorate()
    refreshMatches(findText)
    setCurrentIdx(-1)
  }

  // 面板打开时自动聚焦查找输入框
  useEffect(() => {
    if (findOpen) {
      const input = document.querySelector<HTMLInputElement>('.find-replace-input')
      input?.focus()
    }
  }, [findOpen])

  if (!findOpen || !editor) return <></>

  return (
    <div className="find-replace-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="find-replace-row">
        <input
          className="find-replace-input"
          type="text"
          placeholder="查找"
          value={findText}
          onChange={(e) => onFindChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(e.shiftKey ? -1 : 1)
            if (e.key === 'Escape') close()
          }}
        />
        <span className="find-replace-count">
          {matches.length > 0 ? `${currentIdx >= 0 ? currentIdx + 1 : '?'}/${matches.length}` : '0'}
        </span>
        <button className="tool-btn" data-tip="上一个 (Shift+Enter)" onClick={() => go(-1)}>
          ↑
        </button>
        <button className="tool-btn" data-tip="下一个 (Enter)" onClick={() => go(1)}>
          ↓
        </button>
      </div>
      <div className="find-replace-row">
        <input
          className="find-replace-input"
          type="text"
          placeholder="替换为"
          value={replaceText}
          onChange={(e) => setReplaceText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') replaceCurrent()
            if (e.key === 'Escape') close()
          }}
        />
        <button className="tool-btn" data-tip="替换当前" onClick={replaceCurrent} disabled={matches.length === 0}>
          替换
        </button>
        <button className="tool-btn" data-tip="全部替换" onClick={replaceAll} disabled={matches.length === 0}>
          全部替换
        </button>
        <button className="tool-btn" data-tip="关闭 (Esc)" onClick={close}>
          ✕
        </button>
      </div>
    </div>
  )
}
