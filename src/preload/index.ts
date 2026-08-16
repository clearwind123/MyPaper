// src/preload/index.ts
// 预加载脚本：通过 contextBridge 向渲染进程暴露窗口控制与文件系统 API

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppConfig,
  SystemId,
  TreeEntry,
  OpResult,
  SearchHit,
  ConflictResolution,
  AiMessage,
  AiCompleteResult,
  ScreenshotCaptureResult,
  SnapshotMarker,
  OcrHistoryEntry,
  TodoItem
} from '../shared/types'

export interface WindowApi {
  // 窗口控制
  minimize: () => void
  toggleMaximize: () => void
  close: () => void

  // 配置
  getConfig: () => Promise<AppConfig>
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
  getDataDir: () => Promise<string>
  getDataRoot: () => Promise<string>
  /** 首次启动标记（无 dataDir 配置 → 显示引导向导） */
  isFirstRun: () => Promise<boolean>
  firstRunDone: () => Promise<boolean>
  /** 应用版本号（dev 读 package.json，打包后读安装包版本） */
  getAppVersion: () => Promise<string>
  /** 更改 MyPaperData 目录（整体移动），返回结果；渲染层需先确认无打开标签页 */
  changeDataRoot: () => Promise<{ ok: boolean; canceled?: boolean; error?: string; dataRoot?: string }>

  // 个人资料（头像 + 用户名）
  /** 打开系统对话框选择头像图片：复制到 userData/avatars 并保存配置；取消返回 { config: null } */
  chooseAvatar: () => Promise<{ config: AppConfig | null; avatarDataUrl: string | null }>
  /** 读取当前头像图片（data URL；无自定义头像或读取失败返回 null） */
  readAvatar: () => Promise<string | null>
  /** 移除自定义头像（恢复默认），返回更新后的配置 */
  clearAvatar: () => Promise<AppConfig>

  // 操作日志
  /** 追加一行操作日志（写入 <userData>/logs/mypaper.log，排障用） */
  logApp: (line: string) => void

  // 文件夹树
  readTree: (systemId: SystemId) => Promise<TreeEntry[]>
  getSystemDir: (systemId: SystemId) => Promise<string>
  createFile: (parentPath: string, name: string) => Promise<OpResult>
  createFolder: (parentPath: string, name: string) => Promise<OpResult>
  rename: (targetPath: string, newName: string) => Promise<OpResult>
  trash: (targetPath: string) => Promise<OpResult>

  // 复制/剪切/粘贴
  copy: (paths: string[]) => Promise<OpResult>
  cut: (paths: string[]) => Promise<OpResult>
  paste: (
    destDir: string,
    resolution?: { kind: ConflictResolution; renameTo?: string }
  ) => Promise<OpResult>
  /** 清空复制/剪切剪贴板（取消粘贴时调用，防残留 cut 状态导致后续粘贴误移动剩余文件） */
  clearClipboard: () => Promise<OpResult>

  // 资源管理器
  reveal: (targetPath: string) => Promise<OpResult>
  openSystem: (systemId: SystemId) => Promise<OpResult>

  // 快照
  /** 创建快照（复制到 Versions/日期文件夹 + sidecar），仅论文写作/未分类可创建 */
  createSnapshot: (sourcePath: string) => Promise<OpResult>
  /** 读取快照 sidecar（恢复时用） */
  readSnapshotMarker: (snapshotPath: string, isFile: boolean) => Promise<SnapshotMarker | null>
  /** 恢复快照（回原路径覆盖/合并；原路径不存在则落回未分类） */
  restoreSnapshot: (snapshotPath: string) => Promise<OpResult>
  /** 去掉快照标识（删除 sidecar，快照变普通文件/文件夹） */
  removeSnapshotMarker: (snapshotPath: string) => Promise<OpResult>

