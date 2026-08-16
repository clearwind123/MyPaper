// src/main/store.ts
// 配置文件读写：config.json（应用配置）/ todo.json（待办清单），存放于 Electron userData 目录

import { app, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { promises as fs } from 'fs'
import { join, basename } from 'path'
import type { AppConfig, OcrHistoryItem, OcrHistoryEntry, TodoItem } from '../shared/types'
import { dataPaths } from './dataPaths'

export type { AppConfig, TodoItem }

export function defaultConfig(): AppConfig {
  return {
    dataDir: '',
    handbookSeeded: false,
    userName: 'User',
    avatarPath: null,
    ai: {
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.7,
      visionModel: '',
      visionApiKey: '',
      visionBaseUrl: '',
      prompts: {
        continue: '',
        summarize: '',
        polish: '',
        translateEn: '',
        translateZh: ''
      }
    },
    settings: {
      autoSaveInterval: 10,
      autoSaveEnabled: true,
      snapshotOnClose: true,
      ocrMode: 'local',
      ocrZoomPreview: true,
      defaultNewFileExt: 'docx',
      restoreTabs: true,
      cleanupSnapshots: false,
      snapshotCleanupDays: 30,
      snapshotRestoreTarget: 'original-system',
      autoOpenOutline: true,
      autoOpenAux: false,
      rememberPosition: true,
      splashEnabled: true
    },
    folderColors: {},
    // 文件夹树置顶条目路径（按置顶先后；旧配置无此字段时补默认空数组）
    pinnedPaths: [],
    // 独立窗口位置记忆（ocrHistory/todo：窗口移动后保存，重开恢复位置）
    windowPositions: {}
  }
}

function configFilePath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function todosFilePath(): string {
  // 待办数据放数据目录下 todoList/ 文件夹（与 usersData 同级），与截屏记录同层
  return join(loadTodosDataDir(), 'todo.json')
}

/** 待办数据目录：<dataDir>/todoList/（无配置时兜底 userData） */
function loadTodosDataDir(): string {
  return dataPaths(cachedConfig?.dataDir || app.getPath('userData')).todoList
}

/** 原子写 JSON 文件：先写临时文件再改名，避免写坏 */
async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmpPath, filePath)
}

async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

let cachedConfig: AppConfig | null = null

/** 读取配置（带内存缓存） */
export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig
  const filePath = configFilePath()
  let saved: Partial<AppConfig> = {}
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    saved = JSON.parse(raw) as Partial<AppConfig>
  } catch (err) {
    // 损坏（解析/读取失败）：备份后按默认继续，避免被误判为首次启动（数据"被遗忘"）
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      try {
        await fs.copyFile(filePath, `${filePath}.bak`).catch(() => {})
      } catch {
        /* 忽略 */
      }
      console.log('[store] config.json 损坏，已备份为 config.json.bak，使用默认配置')
    }
    saved = {}
  }
  const def = defaultConfig()
  // ai / settings 子对象字段级合并：旧配置文件缺少新增字段时补默认值
  cachedConfig = {
    ...def,
    ...saved,
    ai: { ...def.ai, ...(saved.ai ?? {}) },
    settings: { ...def.settings, ...(saved.settings ?? {}) }
  }
  return cachedConfig
}

/** 保存配置并更新缓存 */
export async function saveConfig(config: AppConfig): Promise<void> {
  cachedConfig = config
  await writeJsonAtomic(configFilePath(), config)
}

/** 配置写入串行队列：串行化 read-modify-write，防并发 updateConfig 互相覆盖
 * （如窗口位置防抖保存与 AI 配置保存同时触发时，后写者丢失前写者的 patch） */
let configWriteChain: Promise<unknown> = Promise.resolve()

/** 部分更新配置（合并后保存） */
export function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const run = configWriteChain.then(async () => {
    const current = await loadConfig()
    const next = { ...current, ...patch }
    await saveConfig(next)
    return next
  })
  // 队列本身不因单次失败中断；错误由调用方处理（run 会 reject）
  configWriteChain = run.catch(() => undefined)
  return run
}

/** 读取待办清单 */
export async function loadTodos(): Promise<TodoItem[]> {
  await fs.mkdir(loadTodosDataDir(), { recursive: true })
  return readJsonSafe<TodoItem[]>(todosFilePath(), [])
}

/** 保存待办清单 */
export async function saveTodos(todos: TodoItem[]): Promise<void> {
  await fs.mkdir(loadTodosDataDir(), { recursive: true })
  await writeJsonAtomic(todosFilePath(), todos)
}

