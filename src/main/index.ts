// src/main/index.ts
// 应用入口：数据目录初始化（首次选目录/检测补建）、窗口创建、全部 IPC 通道注册

import { app, shell, BrowserWindow, ipcMain, dialog, desktopCapturer, screen } from 'electron'
import { promises as fs } from 'fs'
import { watch, type FSWatcher } from 'fs'
import { join, dirname, basename, extname, isAbsolute } from 'path'
import { spawn } from 'child_process'
import { appendLog } from './logger'
import {
  loadConfig,
  saveConfig,
  updateConfig,
  loadOcrHistory,
  readOcrImage,
  appendOcrHistory,
  loadTodos,
  saveTodos,
  type AppConfig,
  type TodoItem
} from './store'
import {
  ensureSystemFolders,
  systemDirPath,
  SYSTEM_IDS,
  SYSTEM_FOLDERS,
  MARKER_FILE
} from './system-folders'
import * as fsService from './fs-service'
import type { SystemId, AiMessage } from '../shared/types'
import {
  dataPaths,
  migrateToDataLayout,
  moveDataLayout,
  findScatteredDataDirs,
  isScatteredUsersDataDir
} from './dataPaths'

/** 当前数据根目录（Data 布局的父级；更改 Data 目录后更新，所有 IPC 闭包读取最新值） */
let currentDataDir = ''
/** 当前 usersData 容器路径（Data/usersData；随 Data 目录更改而更新） */
let currentUsersDataPath = ''
/** 首次启动标记：无 dataDir 配置时置 true，渲染层显示引导向导（选数据目录） */
let isFirstRun = false

/** 文件夹树监听器（更改 Data 目录后重建） */
let treeWatcher: FSWatcher | null = null
let treeWatchTimer: NodeJS.Timeout | null = null

/** 文件夹树实时刷新：监听 usersData 目录变化（递归），防抖后推送渲染进程；改 Data 目录后重建 */
function startTreeWatch(watchPath: string): void {
  try {
    treeWatcher?.close()
  } catch {
    /* 忽略 */
  }
  treeWatcher = null
  try {
    treeWatcher = watch(watchPath, { recursive: true }, () => {
      if (treeWatchTimer) clearTimeout(treeWatchTimer)
      treeWatchTimer = setTimeout(() => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('fs:changed')
        }
      }, 500)
    })
  } catch (err) {
    console.log('[tree-watch] 无法监听目录：', String(err))
  }
}

/** 当前主窗口引用（关闭握手用） */
let mainWindowRef: BrowserWindow | null = null
// 开场动画 splash 窗口引用（方案 B：独立 splash 窗口 + Logo CSS 动画，主窗口就绪后关闭）
let splashWindowRef: BrowserWindow | null = null
/** splash 兜底关闭 timer（主窗口初始化异常时 10s 强制关；正常流程关闭时 clear） */
let splashFallbackTimer: NodeJS.Timeout | null = null
/** splash 创建时间（用于计算最短展示时长，保证动画播完再出现主窗口） */
let splashStartTime = 0
/** splash 最短展示时长（ms）：动画循环 2 轮左右，主窗口等它播完再淡入 */
const SPLASH_MIN_MS = 2600
/** splash 淡出时长（ms）：与主窗口淡入重叠衔接 */
const SPLASH_FADE_MS = 350
// 关闭握手：主窗口销毁后主进程仍在后台创建自动快照（未完成时不退出）
let pendingCloseSnapshots = false
// 主窗口关闭握手状态：渲染层保存失败取消关闭时复位（清除兜底 timer + closing 标记）
let mainClosing = false
let mainCloseTimer: NodeJS.Timeout | null = null

/** 识图全屏遮罩窗口引用（软件识图压暗屏幕 / 全屏识图选区宿主） */
let captureWindowRef: BrowserWindow | null = null

/** 创建开场动画窗口（方案 B：独立 splash + Logo CSS 动画；主窗口 ready 后由 closeSplashWindow 关闭）。
 *  设置 settings.splashEnabled 关闭时跳过（启动不弹 splash）。 */
async function createSplashWindow(): Promise<void> {
  if (splashWindowRef && !splashWindowRef.isDestroyed()) return
  try {
    const config = await loadConfig()
    if (!config.settings.splashEnabled) return
  } catch {
    /* 配置读取失败时仍显示 splash（默认行为） */
  }
  const splash = new BrowserWindow({
    width: 220,
    height: 220,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      sandbox: true
    }
  })
  splashWindowRef = splash
  splashStartTime = Date.now()
  splash.on('ready-to-show', () => splash.show())
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void splash.loadURL(`${devUrl}/splash.html`)
  } else {
    void splash.loadFile(join(__dirname, '../renderer/splash.html'))
  }
  // 兜底：主窗口初始化异常时 10s 后强制关闭，避免 splash 卡住
  splashFallbackTimer = setTimeout(() => closeSplashWindow(), 10000)
}

/** 关闭开场动画窗口（幂等） */
function closeSplashWindow(): void {
  if (splashFallbackTimer) {
    clearTimeout(splashFallbackTimer)
    splashFallbackTimer = null
  }
  if (splashWindowRef && !splashWindowRef.isDestroyed()) splashWindowRef.destroy()
  splashWindowRef = null
}

/** 遮罩窗口加载地址（#capture?mode=window|fullscreen，渲染层按 hash 路由） */
function captureWindowUrl(mode: 'window' | 'fullscreen'): string {
  const hash = `capture?mode=${mode}`
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return `${devUrl}/#${hash}`
  return `file://${join(__dirname, '../renderer/index.html')}#${hash}`
}

/** 创建并显示全屏遮罩窗口 */
function openCaptureWindow(mode: 'window' | 'fullscreen'): void {
  closeCaptureWindow()
  const mainWindow = mainWindowRef
  if (!mainWindow || mainWindow.isDestroyed()) return
  const win = new BrowserWindow({
    transparent: true,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  captureWindowRef = win
  void win.loadURL(captureWindowUrl(mode))
  if (mode === 'window') {
    // 软件识图：遮罩压暗屏幕，主窗口置顶发亮（可截窗口内内容）
    win.setFocusable(false)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    win.show()
    mainWindow.show()
    mainWindow.focus()
  } else {
    // 全屏识图：隐藏主窗口，遮罩窗口内做选区
    mainWindow.hide()
    win.show()
  }
}

/** 关闭遮罩窗口并恢复主窗口 */
function closeCaptureWindow(): void {
  if (captureWindowRef && !captureWindowRef.isDestroyed()) captureWindowRef.destroy()
  captureWindowRef = null
  const mainWindow = mainWindowRef
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.setAlwaysOnTop(false)
    mainWindow.focus()
  }
}

/** 读取头像图片文件 → data URL（渲染层显示用；文件缺失返回 null） */
async function readAvatarDataUrl(path: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(path)
    const ext = extname(path).slice(1).toLowerCase()
    const mime: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp'
    }
    return `data:${mime[ext] ?? 'image/png'};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** 截屏记录窗口引用 */
let ocrHistoryWindowRef: BrowserWindow | null = null

/** 打开截屏记录窗口（已存在则聚焦） */
async function openOcrHistoryWindow(): Promise<void> {
  if (ocrHistoryWindowRef && !ocrHistoryWindowRef.isDestroyed()) {
    activateWindow(ocrHistoryWindowRef)
    return
  }
  const saved = await getSavedWindowPos('ocrHistory')
  const win = new BrowserWindow({
    width: 760,
    height: 540,
    minWidth: 600,
    minHeight: 440,
    title: '截屏记录',
    frame: false,
    backgroundColor: '#e9e9e9',
    // 优先记忆位置；无记忆时级联居中（避免与其他独立窗口重叠）
    ...(saved ?? cascadePosition(760, 540)),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  ocrHistoryWindowRef = win
  win.on('moved', () => scheduleSaveWindowPos('ocrHistory', win))
  win.on('closed', () => {
    const t = windowPosTimers.get('ocrHistory')
    if (t) clearTimeout(t)
    windowPosTimers.delete('ocrHistory')
    ocrHistoryWindowRef = null
  })
  // 诊断：转发统计窗口 console 与崩溃日志（与主窗口一致）
  win.webContents.on('console-message', (event, levelOrDetails, message, line, sourceId) => {
    void event
    if (typeof levelOrDetails === 'object' && levelOrDetails !== null) {
      const d = levelOrDetails as { level?: string; message?: string; lineNumber?: number; sourceId?: string }
      console.log(`[ocr-history:${d.level ?? ''}] ${d.message ?? ''} (${d.sourceId ?? ''}:${d.lineNumber ?? ''})`)
    } else {
      console.log(`[ocr-history:${levelOrDetails}] ${message ?? ''} (${sourceId ?? ''}:${line ?? ''})`)
    }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[ocr-history render-process-gone]', JSON.stringify(details))
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/#ocr-history`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'ocr-history' })
}