  // 文件读写（编辑器）
  readFile: (targetPath: string) => Promise<{ ext: string; buffer: Uint8Array }>
  writeFile: (targetPath: string, data: string | Uint8Array) => Promise<OpResult>
  /** 读取本地图片文件（粘贴图片用：Word/网页剪贴板的 file:// 图片在系统任意位置，
   *  不受 usersData 白名单限制；主进程严格校验图片扩展名，防任意文件读取） */
  readImageFile: (
    targetPath: string
  ) => Promise<{ ok: boolean; ext?: string; buffer?: Uint8Array; error?: string }>
  /** 路径存在性检查（启动恢复标签页用） */
  stat: (targetPath: string) => Promise<{ exists: boolean; isDirectory: boolean; size: number }>
  /** 自定义表情包：列表（含 data URL）/ 添加（文件选择+复制）/ 删除，图片存 userData/emojis/ */
  listEmojis: () => Promise<{ name: string; dataUrl: string }[]>
  addEmoji: () => Promise<{ name: string; dataUrl: string }[]>
  removeEmoji: (name: string) => Promise<{ name: string; dataUrl: string }[]>

  // 搜索 / 导入
  search: (query: string) => Promise<SearchHit[]>
  importFiles: (parentPath: string) => Promise<OpResult>
  importFolders: (parentPath: string) => Promise<OpResult>
  /** 外部拖入导入（源=系统任意位置拖拽路径，目标=usersData 内目录） */
  importDrop: (destDir: string, paths: string[]) => Promise<OpResult>
  /** 系统文件对话框选择数据目录内的单个文件（不复制，直接打开）；
   *  取消返回 { canceled: true }；选了数据目录外的文件返回 { outOfRange: true }（渲染层提示先导入） */
  chooseFile: () => Promise<{ canceled: boolean; path: string | null; outOfRange?: boolean }>
  /** 从拖拽的 File 对象解析本地路径（Electron webUtils） */
  getPathForFile: (file: File) => string
  /** 用系统默认程序打开文件（非编辑类型） */
  openPath: (targetPath: string) => Promise<OpResult>
  /** 订阅文件系统变化（文件夹树刷新），返回取消函数 */
  onTreeChanged: (cb: () => void) => () => void
  /** 订阅"准备关闭"（主进程关闭握手：先保存+自动快照，完成后调用 readyClose） */
  onPrepareClose: (cb: () => void) => () => void
  /** 通知主进程：保存与自动快照已完成，可以关闭 */
  readyClose: (snapshotPaths?: string[]) => void
  /** 取消关闭（保存失败、用户选择不退出）：主进程清除兜底 timer，窗口保持打开 */
  cancelClose: () => void
  /** 编辑器独立窗口关闭握手完成（只销毁发送方窗口） */
  readyCloseEditor: () => void
  /** 编辑器独立窗口取消关闭（同 cancelClose） */
  cancelCloseEditor: () => void
  /** 在新窗口中打开文件（完整编辑器窗口） */
  openInNewWindow: (filePath: string) => Promise<void>

  // 导出
  /** 系统保存对话框：取消返回 null */
  saveDialog: (
    options: { defaultName: string; filters?: { name: string; extensions: string[] }[] }
  ) => Promise<string | null>
  /** HTML → PDF（隐藏窗口 printToPDF），返回 Buffer */
  exportPdf: (html: string) => Promise<{ ok: boolean; data?: Uint8Array; error?: string }>
  /** 导出写入（任意路径，路径来自系统保存对话框；与 writeFile 的 usersData 白名单分离） */
  exportWrite: (targetPath: string, data: string | Uint8Array) => Promise<OpResult>

