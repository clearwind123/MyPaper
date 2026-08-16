// src/main/fs-service.ts
// 文件系统服务：目录树读取、增删改移、回收站删除、复制/剪切/粘贴、跨系统搜索、导入、快照

import { promises as fs } from 'fs'
import { join, dirname, basename, extname, resolve, sep } from 'path'
import { shell, dialog } from 'electron'
import {
  SystemId,
  TreeEntry,
  OpResult,
  ConflictResolution,
  ClipboardMode,
  SearchHit,
  SnapshotMarker,
  EDITABLE_FILE_EXTS
} from '../shared/types'
import { SYSTEM_FOLDERS, SYSTEM_IDS, systemDirPath } from './system-folders'
import { appendLog } from './logger'

/** 快照标识文件（与文件同名的 sidecar / 文件夹包内） */
const SNAPSHOT_MARKER = '.snapshot.json'

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function uniquify(dir: string, name: string): Promise<string> {
  // name 已是唯一：直接返回；否则插入 (1) (2)...
  let candidate = name
  let i = 1
  const ext = extname(name)
  const base = ext ? name.slice(0, -ext.length) : name
  while (await exists(join(dir, candidate))) {
    candidate = ext ? `${base} (${i})${ext}` : `${base} (${i})`
    i++
  }
  return candidate
}

/** 把 basePath 下的隐藏文件/文件夹（以 . 开头）过滤掉 */
function isHidden(name: string): boolean {
  return name.startsWith('.')
}

/** 快照 sidecar 文件（文件快照的旁置标记：名字-时间戳.docx.snapshot.json），树中隐藏 */
function isSnapshotMarkerName(name: string): boolean {
  return name.endsWith(SNAPSHOT_MARKER)
}

/**
 * 读取目录树（按创建时间升序，先创建的在上；跳过隐藏项与快照 sidecar）。
 * 快照状态继承：快照文件夹内的所有内容（含子文件夹/文件）都标记为快照（只读）；
 * isSnapshotRoot 仅自身带 sidecar 的条目为 true（可恢复）。
 */
export async function readTree(dir: string, inheritedSnapshot = false): Promise<TreeEntry[]> {
  let dirents
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const entries = await Promise.all(
    dirents
      .filter((d) => !isHidden(d.name) && !isSnapshotMarkerName(d.name))
      .map(async (d): Promise<TreeEntry | null> => {
        const p = join(dir, d.name)
        try {
          const stat = await fs.stat(p)
          if (d.isDirectory() && !d.isSymbolicLink()) {
            const selfSnapshot = await exists(join(p, SNAPSHOT_MARKER))
            const isSnapshot = selfSnapshot || inheritedSnapshot
            return {
              name: d.name,
              path: p,
              type: 'folder',
              ext: '',
              size: 0,
              mtimeMs: stat.mtimeMs,
              birthtimeMs: stat.birthtimeMs,
              isSnapshot,
              isSnapshotRoot: selfSnapshot,
              children: await readTree(p, isSnapshot)
            }
          }
          if (d.isFile()) {
            const selfSnapshot = await exists(`${p}${SNAPSHOT_MARKER}`)
            return {
              name: d.name,
              path: p,
              type: 'file',
              ext: extname(d.name),
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              birthtimeMs: stat.birthtimeMs,
              isSnapshot: selfSnapshot || inheritedSnapshot,
              isSnapshotRoot: selfSnapshot
            }
          }
          return null
        } catch {
          return null
        }
      })
  )

  return entries
    .filter((e): e is TreeEntry => e !== null)
    .sort((a, b) => a.birthtimeMs - b.birthtimeMs)
}

/** 名称合法性校验：不能包含路径分隔符 / \\（防路径穿越写入任意位置），不能是 . 或 .. */
function isValidEntryName(name: string): boolean {
  return !!name.trim() && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..'
}

