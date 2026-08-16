// src/renderer/src/store/appStore.ts
// 全局应用状态：当前系统、配置、文件夹树缓存、标签页、展开状态、编辑器内容（zustand）

import { create } from 'zustand'
import type { AppConfig, SystemId, TreeEntry } from '../../../shared/types'
import type { Value } from 'platejs'
import type { usePlateEditor } from 'platejs/react'
import { logApp } from '../utils/logger'
import { renamePositionKey } from '../utils/positionMemory'

/** Plate 编辑器完整实例类型（含插件扩展的 tf/api 命名空间） */
export type EditorInstance = NonNullable<ReturnType<typeof usePlateEditor>>

/** 已打开的文件（标签页） */
export interface OpenFile {
  path: string
  name: string
  ext: string
  isSnapshot: boolean
  /** 预览标签（单击打开的临时标签）：再点其他文件会被替换；编辑/双击后转正式 */
  isPreview?: boolean
  /** 置顶标签（固定显示在标签栏最前；标签级，关闭后失效） */
  isPinned?: boolean
  /** 文件大小（字节），悬停提示第三行显示；undefined = 打开时未取得（App 用 fs:stat 异步补齐） */
  size?: number
}

interface AppState {
  systemId: SystemId
  config: AppConfig | null
  /** 当前用户头像图片（data URL；null = 默认头像） */
  avatarDataUrl: string | null
  /** 各系统文件夹树缓存 */
  tree: Record<SystemId, TreeEntry[]>
  /** 树的刷新版本号（每次重新加载 +1，用于触发重渲染） */
  treeVersion: Record<SystemId, number>
  /** 文件夹展开状态（path -> 是否展开） */
  expanded: Record<string, boolean>
  /** 标签页 */
  openFiles: OpenFile[]
  /** 当前激活文件路径（null = 无） */
  activeFile: string | null
  /** 当前选中的文件夹路径（null = 无；"添加文件"等操作的目标） */
  selectedFolder: string | null
  /** 多选路径集合（Ctrl+点击逐一 / Shift+点击范围选择） */
  multiSelected: string[]
  /** Shift 范围选择的锚点（最后一次单击/Ctrl 点击的条目路径） */
  multiAnchor: string | null
  /** 已打开文件的编辑内容缓存（path -> slate value） */
  fileValues: Record<string, Value>
  /** 未保存修改标记（path -> 是否脏） */
  dirtyPaths: Record<string, boolean>
  /** 当前激活文件的字数（状态栏显示） */
  wordCount: number
  /** 各文件字数缓存（path -> 字数；切换文件时直接读取，避免每次切换全树数词） */
  wordCounts: Record<string, number>
  /** 当前编辑器实例（EditorPane 创建后注册，供工具栏等使用） */
  editor: EditorInstance | null
  /** 编辑器选区/内容版本号（每次 selection 变化 +1，驱动工具栏激活态刷新） */
  selectionTick: number
  /** 全局视图缩放比例（Ctrl+滚轮调整，作用于编辑器/查看器内容；状态栏显示） */
  viewZoom: number
  /** 各文件视图缩放缓存（path -> zoom；切换文件时独立保留，互不影响） */
  viewZooms: Record<string, number>

