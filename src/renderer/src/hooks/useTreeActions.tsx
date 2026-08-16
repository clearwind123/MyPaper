// src/renderer/src/hooks/useTreeActions.ts
// 文件夹树所有操作与右键菜单构建：打开/增删改移/复制粘贴/颜色/拖拽导入

import { useCallback } from 'react'
import type { DragEvent } from 'react'
import {
  Pencil,
  Copy,
  Scissors,
  Trash2,
  FolderInput,
  FilePlus2,
  FolderPlus,
  ExternalLink,
  Move,
  Palette,
  ClipboardPaste,
  Camera,
  RotateCcw,
  Ban,
  Pin,
  PinOff
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useUiStore } from '../store/uiStore'
import { pasteLoop, refreshCurrentTree, copyEntries, cutEntries, ensureSavedBeforeSnapshot, migrateTabsAfterMove } from './useFileOps'
import { logApp } from '../utils/logger'
import type { TreeEntry } from '../../../shared/types'
import { EDITABLE_FILE_EXTS } from '../../../shared/types'
import type { MenuItem } from '../components/ContextMenu'

/** 文件夹可选的 8 种颜色 */
export const FOLDER_COLORS = [
  { name: 'red', label: '红色', value: '#e05b4e' },
  { name: 'orange', label: '橙色', value: '#e8943a' },
  { name: 'yellow', label: '黄色', value: '#d9b93c' },
  { name: 'green', label: '绿色', value: '#4a9c6d' },
  { name: 'cyan', label: '青色', value: '#3ba3a3' },
  { name: 'blue', label: '蓝色', value: '#4a82c4' },
  { name: 'purple', label: '紫色', value: '#8b6bbd' },
  { name: 'black', label: '黑色', value: '#555555' }
] as const

const SEP = '\\'

