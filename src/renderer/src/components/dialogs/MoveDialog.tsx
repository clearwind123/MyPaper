// src/renderer/src/components/dialogs/MoveDialog.tsx
// 移动对话框：浏览四个系统文件夹树，选择目标位置并移动

import { useEffect, useMemo, useState, type JSX } from 'react'
import { Folder, Move, ChevronRight, ChevronDown, X, FileText, History, Library, Inbox } from 'lucide-react'
import { useUiStore, type MoveRequest } from '../../store/uiStore'
import { useAppStore } from '../../store/appStore'
import { pasteLoop, refreshCurrentTree, migrateTabsAfterMove } from '../../hooks/useFileOps'
import type { SystemId, TreeEntry } from '../../../../shared/types'

const SYSTEM_LABELS: Record<SystemId, string> = {
  paper: '论文写作',
  versions: '版本管理',
  references: '参考文献',
  unclassified: '未分类文件'
}

/** 系统根目录图标（与左侧竖列一致） */
const SYSTEM_ICONS: Record<SystemId, typeof FileText> = {
  paper: FileText,
  versions: History,
  references: Library,
  unclassified: Inbox
}

/** 收集树中所有文件夹路径（用于校验移动目标） */
function collectFolders(entries: TreeEntry[], acc: string[]): void {
  for (const e of entries) {
    if (e.type === 'folder') {
      acc.push(e.path)
      if (e.children) collectFolders(e.children, acc)
    }
  }
}

export default function MoveDialog({ request }: { request: MoveRequest }): JSX.Element {
  const setMove = useUiStore((s) => s.setMove)
  const [trees, setTrees] = useState<Record<SystemId, TreeEntry[]>>({
    paper: [],
    versions: [],
    references: [],
    unclassified: []
  })
  /** 四个系统的根目录路径（系统名行可点击 = 移动到该系统根目录） */
  const [systemRoots, setSystemRoots] = useState<Record<SystemId, string>>({
    paper: '',
    versions: '',
    references: '',
    unclassified: ''
  })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ids: SystemId[] = ['paper', 'versions', 'references', 'unclassified']
      const result = { ...trees }
      const roots = { ...systemRoots }
      for (const id of ids) {
        result[id] = await window.api.readTree(id)
        roots[id] = await window.api.getSystemDir(id)
        if (cancelled) return
      }
      setTrees(result)
      setSystemRoots(roots)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 收集所有可用目标文件夹
  const allFolders: string[] = []
  for (const id of Object.keys(trees) as SystemId[]) {
    collectFolders(trees[id], allFolders)
  }
  // 版本管理系统为纯快照区（其他入口均禁止添加/导入/粘贴）：
  // 移动目标同样禁止进入 Versions，防止普通文件混入快照区（不受只读保护、
  // 且可能被快照自动清理连带删除）
  const versionsFolders = useMemo(() => {
    const acc: string[] = []
    collectFolders(trees.versions, acc)
    return new Set(acc)
  }, [trees])

  const canMoveTo = (dir: string): boolean => {
    // 目标不能是任一被移动条目自身或其子孙
    for (const p of request.paths) {
      if (dir === p) return false
      if (dir.startsWith(p + '\\')) return false
    }
    // 版本管理（Versions）不可作为移动目标
    if (versionsFolders.has(dir)) return false
    return true
  }

  const doMove = async (): Promise<void> => {
    if (!target || !canMoveTo(target)) return
    setBusy(true)
    try {
      const cutRes = await window.api.cut(request.paths)
      if (!cutRes.ok) {
        useUiStore.getState().showToast('error', cutRes.error || '剪切失败')
        return
      }
      const result = await pasteLoop(target)
      // 无论整体成败，已实际移动的条目标签都要迁移（否则标签指向不存在的旧路径）
      migrateTabsAfterMove(result.moved)
      if (result.ok) {
        await refreshCurrentTree()
        useAppStore.getState().clearMultiSelected()
        setMove(null)
      } else if (!result.canceled) {
        // 粘贴失败（用户取消除外）：文件剪贴板状态已被清除，提示用户重新操作
        useUiStore.getState().showToast('error', '移动失败，请重试')
      }
    } catch (err) {
      useUiStore.getState().showToast('error', `移动失败：${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const renderTree = (entries: TreeEntry[], depth: number): JSX.Element[] =>
    entries.map((e) => {
      if (e.type !== 'folder') return <span key={e.path} />
      const isExpanded = expanded[e.path] ?? false
      const isTarget = target === e.path
      const disabled = !canMoveTo(e.path)
      return (
        <div key={e.path}>
          <div
            className={`move-row ${isTarget ? 'move-row-target' : ''} ${
              disabled ? 'move-row-disabled' : ''
            }`}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => {
              if (disabled) return
              setExpanded((s) => ({ ...s, [e.path]: !isExpanded }))
              setTarget(e.path)
            }}
          >
            {isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
            <Folder size={15} className="move-folder-icon" />
            <span>{e.name}</span>
          </div>
          {isExpanded && e.children && renderTree(e.children, depth + 1)}
        </div>
      )
    })

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-wide move-dialog">
        <div className="dialog-title">
          <span className="dialog-title-text">
            <Move size={15} className="dialog-title-icon" /> 选择移动位置
          </span>
          <button className="icon-btn dialog-close move-dialog-close" onClick={() => setMove(null)}>
            <X size={15} />
          </button>
        </div>
        <div className="dialog-text">
          将「{request.paths.length > 1 ? `${request.paths.length} 项` : request.paths[0].split('\\').pop()}」移动到：
        </div>
        <div className="move-tree">
          {(Object.keys(trees) as SystemId[]).map((id) => {
            const root = systemRoots[id]
            const Icon = SYSTEM_ICONS[id]
            // 版本管理为纯快照区不可移入；根路径未加载完成时也不可点
            const rootDisabled = id === 'versions' || !root || !canMoveTo(root)
            const rootIsTarget = root !== '' && target === root
            // 版本管理下的日期文件夹（Versions/YYYYMMDD）不展示：纯快照区整体不可移入，
            // 日期文件夹层级无选择意义且占空间
            const visibleEntries =
              id === 'versions'
                ? trees[id].filter((e) => !(e.type === 'folder' && /^\d{8}$/.test(e.name)))
                : trees[id]
            return (
              <div key={id}>
                {/* 系统根目录行：点击 = 移动到该系统根目录（版本管理除外） */}
                <div
                  className={`move-row move-system-root ${rootIsTarget ? 'move-row-target' : ''} ${
                    rootDisabled ? 'move-row-disabled' : ''
                  }`}
                  style={{ paddingLeft: 8 }}
                  data-tip={rootDisabled ? undefined : `移动到「${SYSTEM_LABELS[id]}」根目录`}
                  onClick={() => {
                    if (rootDisabled) return
                    setTarget(root)
                  }}
                >
                  <Icon size={15} className="move-folder-icon" />
                  <span>{SYSTEM_LABELS[id]}</span>
                </div>
                {renderTree(visibleEntries, 1)}
              </div>
            )
          })}
        </div>
        <div className="dialog-actions">
          <button className="btn-plain" onClick={() => setMove(null)} disabled={busy}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={!target || busy}
            onClick={() => void doMove()}
          >
            移动到此处
          </button>
        </div>
      </div>
    </div>
  )
}