/** 待办清单窗口引用 */
let todoWindowRef: BrowserWindow | null = null

/**
 * 独立窗口打开位置：优先记忆位置；无记忆时默认居中，
 * 已有其他独立窗口打开则向右下偏移 60px 级联（避免完全重叠）
 */
function cascadePosition(width: number, height: number): { x: number; y: number } {
  const otherOpen =
    (ocrHistoryWindowRef && !ocrHistoryWindowRef.isDestroyed()) ||
    (todoWindowRef && !todoWindowRef.isDestroyed())
  const wa = screen.getPrimaryDisplay().workArea
  const x = Math.round(wa.x + (wa.width - width) / 2) + (otherOpen ? 60 : 0)
  const y = Math.round(wa.y + (wa.height - height) / 2) + (otherOpen ? 60 : 0)
  return { x, y }
}

/** 读取记忆的窗口位置（无则 null） */
async function getSavedWindowPos(key: string): Promise<{ x: number; y: number } | null> {
  const cfg = await loadConfig()
  const p = cfg.windowPositions?.[key]
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p
  return null
}

/** 记忆窗口位置（防抖 600ms 写 config），窗口关闭时清除待写入 */
const windowPosTimers = new Map<string, NodeJS.Timeout>()

function scheduleSaveWindowPos(key: string, win: BrowserWindow): void {
  const prev = windowPosTimers.get(key)
  if (prev) clearTimeout(prev)
  windowPosTimers.set(
    key,
    setTimeout(() => {
      windowPosTimers.delete(key)
      if (win.isDestroyed()) return
      const b = win.getBounds()
      void (async () => {
        const cfg = await loadConfig()
        await updateConfig({
          windowPositions: { ...cfg.windowPositions, [key]: { x: b.x, y: b.y } }
        }).catch(() => undefined)
      })()
    }, 600)
  )
}

/** 唤起已打开的独立窗口（已显示仅聚焦，避免闪动；最小化先恢复） */
function activateWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

