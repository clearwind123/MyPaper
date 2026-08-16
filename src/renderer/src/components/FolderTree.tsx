// src/renderer/src/components/FolderTree.tsx
// 文件夹树组件：递归渲染树、点击展开/打开、右键菜单、树内拖拽移动、外部拖入导入

import { useEffect, useMemo, useState, type JSX, type DragEvent, type Dispatch, type SetStateAction, type MouseEvent as ReactMouseEvent } from 'react'
import { Folder, ChevronRight, ChevronDown, FolderOpen, Pin } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useUiStore } from '../store/uiStore'
import { useTreeActions, FOLDER_COLORS } from '../hooks/useTreeActions'
import { fileTypeColor } from '../utils/fileTypeColors'
import { fileIcon } from '../utils/fileIcon'
import ContextMenu from './ContextMenu'
import { dirOf, formatFileSize } from './Tooltip'
import type { TreeEntry } from '../../../shared/types'

interface MenuState {
  x: number
  y: number
  entry: TreeEntry | null
  /** 批量选择（Ctrl/Shift 多选右键时传入被选中的条目列表） */
  multi?: TreeEntry[]
}

/** 置顶条目排前（按 pinnedPaths 顺序），其余保持原有顺序（readTree 已按创建时间升序） */
function sortEntries(entries: TreeEntry[], pinnedPaths: string[]): TreeEntry[] {
  if (pinnedPaths.length === 0) return entries
  const rest = entries.filter((e) => !pinnedPaths.includes(e.path))
  const pinned = pinnedPaths
    .map((p) => entries.find((e) => e.path === p))
    .filter((e): e is TreeEntry => Boolean(e))
  return [...pinned, ...rest]
}