/** 新建文件（空内容） */
export async function createFile(parentPath: string, name: string): Promise<OpResult> {
  if (!isValidEntryName(name)) return { ok: false, error: '名称不合法' }
  const target = join(parentPath, name)
  if (await exists(target)) return { ok: false, error: 'EXISTS' }
  await fs.writeFile(target, '', 'utf-8')
  return { ok: true }
}

/** 新建文件夹 */
export async function createFolder(parentPath: string, name: string): Promise<OpResult> {
  if (!isValidEntryName(name)) return { ok: false, error: '名称不合法' }
  const target = join(parentPath, name)
  if (await exists(target)) return { ok: false, error: 'EXISTS' }
  await fs.mkdir(target)
  return { ok: true }
}

/** 重命名 */
export async function renameEntry(
  targetPath: string,
  newName: string,
  dataDir?: string
): Promise<OpResult> {
  if (!isValidEntryName(newName)) return { ok: false, error: '名称不合法' }
  const target = join(targetPath, '..', newName)
  if (target === targetPath) return { ok: true }
  if (await exists(target)) return { ok: false, error: 'EXISTS' }
  await fs.rename(targetPath, target)
  // 原文件改名：联动更新指向它的快照 sidecar 原路径（恢复时才能找到新位置）
  if (dataDir) await updateSnapshotReferences(dataDir, targetPath, target)
  return { ok: true }
}