/** 打开待办清单窗口（已存在则聚焦） */
async function openTodoWindow(): Promise<void> {
  if (todoWindowRef && !todoWindowRef.isDestroyed()) {
    activateWindow(todoWindowRef)
    return
  }
  const saved = await getSavedWindowPos('todo')
  const win = new BrowserWindow({
    width: 520,
    height: 620,
    minWidth: 420,
    minHeight: 420,
    title: '待办清单',
    frame: false,
    backgroundColor: '#e9e9e9',
    // 优先记忆位置；无记忆时级联居中（避免与其他独立窗口重叠）
    ...(saved ?? cascadePosition(520, 620)),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  todoWindowRef = win
  win.on('moved', () => scheduleSaveWindowPos('todo', win))
  win.on('closed', () => {
    const t = windowPosTimers.get('todo')
    if (t) clearTimeout(t)
    windowPosTimers.delete('todo')
    todoWindowRef = null
  })
  // 诊断：转发待办窗口 console 与崩溃日志
  win.webContents.on('console-message', (event, levelOrDetails, message, line, sourceId) => {
    void event
    if (typeof levelOrDetails === 'object' && levelOrDetails !== null) {
      const d = levelOrDetails as { level?: string; message?: string; lineNumber?: number; sourceId?: string }
      console.log(`[todo:${d.level ?? ''}] ${d.message ?? ''} (${d.sourceId ?? ''}:${d.lineNumber ?? ''})`)
    } else {
      console.log(`[todo:${levelOrDetails}] ${message ?? ''} (${sourceId ?? ''}:${line ?? ''})`)
    }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[todo render-process-gone]', JSON.stringify(details))
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/#todo`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'todo' })
}

function defaultDataDir(): string {
  // dev：项目根目录；打包后：userData（AppData，始终可写、卸载不删）。
  // 不用 exe 目录：安装到 Program Files 等受保护位置时首次启动 mkdir 会失败，
  // 且卸载程序删除安装目录会连带删掉数据。
  return app.isPackaged ? app.getPath('userData') : process.cwd()
}

async function pathExists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true).catch(() => false)
}

/**
 * 确保数据目录就绪，返回 { dataDir（usersData 的父目录）, currentUsersDataPath（usersData 容器） }。
 * 规则：数据目录下创建 usersData 容器，四个系统文件夹建在 usersData 内。
 * 兼容处理：
 *  - 用户直接把 usersData 目录选为数据目录 → 该目录即 usersData 根
 *  - 旧版把数据目录直接当 usersData 根（.mypaper 直接存在于数据目录）→ 迁移进 usersData 容器
 */
async function ensureDataDir(): Promise<{ dataDir: string; usersDataPath: string }> {
  let config = await loadConfig()
  let dataDir = config.dataDir

  if (!dataDir || !(await pathExists(dataDir))) {
    if (!dataDir) {
      // 首次启动：不弹原生对话框，用默认目录先初始化，标记 firstRun
      // 由渲染层引导向导引导用户选择数据目录（调 data:change-root 整体移动）
      isFirstRun = true
      dataDir = defaultDataDir()
    } else {
      // 已配置但目录失效（被移动/删除）：弹框重新选择
      const res = await dialog.showOpenDialog({
        title: '选择 MyPaper 数据目录（MyPaperData 将创建在该目录下）',
        buttonLabel: '选择此目录',
        properties: ['openDirectory', 'createDirectory']
      })
      if (!res.canceled && res.filePaths[0]) {
        dataDir = res.filePaths[0]
      }
    }
    if (!dataDir) dataDir = defaultDataDir()
    config = { ...config, dataDir }
    await saveConfig(config)
  }

  const base = basename(dataDir).toLowerCase()
  if (base === 'usersdata' || base === 'mypaperdata') {
    // 用户把 usersData / MyPaperData 目录本身选为数据目录：修正为父目录
    // （usersData / MyPaperData 将作为子目录创建在该父目录下）
    dataDir = dirname(dataDir)
    config = { ...config, dataDir }
    await saveConfig(config)
  }

  // 旧平级结构（usersData/todoList/ocrImages/emojis 直接放数据根）→ 一次性迁移进 MyPaperData/
  await migrateToDataLayout(dataDir)

  const paths = dataPaths(dataDir)
  currentDataDir = dataDir
  currentUsersDataPath = paths.usersData

  // 旧版迁移：数据目录下直接存在 .mypaper（曾把数据目录当 usersData 根）→ 移进 usersData 容器
  if (await pathExists(join(dataDir, MARKER_FILE))) {
    await fs.mkdir(paths.usersData, { recursive: true })
    for (const id of SYSTEM_IDS) {
      const src = join(dataDir, SYSTEM_FOLDERS[id].dir)
      const dst = join(paths.usersData, SYSTEM_FOLDERS[id].dir)
      if ((await pathExists(src)) && !(await pathExists(dst))) {
        await fs.rename(src, dst)
      }
    }
    const markerDst = join(paths.usersData, MARKER_FILE)
    if (!(await pathExists(markerDst))) {
      await fs.rename(join(dataDir, MARKER_FILE), markerDst)
    }
  }

  await ensureSystemFolders(paths.usersData)
  await fs.mkdir(paths.todoList, { recursive: true })
  return { dataDir, usersDataPath: paths.usersData }
}

/** 校验渲染层传入的路径位于 usersData 容器内（防越界访问/执行数据目录之外的文件） */
function insideUsersData(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && fsService.isInsideDataDir(currentUsersDataPath, p)
}

/** 校验路径数组全部位于 usersData 内 */
function allInsideUsersData(paths: unknown): paths is string[] {
  return Array.isArray(paths) && paths.length > 0 && paths.every((p) => insideUsersData(p))
}

/**
 * 首次启动手册播种：把打包进 resources/handbook 的《MyPaper使用手册.md》复制到
 * 论文写作（PaperWriting）根目录并置顶。
 * 规则（用户定案）：同版本内只播一次；用户删除后不再自动出现；目标已存在同名文件时不覆盖。
 * **版本化标记（2026-08-16）**：handbookSeeded 存"已播种的版本号"——旧格式布尔 true 视为
 * 旧版已播种但当前版本未播种 → 覆盖安装/升级时重新播种+置顶一次（解决"重装后手册不出现/不置顶"）；
 * 同版本再次启动直接返回（用户删除手册后不重播）。
 * dev 模式种子回退到项目 build/handbook（process.cwd()）。
 */
async function seedHandbook(usersDataPath: string): Promise<void> {
  try {
    const cfg = await loadConfig()
    const appVersion = app.getVersion()
    if (cfg.handbookSeeded === appVersion) return
    const handbookName = 'MyPaper使用手册.md'
    // 种子源：打包后 resources/handbook；dev 回退项目 build/handbook
    const sources = [
      join(process.resourcesPath, 'handbook', handbookName),
      join(process.cwd(), 'build', 'handbook', handbookName)
    ]
    let src: string | null = null
    for (const s of sources) {
      if (await pathExists(s)) {
        src = s
        break
      }
    }
    if (!src) {
      console.log('[seed-handbook] 未找到手册种子，跳过播种')
      return
    }
    const paperDir = systemDirPath(usersDataPath, 'paper')
    await fs.mkdir(paperDir, { recursive: true })
    const dest = join(paperDir, handbookName)
    if (!(await pathExists(dest))) {
      await fs.copyFile(src, dest)
      console.log('[seed-handbook] 已播种手册到', dest)
    }
    // 置顶（指向目标文件；已存在同名文件时也置顶）。手册始终放置顶区最前，保证第一眼可见；
    // 用户手动取消置顶后（从 pinnedPaths 移除）不再重排——seeded 标记已置位，下次启动直接返回。
    // updateConfig 内部 read-modify-write 串行（configWriteChain 队列），返回值是队列内最新
    // 完整配置——基于它计算置顶，避免用函数开头的旧 pinnedPaths 快照覆盖并发写入的置顶
    const saved = await updateConfig({ handbookSeeded: appVersion })
    const pinned = saved.pinnedPaths ?? []
    const nextPinned = [dest, ...pinned.filter((p) => p !== dest)]
    if (nextPinned[0] !== dest || nextPinned.length !== pinned.length) {
      await updateConfig({ pinnedPaths: nextPinned })
    }
  } catch (err) {
    // 播种失败不阻塞启动（静默）
    console.log('[seed-handbook] 播种失败：', String(err))
  }
}

/** 粘贴本地图片可读取的扩展名（file:read-image 白名单，防任意文件读取） */
const IMAGE_READ_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
  'tif',
  'tiff'
])