export default function FolderTree(): JSX.Element {
  const systemId = useAppStore((s) => s.systemId)
  const tree = useAppStore((s) => s.tree[systemId])
  const expanded = useAppStore((s) => s.expanded)
  const pinnedPaths = useAppStore((s) => s.config?.pinnedPaths)
  const loadTree = useAppStore((s) => s.loadTree)
  const [systemRoot, setSystemRoot] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const { buildMenuItems, onTreeDrop } = useTreeActions(systemRoot)

  useEffect(() => {
    void loadTree(systemId)
    void window.api.getSystemDir(systemId).then(setSystemRoot)
  }, [systemId, loadTree])

  // 可见行展平顺序（前序遍历，仅含展开文件夹的子级——与渲染一致），
  // 供 Shift 范围选择定位锚点与当前条目；同时建立路径→条目映射（右键批量菜单用）
  const { flatPaths, entryMap } = useMemo(() => {
    const paths: string[] = []
    const map = new Map<string, TreeEntry>()
    const walk = (entries: TreeEntry[]): void => {
      for (const e of entries) {
        paths.push(e.path)
        map.set(e.path, e)
        if (e.type === 'folder' && (expanded[e.path] ?? false) && e.children) walk(e.children)
      }
    }
    walk(tree)
    return { flatPaths: paths, entryMap: map }
  }, [tree, expanded])

  return (
    <div
      className="folder-tree"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, entry: null })
      }}
      onDragOver={(e) => {
        e.preventDefault()
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault()
        setDropTargetPath(null)
        if (systemRoot) void onTreeDrop(e, systemRoot, false)
      }}
    >
      {tree.length === 0 ? (
        <div className="tree-empty">
          <FolderOpen size={40} strokeWidth={1.2} className="tree-empty-img" />
          <span className="tree-empty-text">未找到任何文件</span>
        </div>
      ) : (
        sortEntries(tree, pinnedPaths ?? []).map((entry) => (
          <Row
            key={entry.path}
            entry={entry}
            depth={0}
            onMenu={setMenu}
            onTreeDrop={onTreeDrop}
            dropTargetPath={dropTargetPath}
            setDropTargetPath={setDropTargetPath}
            flatPaths={flatPaths}
            entryMap={entryMap}
          />
        ))
      )}

      {menu && (
        <ContextMenu
          items={buildMenuItems(menu.entry, menu.multi)}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

interface RowProps {
  entry: TreeEntry
  depth: number
  onMenu: (m: MenuState) => void
  onTreeDrop: (e: DragEvent, targetDir: string, fromTree: boolean) => Promise<void>
  dropTargetPath: string | null
  setDropTargetPath: Dispatch<SetStateAction<string | null>>
  flatPaths: string[]
  entryMap: Map<string, TreeEntry>
}

function Row({
  entry,
  depth,
  onMenu,
  onTreeDrop,
  dropTargetPath,
  setDropTargetPath,
  flatPaths,
  entryMap
}: RowProps): JSX.Element {
  const expanded = useAppStore((s) => s.expanded[entry.path]) ?? false
  const toggleExpand = useAppStore((s) => s.toggleExpand)
  const activeFile = useAppStore((s) => s.activeFile)
  const selectedFolder = useAppStore((s) => s.selectedFolder)
  const multiSelected = useAppStore((s) => s.multiSelected)
  const openFile = useAppStore((s) => s.openPreview)
  const promotePreview = useAppStore((s) => s.promotePreview)
  const setSelectedFolder = useAppStore((s) => s.setSelectedFolder)
  const config = useAppStore((s) => s.config)
  const pinnedPaths = config?.pinnedPaths ?? []
  const [dragging, setDragging] = useState(false)

  const isFolder = entry.type === 'folder'
  // 选中态：文件被激活（编辑中）或文件夹被选中；多选时多个行高亮
  const isSelected = isFolder ? entry.path === selectedFolder : entry.path === activeFile
  const isMultiSelected = multiSelected.includes(entry.path)
  const isAncestor =
    isFolder && activeFile !== null && activeFile.startsWith(entry.path + '\\')
  // 颜色：文件夹按路径自定义；文件按扩展名内置配色（fileTypeColors）
  const color = isFolder
    ? config?.folderColors[entry.path]
    : fileTypeColor(entry.ext)
  const colorValue = isFolder ? FOLDER_COLORS.find((c) => c.name === color)?.value : color

  return (
    <div>
      <div
        className={`tree-row ${isSelected ? 'tree-row-active' : ''} ${
          isMultiSelected ? 'tree-row-active' : ''
        } ${isAncestor ? 'tree-row-ancestor' : ''} ${dragging ? 'tree-row-dragging' : ''} ${
          isFolder && dropTargetPath === entry.path ? 'tree-row-drop-target' : ''
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={(e: ReactMouseEvent) => {
          const st = useAppStore.getState()
          // Ctrl/⌘：逐一多选（不触发展开/打开）
          if (e.ctrlKey || e.metaKey) {
            const cur = st.multiSelected
            const next = cur.includes(entry.path)
              ? cur.filter((p) => p !== entry.path)
              : [...cur, entry.path]
            st.setMultiSelected(next)
            st.setMultiAnchor(entry.path)
            return
          }
          // Shift：范围选择（上次点击锚点 → 当前，按可见行顺序）
          if (e.shiftKey) {
            const anchor = st.multiAnchor
            const anchorIdx = anchor ? flatPaths.indexOf(anchor) : -1
            const curIdx = flatPaths.indexOf(entry.path)
            if (anchorIdx >= 0 && curIdx >= 0) {
              const [lo, hi] = anchorIdx <= curIdx ? [anchorIdx, curIdx] : [curIdx, anchorIdx]
              const range = flatPaths.slice(lo, hi + 1)
              st.setMultiSelected(Array.from(new Set([...st.multiSelected, ...range])))
            } else {
              st.setMultiSelected([entry.path])
            }
            st.setMultiAnchor(entry.path)
            return
          }
          // 普通点击：清空多选，走原有打开/展开逻辑
          st.clearMultiSelected()
          if (isFolder) {
            toggleExpand(entry.path)
            setSelectedFolder(entry.path)
          } else {
            // 所有文件类型都进工作区：单击以预览标签打开（再点其他文件自动替换），
            // 可编辑类型用编辑器，其余用广泛查看器
            openFile({
              path: entry.path,
              name: entry.name,
              ext: entry.ext,
              isSnapshot: entry.isSnapshot,
              isPreview: true,
              size: entry.size
            })
            setSelectedFolder(null)
          }
        }}
        onDoubleClick={() => {
          // 双击：预览标签转正式（VS Code 行为；单击已先行打开预览）
          if (!isFolder) promotePreview(entry.path)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const st = useAppStore.getState()
          // 右键命中的条目在多选内 → 弹出批量菜单（传入选中的条目列表）
          if (st.multiSelected.length > 1 && st.multiSelected.includes(entry.path)) {
            const multi = st.multiSelected
              .map((p) => entryMap.get(p))
              .filter((x): x is TreeEntry => Boolean(x))
            onMenu({ x: e.clientX, y: e.clientY, entry, multi })
            return
          }
          onMenu({ x: e.clientX, y: e.clientY, entry })
        }}
        draggable={!entry.isSnapshot}
        onDragStart={(e) => {
          setDragging(true)
          e.dataTransfer.setData('text/mypaper-path', entry.path)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => {
          setDragging(false)
          setDropTargetPath(null)
        }}
        onDragOver={(e) => {
          if (isFolder) {
            // 阻止冒泡：快照文件夹行也要抢占 drop 资格，避免事件冒泡到树容器落到系统根
            e.preventDefault()
            e.stopPropagation()
            setDropTargetPath(entry.path)
          }
        }}
        onDragLeave={() => {
          setDropTargetPath((p) => (p === entry.path ? null : p))
        }}
        onDrop={(e: DragEvent) => {
          if (!isFolder) return
          e.preventDefault()
          e.stopPropagation()
          setDropTargetPath(null)
          // 快照内容不可拖入（外部文件/内部移动都拒绝）
          if (entry.isSnapshot) {
            useUiStore.getState().showToast('error', '快照内容不可添加文件')
            return
          }
          void onTreeDrop(e, entry.path, true)
        }}
        data-tip-name={entry.name}
        data-tip-dir={dirOf(entry.path)}
        data-tip-size={isFolder ? undefined : formatFileSize(entry.size)}
      >
        {isFolder ? (
          expanded ? (
            <ChevronDown size={14} className="tree-row-arrow" />
          ) : (
            <ChevronRight size={14} className="tree-row-arrow" />
          )
        ) : (
          <span className="tree-row-arrow" />
        )}
        <span
          className={`tree-row-icon ${isFolder ? 'tree-row-folder' : ''}`}
          style={colorValue ? { color: colorValue } : undefined}
        >
          {isFolder ? (
            // 文件夹图标填充：默认浅绿（--green-150），自定义颜色后按所选颜色填充
            <Folder size={15} fill={colorValue ?? '#d3ecdc'} strokeWidth={1.8} />
          ) : (
            fileIcon(entry.ext)
          )}
        </span>
        <span className="tree-row-name">{entry.name}</span>
        {pinnedPaths.includes(entry.path) && <Pin size={11} className="tree-row-pin" />}
        {entry.isSnapshot && <span className="tree-row-snapshot">快照</span>}
      </div>

      {isFolder && expanded && entry.children && entry.children.length > 0 && (
        <div>
          {sortEntries(entry.children, pinnedPaths).map((child) => (
            <Row
              key={child.path}
              entry={child}
              depth={depth + 1}
              onMenu={onMenu}
              onTreeDrop={onTreeDrop}
              dropTargetPath={dropTargetPath}
              setDropTargetPath={setDropTargetPath}
              flatPaths={flatPaths}
              entryMap={entryMap}
            />
          ))}
        </div>
      )}
    </div>
  )
}