export function useTreeActions(systemRoot: string) {
  const openFile = useAppStore((s) => s.openFile)
  const toggleExpand = useAppStore((s) => s.toggleExpand)

  /** 打开条目：文件进入工作区，文件夹展开/折叠 */
  const openEntry = useCallback(
    (entry: TreeEntry): void => {
      if (entry.type === 'file') {
        openFile({ path: entry.path, name: entry.name, ext: entry.ext, isSnapshot: entry.isSnapshot, size: entry.size })
      } else {
        toggleExpand(entry.path)
      }
    },
    [openFile, toggleExpand]
  )

  /** 删除（进回收站，带软件风格确认框；成功后同步关闭相关标签页并 toast） */
  const deleteEntry = useCallback((entry: TreeEntry): void => {
    const showToast = useUiStore.getState().showToast
    useUiStore.getState().showConfirm(`确定将"${entry.name}"删除到回收站吗？`, () => {
      void (async () => {
        const res = await window.api.trash(entry.path)
        if (res.ok) {
          // 同步关闭该条目及其内部文件的标签页（含编辑缓存清理）
          useAppStore.getState().closeTabsUnder(entry.path)
          showToast('success', entry.type === 'folder' ? '文件夹已成功删除' : '文件已成功删除')
          logApp('[删除]', `${entry.name} (${entry.type})`)
        } else {
          showToast('error', `删除失败：${res.error ?? '未知错误'}`)
          logApp('[删除] 失败', `${entry.name}: ${res.error ?? '未知错误'}`)
        }
        await refreshCurrentTree()
      })()
    })
  }, [])

  /** 批量删除（多选；逐项进回收站，成功后关闭相关标签页并汇总 toast） */
  const deleteMany = useCallback((entries: TreeEntry[]): void => {
    const showToast = useUiStore.getState().showToast
    useUiStore.getState().showConfirm(
      `确定将选中的 ${entries.length} 项删除到回收站吗？`,
      () => {
        void (async () => {
          let okCount = 0
          let failCount = 0
          for (const e of entries) {
            const res = await window.api.trash(e.path)
            if (res.ok) {
              okCount += 1
              useAppStore.getState().closeTabsUnder(e.path)
            } else {
              failCount += 1
            }
          }
          useAppStore.getState().clearMultiSelected()
          if (failCount === 0) showToast('success', `已删除 ${okCount} 项`)
          else showToast('error', `删除完成：成功 ${okCount} 项，失败 ${failCount} 项`)
          await refreshCurrentTree()
        })()
      }
    )
  }, [])

  /** 创建快照（仅论文写作/未分类；先确保未保存内容落盘，成功后提示并刷新树） */
  const snapshotEntry = useCallback(async (entry: TreeEntry): Promise<void> => {
    const showToast = useUiStore.getState().showToast
    try {
      // 快照复制的是磁盘文件：先把编辑器里未保存的内容保存落盘（避免快照是旧内容）
      await ensureSavedBeforeSnapshot(entry.path)
      const res = await window.api.createSnapshot(entry.path)
      if (res.ok) {
        showToast('success', `已创建快照：${entry.name}`)
      } else {
        showToast('error', `创建快照失败：${res.error ?? '未知错误'}`)
      }
    } catch (err) {
      showToast('error', `创建快照失败：${String(err)}`)
    }
    await refreshCurrentTree()
  }, [])

  /** 恢复快照（确认后执行：回原路径覆盖/合并；原路径不存在回原系统根目录） */
  const restoreEntry = useCallback(async (entry: TreeEntry): Promise<void> => {
    const showToast = useUiStore.getState().showToast
    const res = await window.api.restoreSnapshot(entry.path)
    if (res.ok) {
      const where =
        res.conflictName && res.conflictName !== '原位置'
          ? `原位置已不存在，已恢复到"${res.conflictName}"`
          : '已恢复到原位置'
      showToast('success', `快照"${entry.name}"${where}`)
    } else {
      showToast('error', `恢复失败：${res.error ?? '未知错误'}`)
    }
    await refreshCurrentTree()
  }, [])

  /** 设置文件夹颜色 */
  const setFolderColor = useCallback(async (path: string, color: string): Promise<void> => {
    const config = useAppStore.getState().config
    if (!config) return
    await window.api.updateConfig({ folderColors: { ...config.folderColors, [path]: color } })
    const fresh = await window.api.getConfig()
    useAppStore.setState({ config: fresh })
  }, [])

  /** 置顶/取消置顶（config.pinnedPaths，按置顶先后顺序追加） */
  const togglePin = useCallback(async (path: string): Promise<void> => {
    const config = useAppStore.getState().config
    if (!config) return
    const cur = config.pinnedPaths ?? []
    const next = cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path]
    const fresh = await window.api.updateConfig({ pinnedPaths: next })
    useAppStore.setState({ config: fresh })
  }, [])

  /** 粘贴到指定目录（含冲突处理），成功后刷新树；cut 移动已完成的条目标签同步迁移 */
  const pasteInto = useCallback(async (destDir: string): Promise<void> => {
    const result = await pasteLoop(destDir)
    migrateTabsAfterMove(result.moved)
    if (result.ok) await refreshCurrentTree()
  }, [])

  /** 去掉快照标识（确认后删除 sidecar 并移出版本管理，内容回原系统根目录）；
   *  同步更新已打开标签页的只读状态（否则工作区不刷新为可编辑） */
  const unmarkSnapshot = useCallback(async (entry: TreeEntry): Promise<void> => {
    const showToast = useUiStore.getState().showToast
    const res = await window.api.removeSnapshotMarker(entry.path)
    if (res.ok) {
      // 更新已打开标签页：该快照根及其内部文件的 isSnapshot 全部清为普通
      useAppStore.setState((s) => ({
        openFiles: s.openFiles.map((f) => {
          const inside = f.path === entry.path || f.path.startsWith(entry.path + '\\')
          return inside && f.isSnapshot ? { ...f, isSnapshot: false } : f
        })
      }))
      const where =
        res.conflictName && res.conflictName !== '未分类' ? res.conflictName : '未分类'
      showToast('success', `已去掉快照标识，内容已移动到"${where}"`)
    } else {
      showToast('error', `操作失败：${res.error ?? '未知错误'}`)
    }
    await refreshCurrentTree()
  }, [])

  /** 树内/外部拖拽落点处理：内部路径=移动，外部文件=复制导入 */
  const onTreeDrop = useCallback(
    async (e: DragEvent, targetDir: string, _fromTree: boolean): Promise<void> => {
      e.preventDefault()
      if (!systemRoot) return
      // 版本管理系统为纯快照区（含日期文件夹与快照根）：一律禁止拖入，
      // 与 MoveDialog 的移动目标拦截一致，防止普通文件混入快照区
      const sysId = useAppStore.getState().systemId
      if (sysId === 'versions') {
        useUiStore.getState().showToast('error', '版本管理为纯快照区，不可移动/导入文件进入')
        return
      }
      const internalPath = e.dataTransfer.getData('text/mypaper-path')

      if (internalPath) {
        // 树内移动：不能移动到自己或自己的子孙
        if (internalPath === targetDir) return
        if (targetDir.startsWith(internalPath + SEP)) return
        try {
          const cutRes = await window.api.cut([internalPath])
          if (!cutRes.ok) {
            useUiStore.getState().showToast('error', cutRes.error || '剪切失败')
            return
          }
          await pasteInto(targetDir)
        } catch (err) {
          // 移动失败：文件留在剪贴板 cut 状态，提示用户（后续粘贴会误移动）
          useUiStore.getState().showToast('error', `移动失败：${String(err)}`)
        }
        return
      }

      // 外部拖入：复制导入（源路径在系统任意位置，走 fs:import-drop 专用 IPC——
      // fs:copy 有 usersData 白名单会拦截外部路径，之前用 copy 导致拖拽静默失效）
      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return
      const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean)
      if (paths.length === 0) return
      try {
        const res = await window.api.importDrop(targetDir, paths)
        if (!res.ok) useUiStore.getState().showToast('error', res.error ?? '导入失败')
        else await refreshCurrentTree()
      } catch (err) {
        useUiStore.getState().showToast('error', `导入失败：${String(err)}`)
      }
    },
    [systemRoot, pasteInto]
  )

  /** 构建右键菜单项 */
  const buildMenuItems = useCallback(
    (entry: TreeEntry | null, multi?: TreeEntry[]): MenuItem[] => {
      // 批量选择（Ctrl/Shift 多选）：仅保留复制/剪切/移动到/删除
      if (multi && multi.length > 1) {
        const sysId = useAppStore.getState().systemId
        const paths = multi.map((e) => e.path)
        // 快照内容只读：复制/剪切/移动到禁用；日期文件夹不可操作：全部禁用删除
        const hasSnapshot = multi.some((e) => e.isSnapshot)
        const hasDateFolder = multi.some(
          (e) => e.type === 'folder' && sysId === 'versions' && /^\d{8}$/.test(e.name)
        )
        return [
          {
            label: '复制',
            icon: <Copy size={14} />,
            disabled: hasSnapshot || hasDateFolder,
            onClick: () => void copyEntries(paths)
          },
          {
            label: '剪切',
            icon: <Scissors size={14} />,
            disabled: hasSnapshot || hasDateFolder,
            onClick: () => void cutEntries(paths)
          },
          {
            label: '移动到',
            icon: <Move size={14} />,
            disabled: hasSnapshot || hasDateFolder,
            onClick: () => useUiStore.getState().setMove({ paths }),
            separatorAfter: true
          },
          {
            label: `删除（${multi.length} 项）`,
            icon: <Trash2 size={14} />,
            danger: true,
            disabled: hasDateFolder,
            onClick: () => void deleteMany(multi)
          }
        ]
      }

      const addFileSubmenu = (parentPath: string): MenuItem => ({
        label: '添加文件',
        icon: <FilePlus2 size={14} />,
        children: [
          {
            label: '导入文件',
            icon: <FolderInput size={14} />,
            onClick: async () => {
              await window.api.importFiles(parentPath)
              await refreshCurrentTree()
            }
          },
          {
            label: '新建文件',
            icon: <FilePlus2 size={14} />,
            onClick: () => useUiStore.getState().setNewEntry({ parentPath, kind: 'file' })
          }
        ]
      })

      const addFolderSubmenu = (parentPath: string): MenuItem => ({
        label: '添加文件夹',
        icon: <FolderPlus size={14} />,
        children: [
          {
            label: '导入文件夹',
            icon: <FolderInput size={14} />,
            onClick: async () => {
              await window.api.importFolders(parentPath)
              await refreshCurrentTree()
            }
          },
          {
            label: '新建文件夹',
            icon: <FolderPlus size={14} />,
            onClick: () => useUiStore.getState().setNewEntry({ parentPath, kind: 'folder' })
          }
        ]
      })

      if (!entry) {
        // 空白区域右键（按功能分组，组间浅绿分隔线）
        const sysId = useAppStore.getState().systemId
        // 版本管理系统为纯快照区：不可添加/粘贴（方案 A），仅保留打开资源管理器
        if (sysId === 'versions') {
          return [
            {
              label: '在文件资源管理器中打开',
              icon: <ExternalLink size={14} />,
              onClick: async () => {
                await window.api.openSystem('versions')
              }
            }
          ]
        }
        return [
          addFileSubmenu(systemRoot),
          { ...addFolderSubmenu(systemRoot), separatorAfter: true },
          {
            label: '粘贴',
            icon: <ClipboardPaste size={14} />,
            onClick: () => void pasteInto(systemRoot),
            separatorAfter: true
          },
          {
            label: '在文件资源管理器中打开',
            icon: <ExternalLink size={14} />,
            onClick: async () => {
              const systemId = useAppStore.getState().systemId
              await window.api.openSystem(systemId)
            }
          }
        ]
      }

      // 条目右键（按功能分组，组间浅绿分隔线）
      const isFolder = entry.type === 'folder'
      // 创建快照：仅论文写作/未分类系统内、且条目本身不是快照
      const sysId = useAppStore.getState().systemId
      const canSnapshot = !entry.isSnapshot && (sysId === 'paper' || sysId === 'unclassified')
      // 不可编辑文件（查看器文件如 pdf/xlsx/图片）创建快照置灰——保留菜单项但禁用
      const snapshotDisabled =
        entry.type === 'file' &&
        !(EDITABLE_FILE_EXTS as readonly string[]).includes(
          entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase()
        )
      // 日期文件夹（Versions/YYYYMMDD）：不可操作，仅可换颜色
      const isDateFolder = isFolder && sysId === 'versions' && /^\d{8}$/.test(entry.name)
      if (isDateFolder) {
        return [
          {
            label: '打开文件夹',
            icon: <ExternalLink size={14} />,
            onClick: () => openEntry(entry)
          },
          {
            label: '在文件资源管理器中打开',
            icon: <ExternalLink size={14} />,
            onClick: () => void window.api.reveal(entry.path),
            separatorAfter: true
          },
          {
            label: '自定义文件夹颜色',
            icon: <Palette size={14} />,
            children: FOLDER_COLORS.map((c) => ({
              label: c.label,
              icon: <span className="color-dot" style={{ background: c.value }} />,
              onClick: () => void setFolderColor(entry.path, c.name)
            }))
          }
        ]
      }
      const items: MenuItem[] = []

      // 组①：打开
      items.push(
        {
          label: entry.type === 'file' ? '打开文件' : '打开文件夹',
          icon: <ExternalLink size={14} />,
          onClick: () => openEntry(entry)
        },
        {
          label: '在文件资源管理器中打开',
          icon: <ExternalLink size={14} />,
          onClick: () => void window.api.reveal(entry.path),
          separatorAfter: true
        }
      )

      // 组②：快照操作（创建/恢复/去掉标识；组内最后一项画分隔线）
      const snapshotItems: MenuItem[] = []
      if (canSnapshot) {
        snapshotItems.push({
          label: '创建快照',
          icon: <Camera size={14} />,
          disabled: snapshotDisabled,
          onClick: () => void snapshotEntry(entry)
        })
      }
      // 恢复快照：快照根与快照文件夹内条目均可恢复（覆盖类操作需确认）；
      // 内部条目的恢复会定位到所在快照根，按相对路径恢复到原位置
      if (entry.isSnapshot) {
        snapshotItems.push({
          label: '恢复快照',
          icon: <RotateCcw size={14} />,
          onClick: () => {
            const showConfirm = useUiStore.getState().showConfirm
            showConfirm(
              `将快照"${entry.name}"恢复到原位置（同名内容会被替换），确定吗？`,
              () => void restoreEntry(entry)
            )
          }
        })
      }
      // 去掉快照标识：仅快照根（自身带 sidecar）；删除 sidecar 后变普通文件/文件夹
      if (entry.isSnapshotRoot) {
        snapshotItems.push({
          label: '去掉快照标识',
          icon: <Ban size={14} />,
          onClick: () => {
            const showConfirm = useUiStore.getState().showConfirm
            showConfirm(
              `去掉快照标识后"${entry.name}"将变为普通文件（可编辑），确定吗？`,
              () => void unmarkSnapshot(entry)
            )
          }
        })
      }
      if (snapshotItems.length > 0) {
        snapshotItems[snapshotItems.length - 1].separatorAfter = true
        items.push(...snapshotItems)
      }

      // 组③：添加（仅文件夹且非快照内容；快照根与内部条目禁止添加）
      if (isFolder && !entry.isSnapshot) {
        items.push(addFileSubmenu(entry.path))
        items.push({ ...addFolderSubmenu(entry.path), separatorAfter: true })
      }

      // 组④：自定义文件夹颜色（文件夹；快照文件夹同样允许换颜色）
      if (isFolder) {
        items.push({
          label: '自定义文件夹颜色',
          icon: <Palette size={14} />,
          children: FOLDER_COLORS.map((c) => ({
            label: c.label,
            icon: <span className="color-dot" style={{ background: c.value }} />,
            onClick: () => void setFolderColor(entry.path, c.name)
          })),
          separatorAfter: true
        })
      }

      // 组⑤：置顶（排序置顶，对所有条目可用，含快照/日期文件夹）
      const isPinned = (useAppStore.getState().config?.pinnedPaths ?? []).includes(entry.path)
      items.push({
        label: isPinned ? '取消置顶' : '置顶',
        icon: isPinned ? <PinOff size={14} /> : <Pin size={14} />,
        onClick: () => void togglePin(entry.path),
        separatorAfter: true
      })

      // 组⑥：复制/剪切/重命名/移动到（快照内容禁止）
      if (!entry.isSnapshot) {
        items.push(
          { label: '复制', icon: <Copy size={14} />, onClick: () => void copyEntries([entry.path]) },
          { label: '剪切', icon: <Scissors size={14} />, onClick: () => void cutEntries([entry.path]) },
          { label: '重命名', icon: <Pencil size={14} />, onClick: () => useUiStore.getState().setRename({ path: entry.path, currentName: entry.name }) },
          {
            label: '移动到',
            icon: <Move size={14} />,
            onClick: () => useUiStore.getState().setMove({ paths: [entry.path] }),
            separatorAfter: true
          }
        )
      }

      // 组⑥：删除（危险项，图标红色）
      items.push(
        {
          label: '删除',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => void deleteEntry(entry)
        }
      )
      return items
    },
    [systemRoot, openEntry, deleteEntry, deleteMany, snapshotEntry, restoreEntry, unmarkSnapshot, setFolderColor, togglePin, pasteInto]
  )

  return { openEntry, buildMenuItems, onTreeDrop }
}
