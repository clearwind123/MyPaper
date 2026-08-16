// src/renderer/src/store/uiStore.ts
// 对话框/面板的全局状态：新建、重命名、移动、重名冲突、搜索面板

import { create } from 'zustand'
import type { ConflictResolution } from '../../../shared/types'

export interface NewEntryRequest {
  parentPath: string
  kind: 'file' | 'folder'
}

export interface RenameRequest {
  path: string
  currentName: string
}

export interface MoveRequest {
  /** 被移动的条目路径（单个或批量） */
  paths: string[]
}

export interface ConflictRequest {
  destDir: string
  name: string
  /** 用户选择冲突处理方式后调用；null = 用户取消本次粘贴 */
  resolve: (choice: { kind: ConflictResolution; renameTo?: string } | null) => void
}

export interface ToastState {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

export interface ConfirmRequest {
  message: string
  /** 确认后执行（取消则什么都不做） */
  onConfirm: () => void
  /** 取消时执行（可选；关闭对话框同时调用，如中止关闭握手） */
  onCancel?: () => void
}

interface UiState {
  newEntry: NewEntryRequest | null
  rename: RenameRequest | null
  move: MoveRequest | null
  conflict: ConflictRequest | null
  searchOpen: boolean
  /** 查找替换面板开关 */
  findOpen: boolean
  /** 大纲列表抽屉开关 */
  outlineOpen: boolean
  /** 辅助面板抽屉开关 */
  auxOpen: boolean
  /** AI 配置窗口开关 */
  aiConfigOpen: boolean
  /** AI 助手面板开关 */
  aiOpen: boolean
  /** 设置窗口开关 */
  settingsOpen: boolean
  /** AI 面板预设动作（右键菜单触发：续写/总结/润色/翻译），面板打开后消费并清空 */
  aiPresetAction: string | null
  /** 轻提示（toast，自动消失） */
  toast: ToastState | null
  /** 确认对话框请求 */
  confirm: ConfirmRequest | null
  /** 提示对话框请求（软件风格单按钮，替代原生 window.alert） */
  alert: { message: string; onClose?: () => void } | null

  setNewEntry: (r: NewEntryRequest | null) => void
  setRename: (r: RenameRequest | null) => void
  setMove: (r: MoveRequest | null) => void
  setConflict: (r: ConflictRequest | null) => void
  setSearchOpen: (v: boolean) => void
  setFindOpen: (v: boolean) => void
  setOutlineOpen: (v: boolean) => void
  setAuxOpen: (v: boolean) => void
  setAiConfigOpen: (v: boolean) => void
  setAiOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  setAiPresetAction: (v: string | null) => void
  showToast: (type: 'success' | 'error' | 'info', message: string) => void
  closeToast: () => void
  showConfirm: (message: string, onConfirm: () => void, onCancel?: () => void) => void
  closeConfirm: () => void
  showAlert: (message: string, onClose?: () => void) => void
  closeAlert: () => void
}

export const useUiStore = create<UiState>((set) => ({
  newEntry: null,
  rename: null,
  move: null,
  conflict: null,
  searchOpen: false,
  findOpen: false,
  outlineOpen: false,
  auxOpen: false,
  aiConfigOpen: false,
  aiOpen: false,
  settingsOpen: false,
  aiPresetAction: null,
  toast: null,
  confirm: null,
  alert: null,

  setNewEntry: (r) => set({ newEntry: r }),
  setRename: (r) => set({ rename: r }),
  setMove: (r) => set({ move: r }),
  setConflict: (r) => set({ conflict: r }),
  setSearchOpen: (v) => set({ searchOpen: v }),
  setFindOpen: (v) => set({ findOpen: v }),
  setOutlineOpen: (v) => set({ outlineOpen: v }),
  setAuxOpen: (v) => set({ auxOpen: v }),
  setAiConfigOpen: (v) => set({ aiConfigOpen: v }),
  setAiOpen: (v) => set({ aiOpen: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setAiPresetAction: (v) => set({ aiPresetAction: v }),

  showToast: (type, message) => {
    const id = Date.now() + Math.random()
    set({ toast: { id, type, message } })
    // 3 秒后自动消失（仅当仍是这条 toast 时）
    window.setTimeout(() => {
      set((s) => (s.toast && s.toast.id === id ? { toast: null } : s))
    }, 3000)
  },

  showConfirm: (message, onConfirm, onCancel) => set({ confirm: { message, onConfirm, onCancel } }),
  closeToast: () => set({ toast: null }),
  closeConfirm: () => set({ confirm: null }),
  showAlert: (message, onClose) => set({ alert: { message, onClose } }),
  closeAlert: () => set({ alert: null })
}))
