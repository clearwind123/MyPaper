// src/renderer/src/App.tsx
// 主界面：顶部条、左侧系统列、文件夹树卡片、工作区卡片（标签页+内容+状态栏）、全局对话框挂载

import { useEffect, useRef, useState, type JSX } from 'react'
import {
  FileText,
  History,
  Library,
  Inbox,
  CheckSquare,
  Settings,
  Minus,
  Square,
  X,
  FilePlus2,
  FolderPlus,
  FolderOpen,
  FileUp,
  FolderInput,
  Search,
  File as FileIcon,
  ListTree,
  PanelRight,
  Replace,
  Bot,
  ListTodo,
  CloudUpload,
  Camera,
  Download,
  Save,
  Plus,
  CopyX,
  FolderX,
  Copy,
  Scissors,
  ClipboardPaste,
  ListChecks,
  Images,
  MonitorUp,
  Lock,
  ExternalLink,
  Pin,
  PinOff,
  Globe
} from 'lucide-react'
import FolderTree from './components/FolderTree'
import Tooltip, { dirOf, formatFileSize } from './components/Tooltip'
import WordCount from './components/WordCount'
import { fileTypeColor } from './utils/fileTypeColors'
import ContextMenu, { type MenuItem } from './components/ContextMenu'
import { fileIcon } from './utils/fileIcon'
import { logApp } from './utils/logger'
import EditorPane from './components/editor/EditorPane'
import FileViewerPane, { IMG_EXTS } from './components/viewer/FileViewerPane'
import Toolbar from './components/editor/Toolbar'
import FindReplacePanel from './components/editor/FindReplacePanel'
import OutlinePanel from './components/editor/OutlinePanel'
import AuxPanel from './components/editor/AuxPanel'
import ErrorBoundary from './components/ErrorBoundary'
import AiAssistantPanel from './components/editor/AiAssistantPanel'
import { saveValueToFile } from './utils/editorSave'
import { ensureSavedBeforeSnapshot, refreshCurrentTree } from './hooks/useFileOps'
import { writePosition } from './utils/positionMemory'
import { exportDocument } from './utils/editorExport'
import SearchPanel from './components/SearchPanel'
import NewEntryDialog from './components/dialogs/NewEntryDialog'
import RenameDialog from './components/dialogs/RenameDialog'
import MoveDialog from './components/dialogs/MoveDialog'
import ConflictDialog from './components/dialogs/ConflictDialog'
import AiConfigDialog from './components/dialogs/AiConfigDialog'
import SettingsDialog from './components/dialogs/SettingsDialog'
import ConfirmDialog from './components/dialogs/ConfirmDialog'
import AlertDialog from './components/dialogs/AlertDialog'
import FirstRunWizard from './components/FirstRunWizard'
import Toast from './components/Toast'
import UserCard from './components/UserCard'
import CaptureSelect, { type CaptureRect } from './components/ocr/CaptureSelect'
import OcrResultDialog from './components/ocr/OcrResultDialog'
import { cropImage } from './utils/ocrCapture'
import { useAppStore, type OpenFile } from './store/appStore'
import { useUiStore } from './store/uiStore'
import type { SystemId, TreeEntry } from '../../shared/types'

/** 在当前系统树中递归查找路径对应的条目（快照判断用） */
function findEntryInTree(entries: TreeEntry[], path: string): TreeEntry | null {
  for (const e of entries) {
    if (e.path === path) return e
    if (e.children) {
      const found = findEntryInTree(e.children, path)
      if (found) return found
    }
  }
  return null
}

const SYSTEMS: { id: SystemId; label: string; icon: typeof FileText }[] = [
  { id: 'paper', label: '论文写作', icon: FileText },
  { id: 'versions', label: '版本管理', icon: History },
  { id: 'references', label: '参考文献', icon: Library },
  { id: 'unclassified', label: '未分类文件', icon: Inbox }
]

const EXTRA_RAIL_ITEMS = [
  { id: 'myAiBrowser', label: 'MyAI Browser', icon: Globe },
  { id: 'ocrHistory', label: '截屏记录', icon: Images },
  { id: 'todo', label: '待办清单', icon: CheckSquare },
  { id: 'settings', label: '设置', icon: Settings }
]

/** 可编辑文件扩展名（其余类型用系统默认程序打开，不塞进编辑器） */
const EDITABLE_EXTS = new Set(['.docx', '.md', '.txt'])

/** 关闭软件前 flush 当前文件阅读位置（关闭握手时组件不卸载、DOM 仍在——立即读立即写） */
function flushReadingPosition(path: string): void {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  const st = useAppStore.getState()
  if (!st.config?.settings.rememberPosition) return
  if (EDITABLE_EXTS.has(ext)) {
    const sc = document.querySelector<HTMLElement>('.editor-scroll')
    const editor = st.editor
    const sel = editor?.selection
    if (sc || sel) {
      writePosition(path, {
        s: sc?.scrollTop ?? 0,
        l: sc?.scrollLeft ?? 0,
        sel: sel
          ? {
              anchor: { path: [...sel.anchor.path], offset: sel.anchor.offset },
              focus: { path: [...sel.focus.path], offset: sel.focus.offset }
            }
          : undefined
      })
    }
  } else if (ext === '.pdf') {
    const el = document.querySelector<HTMLElement>('.pdf-viewer-body')
    if (el) writePosition(path, { s: el.scrollTop, l: el.scrollLeft })
  } else if (ext === '.xlsx') {
    const el = document.querySelector<HTMLElement>('.xlsx-viewer-body')
    if (el) writePosition(path, { s: el.scrollTop, l: el.scrollLeft })
  } else if (IMG_EXTS.has(ext)) {
    const el = document.querySelector<HTMLElement>('.image-viewer')
    if (el) writePosition(path, { s: el.scrollTop, l: el.scrollLeft })
  }
}

