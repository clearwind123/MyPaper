// src/renderer/src/hooks/useFileOps.ts
// 文件操作封装：粘贴/移动的重名冲突处理循环、操作后刷新当前系统树、快照前保存落盘

import { useAppStore } from '../store/appStore'
import { useUiStore } from '../store/uiStore'
import { saveValueToFile } from '../utils/editorSave'
import type { ConflictResolution } from '../../../shared/types'

/**
 * 粘贴（或移动）到目标目录。
 * 遇重名冲突时弹出三选一对话框，用户选择后带 resolution 重试，直到完成。
 * @returns ok=是否全部成功；moved=已实际完成的移动映射（cut 模式；copy 为空）；
 *          canceled=用户在冲突对话框选择取消（已清剪贴板，停止粘贴）
 */
export async function pasteLoop(
  destDir: string
): Promise<{ ok: boolean; moved: Array<{ from: string; to: string }>; canceled?: boolean }> {
  const ui = useUiStore.getState()
  const moved: Array<{ from: string; to: string }> = []

  for (;;) {
    const res = await window.api.paste(destDir)
    if (res.moved) moved.push(...res.moved)
    if (res.ok) return { ok: true, moved }

    if (res.error === 'CONFLICT' && res.conflictName) {
      // 等待用户在 ConflictDialog 中做出选择（取消 → 清剪贴板并停止粘贴）
      const choice = await new Promise<{ kind: ConflictResolution; renameTo?: string } | null>(
        (resolve) => {
          ui.setConflict({ destDir, name: res.conflictName as string, resolve })
        }
      )
      if (choice === null) {
        // 用户取消：清除剪贴板残留的 cut 状态；已移动的条目不回滚（moved 已收集，
        // 由调用方 migrateTabsAfterMove 迁移标签）
        await window.api.clearClipboard().catch(() => undefined)
        return { ok: false, moved, canceled: true }
      }
      const retry = await window.api.paste(destDir, choice)
      if (retry.moved) moved.push(...retry.moved)
      if (!retry.ok && retry.error !== 'CONFLICT') return { ok: false, moved }
      continue
    }

    return { ok: false, moved }
  }
}

/** 移动（cut 粘贴）成功后迁移已打开的标签路径（复制场景 moved 为空，无操作）。
 *  无论粘贴整体成败，已实际移动的条目都要迁移，否则标签指向不存在的旧路径。 */
export function migrateTabsAfterMove(moved: Array<{ from: string; to: string }>): void {
  const st = useAppStore.getState()
  for (const m of moved) {
    if (!m.from || m.from === m.to) continue
    const newName = m.to.slice(m.to.lastIndexOf('\\') + 1)
    st.renameOpenFile(m.from, m.to, newName)
  }
}

/** 操作完成后刷新当前系统的文件夹树 */
export async function refreshCurrentTree(): Promise<void> {
  const { systemId, refreshTree } = useAppStore.getState()
  await refreshTree(systemId)
}

/** 复制到剪贴板 */
export async function copyEntries(paths: string[]): Promise<void> {
  await window.api.copy(paths)
}

/** 剪切到剪贴板 */
export async function cutEntries(paths: string[]): Promise<void> {
  await window.api.cut(paths)
}

/**
 * 创建快照前确保内容已落盘：把目标文件本身（或位于目标文件夹下）的
 * 未保存编辑器内容先保存（快照复制的是磁盘文件；Ctrl+S 保存是 Worker 异步的，
 * 不等待就会复制到旧内容）。
 */
export async function ensureSavedBeforeSnapshot(targetPath: string): Promise<void> {
  const st = useAppStore.getState()
  for (const [path, dirty] of Object.entries(st.dirtyPaths)) {
    if (!dirty) continue
    const isInside = path === targetPath || path.startsWith(targetPath + '\\')
    if (!isInside) continue
    const value = st.fileValues[path]
    if (!value) continue
    const dot = path.lastIndexOf('.')
    const ext = dot >= 0 ? path.slice(dot) : ''
    await saveValueToFile(path, ext, value)
    useAppStore.setState((s) => ({ dirtyPaths: { ...s.dirtyPaths, [path]: false } }))
  }
}