function registerIpc(): void {
  // ---- 关闭握手：渲染进程保存完成后才真正关闭 ----
  // 自动快照移入主进程后台执行：窗口先销毁，主进程逐个创建快照（复制磁盘文件，
  // 无需渲染层），全部完成后再退出——避免关闭时等待 fs 复制大文件而"卡一下"。
  ipcMain.on('app:ready-close', (_e, snapshotPaths?: string[]) => {
    closeSplashWindow()
    // 先置位再销毁窗口：destroy() 会同步触发 window-all-closed，
    // 若此时 pendingCloseSnapshots 仍为 false，app.quit() 会提前退出、中断后台快照
    pendingCloseSnapshots = true
    if (mainWindowRef && !mainWindowRef.isDestroyed()) mainWindowRef.destroy()
    const paths = Array.isArray(snapshotPaths)
      ? snapshotPaths.filter((p): p is string => typeof p === 'string' && p.length > 0 && insideUsersData(p))
      : []
    if (paths.length === 0) {
      pendingCloseSnapshots = false
      app.quit()
      return
    }
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      pendingCloseSnapshots = false
      app.quit()
    }
    void (async () => {
      for (const p of paths) {
        try {
          // 关闭软件自动快照：放开区域限制，只按可编辑性分类（渲染层已过滤非可编辑文件）
          await fsService.createSnapshot(currentUsersDataPath, p, { allowAnySystem: true })
        } catch {
          // 快照失败静默忽略（与原渲染层行为一致）
        }
      }
    })().finally(finish)
    // 兜底：快照异常耗时超过 20s 强制退出
    setTimeout(finish, 20000)
  })

  // ---- 配置 ----
  ipcMain.handle('config:get', () => loadConfig())
  ipcMain.handle('config:update', (_e, patch: Partial<AppConfig>) => updateConfig(patch))

  // ---- 操作日志：渲染层关键事件写入 <userData>/logs/mypaper.log（排障用） ----
  ipcMain.on('log:append', (_e, line: string) => {
    if (typeof line === 'string' && line.length > 0) void appendLog(line)
  })

  // ---- 个人资料（头像 + 用户名）：头像图片复制到 userData/avatars/，config.avatarPath 记录绝对路径 ----
  ipcMain.handle('profile:choose-avatar', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择头像图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      properties: ['openFile']
    })
    const src = res.canceled ? '' : res.filePaths[0]
    // 取消选择：config 返回 null，渲染层据此不更新状态
    if (!src) return { config: null, avatarDataUrl: null }
    const avatarDir = join(app.getPath('userData'), 'avatars')
    await fs.mkdir(avatarDir, { recursive: true })
    const dest = join(avatarDir, `avatar-${Date.now()}${extname(src).toLowerCase() || '.png'}`)
    await fs.copyFile(src, dest)
    // 删除旧头像文件，避免 avatars/ 目录堆积
    const prev = await loadConfig()
    if (prev.avatarPath) await fs.unlink(prev.avatarPath).catch(() => {})
    const config = await updateConfig({ avatarPath: dest })
    return { config, avatarDataUrl: await readAvatarDataUrl(dest) }
  })
  ipcMain.handle('profile:read-avatar', async () => {
    const { avatarPath } = await loadConfig()
    return avatarPath ? readAvatarDataUrl(avatarPath) : null
  })
  ipcMain.handle('profile:clear-avatar', async () => {
    const prev = await loadConfig()
    if (prev.avatarPath) await fs.unlink(prev.avatarPath).catch(() => {})
    return updateConfig({ avatarPath: null })
  })

  // ---- 自定义表情包：图片复制到 <dataDir>/MyPaperData/emojis/，面板列表展示、点击插入文档 ----
  // 注意：必须运行时求值（data:change-root 首次启动/更改数据根后 emojiDir 会变化，不能闭包快照）
  const getEmojiDir = (): string => dataPaths(currentDataDir).emojis
  const oldEmojiDir = join(app.getPath('userData'), 'emojis')

  const readEmojiDataUrl = async (filePath: string): Promise<string | null> => {
    try {
      const buf = await fs.readFile(filePath)
      const ext = extname(filePath).toLowerCase().slice(1) || 'png'
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }

  // 迁移：早期版本存 userData/emojis/，移到 <dataDir>/emojis/ 后删除旧目录（幂等）
  const migrateEmojis = async (): Promise<void> => {
    const emojiDir = getEmojiDir()
    if (oldEmojiDir === emojiDir) return
    if (!(await pathExists(oldEmojiDir))) return
    await fs.mkdir(emojiDir, { recursive: true })
    for (const f of await fs.readdir(oldEmojiDir)) {
      const dest = join(emojiDir, f)
      if (!(await pathExists(dest))) {
        await fs.copyFile(join(oldEmojiDir, f), dest).catch(() => {})
      }
    }
    await fs.rm(oldEmojiDir, { recursive: true, force: true }).catch(() => {})
  }

  const listEmojis = async (): Promise<{ name: string; dataUrl: string }[]> => {
    const emojiDir = getEmojiDir()
    await migrateEmojis()
    await fs.mkdir(emojiDir, { recursive: true })
    const entries = await fs.readdir(emojiDir)
    const out: { name: string; dataUrl: string }[] = []
    for (const f of entries.filter((n) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(n)).sort()) {
      const dataUrl = await readEmojiDataUrl(join(emojiDir, f))
      if (dataUrl) out.push({ name: f, dataUrl })
    }
    return out
  }

  const fileExists = async (p: string): Promise<boolean> => {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }

  ipcMain.handle('emoji:list', () => listEmojis())

  ipcMain.handle('emoji:add', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择表情图片（可多选）',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled || res.filePaths.length === 0) return listEmojis()
    const emojiDir = getEmojiDir()
    await fs.mkdir(emojiDir, { recursive: true })
    for (const src of res.filePaths) {
      const ext = extname(src).toLowerCase() || '.png'
      const base = basename(src, extname(src))
      let dest = join(emojiDir, `${base}${ext}`)
      let i = 1
      while (await fileExists(dest)) {
        dest = join(emojiDir, `${base}-${i}${ext}`)
        i++
      }
      await fs.copyFile(src, dest)
    }
    return listEmojis()
  })

  ipcMain.handle('emoji:remove', async (_e, name: string) => {
    // 防路径穿越：只允许删除 emojis 目录内的文件
    if (basename(name) === name) await fs.unlink(join(getEmojiDir(), name)).catch(() => {})
    return listEmojis()
  })

  // ---- AI（OpenAI 兼容接口，主进程转发避免渲染进程 CORS 限制） ----
  // 各窗口进行中的请求按 webContents.id 注册，ai:abort 只中止发送方窗口的请求
  // （避免多窗口并发时互相误杀，如主窗口 AI 面板与独立编辑器窗口同时生成）
  const activeAiAborts = new Map<number, () => void>()
  ipcMain.handle('ai:complete', async (event, messages: AiMessage[]) => {
    const senderId = event.sender.id
    const { ai } = await loadConfig()
    if (!ai.baseUrl || !ai.apiKey || !ai.model) {
      return { ok: false, error: '请先在右上角 AI 配置中填写 API 地址、API Key 和模型名' }
    }
    const url = `${ai.baseUrl.replace(/\/+$/, '')}/chat/completions`
    const controller = new AbortController()
    let stoppedByUser = false
    activeAiAborts.set(senderId, () => {
      stoppedByUser = true
      controller.abort()
    })
    const timer = setTimeout(() => controller.abort(), 120_000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ai.apiKey}`
        },
        body: JSON.stringify({
          model: ai.model,
          messages,
          temperature: ai.temperature
        }),
        signal: controller.signal
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false, error: `AI 请求失败（HTTP ${res.status}）：${body.slice(0, 300)}` }
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const text = data.choices?.[0]?.message?.content
      if (!text) return { ok: false, error: 'AI 返回内容为空' }
      return { ok: true, text }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: stoppedByUser ? '已停止' : 'AI 请求超时' }
      }
      return { ok: false, error: `AI 请求异常：${String(err)}` }
    } finally {
      activeAiAborts.delete(senderId)
      clearTimeout(timer)
    }
  })
  ipcMain.on('ai:abort', (event) => {
    // 只中止发送方窗口的请求（各窗口独立注册）
    activeAiAborts.get(event.sender.id)?.()
  })

  // ---- 识图：整屏截屏（供渲染层选区裁剪，本窗口不隐藏） ----
  ipcMain.handle('screenshot:capture', async () => {
    try {
      const cursor = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(cursor)
      const scale = display.scaleFactor
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(display.size.width * scale),
          height: Math.round(display.size.height * scale)
        }
      })
      const source = sources.find((s) => s.display_id === String(display.id))
      if (!source) return { ok: false, error: '未找到屏幕源，请重试' }
      const win = mainWindowRef
      const bounds = win?.getContentBounds()
      return {
        ok: true,
        imageDataUrl: source.thumbnail.toDataURL(),
        display: { x: display.bounds.x, y: display.bounds.y, scaleFactor: scale },
        win: bounds ? { x: bounds.x, y: bounds.y } : { x: 0, y: 0 }
      }
    } catch (err) {
      return { ok: false, error: `截屏失败：${String(err)}` }
    }
  })

  // ---- 识图：AI 视觉模型识别（OpenAI 兼容，content 用 parts 数组 + image_url） ----
  ipcMain.handle('ai:vision', async (event, imageDataUrl: string, prompt?: string) => {
    const senderId = event.sender.id
    const { ai } = await loadConfig()
    // 视觉模型名：优先识图模型；未配置时兜底用文字模型（需支持多模态，与 AI 配置提示一致）
    const visionModel = ai.visionModel?.trim() || ai.model?.trim()
    if (!visionModel) {
      return { ok: false, error: '未配置模型名（右上角 AI 配置 → 文字模型或识图模型）' }
    }
    // 视觉模型可与文本模型不同服务商：地址/Key 均支持独立配置，留空才复用文本配置
    const visionBaseUrl = ai.visionBaseUrl?.trim() || ai.baseUrl
    const key = ai.visionApiKey?.trim() || ai.apiKey
    if (!visionBaseUrl || !key) return { ok: false, error: '请先配置 API 地址和 API Key' }
    const url = `${visionBaseUrl.replace(/\/+$/, '')}/chat/completions`
    const controller = new AbortController()
    activeAiAborts.set(senderId, () => controller.abort())
    const timer = setTimeout(() => controller.abort(), 120_000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: visionModel,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    prompt ??
                    '请识别图片中的所有文字，保留原有换行排版，只输出识别出的文字，不要任何解释。'
                },
                { type: 'image_url', image_url: { url: imageDataUrl, detail: 'auto' } }
              ]
            }
          ],
          temperature: ai.temperature
        }),
        signal: controller.signal
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false, error: `AI 识图请求失败（HTTP ${res.status}）：${body.slice(0, 300)}` }
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const text = data.choices?.[0]?.message?.content
      if (!text) return { ok: false, error: 'AI 识图返回内容为空' }
      return { ok: true, text }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: 'AI 识图请求超时' }
      }
      return { ok: false, error: `AI 识图请求异常：${String(err)}` }
    } finally {
      activeAiAborts.delete(senderId)
      clearTimeout(timer)
    }
  })

  // ---- 识图：遮罩窗口（软件识图压暗屏幕 / 全屏识图选区） ----
  ipcMain.on('capture:start', (_e, mode: 'window' | 'fullscreen') => {
    openCaptureWindow(mode)
  })
  ipcMain.on('capture:cancel', () => {
    closeCaptureWindow()
  })
  // 全屏模式：遮罩窗口确认选区并裁剪后回传，转发给主窗口显示截图结果框
  ipcMain.on('capture:result', (_e, dataUrl: string) => {
    const mainWindow = mainWindowRef
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('capture:result', dataUrl)
    }
    closeCaptureWindow()
  })

  // ---- 识图：截屏记录（ocrHistory.json + ocrImages/） ----
  ipcMain.handle('ocr:list', () => loadOcrHistory())
  ipcMain.handle('ocr:image', (_e, fileName: string) => readOcrImage(fileName))
  ipcMain.handle(
    'ocr:save',
    (_e, dataUrl: string, text: string | null, translated: string | null) =>
      appendOcrHistory(dataUrl, text, translated)
  )

  // ---- 截屏记录窗口（独立窗口） ----
  ipcMain.on('window:open-ocr-history', () => {
    openOcrHistoryWindow()
  })

  // ---- 待办清单 ----
  ipcMain.handle('todo:list', () => loadTodos())
  ipcMain.handle('todo:save', (_e, items: TodoItem[]) => saveTodos(items))
  ipcMain.on('window:open-todo', () => {
    openTodoWindow()
  })
  // 窗口置顶切换（待办窗口用）
  ipcMain.on('window:toggle-always-on-top', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setAlwaysOnTop(!win.isAlwaysOnTop())
  })

  // ---- 外部工具：MyAI Browser（C# 程序，独立窗口启动） ----
  // 打包后程序位于 resources/MyAI Browser/；dev 回退项目根「MyAI Browser-发布包」目录
  ipcMain.handle('tool:launch-browser', async () => {
    const toolName = 'MyAI Browser'
    const dirs = [join(process.resourcesPath, toolName), join(process.cwd(), `${toolName}-发布包`)]
    let exe: string | null = null
    let toolDir = ''
    for (const d of dirs) {
      const p = join(d, `${toolName}.exe`)
      if (await pathExists(p)) {
        exe = p
        toolDir = d
        break
      }
    }
    if (!exe) {
      return { ok: false, error: `未找到 ${toolName}.exe（resources/${toolName}/）` }
    }
    try {
      // stdio ignore：不接管道，避免子进程输出写满阻塞；cwd 指向程序目录（dll 相对加载）
      await new Promise<void>((resolve, reject) => {
        const target = exe as string
        const child = spawn(target, [], { cwd: toolDir, stdio: 'ignore' })
        child.once('error', reject)
        child.once('spawn', () => resolve())
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `启动失败：${String(err)}` }
    }
  })

  // ---- 数据目录 ----
  ipcMain.handle('app:get-data-dir', () => currentUsersDataPath)
  // 数据根目录（MyPaperData 的父级；首次启动向导显示默认位置用）
  ipcMain.handle('app:get-data-root', () => currentDataDir)
  // 首次启动标记（无 dataDir 配置 → 引导向导选数据目录）
  ipcMain.handle('app:is-first-run', () => isFirstRun)
  // 引导向导完成（选择目录或跳过）后复位标记，防止渲染层刷新后向导反复弹出
  ipcMain.handle('app:first-run-done', () => {
    isFirstRun = false
    return true
  })
  // 应用版本（electron 打包后读安装包版本，dev 读 package.json）
  ipcMain.handle('app:get-version', () => app.getVersion())

  // 更改数据根目录：选择新根（MyPaperData 将创建在该目录下）→ 整体移动 →
  // 更新 config / 快照 originalPath / 文件夹颜色前缀 / fs.watch 重建。
  // 兼容旧 BUG 布局自愈：若新根或当前根下存在散落的数据目录（用户当初选的目录被
  // 误当成 MyPaperData 本体），一并收拢进新的 MyPaperData。渲染层需先确认无打开标签页。
  ipcMain.handle(
    'data:change-root',
    async (): Promise<{ ok: boolean; canceled?: boolean; error?: string; dataRoot?: string }> => {
      try {
        const oldPaths = dataPaths(currentDataDir)
        const res = await dialog.showOpenDialog({
          title: '选择新的数据根目录（MyPaperData 文件夹将创建在该目录下）',
          buttonLabel: '移动到此位置',
          properties: ['openDirectory', 'createDirectory']
        })
        if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
        const newDataDir = res.filePaths[0]
        const newRoot = join(newDataDir, 'MyPaperData')
        if (newDataDir.toLowerCase() === currentDataDir.toLowerCase()) {
          return { ok: false, error: '新位置与当前数据根目录相同' }
        }
        if (fsService.isInsideDataDir(oldPaths.dataRoot, newRoot)) {
          return { ok: false, error: '不能选择当前 MyPaperData 文件夹内部的位置' }
        }
        if (await pathExists(newRoot)) {
          const entries = await fs.readdir(newRoot)
          if (entries.length > 0) {
            return { ok: false, error: '目标位置已存在非空 MyPaperData 文件夹，请选择其他位置' }
          }
        }
        // 旧 BUG 布局自愈：数据可能散落在新根下（重新选择当初的目录）或当前根下（改选全新位置）
        const scatteredSet = new Set<string>()
        if (await isScatteredUsersDataDir(newDataDir)) scatteredSet.add(newDataDir)
        for (const d of await findScatteredDataDirs(newDataDir)) scatteredSet.add(d)
        for (const d of await findScatteredDataDirs(currentDataDir)) scatteredSet.add(d)
        const scattered = [...scatteredSet]
        // 移动前先关闭旧 watcher（Windows 上递归 fs.watch 会阻碍 rename/rm）
        try {
          treeWatcher?.close()
        } catch {
          /* 忽略 */
        }
        treeWatcher = null
        await moveDataLayout(oldPaths.dataRoot, newRoot, scattered)
        // 先持久化 config：失败则回滚（把已移入的项移回旧位置），避免"数据已移动但配置没更新"
        try {
          await updateConfig({ dataDir: newDataDir })
        } catch (err) {
          try {
            await moveDataLayout(newRoot, oldPaths.dataRoot, [])
          } catch {
            /* 回滚尽力而为 */
          }
          return { ok: false, error: `配置保存失败，数据已尝试回滚：${String(err)}` }
        }
        const newPaths = dataPaths(newDataDir)
        // 更新运行时路径 + 重建监听
        currentDataDir = newDataDir
        currentUsersDataPath = newPaths.usersData
        isFirstRun = false
        startTreeWatch(newPaths.usersData)
        // 辅助联动（快照 originalPath / 文件夹颜色前缀）：失败仅告警，不影响主流程结果
        try {
          await fsService.updateSnapshotReferences(newPaths.usersData, oldPaths.dataRoot, newRoot)
          for (const src of scattered) {
            await fsService.updateSnapshotReferences(
              newPaths.usersData,
              join(src, 'usersData'),
              newPaths.usersData
            )
          }
        } catch (err) {
          console.log('[data-layout] 快照引用更新失败：', String(err))
        }
        try {
          const cfg = await loadConfig()
          if (cfg.folderColors && Object.keys(cfg.folderColors).length > 0) {
            const pairs: Array<[string, string]> = [
              ...scattered.map((s) => [s, newRoot] as [string, string]),
              [oldPaths.dataRoot, newRoot]
            ]
            let colors = { ...cfg.folderColors }
            for (const [from, to] of pairs) {
              const fp = from.replace(/\\/g, '/')
              const tp = to.replace(/\\/g, '/')
              const next: Record<string, string> = {}
              for (const [k, v] of Object.entries(colors)) {
                const nk = k.replace(/\\/g, '/')
                next[nk.startsWith(fp + '/') ? tp + nk.slice(fp.length) : k] = v
              }
              colors = next
            }
            await updateConfig({ folderColors: colors })
          }
        } catch (err) {
          console.log('[data-layout] 文件夹颜色前缀更新失败：', String(err))
        }
        try {
          // 置顶路径前缀联动（与 folderColors 同规则：旧根 → 新根，散落源 → 新根）
          const cfg = await loadConfig()
          if (cfg.pinnedPaths && cfg.pinnedPaths.length > 0) {
            const pairs: Array<[string, string]> = [
              ...scattered.map((s) => [s, newRoot] as [string, string]),
              [oldPaths.dataRoot, newRoot]
            ]
            let pinned = [...cfg.pinnedPaths]
            for (const [from, to] of pairs) {
              const fp = from.replace(/\\/g, '/')
              const tp = to.replace(/\\/g, '/')
              pinned = pinned.map((p) => {
                const np = p.replace(/\\/g, '/')
                return np.startsWith(fp + '/') ? tp + np.slice(fp.length) : p
              })
            }
            await updateConfig({ pinnedPaths: pinned })
          }
        } catch (err) {
          console.log('[data-layout] 置顶路径前缀更新失败：', String(err))
        }
        return { ok: true, dataRoot: newRoot }
      } catch (err) {
        return { ok: false, error: `移动失败：${String(err)}` }
      }
    }
  )

  // ---- 文件夹树 ----
  ipcMain.handle('fs:read-tree', (_e, systemId: SystemId) =>
    fsService.readTree(systemDirPath(currentUsersDataPath, systemId))
  )
  ipcMain.handle('fs:get-system-dir', (_e, systemId: SystemId) =>
    fsService.getSystemDir(currentUsersDataPath, systemId)
  )
  ipcMain.handle('fs:create-file', (_e, parentPath: string, name: string) => {
    if (!insideUsersData(parentPath)) return { ok: false, error: '路径越界' }
    return fsService.createFile(parentPath, name)
  })
  ipcMain.handle('fs:create-folder', (_e, parentPath: string, name: string) => {
    if (!insideUsersData(parentPath)) return { ok: false, error: '路径越界' }
    return fsService.createFolder(parentPath, name)
  })
  ipcMain.handle('fs:rename', (_e, targetPath: string, newName: string) => {
    if (!insideUsersData(targetPath)) return { ok: false, error: '路径越界' }
    return fsService.renameEntry(targetPath, newName, currentUsersDataPath)
  })
  ipcMain.handle('fs:trash', (_e, targetPath: string) => {
    if (!insideUsersData(targetPath)) return { ok: false, error: '路径越界' }
    return fsService.trashEntry(targetPath)
  })

  // ---- 快照 ----
  ipcMain.handle('snapshot:create', (_e, sourcePath: string) => {
    if (!insideUsersData(sourcePath)) return { ok: false, error: '路径越界' }
    return fsService.createSnapshot(currentUsersDataPath, sourcePath)
  })
  ipcMain.handle('snapshot:read-marker', (_e, snapshotPath: string, isFile: boolean) => {
    if (!insideUsersData(snapshotPath)) return { ok: false, error: '路径越界' }
    return fsService.readSnapshotMarker(snapshotPath, isFile)
  })
  ipcMain.handle('snapshot:restore', async (_e, snapshotPath: string) => {
    if (!insideUsersData(snapshotPath)) return { ok: false, error: '路径越界' }
    const config = await loadConfig()
    return fsService.restoreSnapshot(
      currentUsersDataPath,
      snapshotPath,
      config.settings.snapshotRestoreTarget
    )
  })
  ipcMain.handle('snapshot:remove-marker', (_e, snapshotPath: string) => {
    if (!insideUsersData(snapshotPath)) return { ok: false, error: '路径越界' }
    return fsService.removeSnapshotMarker(currentUsersDataPath, snapshotPath)
  })

  // ---- 复制/剪切/粘贴（含重名冲突续传） ----
  ipcMain.handle('fs:copy', (_e, paths: string[]) => {
    if (!allInsideUsersData(paths)) return { ok: false, error: '路径越界' }
    fsService.setClipboard('copy', paths)
    return { ok: true }
  })
  ipcMain.handle('fs:cut', (_e, paths: string[]) => {
    if (!allInsideUsersData(paths)) return { ok: false, error: '路径越界' }
    fsService.setClipboard('cut', paths)
    return { ok: true }
  })
  ipcMain.handle(
    'fs:paste',
    (
      _e,
      destDir: string,
      resolution?: { kind: 'overwrite' | 'keep-both' | 'rename'; renameTo?: string }
    ) => {
      if (!insideUsersData(destDir)) return { ok: false, error: '路径越界' }
      return fsService.pasteTo(destDir, resolution, currentUsersDataPath)
    }
  )
  // 清空复制/剪切剪贴板（取消粘贴时调用，防残留 cut 状态导致后续粘贴误移动剩余文件）
  ipcMain.handle('fs:clipboard-clear', () => {
    fsService.clearClipboard()
    return { ok: true }
  })

  // ---- 资源管理器 ----
  ipcMain.handle('fs:reveal', (_e, targetPath: string) => {
    if (!insideUsersData(targetPath)) return { ok: false, error: '路径越界' }
    fsService.revealInExplorer(targetPath)
    return { ok: true }
  })

  // ---- 文件读写（编辑器） ----
  ipcMain.handle('file:read', (_e, targetPath: string) => {
    if (!insideUsersData(targetPath)) throw new Error('路径越界')
    return fsService.readFile(targetPath)
  })
  // 粘贴本地图片专用读取：粘贴的 file:// 图片位于系统任意位置（Word/网页剪贴板），
  // 不受 usersData 白名单限制；严格限制为图片扩展名，防任意文件被读取
  ipcMain.handle('file:read-image', async (_e, targetPath: string) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
      return { ok: false, error: '路径无效' }
    }
    const ext = extname(targetPath).slice(1).toLowerCase()
    if (!IMAGE_READ_EXTS.has(ext)) return { ok: false, error: '仅支持图片文件' }
    try {
      const r = await fsService.readFile(targetPath)
      return { ok: true, ext: r.ext, buffer: r.buffer }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
  ipcMain.handle('file:write', (_e, targetPath: string, data: string | Uint8Array) => {
    if (!insideUsersData(targetPath)) return { ok: false, error: '路径越界' }
    return fsService.writeFile(targetPath, data)
  })
  // 路径存在性检查（启动恢复标签页过滤已删除的文件）
  ipcMain.handle('fs:stat', (_e, targetPath: string) => {
    if (!insideUsersData(targetPath)) return { exists: false, isDirectory: false, size: 0 }
    return fsService.statEntry(targetPath)
  })
  ipcMain.handle('fs:open-system', (_e, systemId: SystemId) => {
    fsService.openSystemFolder(currentUsersDataPath, systemId)
    return { ok: true }
  })

  // ---- 搜索 / 导入 ----
  ipcMain.handle('fs:search', (_e, query: string) => fsService.searchFiles(currentUsersDataPath, query))
  ipcMain.handle('fs:choose-file', async () => {
    const res = await dialog.showOpenDialog({
      title: '打开文件',
      defaultPath: currentUsersDataPath,
      properties: ['openFile']
    })
    if (res.canceled) return { canceled: true, path: null }
    const p = res.filePaths[0]
    // 仅允许打开数据目录内的文件（外部文件请先导入，否则编辑器打开会"路径越界"）
    if (!fsService.isInsideDataDir(currentUsersDataPath, p)) {
      return { canceled: false, path: null, outOfRange: true }
    }
    return { canceled: false, path: p }
  })
  ipcMain.handle('fs:import-files', (_e, parentPath: string) => {
    if (!insideUsersData(parentPath)) return { ok: false, error: '路径越界' }
    return fsService.importFiles(parentPath)
  })
  ipcMain.handle('fs:import-folders', (_e, parentPath: string) => {
    if (!insideUsersData(parentPath)) return { ok: false, error: '路径越界' }
    return fsService.importFolders(parentPath)
  })
  // 外部拖入导入：源路径来自系统拖拽（任意位置），目标必须在 usersData 内。
  // 源不做 usersData 白名单（外部文件本就该在数据目录外），仅校验是绝对路径且存在
  ipcMain.handle('fs:import-drop', async (_e, destDir: string, paths: unknown) => {
    if (!insideUsersData(destDir)) return { ok: false, error: '路径越界' }
    if (!Array.isArray(paths)) return { ok: false, error: '路径无效' }
    const list = paths.filter(
      (p): p is string =>
        typeof p === 'string' && p.length > 0 && isAbsolute(p)
    )
    if (list.length === 0) return { ok: false, error: '没有可导入的文件' }
    return fsService.importDrop(destDir, list)
  })
  // 非编辑类型文件：用系统默认程序打开（shell.openPath）。
  // 校验放宽到 MyPaperData 根内（设置-数据位置要能打开 MyPaperData 本身与 todoList/
  // ocrImages/emojis 等子目录，不限于 usersData），仍是应用专属数据目录，防任意路径。
  ipcMain.handle('fs:open-path', async (_e, targetPath: string) => {
    const root = dataPaths(currentDataDir).dataRoot
    if (!fsService.isInsideDataDir(root, targetPath)) return { ok: false, error: '路径越界' }
    const err = await shell.openPath(targetPath)
    return err ? { ok: false, error: err } : { ok: true }
  })

  // ---- 导出 ----
  // 系统保存对话框：返回用户选择的路径（取消返回 null）
  ipcMain.handle('export:save-dialog', async (_e, options: { defaultName: string; filters?: { name: string; extensions: string[] }[] }) => {
    const res = await dialog.showSaveDialog({
      title: '导出文件',
      defaultPath: options.defaultName,
      filters: options.filters ?? [{ name: 'All Files', extensions: ['*'] }]
    })
    return res.canceled ? null : res.filePath
  })
  // 导出写入：路径来自系统保存对话框（用户显式选择的目标），不受 usersData 白名单限制——
  // 与 file:write（仅限 usersData 内，安全校验）分离，否则导出到外部文件夹会被"路径越界"拒绝。
  ipcMain.handle('export:save', (_e, targetPath: string, data: string | Uint8Array) => {
    return fsService.writeFile(targetPath, data)
  })
  // PDF 导出：加载 HTML 到隐藏窗口 → printToPDF → 返回 Buffer（渲染进程负责写文件）。
  // 2026-08-09 安全加固：① 注入严格 CSP（只允许样式/图片/字体，禁止一切脚本执行——
  // 原 data: URL 窗口无 CSP，克隆 HTML 中的内联脚本可被执行）；② 改临时文件加载，
  // 绕开 data: URL 约 2MB 上限（含图大文档导出 PDF 失败）。
  ipcMain.handle('export:pdf', async (_e, html: string) => {
    const tmpPath = join(app.getPath('temp'), `mypaper-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`)
    const cspMeta =
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'unsafe-inline\' data: blob:; font-src \'unsafe-inline\' data:; script-src \'none\'">'
    // 在 <head> 后插入 CSP meta（无 head 则兜底不注入，打印窗口不执行脚本风险面仍受控）
    // 在 <head> 后插入 CSP meta；无 head 则兜底在 <html> 后补 <head>，
    // 再不行（html 是 fragment）包一层完整文档——保证打印窗口任何情况下都不执行内联脚本
    let safeHtml: string
    if (/<head[^>]*>/i.test(html)) {
      safeHtml = html.replace(/<head[^>]*>/i, (m) => `${m}${cspMeta}`)
    } else if (/<html[^>]*>/i.test(html)) {
      safeHtml = html.replace(/<html[^>]*>/i, (m) => `${m}<head>${cspMeta}</head>`)
    } else {
      safeHtml = `<!DOCTYPE html><html lang="zh-CN"><head>${cspMeta}</head><body>${html}</body></html>`
    }
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true }
    })
    try {
      await fs.writeFile(tmpPath, safeHtml, 'utf-8')
      await win.loadFile(tmpPath)
      const pdf = await win.webContents.printToPDF({ printBackground: true })
      return { ok: true, data: pdf } as const
    } catch (err) {
      return { ok: false, error: String(err) } as const
    } finally {
      win.destroy()
      await fs.rm(tmpPath, { force: true }).catch(() => undefined)
    }
  })

  // ---- 窗口控制 ----
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  // ---- 编辑器独立窗口：右键标签「在新窗口中打开」----
  ipcMain.handle('window:open-editor', (_e, filePath: string) => {
    if (!insideUsersData(filePath)) return
    createEditorWindow(filePath)
  })
  // 编辑器窗口关闭握手完成（保存完 dirty 后由渲染层发送，只销毁发送方对应的窗口）
  ipcMain.on('editor-window:ready-close', (event) => {
    for (const w of editorWindows) {
      if (!w.isDestroyed() && w.webContents.id === event.sender.id) {
        editorWindows.delete(w)
        w.destroy()
        break
      }
    }
  })
  // 主窗口取消关闭（渲染层保存失败、用户选择不退出）：清除兜底 timer + 复位 closing
  ipcMain.on('app:cancel-close', () => {
    if (mainCloseTimer) {
      clearTimeout(mainCloseTimer)
      mainCloseTimer = null
    }
    mainClosing = false
  })
}

/** 已打开的编辑器独立窗口（右键标签「在新窗口中打开」创建） */
const editorWindows = new Set<BrowserWindow>()

/** 创建编辑器独立窗口：完整编辑器（工具栏 + 编辑器 + 状态栏），仅隐藏左侧导航与文件夹树 */
function createEditorWindow(filePath: string): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    show: false,
    frame: false,
    backgroundColor: '#e9e9e9',
    title: 'MyPaper',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  editorWindows.add(win)
  // 禁用浏览器默认视觉缩放（Ctrl+滚轮/快捷键），缩放由渲染层自定义处理（viewZoom）
  void win.webContents.setVisualZoomLevelLimits(1, 1)

  // 关闭握手：先阻止关闭，通知渲染进程保存 dirty，完成后 editor-window:ready-close 再真正关闭
  // （独立窗口不建自动快照，快照逻辑保留在主窗口关闭时）
  let closing = false
  let closeTimer: NodeJS.Timeout | null = null
  win.on('close', (e) => {
    if (closing) return
    e.preventDefault()
    closing = true
    win.webContents.send('app:prepare-close')
    // 兜底：渲染进程无响应时 8 秒后强制关闭
    closeTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.destroy()
    }, 8000)
  })
  // 渲染层保存失败取消关闭：清除兜底 timer 并复位 closing（下次可再正常走握手）
  win.webContents.on('ipc-message', (_e, channel) => {
    if (channel === 'editor-window:cancel-close' && closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
      closing = false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => editorWindows.delete(win))

  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[editor-window render-process-gone]', JSON.stringify(details))
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(
      `${process.env['ELECTRON_RENDERER_URL']}/#editor?path=${encodeURIComponent(filePath)}`
    )
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: `editor?path=${encodeURIComponent(filePath)}`
    })
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#e9e9e9',
    title: 'MyPaper',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  mainWindowRef = mainWindow
  // 禁用浏览器默认视觉缩放（Ctrl+滚轮/快捷键），缩放由渲染层自定义处理（viewZoom）
  void mainWindow.webContents.setVisualZoomLevelLimits(1, 1)

  // 关闭握手：先阻止关闭，通知渲染进程保存 + 自动快照，完成后 app:ready-close 再真正关闭
  mainWindow.on('close', (e) => {
    if (mainClosing) return
    e.preventDefault()
    mainClosing = true
    mainWindow.webContents.send('app:prepare-close')
    // 兜底：渲染进程无响应时 8 秒后强制关闭
    mainCloseTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed()) mainWindow.destroy()
    }, 8000)
  })

  mainWindow.on('ready-to-show', () => {
    // 无缝衔接：主窗口先隐藏，等 splash 动画播满最短时长 → splash 淡出 → 主窗口淡入，
    // 避免"软件已打开、动画还在播"的割裂感
    if (!splashWindowRef || splashWindowRef.isDestroyed()) {
      // 无 splash（设置关闭了开场动画）：直接显示
      mainWindow.show()
      return
    }
    const elapsed = Date.now() - splashStartTime
    const wait = Math.max(0, SPLASH_MIN_MS - elapsed)
    setTimeout(() => {
      // splash 淡出（CSS transition 350ms）
      void splashWindowRef?.webContents
        .executeJavaScript(`document.body.classList.add('fade-out')`)
        .catch(() => undefined)
      // 主窗口淡入，与 splash 淡出重叠衔接
      if (!mainWindow.isDestroyed()) {
        mainWindow.setOpacity(0)
        mainWindow.show()
        const fadeStart = Date.now()
        const fadeIv = setInterval(() => {
          const t = Math.min(1, (Date.now() - fadeStart) / SPLASH_FADE_MS)
          if (!mainWindow.isDestroyed()) mainWindow.setOpacity(t)
          if (t >= 1) clearInterval(fadeIv)
        }, 16)
      }
      // 淡出完成后销毁 splash
      setTimeout(() => closeSplashWindow(), SPLASH_FADE_MS)
    }, wait)
  })

  // 诊断：转发渲染进程 console 错误与崩溃原因到主进程日志
  mainWindow.webContents.on('console-message', (event, levelOrDetails, message, line, sourceId) => {
    void event
    if (typeof levelOrDetails === 'object' && levelOrDetails !== null) {
      const d = levelOrDetails as { level?: string; message?: string; lineNumber?: number; sourceId?: string }
      console.log(`[renderer:${d.level ?? ''}] ${d.message ?? ''} (${d.sourceId ?? ''}:${d.lineNumber ?? ''})`)
    } else {
      console.log(`[renderer:${levelOrDetails}] ${message ?? ''} (${sourceId ?? ''}:${line ?? ''})`)
    }
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('[render-process-gone]', JSON.stringify(details))
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  try {
    // 开场动画：先显示 splash 窗口，主窗口就绪后关闭（初始化在 splash 展示期间完成）
    await createSplashWindow()
    const { dataDir, usersDataPath } = await ensureDataDir()
    currentDataDir = dataDir
    currentUsersDataPath = usersDataPath
    registerIpc()
    createWindow()
    // 首次启动手册播种（幂等：只播一次；失败不阻塞启动）
    void seedHandbook(usersDataPath)

    // 快照自动清理：后台异步执行（开关关闭时内部直接返回），不阻塞启动
    const startupConfig = await loadConfig()
    void fsService.cleanupOldSnapshots(usersDataPath, startupConfig.settings)

    // 文件夹树实时刷新：监听 usersData 目录变化（递归），防抖后推送渲染进程
    startTreeWatch(currentUsersDataPath)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (err) {
    // 初始化失败（数据目录不可写/磁盘满等）：给用户可见错误，不要静默退出
    console.log('[startup] 初始化失败：', err)
    try {
      dialog.showErrorBox('MyPaper 启动失败', `初始化失败：${String(err)}\n\n请检查数据目录是否可写后重新启动。`)
    } catch {
      /* 对话框也失败时放弃 */
    }
    app.quit()
  }
})

app.on('window-all-closed', () => {
  // 关闭快照未完成（主窗口销毁后主进程在后台创建快照）时不自动退出，
  // 等 ready-close 流程里的 finish()（快照完成或 20s 兜底）再 app.quit()
  if (process.platform !== 'darwin' && !pendingCloseSnapshots) app.quit()
})