function App(): JSX.Element {
  const systemId = useAppStore((s) => s.systemId)
  const setSystemId = useAppStore((s) => s.setSystemId)
  const setConfig = useAppStore((s) => s.setConfig)
  const config = useAppStore((s) => s.config)
  const openFiles = useAppStore((s) => s.openFiles)
  const activeFile = useAppStore((s) => s.activeFile)
  const activateFile = useAppStore((s) => s.activateFile)
  const promotePreview = useAppStore((s) => s.promotePreview)
  const searchOpen = useUiStore((s) => s.searchOpen)
  const setSearchOpen = useUiStore((s) => s.setSearchOpen)
  const newEntry = useUiStore((s) => s.newEntry)
  const rename = useUiStore((s) => s.rename)
  const move = useUiStore((s) => s.move)
  const conflict = useUiStore((s) => s.conflict)
  const findOpen = useUiStore((s) => s.findOpen)
  const setFindOpen = useUiStore((s) => s.setFindOpen)
  const outlineOpen = useUiStore((s) => s.outlineOpen)
  const setOutlineOpen = useUiStore((s) => s.setOutlineOpen)
  const auxOpen = useUiStore((s) => s.auxOpen)
  const setAuxOpen = useUiStore((s) => s.setAuxOpen)
  const aiConfigOpen = useUiStore((s) => s.aiConfigOpen)
  const setAiConfigOpen = useUiStore((s) => s.setAiConfigOpen)
  const aiOpen = useUiStore((s) => s.aiOpen)
  const setAiOpen = useUiStore((s) => s.setAiOpen)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const avatarDataUrl = useAppStore((s) => s.avatarDataUrl)
  const setAvatarDataUrl = useAppStore((s) => s.setAvatarDataUrl)
  // 点击左侧头像弹出的用户资料小卡片
  const [userCardOpen, setUserCardOpen] = useState(false)
  // 关闭握手进行中（显示"正在保存"遮罩）
  const [closing, setClosing] = useState(false)
  // 编辑器独立窗口：置顶状态（自绘标题栏按钮）
  const [pinned, setPinned] = useState(false)
  // 标签拖拽换位：拖动源 path（HTML5 drag 的 dataTransfer 自定义类型在 Electron 下可能丢失，用 ref 更可靠）
  const dragTabPathRef = useRef<string | null>(null)

  // 编辑器独立窗口模式（右键标签「在新窗口中打开」）：隐藏左侧导航与文件夹树，自动打开指定文件
  const editorOpenPath = (() => {
    const h = window.location.hash.replace(/^#/, '')
    if (!h.startsWith('editor')) return null
    return new URLSearchParams(h.split('?')[1] ?? '').get('path')
  })()
  const isEditorWindow = editorOpenPath !== null

  // 首次启动（config 无 dataDir）：显示引导向导（选数据目录）
  const [firstRun, setFirstRun] = useState(false)
  useEffect(() => {
    if (isEditorWindow) return
    void window.api.isFirstRun().then(setFirstRun)
  }, [isEditorWindow])

  // 编辑器独立窗口：自动打开指定文件（正式标签）
  useEffect(() => {
    if (!editorOpenPath) return
    const p = editorOpenPath
    const name = p.split(/[\\/]/).pop() ?? p
    const dot = name.lastIndexOf('.')
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''
    useAppStore.getState().openFile({
      path: p,
      name,
      ext,
      isSnapshot: p.includes('\\Versions\\')
    })
    logApp('[独立窗口] 打开', `${name} (${ext})`)
  }, [editorOpenPath])

  // 切换文件时恢复该文件自己的缩放（每个文件独立记忆，互不影响）
  useEffect(() => {
    if (!activeFile) return
    const st = useAppStore.getState()
    st.setViewZoom(st.viewZooms[activeFile] ?? 1)
  }, [activeFile])

  // 全局滚轮：Ctrl+滚轮缩放（编辑器与查看器所有类型统一百分比布局放大 / 编辑器 zoom）；
  // Shift+滚轮加速水平滚动（浏览器原生步长太慢）；捕获阶段 preventDefault 阻止浏览器默认页面缩放
  useEffect(() => {
    const onWheel = (e: WheelEvent): void => {
      // Shift+滚轮：找到最近的可水平滚动容器并加速滚动（原生每次只有约几十像素，太慢）
      if (e.shiftKey) {
        if (!(e.target instanceof HTMLElement)) return
        let node: HTMLElement | null = e.target
        let sc: HTMLElement | null = null
        while (node && node !== document.body) {
          // 只认真正可水平滚动的容器（overflow auto/scroll 且横向溢出）：
          // 占位层/普通 div 即使 scrollWidth 很大，scrollLeft 也无法滚动（实测 0 -> 0）
          if (node.scrollWidth > node.clientWidth + 2) {
            const cs = window.getComputedStyle(node)
            if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') {
              sc = node
              break
            }
          }
          node = node.parentElement
        }
        if (sc) {
          e.preventDefault()
          // deltaX 兜底：部分鼠标驱动把 Shift+滚轮转成水平滚轮事件（deltaY=0、deltaX≠0）
          sc.scrollLeft += (e.deltaY !== 0 ? e.deltaY : e.deltaX) * 4
        }
        return
      }
      if (!e.ctrlKey) return
      e.preventDefault()
      const st = useAppStore.getState()
      const z = st.viewZoom
      // 所有类型统一全局缩放（编辑器 zoom / 图片百分比 / PDF·xlsx 内容级 / @file-viewer setZoom），
      // 各组件自行订阅 viewZoom 应用；状态栏显示即真实比例
      st.setViewZoom(Math.min(3, Math.max(0.5, z * (e.deltaY < 0 ? 1.1 : 0.9))))
    }
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () =>
      window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
  }, [])

  // 启动时加载配置（头像等）；大纲/辅助面板改为打开文件后才自动展开（见下），
  // 避免"没有文件打开时抽屉空显示"
  useEffect(() => {
    void window.api.getConfig().then((config) => {
      setConfig(config)
      // 已设置自定义头像时读取图片（data URL）
      if (config.avatarPath) void window.api.readAvatar().then(setAvatarDataUrl)
    })
  }, [setConfig, setAvatarDataUrl])

  // 启动恢复上次打开的文件标签页（设置 restoreTabs，默认开）：
  // 从 localStorage 读取上次会话的标签列表，过滤已被删除的文件，恢复为正式标签并激活最后一个
  const restoreDoneRef = useRef(false)
  useEffect(() => {
    if (isEditorWindow) return // 独立窗口不恢复上次会话标签
    if (restoreDoneRef.current) return
    if (!config) return
    if (!config.settings.restoreTabs) return
    if (useAppStore.getState().openFiles.length > 0) return
    const raw = localStorage.getItem('mypaper.lastTabs')
    if (!raw) {
      logApp('[标签] 恢复：localStorage 无数据')
      return
    }
    let tabs: OpenFile[]
    try {
      tabs = JSON.parse(raw) as OpenFile[]
    } catch {
      logApp('[标签] 恢复：localStorage 数据损坏')
      return
    }
    if (tabs.length === 0) return
    restoreDoneRef.current = true
    logApp('[标签] 恢复检查', `restoreTabs=${config.settings.restoreTabs} 待恢复 ${tabs.length} 个`)
    void Promise.all(tabs.map((t) => window.api.stat(t.path))).then((res) => {
      const valid = tabs.filter((_, i) => res[i]?.exists)
      logApp('[标签] 恢复', `有效 ${valid.length}/${tabs.length} 个`)
      if (valid.length === 0) return
      const st = useAppStore.getState()
      for (const t of valid) st.openFile({ ...t, isPreview: false })
      st.activateFile(valid[valid.length - 1].path)
    })
  }, [config])

  // 标签页悬停第三行（文件大小）：树/右键打开时已带 size，
  // 其余入口（恢复标签/打开对话框/独立窗口/查看器文件）打开时无 size，用 fs:stat 异步补齐
  useEffect(() => {
    const files = useAppStore.getState().openFiles
    for (const f of files) {
      if (f.size !== undefined) continue
      void window.api.stat(f.path).then((res) => {
        if (!res.exists) return
        useAppStore.setState((s) => ({
          openFiles: s.openFiles.map((x) =>
            x.path === f.path && x.size === undefined ? { ...x, size: res.size } : x
          )
        }))
      })
    }
  }, [openFiles])

  // 打开/关闭标签时持久化列表（供下次启动恢复；始终记录最新状态）。
  // 用"内容 key"比较：只有标签列表真正变化才写入。
  // 不能用"跳过首次渲染"的 ref 方案——React StrictMode 下 effect 会双跑，
  // 第二次执行时 ref 已置位，仍会把启动时的空列表写进 localStorage，
  // 覆盖上次会话保存的标签（恢复功能失效的根因）。
  const prevTabsKeyRef = useRef('')
  useEffect(() => {
    const tabs = useAppStore.getState().openFiles.map((f) => ({
      path: f.path,
      name: f.name,
      ext: f.ext,
      isSnapshot: f.isSnapshot,
      isPinned: f.isPinned
    }))
    const key = tabs.map((t) => t.path).join('|')
    if (prevTabsKeyRef.current === key) return
    prevTabsKeyRef.current = key
    localStorage.setItem('mypaper.lastTabs', JSON.stringify(tabs))
    logApp('[标签] 持久化', `${tabs.length} 个标签`)
  }, [openFiles])

  // 抽屉与文件的关系：
  // - 没有任何打开的文件时，大纲/辅助面板一律不显示（并强制关闭）；
  // - 打开第一个可编辑文件时，按设置（autoOpenOutline 默认开 / autoOpenAux 默认关）自动展开一次；
  //   查看器文件（无大纲/辅助内容）不消耗自动展开机会，也不展开面板
  const autoOpenAppliedRef = useRef(false)
  useEffect(() => {
    if (openFiles.length === 0) {
      setOutlineOpen(false)
      setAuxOpen(false)
      return
    }
    if (!autoOpenAppliedRef.current && config) {
      const hasEditable = openFiles.some((f) => EDITABLE_EXTS.has(f.ext.toLowerCase()))
      if (hasEditable) {
        autoOpenAppliedRef.current = true
        setOutlineOpen(config.settings.autoOpenOutline)
        setAuxOpen(config.settings.autoOpenAux)
      }
    }
  }, [openFiles.length, config, setOutlineOpen, setAuxOpen])

  // 注册"切换/关闭标签前保存阅读位置"回调：store 的 activateFile/closeFile/closeTabsUnder
  // 在切换发生前调用它（DOM 还在、store.editor 还是旧实例）。事件驱动，StrictMode 的
  // 模拟卸载不经过这里——修复"挂载时把 {s:0} 污染进位置记录，导致永远记不住位置"的根因。
  useEffect(() => {
    useAppStore.setState({
      flushPosition: () => {
        const p = useAppStore.getState().activeFile
        if (p) flushReadingPosition(p)
      }
    })
    return () => useAppStore.setState({ flushPosition: null })
  }, [])

  // 关闭软件时：先保存所有未保存的文件，再按设置（snapshotOnClose，默认开）
  // 对当前打开的可编辑文件自动创建快照；全部完成后通知主进程真正关闭（关闭握手）。
  // 自动保存不快照、关闭标签页不快照。任何环节失败也继续关闭（readyClose 兜底）。
  useEffect(() => {
    const prepare = (): void => {
      // 关闭握手：显示"正在保存"遮罩（保存必须在渲染层销毁前完成，
      // 大文档导出需数秒，遮罩让等待可见，避免被感知为卡死）
      setClosing(true)
      const st = useAppStore.getState()
      // 关闭软件：先保存当前文件阅读位置（组件不卸载，需主动 flush；
      // 其余文件的阅读位置在切换/关闭标签时已由组件卸载保存）
      if (st.activeFile) flushReadingPosition(st.activeFile)
      const savePromises: Promise<boolean>[] = []
      for (const path of Object.keys(st.dirtyPaths)) {
        if (!st.dirtyPaths[path]) continue
        const value = st.fileValues[path]
        if (!value) continue
        const dot = path.lastIndexOf('.')
        const ext = dot >= 0 ? path.slice(dot) : ''
        savePromises.push(saveValueToFile(path, ext, value))
      }
      // 保存完成后收尾：全部成功 → 正常关闭流程；有失败 → 询问用户是否仍退出
      const finishClose = (): void => {
        // 编辑器独立窗口：只保存 dirty（不建自动快照），完成后只销毁自己
        if (isEditorWindow) {
          window.api.readyCloseEditor()
          return
        }
        const snapshotOnClose = useAppStore.getState().config?.settings.snapshotOnClose ?? true
        if (!snapshotOnClose) {
          window.api.readyClose()
          return
        }
        // 自动快照移入主进程后台执行（窗口先销毁，主进程复制磁盘文件后退出）
        const files = useAppStore.getState().openFiles
        const snapPaths = files
          .filter((f) => !f.isSnapshot && EDITABLE_EXTS.has(f.ext.toLowerCase()))
          .map((f) => f.path)
        window.api.readyClose(snapPaths)
      }
      const cancelClose = (): void => {
        // 保存失败用户选择不退出：复位遮罩 + 通知主进程清除兜底 timer（窗口保持打开）
        setClosing(false)
        if (isEditorWindow) window.api.cancelCloseEditor()
        else window.api.cancelClose()
      }
      // 遮罩至少展示 500ms：无 dirty 时保存瞬间完成，避免"保存画面"一闪而过不可见
      const closeStart = Date.now()
      const waitMinMask = async (): Promise<void> => {
        const elapsed = Date.now() - closeStart
        if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed))
      }
      void Promise.allSettled(savePromises).then(async (results) => {
        const failed = results.some(
          (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === false)
        )
        if (failed) {
          // 保存失败：确认才退出，取消则中止关闭（未保存的修改留在内存，用户可重试）
          useUiStore.getState().showConfirm(
            '部分文件保存失败，仍要退出吗？未保存的修改可能丢失。',
            finishClose,
            cancelClose
          )
          return
        }
        await waitMinMask()
        finishClose()
      })
    }
    const unsub = window.api.onPrepareClose(prepare)
    return unsub
  }, [])

  // 关闭标签页：保存当前内容并保存为快照（若有未保存修改先保存，保存失败则不关闭标签）
  const closeTab = async (path: string): Promise<void> => {
    const st = useAppStore.getState()
    if (st.dirtyPaths[path] && st.fileValues[path]) {
      const dot = path.lastIndexOf('.')
      const ext = dot >= 0 ? path.slice(dot) : ''
      try {
        const ok = await saveValueToFile(path, ext, st.fileValues[path])
        if (!ok) {
          useUiStore.getState().showToast('error', '保存失败，标签未关闭')
          return
        }
      } catch (err) {
        useUiStore.getState().showToast('error', `保存失败：${String(err)}`)
        return
      }
    }
    // 关闭 = 留版本点：保存为快照（仅非快照可编辑文件；主进程校验区域，
    // 非论文写作/未分类静默跳过；快照失败不阻断关闭，与 Ctrl+S 同策略）
    const file = st.openFiles.find((f) => f.path === path)
    if (file && !file.isSnapshot && EDITABLE_EXTS.has(file.ext.toLowerCase())) {
      const res = await window.api
        .createSnapshot(path)
        .catch(() => ({ ok: false, error: 'IPC 失败' }))
      if (!res.ok) console.log('[closeTab] 自动快照未创建：', res.error)
    }
    st.closeFile(path)
  }

  // 导出菜单开关
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  // 识图：软件识图（窗口内选区，配合主进程压暗遮罩）/ 全屏识图（隐藏主窗口，全屏选区）
  const [ocrSelecting, setOcrSelecting] = useState(false)
  // 截图结果（软件/全屏识图确认后，展示识图结果对话框）
  const [ocrResultDataUrl, setOcrResultDataUrl] = useState<string | null>(null)
  // 识别流程进行中（防止重复打开选区）
  const [ocrBusy, setOcrBusy] = useState(false)

  // 软件识图：打开压暗遮罩（屏幕其余变暗）+ 窗口内选区
  const startWindowCapture = (): void => {
    if (ocrBusy) return
    window.api.captureStart('window')
    setOcrSelecting(true)
  }

  // 全屏识图：隐藏主窗口 + 全屏遮罩选区（结果经 capture:result 回传）
  const startFullscreenCapture = (): void => {
    if (ocrBusy) return
    window.api.captureStart('fullscreen')
  }

  // 软件识图选区确认：关压暗遮罩 → 截屏 → 裁剪 → 展示结果框
  const handleWindowConfirm = async (rect: CaptureRect): Promise<void> => {
    setOcrSelecting(false)
    window.api.captureCancel()
    setOcrBusy(true)
    try {
      // 等遮罩关闭后再截屏（否则截图包含暗层）
      await new Promise((r) => setTimeout(r, 150))
      const shot = await window.api.screenshotCapture()
      if (!shot.ok || !shot.imageDataUrl || !shot.display || !shot.win) {
        useUiStore.getState().showToast('error', shot.error ?? '截屏失败')
        return
      }
      const cropped = await cropImage(shot.imageDataUrl, rect, shot.display, shot.win)
      setOcrResultDataUrl(cropped)
    } catch (err) {
      useUiStore.getState().showToast('error', `识图失败：${String(err)}`)
    } finally {
      setOcrBusy(false)
    }
  }

  // 全屏识图：遮罩窗口确认选区并裁剪后回传，主窗口展示结果框
  useEffect(() => {
    return window.api.onCaptureResult((dataUrl) => {
      setOcrResultDataUrl(dataUrl)
    })
  }, [])

  // 标签页右键菜单 / 编辑器右键菜单
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)

  // 编辑器右键菜单：原生捕获阶段监听 contextmenu（必须用原生监听而非 React 合成事件——
  // React 合成事件在冒泡阶段处理，会被 slate/Plate 内部逻辑干扰导致 preventDefault 失效；
  // 原生捕获监听在事件派发最早阶段 preventDefault，实测可阻止 Electron 默认编辑菜单显示）
  useEffect(() => {
    const onNativeCtx = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null
      if (!t || !t.closest('.workspace-editor-row')) return
      e.preventDefault()
      if (!useAppStore.getState().activeFile) return
      const editor = useAppStore.getState().editor
      const sel = editor?.selection
      setEditorMenu({
        x: e.clientX,
        y: e.clientY,
        hasSelection: !!sel && !editor.api.isCollapsed()
      })
    }
    window.addEventListener('contextmenu', onNativeCtx, true)
    return () => window.removeEventListener('contextmenu', onNativeCtx, true)
  }, [])

  // 标签页 + 按钮：在当前系统目录新建未命名文件并打开（重名自动加序号）
  const newTab = async (): Promise<void> => {
    const st = useAppStore.getState()
    const dir = await window.api.getSystemDir(st.systemId)
    const ext = st.config?.settings.defaultNewFileExt ?? 'docx'
    let name = `未命名.${ext}`
    for (let i = 1; ; i++) {
      const res = await window.api.createFile(dir, name)
      if (res.ok) break
      if (res.error !== 'EXISTS') return
      name = `未命名${i}.${ext}`
    }
    st.openFile({ path: `${dir}\\${name}`, name, ext: `.${ext}`, isSnapshot: false })
    void st.refreshTree(st.systemId)
  }

  // 右键菜单触发 AI：直接打开 AI 助手面板（与状态栏 AI 按钮一致，功能在面板内选择）
  const openAiPanel = (): void => {
    setAiOpen(true)
  }

  // 编辑器右键菜单项（复制/剪切/粘贴/全选 + AI 助手，分组间浅绿分割线）
  // 快照（只读）文件：剪切/粘贴/AI 助手禁用变灰（复制/全选保留，只读可查看复制）
  const editorMenuItems = (): MenuItem[] => {
    const editor = useAppStore.getState().editor
    const hasSel = editorMenu?.hasSelection ?? false
    const readonly = activeTab?.isSnapshot ?? false
    const copySelected = (cut: boolean): void => {
      if (!editor) return
      const sel = editor.selection
      if (!sel) return
      void navigator.clipboard.writeText(editor.api.string(sel) ?? '')
      if (cut) editor.tf.delete({ at: sel })
    }
    return [
      { label: '复制', icon: <Copy size={14} />, disabled: !hasSel, onClick: () => copySelected(false) },
      { label: '剪切', icon: <Scissors size={14} />, disabled: !hasSel || readonly, onClick: () => copySelected(true) },
      {
        label: '粘贴',
        icon: <ClipboardPaste size={14} />,
        disabled: readonly,
        onClick: () => {
          void navigator.clipboard.readText().then((t) => {
            if (t && editor) editor.tf.insertText(t)
          })
        }
      },
      {
        label: '全选',
        icon: <ListChecks size={14} />,
        separatorAfter: true,
        onClick: () => editor?.tf.select([])
      },
      { label: 'AI 助手', icon: <Bot size={14} />, disabled: readonly, onClick: openAiPanel }
    ]
  }

  // 执行导出（docx/pdf/md/html）
  const doExport = (format: 'docx' | 'pdf' | 'md' | 'html'): void => {
    setExportMenuOpen(false)
    const st = useAppStore.getState()
    if (!st.editor || !activeFile) return
    const value = st.fileValues[activeFile]
    if (!value) return
    const baseName = activeFile.split('\\').pop()?.replace(/\.[^.]+$/, '') ?? '文档'
    void exportDocument(value, format, baseName).then((res) => {
      const showToast = useUiStore.getState().showToast
      if (res.ok) {
        showToast('success', '导出成功')
      } else if (res.message !== '已取消') {
        showToast('error', `导出失败：${res.message ?? '未知错误'}`)
      }
    })
  }

  const activeSystem = SYSTEMS.find((s) => s.id === systemId) ?? SYSTEMS[0]

  // 状态栏自动保存按钮：点击切换开/关（写入设置，状态栏文字/颜色即时跟随）
  const toggleAutoSave = async (): Promise<void> => {
    const cur = useAppStore.getState().config
    if (!cur) return
    try {
      const next = await window.api.updateConfig({
        settings: { ...cur.settings, autoSaveEnabled: !cur.settings.autoSaveEnabled }
      })
      useAppStore.setState({ config: next })
      useUiStore.getState().showToast(
        'success',
        next.settings.autoSaveEnabled ? '自动保存已开启' : '自动保存已关闭'
      )
    } catch (err) {
      useUiStore.getState().showToast('error', `切换失败：${String(err)}`)
    }
  }

  // 保存当前激活文件（Ctrl+S 快捷键 = 保存 + 自动存快照）
  const saveCurrentDoc = async (): Promise<void> => {
    const st = useAppStore.getState()
    const path = st.activeFile
    if (!path) return
    const value = st.fileValues[path]
    if (!value) return
    const dot = path.lastIndexOf('.')
    const ext = dot >= 0 ? path.slice(dot) : ''
    // 保存失败（序列化异常/写入失败）：toast 提示 + 保持 dirty 标记（用户可重试，不误报已保存）
    let ok = false
    try {
      ok = await saveValueToFile(path, ext, value)
    } catch (err) {
      useUiStore.getState().showToast('error', `保存失败：${String(err)}`)
      return
    }
    if (!ok) {
      useUiStore.getState().showToast('error', '保存失败，未保存的修改仍在')
      return
    }
    useAppStore.setState((s) => ({
      dirtyPaths: { ...s.dirtyPaths, [path]: false }
    }))
    if (
      !st.openFiles.find((f) => f.path === path)?.isSnapshot &&
      EDITABLE_EXTS.has(ext.toLowerCase())
    ) {
      // 手动保存 = 留版本点：自动创建快照（主进程校验区域，非论文写作/未分类静默跳过；
      // 快照失败不阻断保存，与关闭时自动快照同策略）
      const res = await window.api.createSnapshot(path).catch(() => ({ ok: false, error: 'IPC 失败' }))
      if (!res.ok) console.log('[save] Ctrl+S 自动快照未创建：', res.error)
    }
  }

  // 全局经典快捷键（输入框/文本域内不拦截；编辑器聚焦时也生效）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? ''
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      const editor = useAppStore.getState().editor
      if (key === 's') {
        e.preventDefault()
        void saveCurrentDoc()
      } else if (key === 'f') {
        e.preventDefault()
        useUiStore.getState().setFindOpen(true)
      } else if (!editor) {
        return
      } else if (key === 'b') {
        e.preventDefault()
        editor.tf.bold.toggle()
      } else if (key === 'i') {
        e.preventDefault()
        editor.tf.italic.toggle()
      } else if (key === 'u') {
        e.preventDefault()
        editor.tf.underline.toggle()
      } else if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) editor.tf.redo()
        else editor.tf.undo()
      } else if (key === 'y') {
        e.preventDefault()
        editor.tf.redo()
      } else if (key === 'enter') {
        // Ctrl+Enter：预留提交类操作（输入框内不拦截）
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 当前激活文件是否为可编辑类型（docx/md/txt 且非快照）
  const activeTab = openFiles.find((f) => f.path === activeFile)
  const isEditable =
    activeTab !== undefined &&
    !activeTab.isSnapshot &&
    EDITABLE_EXTS.has(activeTab.ext.toLowerCase())
  // 查看器文件（非 docx/md/txt）：状态栏完整显示，但与编辑器相关的按钮禁用变灰
  const isViewerFile =
    activeTab !== undefined && !EDITABLE_EXTS.has(activeTab.ext.toLowerCase())
  // 全局视图缩放（Ctrl+滚轮调整；状态栏显示，点击恢复 100%）
  const viewZoom = useAppStore((s) => s.viewZoom)

  // 文件夹树实时刷新：文件系统变化时刷新当前系统的树
  const refreshTree = useAppStore((s) => s.refreshTree)
  useEffect(() => {
    return window.api.onTreeChanged(() => {
      void refreshTree(systemId)
    })
  }, [refreshTree, systemId])

  // 空工作区"打开文件"按钮
  const pickAndOpenFile = async (): Promise<void> => {
    const res = await window.api.chooseFile()
    if (res.canceled) return
    if (!res.path) {
      // 选择了数据目录外的文件：提示先导入（避免"打开后路径越界"的割裂体验）
      useUiStore.getState().showToast('error', '仅支持打开 MyPaperData 内的文件，请先用导入功能')
      return
    }
    const path = res.path
    const name = path.split('\\').pop() ?? path
    const dot = name.lastIndexOf('.')
    const ext = dot >= 0 ? name.slice(dot) : ''
    // 所有类型都进工作区：可编辑类型用编辑器，其余用广泛查看器
    useAppStore.getState().openFile({
      path,
      name,
      ext,
      isSnapshot: false
    })
  }

  // 文件夹树卡片顶部的"添加"菜单状态（file=导入/创建文件；folder=导入/创建文件夹）
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; kind: 'file' | 'folder' } | null>(
    null
  )

  // 文件夹树卡片顶部的"添加文件/添加文件夹"（目标：选中的文件夹，无则当前系统根目录）
  const addEntry = (kind: 'file' | 'folder'): void => {
    const { selectedFolder, systemId, tree } = useAppStore.getState()
    // 版本管理系统为纯快照区：整体禁止添加（无论是否选中文件夹）
    if (systemId === 'versions') {
      useUiStore.getState().showToast('error', '版本管理为快照区，不可添加文件/文件夹')
      return
    }
    if (selectedFolder) {
      // 快照内容不可添加（保持快照纯净）：提示但不打开对话框
      const entry = findEntryInTree(tree[systemId] ?? [], selectedFolder)
      if (entry?.isSnapshot) {
        useUiStore.getState().showToast('error', '快照内容不可添加文件/文件夹')
        return
      }
      useUiStore.getState().setNewEntry({ parentPath: selectedFolder, kind })
    } else {
      void window.api.getSystemDir(systemId).then((root) => {
        useUiStore.getState().setNewEntry({ parentPath: root, kind })
      })
    }
  }

  // 添加菜单里的"导入文件/导入文件夹"：目标与 addEntry 相同（含版本管理/快照拦截）
  const importEntry = (kind: 'file' | 'folder'): void => {
    const { selectedFolder, systemId, tree } = useAppStore.getState()
    if (systemId === 'versions') {
      useUiStore.getState().showToast('error', '版本管理为快照区，不可导入文件/文件夹')
      return
    }
    const doImport = async (parentPath: string): Promise<void> => {
      const res =
        kind === 'file'
          ? await window.api.importFiles(parentPath)
          : await window.api.importFolders(parentPath)
      if (res.ok) await refreshCurrentTree()
    }
    if (selectedFolder) {
      const entry = findEntryInTree(tree[systemId] ?? [], selectedFolder)
      if (entry?.isSnapshot) {
        useUiStore.getState().showToast('error', '快照内容不可导入文件/文件夹')
        return
      }
      void doImport(selectedFolder)
    } else {
      void window.api.getSystemDir(systemId).then((root) => void doImport(root))
    }
  }

  // 添加菜单项：按类型分开——文件图标出"导入文件/创建文件"，文件夹图标出"导入文件夹/创建文件夹"
  const addMenuItems = (kind: 'file' | 'folder'): MenuItem[] =>
    kind === 'file'
      ? [
          { label: '导入文件', icon: <FileUp size={14} />, onClick: () => importEntry('file'), separatorAfter: true },
          { label: '创建文件', icon: <FilePlus2 size={14} />, onClick: () => addEntry('file') }
        ]
      : [
          { label: '导入文件夹', icon: <FolderInput size={14} />, onClick: () => importEntry('folder'), separatorAfter: true },
          { label: '创建文件夹', icon: <FolderPlus size={14} />, onClick: () => addEntry('folder') }
        ]

  return (
    <div className={`app${isEditorWindow ? ' app-editor-window' : ''}`}>
      {/* ===== 顶部：主窗口为白色悬浮条 + AI 图标 + 窗口按钮；编辑器独立窗口为自绘标题栏（参考截屏统计窗口风格） ===== */}
      {isEditorWindow ? (
        <div className="ocr-history-titlebar">
          <span className="ocr-history-title">
            <FileText size={16} className="ocr-history-title-icon" />
            MyPaper 编辑器
          </span>
          <span className="ocr-history-winbtns">
            <button
              className={`win-btn ${pinned ? 'win-btn-pinned' : ''}`}
              data-tip={pinned ? '取消置顶' : '置顶窗口（不被其他窗口遮挡）'}
              onClick={() => {
                setPinned(!pinned)
                window.api.toggleAlwaysOnTop()
              }}
            >
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
            <button className="win-btn" data-tip="最小化" onClick={() => window.api.minimize()}>
              <Minus size={14} />
            </button>
            <button className="win-btn" data-tip="最大化" onClick={() => window.api.toggleMaximize()}>
              <Square size={12} />
            </button>
            <button className="win-btn win-btn-close" data-tip="关闭" onClick={() => window.api.close()}>
              <X size={14} />
            </button>
          </span>
        </div>
      ) : (
        <header className="top-bar">
          <div className="top-float-bar" data-tip="预留位置，功能待定" />
          <button
            className="icon-btn top-ai"
            data-tip="AI 配置"
            onClick={() => setAiConfigOpen(true)}
          >
            <Bot size={16} />
          </button>
          <div className="win-controls">
            <button className="win-btn" data-tip="最小化" onClick={() => window.api.minimize()}>
              <Minus size={14} />
            </button>
            <button className="win-btn" data-tip="最大化" onClick={() => window.api.toggleMaximize()}>
              <Square size={12} />
            </button>
            <button className="win-btn win-btn-close" data-tip="关闭" onClick={() => window.api.close()}>
              <X size={14} />
            </button>
          </div>
        </header>
      )}

      {/* ===== 主体 ===== */}
      <div className="body">
        {/* 左侧系统图标列（贴底板） */}
        <nav className="left-rail">
          <div
            className={`rail-avatar${avatarDataUrl ? ' has-avatar' : ''}`}
            data-tip="查看用户资料"
            onClick={() => setUserCardOpen((v) => !v)}
          >
            {avatarDataUrl ? (
              <img className="rail-avatar-img" src={avatarDataUrl} alt="" />
            ) : null}
          </div>

          <div className="rail-sep rail-sep-big" />
          {SYSTEMS.map((s) => {
            const Icon = s.icon
            const active = s.id === systemId
            return (
              <button
                key={s.id}
                className={`rail-icon ${active ? 'rail-icon-active' : ''}`}
                data-tip={s.label}
                onClick={() => setSystemId(s.id)}
              >
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              </button>
            )
          })}

          <div className="rail-sep rail-sep-small" />
          <div className="rail-spacer" />
          {EXTRA_RAIL_ITEMS.map((it) => {
            const Icon = it.icon
            return (
              <button
                key={it.id}
                className="rail-icon"
                data-tip={it.label}
                onClick={() => {
                  if (it.id === 'settings') setSettingsOpen(true)
                  else if (it.id === 'ocrHistory') window.api.openOcrHistory()
                  else if (it.id === 'todo') window.api.openTodo()
                  else if (it.id === 'myAiBrowser') {
                    // 启动外部 C# 程序（MyAI Browser），失败 toast 提示
                    void window.api.launchMyAiBrowser().then((r) => {
                      if (!r.ok) useUiStore.getState().showToast('error', r.error ?? '启动失败')
                    })
                  }
                }}
              >
                <Icon size={20} />
              </button>
            )
          })}
        </nav>

        {/* 文件夹树卡片 */}
        <aside className="folder-card">
          <div className="folder-card-header">
            <span className="folder-card-title">
              <activeSystem.icon size={14} className="folder-card-title-icon" />
              {activeSystem.label}
            </span>
            <div className="folder-card-actions">
              <button
                className="icon-btn"
                data-tip="添加文件（导入/创建）"
                onClick={(e) => setAddMenu({ x: e.clientX, y: e.clientY, kind: 'file' })}
              >
                <FilePlus2 size={15} />
              </button>
              <button
                className="icon-btn"
                data-tip="添加文件夹（导入/创建）"
                onClick={(e) => setAddMenu({ x: e.clientX, y: e.clientY, kind: 'folder' })}
              >
                <FolderPlus size={15} />
              </button>
              <button
                className="icon-btn"
                data-tip="在文件资源管理器中打开"
                onClick={() => void window.api.openSystem(systemId)}
              >
                <FolderOpen size={15} />
              </button>
              <button
                className={`icon-btn ${searchOpen ? 'icon-btn-active' : ''}`}
                data-tip="搜索"
                onClick={() => setSearchOpen(!searchOpen)}
              >
                <Search size={15} />
              </button>
            </div>
          </div>
          <div className="folder-card-content">
            {searchOpen ? <SearchPanel /> : <FolderTree />}
          </div>
        </aside>

        {/* 工作区卡片 */}
        <section className="workspace-card">
          <div className="tabs-bar">
            <div className="tabs-scroll">
              {/* 分区渲染：置顶标签固定最前（按置顶先后），普通标签按打开顺序在后 */}
              {[...openFiles.filter((f) => f.isPinned), ...openFiles.filter((f) => !f.isPinned)].map((f) => {
                // 标签图标颜色：按扩展名内置配色（与树中文件图标一致）
                const tabColor = fileTypeColor(f.ext)
                return (
                  <div
                    key={f.path}
                    className={`tab ${f.path === activeFile ? 'tab-active' : ''} ${
                      f.isPreview ? 'tab-preview' : ''
                    }`}
                    onClick={() => activateFile(f.path)}
                    onDoubleClick={() => promotePreview(f.path)}
                    draggable
                    onDragStart={() => {
                      dragTabPathRef.current = f.path
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const from = dragTabPathRef.current
                      dragTabPathRef.current = null
                      if (from && from !== f.path) useAppStore.getState().reorderTabs(from, f.path)
                    }}
                    onDragEnd={() => {
                      dragTabPathRef.current = null
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setTabMenu({ x: e.clientX, y: e.clientY, path: f.path })
                    }}
                    data-tip-name={f.name}
                    data-tip-dir={dirOf(f.path)}
                    data-tip-size={f.size !== undefined ? formatFileSize(f.size) : undefined}
                  >
                    <span style={tabColor ? { color: tabColor } : undefined}>
                      {fileIcon(f.ext, 13)}
                    </span>
                    <span className="tab-name">{f.name}</span>
                    {f.isPinned && <Pin size={10} className="tab-pin" />}
                    {f.isSnapshot && <Lock size={10} className="tab-readonly" />}
                    <button
                      className="tab-close"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(f.path)
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
            <button
              className="tabs-add"
              data-tip="新建文件"
              onClick={() => void newTab()}
            >
              <Plus size={15} />
            </button>
          </div>

          {/* 工具栏：仅可编辑（非快照）文件显示；快照只读文件直接隐藏 */}
          {isEditable && (
            <ErrorBoundary>
              <Toolbar ext={activeTab?.ext ?? ''} />
            </ErrorBoundary>
          )}

          <div className="workspace-content">
            {/* 查找替换面板：浮在编辑器上方 */}
            {findOpen && (
              <div className="find-replace-overlay">
                <FindReplacePanel />
              </div>
            )}
            {/* AI 助手交互（命令条/生成提示条/结果操作条，浮层定位在 workspace-content 内） */}
            {aiOpen && <AiAssistantPanel />}
            {/* 编辑器 + 抽屉行：抽屉与编辑器并排布局，抽屉不遮挡正文 */}
            <div
              className="workspace-editor-row"
              onMouseDownCapture={(e) => {
                // 阻止右键 mousedown 默认行为：保留选中文字（slate 检查 defaultPrevented 会跳过）
                if (e.button === 2) e.preventDefault()
              }}
            >
              {/* 大纲抽屉：仅可编辑文件显示（查看器文件无大纲，强制隐藏） */}
              {activeFile && outlineOpen && !isViewerFile && <OutlinePanel />}
              {activeFile ? (
                activeTab && EDITABLE_EXTS.has(activeTab.ext.toLowerCase()) ? (
                  <ErrorBoundary>
                    {/* key 强制按文件重建编辑器实例：避免 readOnly/焦点等状态跨文件粘滞（BUG 4 防御） */}
                    <EditorPane key={activeFile} />
                  </ErrorBoundary>
                ) : (
                  <ErrorBoundary>
                    {/* 非编辑类型：广泛文件查看器（按文件重建） */}
                    <FileViewerPane key={activeFile} path={activeFile} name={activeTab?.name ?? activeFile} />
                  </ErrorBoundary>
                )
              ) : (
                <div className="workspace-empty">
                  <FileIcon size={44} strokeWidth={1.2} className="workspace-empty-img" />
                  <span className="workspace-empty-text">还未打开任何文件</span>
                  <button className="btn-primary" onClick={() => void pickAndOpenFile()}>
                    <Plus size={15} /> 打开文件
                  </button>
                </div>
              )}
              {/* 辅助面板抽屉：仅可编辑文件显示（查看器文件无编辑器实例，强制隐藏） */}
              {activeFile && auxOpen && !isViewerFile && <AuxPanel />}
            </div>
          </div>

          {/* 底部状态栏：有文件即完整显示（字数/大纲/辅助/查找/AI/待办/识图/全屏/导出/快照/自动保存/缩放）；
              查看器文件：与编辑器相关的按钮禁用变灰，AI/待办/识图/全屏/缩放可用 */}
          {activeTab && (
            <div className="status-bar">
              <div className="status-left">
                {isViewerFile ? <span>字数：—</span> : <WordCount />}
              </div>
              <div className="status-right">
                <button
                  className={`status-btn ${outlineOpen ? 'status-btn-active' : ''} ${
                    isViewerFile ? 'status-btn-disabled' : ''
                  }`}
                  data-tip="大纲列表"
                  disabled={isViewerFile}
                  onClick={() => setOutlineOpen(!outlineOpen)}
                >
                  <ListTree size={15} />
                  <span>大纲</span>
                </button>
              <button
                className={`status-btn ${auxOpen ? 'status-btn-active' : ''} ${
                  isViewerFile ? 'status-btn-disabled' : ''
                }`}
                data-tip="辅助面板"
                disabled={isViewerFile}
                onClick={() => setAuxOpen(!auxOpen)}
              >
                <PanelRight size={15} />
                <span>辅助</span>
              </button>
              <button
                className={`status-btn ${findOpen ? 'status-btn-active' : ''} ${
                  isViewerFile ? 'status-btn-disabled' : ''
                }`}
                data-tip="查找替换"
                disabled={isViewerFile}
                onClick={() => {
                  setFindOpen(!findOpen)
                }}
              >
                <Replace size={15} />
                <span>查找</span>
              </button>
              <button
                className={`status-btn ${aiOpen ? 'status-btn-active' : ''} ${
                  activeTab?.isSnapshot ? 'status-btn-disabled' : ''
                }`}
                data-tip="AI 助手"
                onMouseDown={(e) => e.preventDefault()}
                disabled={activeTab?.isSnapshot ?? false}
                onClick={() => setAiOpen(!aiOpen)}
              >
                <Bot size={15} />
                <span>AI</span>
              </button>
              <button
                className="status-btn"
                data-tip="待办清单"
                onClick={() => window.api.openTodo()}
              >
                <ListTodo size={15} />
                <span>待办</span>
              </button>
              <span className="status-divider" />
              {/* 识图：软件识图（窗口内选区，窗口高亮）/ 全屏识图（隐藏窗口全屏选区） */}
              <button
                className="status-btn"
                data-tip="识图（在软件窗口内选择区域识别）"
                onClick={startWindowCapture}
              >
                <Camera size={15} />
                <span>识图</span>
              </button>
              <button
                className="status-btn"
                data-tip="全屏识图（隐藏窗口，全屏选择区域识别）"
                onClick={startFullscreenCapture}
              >
                <MonitorUp size={15} />
                <span>全屏</span>
              </button>
              {/* 导出文件：下拉菜单 */}
              <div className="export-menu-wrap">
                <button
                  className={`status-btn ${exportMenuOpen ? 'status-btn-active' : ''} ${
                    isViewerFile ? 'status-btn-disabled' : ''
                  }`}
                  data-tip="导出文件"
                  disabled={isViewerFile}
                  onClick={() => setExportMenuOpen(!exportMenuOpen)}
                >
                  <Download size={15} />
                  <span>导出</span>
                </button>
                {exportMenuOpen && (
                  <>
                    <div className="status-menu-overlay" onClick={() => setExportMenuOpen(false)} />
                    <div className="status-menu">
                      <button className="status-menu-item" onClick={() => doExport('docx')}>
                        Word 文档 (.docx)
                      </button>
                      <button className="status-menu-item" onClick={() => doExport('pdf')}>
                        PDF 文档 (.pdf)
                      </button>
                      <button className="status-menu-item" onClick={() => doExport('md')}>
                        Markdown (.md)
                      </button>
                      <button className="status-menu-item" onClick={() => doExport('html')}>
                        HTML 网页 (.html)
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                className={`status-btn ${isEditable ? '' : 'status-btn-disabled'}`}
                data-tip="保存为快照（复制当前文件到版本管理）"
                disabled={!isEditable}
                onClick={() => {
                  if (!activeTab) return
                  void (async () => {
                    const showToast = useUiStore.getState().showToast
                    try {
                      // 快照复制的是磁盘文件：先把编辑器里未保存的内容保存落盘
                      await ensureSavedBeforeSnapshot(activeTab.path)
                      const res = await window.api.createSnapshot(activeTab.path)
                      if (res.ok) showToast('success', `已创建快照：${activeTab.name}`)
                      else showToast('error', `创建快照失败：${res.error ?? '未知错误'}`)
                    } catch (err) {
                      showToast('error', `创建快照失败：${String(err)}`)
                    }
                  })()
                }}
              >
                <Save size={15} />
                <span>快照</span>
              </button>
              <span className="status-divider" />
              <button
                type="button"
                className={`auto-save ${config?.settings.autoSaveEnabled ? '' : 'auto-save-off'}`}
                data-tip={`自动保存：${config?.settings.autoSaveEnabled ? `开启（每 ${config?.settings.autoSaveInterval ?? 10} 秒）` : '已关闭'}（点击切换）`}
                onClick={() => void toggleAutoSave()}
              >
                <CloudUpload size={15} />
                自动保存：{config?.settings.autoSaveEnabled ? '开' : '关'}
              </button>
              <span
                className="status-zoom"
                data-tip={`视图缩放 ${Math.round(viewZoom * 100)}%（Ctrl+滚轮调整，点击恢复 100%）`}
                onClick={() => useAppStore.getState().setViewZoom(1)}
              >
                缩放 {Math.round(viewZoom * 100)}%
              </span>
            </div>
            </div>
          )}
        </section>
      </div>

      {/* ===== 右键菜单 ===== */}
      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={[
            {
              label: '在新窗口中打开',
              icon: <ExternalLink size={14} />,
              separatorAfter: true,
              onClick: () => void window.api.openInNewWindow(tabMenu.path)
            },
            {
              label: openFiles.find((f) => f.path === tabMenu.path)?.isPinned ? '取消置顶' : '置顶标签',
              icon: openFiles.find((f) => f.path === tabMenu.path)?.isPinned ? (
                <PinOff size={14} />
              ) : (
                <Pin size={14} />
              ),
              separatorAfter: true,
              onClick: () => useAppStore.getState().toggleTabPin(tabMenu.path)
            },
            { label: '关闭标签', icon: <X size={14} />, onClick: () => closeTab(tabMenu.path) },
            {
              label: '关闭其他标签',
              icon: <CopyX size={14} />,
              onClick: () => {
                for (const f of openFiles) if (f.path !== tabMenu.path) closeTab(f.path)
              }
            },
            {
              label: '关闭所有标签',
              icon: <FolderX size={14} />,
              onClick: () => {
                for (const f of openFiles) closeTab(f.path)
              }
            }
          ]}
          onClose={() => setTabMenu(null)}
        />
      )}
      {editorMenu && (
        <ContextMenu
          x={editorMenu.x}
          y={editorMenu.y}
          items={editorMenuItems()}
          onClose={() => setEditorMenu(null)}
        />
      )}
      {addMenu && (
        <ContextMenu
          x={addMenu.x}
          y={addMenu.y}
          items={addMenuItems(addMenu.kind)}
          onClose={() => setAddMenu(null)}
        />
      )}

      {/* ===== 全局对话框 ===== */}
      {userCardOpen && <UserCard onClose={() => setUserCardOpen(false)} />}
      {newEntry && <NewEntryDialog request={newEntry} />}
      {rename && <RenameDialog request={rename} />}
      {move && <MoveDialog request={move} />}
      {conflict && <ConflictDialog request={conflict} />}
      {aiConfigOpen && <AiConfigDialog />}
      {settingsOpen && <SettingsDialog />}
      {/* ===== 确认 / 提示对话框 ===== */}
      {confirm && <ConfirmDialog request={confirm} />}
      <AlertDialog />
      {toast && <Toast toast={toast} />}

      {/* ===== 识图：软件识图窗口内选区 + 结果对话框 ===== */}
      {ocrSelecting && (
        <CaptureSelect
          onConfirm={(r) => void handleWindowConfirm(r)}
          onCancel={() => {
            setOcrSelecting(false)
            window.api.captureCancel()
          }}
        />
      )}
      {ocrResultDataUrl !== null && (
        <OcrResultDialog imageDataUrl={ocrResultDataUrl} onClose={() => setOcrResultDataUrl(null)} />
      )}

      {/* ===== 全局悬停提示（两行：名字 + 所在目录，跟随鼠标） ===== */}
      <Tooltip />

      {/* ===== 关闭握手遮罩：保存未完成前提示，避免被感知为卡死 ===== */}
      {closing && (
        <div className="closing-mask">
          <div className="closing-spinner" />
          <div className="closing-text">正在保存修改…</div>
        </div>
      )}

      {/* ===== 首次启动引导向导（选数据目录） ===== */}
      {firstRun && !closing && <FirstRunWizard onDone={() => setFirstRun(false)} />}
    </div>
  )
}

export default App