  // AI
  /** 调用 OpenAI 兼容接口（主进程转发），返回生成文本 */
  aiComplete: (messages: AiMessage[]) => Promise<AiCompleteResult>
  /** 中止进行中的 AI 生成 */
  aiAbort: () => void
  /** 整屏截屏（识图选区裁剪用，返回物理像素截图 + 显示器/窗口位置） */
  screenshotCapture: () => Promise<ScreenshotCaptureResult>
  /** AI 视觉模型识图：图片 data URL → 识别文字 */
  aiVision: (imageDataUrl: string, prompt?: string) => Promise<AiCompleteResult>
  /** 打开识图遮罩窗口：window=压暗屏幕（主窗口置顶）；fullscreen=隐藏主窗口全屏选区 */
  captureStart: (mode: 'window' | 'fullscreen') => void
  /** 取消识图遮罩（关闭遮罩窗口并恢复主窗口） */
  captureCancel: () => void
  /** 全屏模式：遮罩窗口选区确认并裁剪后回传截图（主进程转发主窗口并清理） */
  captureResult: (dataUrl: string) => void
  /** 订阅主窗口收到全屏识图截图（取消函数） */
  onCaptureResult: (cb: (dataUrl: string) => void) => () => void
  /** 截屏记录列表（含缩略图，新在前） */
  ocrList: () => Promise<OcrHistoryEntry[]>
  /** 读取截屏原图（data URL） */
  ocrImage: (fileName: string) => Promise<string | null>
  /** 新增截屏记录（关闭识图结果框时调用） */
  ocrSave: (dataUrl: string, text: string | null, translated: string | null) => Promise<void>
  /** 打开截屏记录窗口（独立窗口，已存在则聚焦） */
  openOcrHistory: () => void
  /** 待办清单列表 */
  todoList: () => Promise<TodoItem[]>
  /** 保存待办清单（全量） */
  todoSave: (items: TodoItem[]) => Promise<void>
  /** 打开待办清单窗口（独立窗口，可置顶） */
  openTodo: () => void
  /** 切换当前窗口置顶状态 */
  toggleAlwaysOnTop: () => void
  /** 启动外部工具 MyAI Browser（C# 程序，独立窗口；失败返回错误信息） */
  launchMyAiBrowser: () => Promise<{ ok: boolean; error?: string }>
}

