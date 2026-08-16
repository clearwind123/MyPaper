// src/renderer/src/components/editor/EmojiPicker.tsx
// emoji 选择面板（工具栏下拉使用）：常用 emoji 快捷按钮 + 我的表情（自定义表情包，存 userData/emojis/）+ 搜索 + 网格

import { useEffect, useMemo, useState, type JSX } from 'react'
import emojiMartData from '@emoji-mart/data'
import {
  DEFAULT_FREQUENTLY_USED_EMOJI,
  EmojiInlineIndexSearch,
  insertEmoji
} from '@platejs/emoji'
import { insertImage } from '@platejs/media'
import type { EditorInstance } from '../../store/appStore'

/** 常用 emoji id 列表（DEFAULT_FREQUENTLY_USED_EMOJI 的 key） */
const FREQUENT_IDS = Object.keys(DEFAULT_FREQUENTLY_USED_EMOJI)

interface EmojiItem {
  id: string
  skins: { native: string }[]
}

export default function EmojiPicker({
  editor,
  onInsert
}: {
  editor: EditorInstance
  /** 插入成功后回调（工具栏用它关闭下拉） */
  onInsert?: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  // 我的表情（自定义表情包，主进程存 userData/emojis/）
  const [mine, setMine] = useState<{ name: string; dataUrl: string }[]>([])

  // 打开面板时加载我的表情
  useEffect(() => {
    let cancelled = false
    void window.api
      .listEmojis()
      .then((list) => {
        if (!cancelled) setMine(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // 搜索结果（无搜索词 = 常用列表）
  const emojis = useMemo(() => {
    if (!query.trim()) {
      const all = (emojiMartData as { emojis: Record<string, EmojiItem> }).emojis
      return FREQUENT_IDS.filter((id) => all[id]).map((id) => all[id])
    }
    const search = EmojiInlineIndexSearch.getInstance(emojiMartData as never)
    search.search(query.trim())
    return search.get().slice(0, 60)
  }, [query])

  // 常用 emoji 快捷按钮（前 5 个）
  const frequentEmojis = useMemo(() => {
    const all = (emojiMartData as { emojis: Record<string, EmojiItem> }).emojis
    return FREQUENT_IDS.slice(0, 5)
      .map((id) => all[id])
      .filter((e) => !!e)
  }, [])

  const pick = (em: EmojiItem): void => {
    insertEmoji(editor, em as never)
    editor.api.redecorate()
    onInsert?.()
  }

  // 插入自定义表情图片（data URL 方式，与工具栏图片插入一致）
  const pickMine = (dataUrl: string): void => {
    insertImage(editor, dataUrl)
    onInsert?.()
  }

  const addMine = (): void => {
    void window.api.addEmoji().then(setMine)
  }

  const removeMine = (name: string): void => {
    void window.api.removeEmoji(name).then(setMine)
  }

  return (
    <div className="emoji-picker">
      <div className="aux-emoji-row">
        {frequentEmojis.map((em) => (
          <button
            key={em.id}
            className="aux-btn aux-emoji-row-btn"
            data-tip={em.id}
            onClick={() => pick(em)}
          >
            {em.skins[0]?.native ?? em.id}
          </button>
        ))}
      </div>

      {/* 我的表情（自定义表情包） */}
      <div className="emoji-mine">
        <span className="emoji-mine-label">我的表情</span>
        <div className="emoji-mine-list">
          {mine.map((em) => (
            <span key={em.name} className="emoji-mine-item" data-tip={em.name} onClick={() => pickMine(em.dataUrl)}>
              <img src={em.dataUrl} alt={em.name} />
              <button
                className="emoji-mine-del"
                data-tip="删除"
                onClick={(e) => {
                  e.stopPropagation()
                  removeMine(em.name)
                }}
              >
                ×
              </button>
            </span>
          ))}
          <button className="emoji-mine-add" data-tip="添加表情" onClick={addMine}>
            +
          </button>
        </div>
      </div>

      <input
        className="aux-search"
        type="text"
        placeholder="搜索 emoji…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="aux-emoji-grid">
        {emojis.length === 0 ? (
          <div className="aux-empty">没有找到 emoji</div>
        ) : (
          emojis.map((em) => (
            <button
              key={em.id}
              className="aux-emoji"
              data-tip={em.id}
              onClick={() => pick(em)}
            >
              {em.skins[0]?.native ?? em.id}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