  setSystemId: (id: SystemId) => void
  setConfig: (config: AppConfig) => void
  setAvatarDataUrl: (dataUrl: string | null) => void
  loadTree: (systemId: SystemId) => Promise<void>
  refreshTree: (systemId: SystemId) => Promise<void>
  toggleExpand: (path: string) => void
  setExpanded: (path: string, value: boolean) => void
  openFile: (file: OpenFile) => void
  /** 预览打开（单击文件）：替换现有未编辑的预览标签，无则新增；不堆积标签 */
  openPreview: (file: OpenFile) => void
  /** 预览标签转正式（编辑内容或双击时调用） */
  promotePreview: (path: string) => void
  closeFile: (path: string) => void
  /** 删除条目后同步关闭其标签页（含文件夹内部文件），并清理缓存 */
  closeTabsUnder: (path: string) => void
  /** 重命名成功后迁移打开的标签（路径/名字/内容缓存/缩放记忆；支持文件夹前缀匹配） */
  renameOpenFile: (oldPath: string, newPath: string, newName: string) => void
  activateFile: (path: string) => void
  /** 标签拖拽换位：把 fromPath 移到 toPath 的位置（激活文件不变） */
  reorderTabs: (fromPath: string, toPath: string) => void
  /** 置顶/取消置顶标签（isPinned；置顶标签固定在最前） */
  toggleTabPin: (path: string) => void
  setSelectedFolder: (path: string | null) => void
  /** 多选集合（Ctrl/Shift 批量选择；普通单选时清空） */
  setMultiSelected: (paths: string[]) => void
  clearMultiSelected: () => void
  setMultiAnchor: (path: string) => void
  setEditor: (editor: EditorInstance | null) => void
  /** 切换/关闭标签前保存当前激活文件阅读位置的回调（由 App 注册，事件驱动免疫 StrictMode 双跑污染） */
  flushPosition: (() => void) | null
  bumpSelectionTick: () => void
  setViewZoom: (zoom: number) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  systemId: 'paper',
  config: null,
  avatarDataUrl: null,
  viewZoom: 1,
  viewZooms: {},
  tree: { paper: [], versions: [], references: [], unclassified: [] },
  treeVersion: { paper: 0, versions: 0, references: 0, unclassified: 0 },
  expanded: {},
  openFiles: [],
  activeFile: null,
  selectedFolder: null,
  multiSelected: [],
  multiAnchor: null,
  fileValues: {},
  dirtyPaths: {},
  wordCount: 0,
  wordCounts: {},
  editor: null,
  flushPosition: null,
  selectionTick: 0,

  setSystemId: (id) => set({ systemId: id, selectedFolder: null, multiSelected: [], multiAnchor: null }),

  setConfig: (config) => set({ config }),

  setAvatarDataUrl: (dataUrl) => set({ avatarDataUrl: dataUrl }),

  loadTree: async (systemId) => {
    const tree = await window.api.readTree(systemId)
    set((s) => ({
      tree: { ...s.tree, [systemId]: tree },
      treeVersion: { ...s.treeVersion, [systemId]: s.treeVersion[systemId] + 1 }
    }))
  },

  refreshTree: async (systemId) => {
    await get().loadTree(systemId)
  },