const api: WindowApi = {
  minimize: (): void => ipcRenderer.send('window:minimize'),
  toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
  close: (): void => ipcRenderer.send('window:close'),

  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  getDataDir: () => ipcRenderer.invoke('app:get-data-dir'),
  getDataRoot: () => ipcRenderer.invoke('app:get-data-root'),
  isFirstRun: () => ipcRenderer.invoke('app:is-first-run'),
  firstRunDone: () => ipcRenderer.invoke('app:first-run-done'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  changeDataRoot: () => ipcRenderer.invoke('data:change-root'),

  chooseAvatar: () => ipcRenderer.invoke('profile:choose-avatar'),
  readAvatar: () => ipcRenderer.invoke('profile:read-avatar'),
  clearAvatar: () => ipcRenderer.invoke('profile:clear-avatar'),

  logApp: (line) => ipcRenderer.send('log:append', line),

  readTree: (systemId) => ipcRenderer.invoke('fs:read-tree', systemId),
  getSystemDir: (systemId) => ipcRenderer.invoke('fs:get-system-dir', systemId),
  createFile: (parentPath, name) => ipcRenderer.invoke('fs:create-file', parentPath, name),
  createFolder: (parentPath, name) => ipcRenderer.invoke('fs:create-folder', parentPath, name),
  rename: (targetPath, newName) => ipcRenderer.invoke('fs:rename', targetPath, newName),
  trash: (targetPath) => ipcRenderer.invoke('fs:trash', targetPath),

  copy: (paths) => ipcRenderer.invoke('fs:copy', paths),
  cut: (paths) => ipcRenderer.invoke('fs:cut', paths),
  paste: (destDir, resolution) => ipcRenderer.invoke('fs:paste', destDir, resolution),
  clearClipboard: () => ipcRenderer.invoke('fs:clipboard-clear'),

  reveal: (targetPath) => ipcRenderer.invoke('fs:reveal', targetPath),
  openSystem: (systemId) => ipcRenderer.invoke('fs:open-system', systemId),

  createSnapshot: (sourcePath) => ipcRenderer.invoke('snapshot:create', sourcePath),
  readSnapshotMarker: (snapshotPath, isFile) =>
    ipcRenderer.invoke('snapshot:read-marker', snapshotPath, isFile),
  restoreSnapshot: (snapshotPath) => ipcRenderer.invoke('snapshot:restore', snapshotPath),
  removeSnapshotMarker: (snapshotPath) =>
    ipcRenderer.invoke('snapshot:remove-marker', snapshotPath),

  readFile: (targetPath) => ipcRenderer.invoke('file:read', targetPath),
  writeFile: (targetPath, data) => ipcRenderer.invoke('file:write', targetPath, data),
  readImageFile: (targetPath) => ipcRenderer.invoke('file:read-image', targetPath),
  stat: (targetPath) => ipcRenderer.invoke('fs:stat', targetPath),
  listEmojis: () => ipcRenderer.invoke('emoji:list'),
  addEmoji: () => ipcRenderer.invoke('emoji:add'),
  removeEmoji: (name) => ipcRenderer.invoke('emoji:remove', name),

  search: (query) => ipcRenderer.invoke('fs:search', query),
  importFiles: (parentPath) => ipcRenderer.invoke('fs:import-files', parentPath),
  importFolders: (parentPath) => ipcRenderer.invoke('fs:import-folders', parentPath),
  importDrop: (destDir, paths) => ipcRenderer.invoke('fs:import-drop', destDir, paths),
  chooseFile: () => ipcRenderer.invoke('fs:choose-file'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openPath: (targetPath) => ipcRenderer.invoke('fs:open-path', targetPath),
  onTreeChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('fs:changed', listener)
    return () => ipcRenderer.removeListener('fs:changed', listener)
  },

  onPrepareClose: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:prepare-close', listener)
    return () => ipcRenderer.removeListener('app:prepare-close', listener)
  },
  readyClose: (snapshotPaths?: string[]) => ipcRenderer.send('app:ready-close', snapshotPaths),
  /** 取消关闭：主进程清除兜底 timer（保存失败用户选择不退出时调用） */
  cancelClose: () => ipcRenderer.send('app:cancel-close'),
  /** 编辑器独立窗口关闭握手完成（只销毁发送方窗口） */
  readyCloseEditor: () => ipcRenderer.send('editor-window:ready-close'),
  /** 编辑器独立窗口取消关闭 */
  cancelCloseEditor: () => ipcRenderer.send('editor-window:cancel-close'),
  /** 在新窗口中打开文件（完整编辑器） */
  openInNewWindow: (filePath) => ipcRenderer.invoke('window:open-editor', filePath),

  saveDialog: (options) => ipcRenderer.invoke('export:save-dialog', options),
  exportPdf: (html) => ipcRenderer.invoke('export:pdf', html),
  exportWrite: (targetPath, data) => ipcRenderer.invoke('export:save', targetPath, data),

  aiComplete: (messages) => ipcRenderer.invoke('ai:complete', messages),
  aiAbort: () => ipcRenderer.send('ai:abort'),
  screenshotCapture: () => ipcRenderer.invoke('screenshot:capture'),
  aiVision: (imageDataUrl, prompt) => ipcRenderer.invoke('ai:vision', imageDataUrl, prompt),
  captureStart: (mode) => ipcRenderer.send('capture:start', mode),
  captureCancel: () => ipcRenderer.send('capture:cancel'),
  captureResult: (dataUrl) => ipcRenderer.send('capture:result', dataUrl),
  onCaptureResult: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, dataUrl: string): void => cb(dataUrl)
    ipcRenderer.on('capture:result', listener)
    return () => ipcRenderer.removeListener('capture:result', listener)
  },
  ocrList: () => ipcRenderer.invoke('ocr:list'),
  ocrImage: (fileName) => ipcRenderer.invoke('ocr:image', fileName),
  ocrSave: (dataUrl, text, translated) =>
    ipcRenderer.invoke('ocr:save', dataUrl, text, translated),
  openOcrHistory: () => ipcRenderer.send('window:open-ocr-history'),
  todoList: () => ipcRenderer.invoke('todo:list'),
  todoSave: (items) => ipcRenderer.invoke('todo:save', items),
  openTodo: () => ipcRenderer.send('window:open-todo'),
  toggleAlwaysOnTop: () => ipcRenderer.send('window:toggle-always-on-top'),
  launchMyAiBrowser: () => ipcRenderer.invoke('tool:launch-browser')
}

contextBridge.exposeInMainWorld('api', api)