/** 删除到系统回收站 */
export async function trashEntry(targetPath: string): Promise<OpResult> {
  try {
    await shell.trashItem(targetPath)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 复制/移动单个条目到目标（destName 可指定解析后的目标名） */
async function copyOrMoveOne(
  src: string,
  destDir: string,
  mode: ClipboardMode,
  destName?: string,
  dataDir?: string
): Promise<OpResult> {
  const name = destName ?? basename(src)
  const dest = join(destDir, name)
  if (await exists(dest)) {
    // 调用方应先用 resolveConflict 处理好，这里直接失败由上层处理
    return { ok: false, error: 'CONFLICT' }
  }
  if (mode === 'copy') {
    await fs.cp(src, dest, { recursive: true })
  } else {
    await fs.rename(src, dest)
    // 原文件移动：联动更新指向它的快照 sidecar 原路径
    if (dataDir) await updateSnapshotReferences(dataDir, src, dest)
  }
  return { ok: true }
}

/** 内存剪贴板：模式 + 待处理路径 + 当前进度（冲突续传） */
interface ClipState {
  mode: ClipboardMode
  paths: string[]
  index: number
}

let clipState: ClipState | null = null

/** 设置剪贴板（复制/剪切） */
export function setClipboard(mode: ClipboardMode, paths: string[]): void {
  clipState = { mode, paths, index: 0 }
}

/**
 * 粘贴到目标目录。
 * 无 resolution 时遇重名返回 { error: 'CONFLICT', conflictName }；
 * 渲染层弹窗后带 resolution（overwrite/keep-both/rename）再次调用，从冲突处继续。
 */
export async function pasteTo(
  destDir: string,
  resolution?: { kind: ConflictResolution; renameTo?: string },
  dataDir?: string
): Promise<OpResult> {
  if (!clipState) return { ok: false, error: '剪贴板为空' }
  const { mode, paths } = clipState
  // 实际完成的移动映射（仅 cut 模式收集，供渲染层迁移已打开的标签路径）
  const moved: Array<{ from: string; to: string }> = []

  /** 失败收尾：非冲突错误清空剪贴板（避免残留 cut 状态导致后续粘贴误移动剩余文件） */
  const fail = (error: string | undefined, extra?: Partial<OpResult>): OpResult => {
    if (error !== 'CONFLICT') clipState = null
    return { ok: false, error, ...extra, moved }
  }

  // 1. 带 resolution：先解决当前 index 的冲突并处理该条目
  if (resolution) {
    const src = paths[clipState.index]
    if (!src) return fail('剪贴板状态异常')
    const name = basename(src)
    const applied = await resolveConflict(destDir, name, resolution.kind, resolution.renameTo)
    if (!applied.ok) return fail(applied.error)
    const res = await copyOrMoveOne(src, destDir, mode, applied.name, dataDir)
    if (!res.ok) return fail(res.error)
    if (mode === 'cut') moved.push({ from: src, to: join(destDir, applied.name ?? name) })
    clipState.index++
  }

  // 2. 继续处理剩余条目
  for (let i = clipState.index; i < paths.length; i++) {
    const src = paths[i]
    const name = basename(src)
    if (await exists(join(destDir, name))) {
      clipState.index = i
      return { ok: false, error: 'CONFLICT', conflictName: name, moved }
    }
    const res = await copyOrMoveOne(src, destDir, mode, undefined, dataDir)
    if (!res.ok) return fail(res.error)
    if (mode === 'cut') moved.push({ from: src, to: join(destDir, name) })
    clipState.index = i + 1
  }

  clipState = null
  return { ok: true, moved }
}

/** 清空剪贴板（取消粘贴时由渲染层调用，防止残留 cut 状态导致后续粘贴误移动剩余文件） */
export function clearClipboard(): void {
  clipState = null
}

/** 对目标应用冲突处理（覆盖 / 保留两者），返回最终可用的目标名 */
export async function resolveConflict(
  destDir: string,
  name: string,
  resolution: ConflictResolution,
  renameTo?: string
): Promise<{ ok: boolean; name?: string; error?: string }> {
  const dest = join(destDir, name)
  if (resolution === 'overwrite') {
    await fs.rm(dest, { recursive: true, force: true })
    return { ok: true, name }
  }
  if (resolution === 'keep-both') {
    return { ok: true, name: await uniquify(destDir, name) }
  }
  // rename：用户手动输入的新名
  if (renameTo && renameTo.trim()) {
    if (!isValidEntryName(renameTo)) return { ok: false, error: '名称不合法' }
    const newName = await uniquify(destDir, renameTo.trim())
    return { ok: true, name: newName }
  }
  return { ok: false, error: '未提供新名称' }
}

/** 在资源管理器中显示条目 */
export function revealInExplorer(targetPath: string): void {
  shell.showItemInFolder(targetPath)
}

/** 打开系统文件夹（空白处右键"在文件资源管理器中打开"） */
export function openSystemFolder(dataDir: string, id: SystemId): void {
  shell.openPath(systemDirPath(dataDir, id))
}

/** 跨系统文件名模糊搜索（只搜四个系统文件夹内部） */
export async function searchFiles(dataDir: string, query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  const limit = 200

  async function walk(dir: string, systemId: SystemId): Promise<void> {
    if (hits.length >= limit) return
    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of dirents) {
      if (hits.length >= limit) return
      if (isHidden(d.name) || isSnapshotMarkerName(d.name)) continue
      const p = join(dir, d.name)
      if (d.name.toLowerCase().includes(q)) {
        hits.push({
          name: d.name,
          path: p,
          systemId,
          type: d.isDirectory() ? 'folder' : 'file'
        })
      }
      if (d.isDirectory() && !d.isSymbolicLink()) {
        await walk(p, systemId)
      }
    }
  }

  for (const id of SYSTEM_IDS) {
    await walk(systemDirPath(dataDir, id), id)
  }
  return hits.slice(0, limit)
}

/** 导入文件（复制进目标目录，冲突自动保留两者） */
export async function importFiles(parentPath: string): Promise<OpResult> {
  const res = await dialog.showOpenDialog({
    title: '导入文件',
    properties: ['openFile', 'multiSelections']
  })
  if (res.canceled) return { ok: true }
  for (const src of res.filePaths) {
    const destName = await uniquify(parentPath, basename(src))
    await fs.cp(src, join(parentPath, destName), { recursive: true })
  }
  return { ok: true }
}

/**
 * 外部拖入导入：把系统任意位置的文件/文件夹复制进目标目录（冲突保留两者）。
 * 与 importFiles 同款复制语义，但源路径来自拖拽（不走系统对话框）。
 * 渲染层拖拽拿到的路径已在主进程校验存在性（fs:import-drop IPC 只接受存在的源路径）。
 */
export async function importDrop(destDir: string, paths: string[]): Promise<OpResult> {
  try {
    for (const src of paths) {
      // 源不存在（拖拽后文件被移走等）→ 跳过该项，不阻断其余
      if (!(await exists(src))) continue
      const destName = await uniquify(destDir, basename(src))
      await fs.cp(src, join(destDir, destName), { recursive: true })
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `导入失败：${String(err)}` }
  }
}

/** 导入文件夹（复制进目标目录，冲突自动保留两者） */
export async function importFolders(parentPath: string): Promise<OpResult> {
  const res = await dialog.showOpenDialog({
    title: '导入文件夹',
    properties: ['openDirectory', 'multiSelections']
  })
  if (res.canceled) return { ok: true }
  for (const src of res.filePaths) {
    const destName = await uniquify(parentPath, basename(src))
    await fs.cp(src, join(parentPath, destName), { recursive: true })
  }
  return { ok: true }
}

/** 获取系统根目录路径（供渲染层拼接/展示） */
export function getSystemDir(dataDir: string, id: SystemId): string {
  return systemDirPath(dataDir, id)
}

/** 读取文件内容（供编辑器加载；返回 Buffer + 扩展名） */
export async function readFile(targetPath: string): Promise<{ ext: string; buffer: Buffer }> {
  const buffer = await fs.readFile(targetPath)
  return { ext: extname(targetPath), buffer }
}

/**
 * 写入文件内容（编辑器保存；data 为字符串或二进制）。
 * 直接写目标文件（不用"临时文件 + rename 覆盖"原子写）：
 * Windows 上 rename 覆盖会改变文件的创建时间（birthtime 变成 rename 时刻）——
 * 文件夹树按创建时间升序排序，保存后文件会跳到列表末尾（实测：node fs.rename
 * 覆盖 birthtime +1.6s；直接 fs.writeFile 不变）。牺牲原子写（写一半崩溃损坏
 * 原文件的概率极低，数据来自 Worker 完整序列化后一次性落盘）。
 */
export async function writeFile(targetPath: string, data: string | Uint8Array): Promise<OpResult> {
  const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf-8') : data.byteLength
  try {
    await fs.writeFile(targetPath, data)
  } catch (err) {
    return { ok: false, error: `写入失败：${err instanceof Error ? err.message : String(err)}` }
  }
  void appendLog(`[保存] 写入 ${targetPath} (${extname(targetPath)}, ${bytes} bytes)`)
  return { ok: true }
}

/** 检查路径是否存在（供启动恢复标签页时过滤已被删除的文件） */
export async function statEntry(targetPath: string): Promise<{
  exists: boolean
  isDirectory: boolean
  /** 文件大小（字节）；目录为 0 */
  size: number
}> {
  try {
    const st = await fs.stat(targetPath)
    return { exists: true, isDirectory: st.isDirectory(), size: st.size }
  } catch {
    return { exists: false, isDirectory: false, size: 0 }
  }
}

/**
 * 校验路径是否位于数据目录内（防止越界访问 usersData 之外）。
 * 用 path.resolve 归一化（消除 `..`、相对路径、多余分隔符），Windows 大小写不敏感，
 * 杜绝 `C:\data\usersData\..\..\secret` 这类前缀字符串绕过。
 */
export function isInsideDataDir(dataDir: string, p: string): boolean {
  const base = resolve(dataDir)
  const target = resolve(p)
  const baseNorm = base.toLowerCase()
  const targetNorm = target.toLowerCase()
  if (targetNorm === baseNorm) return true
  const prefix = baseNorm.endsWith(sep) ? baseNorm : baseNorm + sep
  return targetNorm.startsWith(prefix)
}

/** 各系统文件夹的目录名（供前端展示/校验） */
export const SYSTEM_DIR_NAMES = SYSTEM_FOLDERS

/* ================= 快照系统 ================= */

/** 可创建快照的系统（用户定案：仅论文写作与未分类） */
const SNAPSHOT_ALLOWED_SYSTEMS: SystemId[] = ['paper', 'unclassified']

/** 两位补零 */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 返回 originalPath 所在的系统根目录路径（匹配不到返回 null） */
function findSystemRoot(dataDir: string, originalPath: string): string | null {
  for (const id of SYSTEM_IDS) {
    const root = systemDirPath(dataDir, id)
    if (originalPath !== root && isInsideDataDir(root, originalPath)) return root
  }
  return null
}

/** 系统根路径 → 中文名（用于恢复提示） */
function systemLabel(dataDir: string, rootPath: string): string {
  for (const id of SYSTEM_IDS) {
    if (systemDirPath(dataDir, id) === rootPath) return SYSTEM_FOLDERS[id].label
  }
  return '未分类'
}

/** 读取快照 sidecar（不存在返回 null） */
export async function readSnapshotMarker(
  snapshotPath: string,
  isFile: boolean
): Promise<SnapshotMarker | null> {
  const markerPath = isFile
    ? `${snapshotPath}${SNAPSHOT_MARKER}`
    : join(snapshotPath, SNAPSHOT_MARKER)
  try {
    const raw = await fs.readFile(markerPath, 'utf-8')
    const marker = JSON.parse(raw) as SnapshotMarker
    if (marker && marker.version === 1 && typeof marker.originalPath === 'string') return marker
    return null
  } catch {
    return null
  }
}

/**
 * 快照自动清理（启动时后台调用，不阻塞启动）：
 * 开关关闭则永不清理；开启时把 Versions 下早于 snapshotCleanupDays 天的日期文件夹（YYYYMMDD）
 * 整体移入系统回收站（快照命名 = Versions/YYYYMMDD/名字-时间戳，日期文件夹名即创建日期）。
 * 单个失败静默跳过，不影响其他与启动流程。
 */
export async function cleanupOldSnapshots(
  usersDataPath: string,
  settings: { cleanupSnapshots: boolean; snapshotCleanupDays: number }
): Promise<void> {
  if (!settings.cleanupSnapshots) return
  const days = Math.max(1, Math.floor(settings.snapshotCleanupDays || 30))
  const versionsDir = systemDirPath(usersDataPath, 'versions')
  let entries: string[]
  try {
    entries = await fs.readdir(versionsDir)
  } catch {
    return // Versions 不存在/不可读：无可清理
  }
  // 截止时间 = 今天 00:00 往前 days 天；早于它的日期文件夹过期
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffTime = cutoff.getTime()
  for (const name of entries) {
    if (!/^\d{8}$/.test(name)) continue
    const y = Number(name.slice(0, 4))
    const m = Number(name.slice(4, 6))
    const d = Number(name.slice(6, 8))
    const day = new Date(y, m - 1, d)
    // 非法日期（如 20261399）会被 Date 自动进位：回读校验，防误删
    if (day.getFullYear() !== y || day.getMonth() !== m - 1 || day.getDate() !== d) continue
    if (day.getTime() >= cutoffTime) continue // 间隔内保留
    try {
      await shell.trashItem(join(versionsDir, name))
      appendLog(`快照自动清理：已移入回收站过期快照目录 ${name}（早于 ${days} 天）`)
    } catch {
      /* 单个失败静默（回收站不可用/被占用等），继续下一个 */
    }
  }
}

/**
 * 去掉快照标识：删除 sidecar 并把内容移出 Versions（保持版本管理=纯快照区）。
 * 目标：原系统根目录（解析 sidecar 原路径所在系统；匹配不到兜底未分类），重名自动加序号。
 */
export async function removeSnapshotMarker(
  dataDir: string,
  snapshotPath: string
): Promise<OpResult> {
  let stat
  try {
    stat = await fs.stat(snapshotPath)
  } catch {
    return { ok: false, error: '条目不存在' }
  }
  const isFile = stat.isFile()
  const marker = await readSnapshotMarker(snapshotPath, isFile)
  if (!marker) return { ok: false, error: '该条目不是快照' }

  // 1. 先删除 sidecar（文件=旁置，文件夹=包内）
  const markerPath = isFile
    ? `${snapshotPath}${SNAPSHOT_MARKER}`
    : join(snapshotPath, SNAPSHOT_MARKER)
  await fs.rm(markerPath)

  // 2. 计算目标：原系统根目录（或未分类兜底），重名自动加序号
  const fallbackRoot = systemDirPath(dataDir, 'unclassified')
  const targetRoot =
    findSystemRoot(dataDir, marker.originalPath) ?? fallbackRoot
  const target = join(targetRoot, await uniquify(targetRoot, marker.originalName))

  // 安全：目标必须在 usersData 内（sidecar originalPath 可被外部篡改，防任意路径写入）
  if (!isInsideDataDir(dataDir, target)) {
    return { ok: false, error: '目标越界，已拒绝' }
  }

  // 3. 移动内容（跨目录 rename 同盘即可）
  await fs.rename(snapshotPath, target)

  return { ok: true, conflictName: targetRoot === fallbackRoot ? '未分类' : systemLabel(dataDir, targetRoot) }
}

/**
 * 创建快照：把源条目（文件/文件夹）复制到 Versions/YYYYMMDD/名字-YYYY_MMDD_HHMMSS，
 * 并写 sidecar（.snapshot.json）记录原路径。
 * 默认仅 PaperWriting / Unclassified 下可创建（树右键/Ctrl+S/关闭标签）；
 * 关闭软件自动快照（allowAnySystem）放开区域限制——只按可编辑性分类（可编辑文件就建，查看器文件不建）。
 * 快照内容不可再创建。
 */
export async function createSnapshot(
  dataDir: string,
  sourcePath: string,
  options?: { allowAnySystem?: boolean }
): Promise<OpResult> {
  // 1. 校验：默认要求源在允许的系统内（且不是系统根自身）；allowAnySystem 时跳过区域限制
  // 快照区（Versions）内容一律不可再创建快照（纯快照区定案 + 继承只读：内部条目无自身 sidecar，
  // 不能用 sidecar 判定兜底，必须按区域拦截——含快照根与继承快照的子文件/子文件夹）
  if (isInsideDataDir(systemDirPath(dataDir, 'versions'), sourcePath)) {
    return { ok: false, error: '快照内容不能再创建快照' }
  }
  if (!options?.allowAnySystem) {
    const allowedRoots = SNAPSHOT_ALLOWED_SYSTEMS.map((id) => systemDirPath(dataDir, id))
    const inAllowed = allowedRoots.some(
      (root) => sourcePath !== root && isInsideDataDir(root, sourcePath)
    )
    if (!inAllowed) {
      return { ok: false, error: '仅"论文写作"与"未分类"中的内容可创建快照' }
    }
  }
  // 2. 源必须存在且不是快照
  let stat
  try {
    stat = await fs.stat(sourcePath)
  } catch {
    return { ok: false, error: '源文件不存在' }
  }
  const isFile = stat.isFile()
  const isSnapshot = isFile
    ? await exists(`${sourcePath}${SNAPSHOT_MARKER}`)
    : await exists(join(sourcePath, SNAPSHOT_MARKER))
  if (isSnapshot) return { ok: false, error: '快照内容不能再创建快照' }
  // 2.5 文件类型校验：仅可编辑文档可创建快照（查看器文件如 pdf/xlsx/图片等不可）；
  // 文件夹整体快照不受限（内部文档恢复后仍可编辑）
  if (isFile) {
    const ext = extname(sourcePath).slice(1).toLowerCase()
    if (!(EDITABLE_FILE_EXTS as readonly string[]).includes(ext)) {
      return { ok: false, error: '仅文档文件（docx/md/txt）可创建快照' }
    }
  }

  // 3. 目标：Versions/YYYYMMDD/名字-YYYY_MMDD_HHMMSS（保留扩展名）
  const now = new Date()
  const dateDir = join(systemDirPath(dataDir, 'versions'), `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`)
  await fs.mkdir(dateDir, { recursive: true })
  const stamp = `${now.getFullYear()}_${pad2(now.getMonth() + 1)}_${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  const ext = isFile ? extname(sourcePath) : ''
  const base = isFile ? basename(sourcePath, ext) : basename(sourcePath)
  const targetPath = join(dateDir, `${base}-${stamp}${ext}`)
  if (await exists(targetPath)) {
    return { ok: false, error: '快照目标已存在，请稍后重试' }
  }

  // 4. 复制内容
  await fs.cp(sourcePath, targetPath, { recursive: true })

  // 5. 写 sidecar（文件：目标名.snapshot.json 旁置；文件夹：包内）
  const marker: SnapshotMarker = {
    version: 1,
    kind: isFile ? 'file' : 'folder',
    originalPath: sourcePath,
    originalName: basename(sourcePath),
    createdAt: now.toISOString()
  }
  const markerPath = isFile
    ? `${targetPath}${SNAPSHOT_MARKER}`
    : join(targetPath, SNAPSHOT_MARKER)
  await fs.writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf-8')

  return { ok: true }
}

/**
 * 恢复快照：读 sidecar 找原路径。
 *  - 快照根（自身带 sidecar）：原路径存在 → 恢复原名并替换原路径内容
 *    （文件=覆盖；文件夹=合并：替换同名 + 新增）
 *  - 原路径不存在 → 按 restoreTarget 落回原系统根目录（'original-system'，默认）或未分类
 *    （'unclassified'），快照根名 + 相对路径结构保留，重名自动加序号
 *  - 快照文件夹内的条目（继承快照）：向上定位所在快照根，按相对路径恢复
 * 恢复后快照本身保留（版本管理语义）。
 */
export async function restoreSnapshot(
  dataDir: string,
  snapshotPath: string,
  restoreTarget: 'original-system' | 'unclassified' = 'original-system'
): Promise<OpResult> {
  let stat
  try {
    stat = await fs.stat(snapshotPath)
  } catch {
    return { ok: false, error: '快照不存在' }
  }
  const isFile = stat.isFile()

  // 1. 定位快照根（自身或向上祖先带 sidecar）与相对路径
  let marker = await readSnapshotMarker(snapshotPath, isFile)
  let relPath = ''
  if (!marker) {
    // 快照文件夹内部条目：向上找祖先快照根（限制在 Versions 目录内）
    const versionsRoot = systemDirPath(dataDir, 'versions')
    let cur = dirname(snapshotPath)
    while (isInsideDataDir(versionsRoot, cur) && cur !== versionsRoot) {
      if (await exists(join(cur, SNAPSHOT_MARKER))) {
        const m = await readSnapshotMarker(cur, false)
        if (m) {
          marker = m
          relPath = snapshotPath.slice(cur.length)
          break
        }
      }
      const parent = dirname(cur)
      if (parent === cur) break
      cur = parent
    }
  }
  if (!marker) return { ok: false, error: '快照标记缺失，无法恢复' }

  // 2. 计算目标路径
  const isRootEntry = relPath === ''
  let dest: string
  let destLabel: string
  const originalRoot = marker.originalPath
  const originalRootExists = await exists(originalRoot)

  if (isRootEntry) {
    if (originalRootExists) {
      dest = originalRoot
      destLabel = '原位置'
    } else {
      // 原路径不存在：按设置落回原系统根目录（默认）或未分类；匹配不到系统则兜底未分类
      const fallbackRoot = systemDirPath(dataDir, 'unclassified')
      const base =
        restoreTarget === 'original-system'
          ? findSystemRoot(dataDir, marker.originalPath) ?? fallbackRoot
          : fallbackRoot
      dest = join(base, await uniquify(base, marker.originalName))
      destLabel = base === fallbackRoot ? '未分类' : systemLabel(dataDir, base)
    }
  } else {
    // 内部条目：原根 + 相对路径（目录不存在则逐级创建）。
    // 原根不存在时：在落点根下重建快照根（originalName）+ 相对路径，保持完整结构
    // （如 快照根=文件夹A、内部=文件夹B/文件a → 论文写作/文件夹A/文件夹B/文件a）
    let base: string
    if (originalRootExists) {
      base = originalRoot
      destLabel = '原位置'
    } else {
      const fallbackRoot = systemDirPath(dataDir, 'unclassified')
      const baseRoot =
        restoreTarget === 'original-system'
          ? findSystemRoot(dataDir, marker.originalPath) ?? fallbackRoot
          : fallbackRoot
      base = join(baseRoot, await uniquify(baseRoot, marker.originalName))
      destLabel = baseRoot === fallbackRoot ? '未分类' : systemLabel(dataDir, baseRoot)
    }
    dest = join(base, relPath)
  }

  // 安全：恢复目标必须在 usersData 内（sidecar originalPath 可被外部篡改，防任意路径覆盖）
  if (!isInsideDataDir(dataDir, dest)) {
    return { ok: false, error: '恢复目标越界，已拒绝' }
  }

  try {
    if (isFile) {
      // 文件：覆盖目标（旁置 sidecar 不会被复制）
      await fs.mkdir(dirname(dest), { recursive: true })
      await fs.cp(snapshotPath, dest, { recursive: true, force: true })
    } else {
      // 文件夹：一律用 mergeFolder 复制（跳过包内 sidecar，
      // 避免恢复后的内容残留快照标记）；目标同名条目先删后拷（替换），新增条目直接复制
      await fs.mkdir(dirname(dest), { recursive: true })
      await mergeFolder(snapshotPath, dest)
    }
  } catch (err) {
    return { ok: false, error: `恢复失败：${String(err)}` }
  }

  return { ok: true, conflictName: destLabel }
}

/** 合并快照文件夹到目标目录：同名条目替换（先删后拷），新增条目复制；跳过 sidecar */
async function mergeFolder(srcDir: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true })
  const items = await fs.readdir(srcDir, { withFileTypes: true })
  for (const item of items) {
    if (item.name === SNAPSHOT_MARKER) continue
    const src = join(srcDir, item.name)
    const dest = join(destDir, item.name)
    if (await exists(dest)) await fs.rm(dest, { recursive: true, force: true })
    await fs.cp(src, dest, { recursive: true })
  }
}

/**
 * 原文件移动/改名后联动快照：扫描 Versions 下所有 sidecar，
 * 把 originalPath 位于 fromPath（本身或其子路径）的更新为 toPath 对应位置。
 * 这样快照恢复时才能找到新位置（原位置已被搬走）。
 */
export async function updateSnapshotReferences(
  dataDir: string,
  fromPath: string,
  toPath: string
): Promise<void> {
  const versionsRoot = systemDirPath(dataDir, 'versions')
  if (!(await exists(versionsRoot))) return
  const normFrom = fromPath.replace(/\\/g, '/')
  const normTo = toPath.replace(/\\/g, '/')

  const rewrite = async (markerPath: string): Promise<void> => {
    try {
      const raw = await fs.readFile(markerPath, 'utf-8')
      const marker = JSON.parse(raw) as SnapshotMarker
      if (!marker || typeof marker.originalPath !== 'string') return
      const normOrig = marker.originalPath.replace(/\\/g, '/')
      let updated: string | null = null
      if (normOrig === normFrom) updated = normTo
      else if (normOrig.startsWith(normFrom + '/'))
        updated = normTo + normOrig.slice(normFrom.length)
      if (updated !== null && updated !== marker.originalPath) {
        marker.originalPath = updated
        await fs.writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf-8')
      }
    } catch {
      // 坏 sidecar 忽略
    }
  }

  const walk = async (dir: string): Promise<void> => {
    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of dirents) {
      const p = join(dir, d.name)
      if (d.isDirectory()) {
        const markerPath = join(p, SNAPSHOT_MARKER)
        if (await exists(markerPath)) await rewrite(markerPath)
        await walk(p)
      } else if (d.name.endsWith(SNAPSHOT_MARKER)) {
        await rewrite(p)
      }
    }
  }

  await walk(versionsRoot)
}
