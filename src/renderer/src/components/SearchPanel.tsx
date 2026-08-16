// src/renderer/src/components/SearchPanel.tsx
// 跨系统文件名搜索面板：输入即搜（防抖），点击结果打开文件/定位文件夹

import { useEffect, useState, type JSX } from 'react'
import { Search, X, File as FileIcon, Folder } from 'lucide-react'
import { useUiStore } from '../store/uiStore'
import { useAppStore } from '../store/appStore'
import type { SearchHit, SystemId } from '../../../shared/types'

const SYSTEM_LABELS: Record<SystemId, string> = {
  paper: '论文写作',
  versions: '版本管理',
  references: '参考文献',
  unclassified: '未分类文件'
}

export default function SearchPanel(): JSX.Element {
  const setSearchOpen = useUiStore((s) => s.setSearchOpen)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    // 请求序号：输入变化/组件卸载后旧请求晚返回直接丢弃（防乱序覆盖与卸载后 setState）
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.search(q)
        if (cancelled) return
        setHits(res)
        setLoading(false)
      } catch {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const openHit = (hit: SearchHit): void => {
    const st = useAppStore.getState()
    if (hit.type === 'file') {
      const dot = hit.name.lastIndexOf('.')
      st.openFile({
        path: hit.path,
        name: hit.name,
        ext: dot >= 0 ? hit.name.slice(dot) : '',
        isSnapshot: false
      })
    } else {
      // 定位文件夹：切换系统并逐级展开祖先
      st.setSystemId(hit.systemId)
      const parts = hit.path.split('\\')
      let acc = ''
      const toExpand: Record<string, boolean> = {}
      for (const p of parts) {
        acc = acc ? `${acc}\\${p}` : p
        toExpand[acc] = true
      }
      useAppStore.setState({ expanded: { ...st.expanded, ...toExpand } })
      void st.loadTree(hit.systemId)
    }
    setSearchOpen(false)
  }

  return (
    <div className="search-panel">
      <div className="search-input-wrap">
        <Search size={14} className="search-input-icon" />
        <input
          autoFocus
          placeholder="搜索四个系统中的文件…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSearchOpen(false)
          }}
        />
        <button className="icon-btn" onClick={() => setSearchOpen(false)}>
          <X size={14} />
        </button>
      </div>
      <div className="search-results">
        {loading && <div className="search-tip">搜索中…</div>}
        {!loading && !query.trim() && <div className="search-tip">输入文件名进行搜索</div>}
        {!loading && query.trim() && hits.length === 0 && (
          <div className="search-tip">未找到匹配项</div>
        )}
        {hits.map((h) => (
          <div key={h.path} className="search-hit" onClick={() => openHit(h)} data-tip={h.path}>
            {h.type === 'folder' ? <Folder size={14} /> : <FileIcon size={14} />}
            <span className="search-hit-name">{h.name}</span>
            <span className="search-hit-system">{SYSTEM_LABELS[h.systemId]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