  toggleExpand: (path) =>
    set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),

  setExpanded: (path, value) =>
    set((s) => ({ expanded: { ...s.expanded, [path]: value } })),

  openFile: (file) => {
    // 激活新文件前保存当前激活文件阅读位置（DOM 还在）
    get().flushPosition?.()
    const exists = get().openFiles.some((f) => f.path === file.path)
    if (!exists) {
      set((s) => ({ openFiles: [...s.openFiles, { ...file, isPreview: false }] }))
    }
    set({ activeFile: file.path })
    logApp('[打开] 正式', `${file.name} (${file.ext})`)
  },

  // 预览打开：若存在"未编辑过的预览标签"则原地替换（不新增、不堆积）；
  // 没有可替换的预览标签（都编辑过/不存在）才新增预览标签
  openPreview: (file) => {
    // 激活新文件前保存当前激活文件阅读位置（DOM 还在）
    get().flushPosition?.()
    const { openFiles } = get()
    const exists = openFiles.some((f) => f.path === file.path)
    if (exists) {
      set({ activeFile: file.path })
      logApp('[打开] 预览(已存在，仅激活)', `${file.name} (${file.ext})`)
      return
    }
    const previewIdx = openFiles.findIndex((f) => f.isPreview && !get().dirtyPaths[f.path])
    if (previewIdx >= 0) {
      const next = [...openFiles]
      const replaced = next[previewIdx]
      next[previewIdx] = { ...file, isPreview: true }
      set({ openFiles: next, activeFile: file.path })
      logApp('[打开] 预览替换', `${file.name} (${file.ext}) 替换了 ${replaced.name}`)
    } else {
      set((s) => ({
        openFiles: [...s.openFiles, { ...file, isPreview: true }],
        activeFile: file.path
      }))
      logApp('[打开] 预览新增', `${file.name} (${file.ext})`)
    }
  },

  promotePreview: (path) => {
    const f = get().openFiles.find((x) => x.path === path)
    if (!f?.isPreview) return
    set((s) => ({
      openFiles: s.openFiles.map((x) => (x.path === path ? { ...x, isPreview: false } : x))
    }))
    logApp('[标签] 预览转正式', f.name)
  },

  closeFile: (path) => {
    const { openFiles, activeFile } = get()
    const idx = openFiles.findIndex((f) => f.path === path)
    if (idx < 0) return
    // 关闭的是激活文件：先保存其阅读位置（DOM 还在，事件驱动不受 StrictMode 影响）
    if (activeFile === path) get().flushPosition?.()
    const closedWasPreview = !!openFiles[idx].isPreview
    const next = openFiles.filter((f) => f.path !== path)
    let nextActive = activeFile
    if (activeFile === path) {
      // 激活相邻标签
      const neighbor = next[Math.min(idx, next.length - 1)]
      nextActive = neighbor ? neighbor.path : null
    }
    logApp('[标签] 关闭', `${openFiles[idx].name} (preview=${closedWasPreview})`)
    // 关闭的是预览标签且还有标签 → 相邻标签接替为预览（VS Code 行为）
    if (closedWasPreview && nextActive) {
      set({
        openFiles: next.map((f) =>
          f.path === nextActive ? { ...f, isPreview: true } : f
        ),
        activeFile: nextActive
      })
    } else {
      set({ openFiles: next, activeFile: nextActive })
    }
  },

  // 删除条目后：关闭该条目及其内部文件的标签页，清理 fileValues/dirtyPaths 缓存；
  // 激活的文件被删则激活剩余第一个标签
  closeTabsUnder: (path) => {
    // 激活文件在删除范围内：先保存其阅读位置（DOM 还在）
    const s0 = get()
    if (
      s0.activeFile &&
      (s0.activeFile === path || s0.activeFile.startsWith(path + '\\'))
    ) {
      s0.flushPosition?.()
    }
    set((s) => {
      const remaining = s.openFiles.filter(
        (f) => f.path !== path && !f.path.startsWith(path + '\\')
      )
      const closedCount = s.openFiles.length - remaining.length
      if (closedCount > 0) {
        logApp('[标签] 删除联动关闭', `${path} 关闭了 ${closedCount} 个标签`)
      }
      let activeFile = s.activeFile
      if (activeFile && !remaining.some((f) => f.path === activeFile)) {
        activeFile = remaining.length > 0 ? remaining[0].path : null
      }
      const fileValues: Record<string, Value> = {}
      const dirtyPaths: Record<string, boolean> = {}
      for (const f of remaining) {
        if (s.fileValues[f.path]) fileValues[f.path] = s.fileValues[f.path]
        if (s.dirtyPaths[f.path]) dirtyPaths[f.path] = true
      }
      return { openFiles: remaining, activeFile, fileValues, dirtyPaths }
    })
  },

  // 重命名成功后迁移标签：路径与名字更新，fileValues/dirtyPaths/viewZooms 键迁移，
  // 未保存内容不丢；重命名的是文件夹时，其内部打开的文件的标签也按前缀迁移
  renameOpenFile: (oldPath, newPath, newName) => {
    // 迁移阅读位置记录 key（重命名/移动后新路径继续记住位置）
    renamePositionKey(oldPath, newPath)
    set((s) => {
      const prefix = oldPath.endsWith('\\') ? oldPath : oldPath + '\\'
      const affected = s.openFiles.filter(
        (f) => f.path === oldPath || f.path.startsWith(prefix)
      )
      if (affected.length === 0) return {}
      const mapKey = (p: string): string => {
        if (p === oldPath) return newPath
        if (p.startsWith(prefix)) return newPath + p.slice(oldPath.length)
        return p
      }
      const fileValues = { ...s.fileValues }
      const dirtyPaths = { ...s.dirtyPaths }
      const viewZooms = { ...s.viewZooms }
      for (const f of affected) {
        const np = mapKey(f.path)
        if (np === f.path) continue
        if (f.path in fileValues) {
          fileValues[np] = fileValues[f.path]
          delete fileValues[f.path]
        }
        if (f.path in dirtyPaths) {
          dirtyPaths[np] = dirtyPaths[f.path]
          delete dirtyPaths[f.path]
        }
        if (f.path in viewZooms) {
          viewZooms[np] = viewZooms[f.path]
          delete viewZooms[f.path]
        }
      }
      return {
        openFiles: s.openFiles.map((f) => {
          if (f.path === oldPath) {
            // 重命名（可能改后缀）：同步更新 ext，标签图标/编辑器分派跟随新类型
            const dot = newName.lastIndexOf('.')
            const ext = dot >= 0 ? newName.slice(dot).toLowerCase() : ''
            return { ...f, path: newPath, name: newName, ext }
          }
          if (f.path.startsWith(prefix)) return { ...f, path: mapKey(f.path) }
          return f
        }),
        activeFile: s.activeFile ? mapKey(s.activeFile) : null,
        fileValues,
        dirtyPaths,
        viewZooms
      }
    })
  },

  activateFile: (path) => {
    // 切换前保存当前激活文件的阅读位置（DOM 还在、store.editor 还是旧实例——
    // 事件驱动，StrictMode 模拟卸载不会经过这里，不会被污染）
    get().flushPosition?.()
    set({ activeFile: path })
    const f = get().openFiles.find((x) => x.path === path)
    if (f) logApp('[标签] 切换', `${f.name} (preview=${!!f.isPreview})`)
  },

  // 标签拖拽换位：把 fromPath 移到 toPath 的位置（激活文件不变）。
  // 置顶标签只能在置顶区内换位、普通标签只能在普通区——禁止跨区拖拽（吸附回本区边界）
  reorderTabs: (fromPath, toPath) => {
    if (fromPath === toPath) return
    set((s) => {
      const files = s.openFiles
      const from = files.findIndex((f) => f.path === fromPath)
      const to = files.findIndex((f) => f.path === toPath)
      if (from < 0 || to < 0) return {}
      const fromPinned = !!files[from].isPinned
      const toPinned = !!files[to].isPinned
      if (fromPinned !== toPinned) return {}
      const next = [...files]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { openFiles: next }
    })
  },

  /** 置顶/取消置顶标签（isPinned 标记；渲染时置顶标签固定最前） */
  toggleTabPin: (path) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, isPinned: !f.isPinned } : f))
    })),

  setSelectedFolder: (path) => set({ selectedFolder: path }),

  /** 多选集合（Ctrl/Shift 批量选择；普通单选时清空） */
  setMultiSelected: (paths) => set({ multiSelected: paths }),
  clearMultiSelected: () => set({ multiSelected: [] }),
  setMultiAnchor: (path) => set({ multiAnchor: path }),

  setEditor: (editor) => set({ editor }),

  bumpSelectionTick: () => set((s) => ({ selectionTick: s.selectionTick + 1 })),
  /** 设置当前缩放并写入当前文件的缓存（切换文件后各自保留） */
  setViewZoom: (zoom) =>
    set((s) => {
      const path = s.activeFile
      if (!path) return { viewZoom: zoom }
      return { viewZoom: zoom, viewZooms: { ...s.viewZooms, [path]: zoom } }
    })
}))