// ---- 截屏识别记录（<dataDir>/ocrImages/ 下：图片 + ocrHistory.json 索引） ----

/** ocr 数据目录：<dataDir>/（config.dataDir，与 usersData 同级） */
async function ocrDataDir(): Promise<string> {
  const cfg = await loadConfig()
  return cfg.dataDir || app.getPath('userData')
}

/** 图片目录与索引文件都位于 MyPaperData/ocrImages/ 下 */
function ocrImagesDir(dataDir: string): string {
  return dataPaths(dataDir).ocrImages
}

function ocrHistoryFilePath(dataDir: string): string {
  return join(ocrImagesDir(dataDir), 'ocrHistory.json')
}

/** 旧位置（Electron userData / 数据目录根）有记录而新位置没有时，迁移一次 */
async function migrateOcrIfNeeded(dataDir: string): Promise<void> {
  try {
    const imgDir = ocrImagesDir(dataDir)
    const targetJson = ocrHistoryFilePath(dataDir)
    await fs.mkdir(imgDir, { recursive: true })
    if (existsSync(targetJson)) return
    // 旧位置①：数据目录根（上一版位置，图片本就在 ocrImages/ 无需搬）
    const rootJson = join(dataDir, 'ocrHistory.json')
    if (existsSync(rootJson)) {
      await fs.copyFile(rootJson, targetJson)
      return
    }
    // 旧位置②：Electron userData（最早版本）
    const oldJson = join(app.getPath('userData'), 'ocrHistory.json')
    if (existsSync(oldJson)) {
      await fs.copyFile(oldJson, targetJson)
      const oldImg = join(app.getPath('userData'), 'ocrImages')
      if (existsSync(oldImg)) {
        const files = await fs.readdir(oldImg)
        await Promise.all(
          files.map((f) => fs.copyFile(join(oldImg, f), join(imgDir, f)).catch(() => undefined))
        )
      }
    }
  } catch {
    // 迁移失败不阻塞，忽略
  }
}

/** 读取截屏记录（新在前，最多 50 条，附主进程生成的缩略图） */
export async function loadOcrHistory(): Promise<OcrHistoryEntry[]> {
  const dataDir = await ocrDataDir()
  await migrateOcrIfNeeded(dataDir)
  const items = await readJsonSafe<OcrHistoryItem[]>(ocrHistoryFilePath(dataDir), [])
  const entries: OcrHistoryEntry[] = []
  for (const item of items.slice(0, 50)) {
    entries.push({ ...item, thumbnailDataUrl: await readOcrThumbnail(item.imageFile, dataDir) })
  }
  return entries
}

/**
 * 读取截屏图片（转 data URL 给渲染层显示）。
 * 防路径穿越：fileName 必须是纯文件名（不含路径分隔符），只能落在 ocrImages 目录内。
 */
export async function readOcrImage(fileName: string): Promise<string | null> {
  try {
    if (basename(fileName) !== fileName) return null
    const dataDir = await ocrDataDir()
    const buf = await fs.readFile(join(ocrImagesDir(dataDir), fileName))
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** 生成缩略图 data URL（宽 120px，主进程 nativeImage 无 canvas 依赖）；fileName 同样防穿越 */
async function readOcrThumbnail(fileName: string, dataDir: string): Promise<string> {
  try {
    if (basename(fileName) !== fileName) return ''
    const buf = await fs.readFile(join(ocrImagesDir(dataDir), fileName))
    const img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) return ''
    const resized = img.resize({ width: 120 })
    return resized.toDataURL()
  } catch {
    return ''
  }
}

/** 新增一条截屏记录：图片写文件 + 记录入列（上限 200 条） */
export async function appendOcrHistory(
  dataUrl: string,
  text: string | null,
  translated: string | null
): Promise<OcrHistoryItem> {
  const dataDir = await ocrDataDir()
  await migrateOcrIfNeeded(dataDir)
  const dir = ocrImagesDir(dataDir)
  await fs.mkdir(dir, { recursive: true })
  const fileName = `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  const base64 = dataUrl.split(',')[1] ?? ''
  await fs.writeFile(join(dir, fileName), Buffer.from(base64, 'base64'))
  const item: OcrHistoryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    imageFile: fileName,
    text,
    translated,
    createdAt: new Date().toISOString()
  }
  const items = await readJsonSafe<OcrHistoryItem[]>(ocrHistoryFilePath(dataDir), [])
  items.unshift(item)
  await writeJsonAtomic(ocrHistoryFilePath(dataDir), items.slice(0, 200))
  return item
}
