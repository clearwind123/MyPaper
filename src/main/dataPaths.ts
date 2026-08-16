// src/main/dataPaths.ts
// Data 大文件夹（MyPaperData）路径统一派生 + 旧平级结构一次性迁移：
// <数据根目录>/MyPaperData/{usersData, todoList, ocrImages, emojis}
// 所有数据目录路径必须从这里派生，禁止散落 join(dataDir, 'xxx')

import { promises as fs } from 'fs'
import { join, basename } from 'path'
import { SYSTEM_FOLDERS, SYSTEM_IDS, MARKER_FILE } from './system-folders'

/** Data 布局下各数据目录的路径（dataDir = 用户选择的数据根目录，MyPaperData 的父级） */
export interface DataPaths {
  /** 数据根目录（MyPaperData 的父级） */
  dataDir: string
  /** MyPaperData 大文件夹（软件名 + Data，防与其他软件 Data 目录重名） */
  dataRoot: string
  /** 文档数据（四系统文件夹 + .mypaper 标注） */
  usersData: string
  /** 待办清单（todo.json） */
  todoList: string
  /** 截屏记录（图片 + ocrHistory.json） */
  ocrImages: string
  /** 自定义表情包 */
  emojis: string
}

/** 从数据根目录派生 Data 布局全部路径 */
export function dataPaths(dataDir: string): DataPaths {
  const dataRoot = join(dataDir, 'MyPaperData')
  return {
    dataDir,
    dataRoot,
    usersData: join(dataRoot, 'usersData'),
    todoList: join(dataRoot, 'todoList'),
    ocrImages: join(dataRoot, 'ocrImages'),
    emojis: join(dataRoot, 'emojis')
  }
}

async function pathExists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true).catch(() => false)
}

/**
 * 旧平级结构（<dataDir>/{usersData,todoList,ocrImages,emojis,ocrHistory.json}，早期布局）
 * 一次性迁移进 <dataDir>/MyPaperData/。幂等：目标已存在则跳过；无旧结构则什么都不做。
 * 根级 ocrHistory.json 直接移入 ocrImages/（store.ts 的旧索引迁移逻辑不再需要）。
 * 防误吞：仅当 usersData 带 MyPaper 标志（.mypaper/四系统文件夹）或根级存在截屏索引时
 * 才迁移，避免把第三方软件的 usersData/todoList 等同名目录整个挪走。
 */
export async function migrateToDataLayout(dataDir: string): Promise<void> {
  const p = dataPaths(dataDir)
  if (await pathExists(p.dataRoot)) return // 已是 Data 布局
  const rootJson = join(dataDir, 'ocrHistory.json')
  if (!(await isScatteredUsersDataDir(dataDir)) && !(await pathExists(rootJson))) return
  const oldRoot = [
    join(dataDir, 'usersData'),
    join(dataDir, 'todoList'),
    join(dataDir, 'ocrImages'),
    join(dataDir, 'emojis'),
    rootJson
  ]
  const anyOld = (await Promise.all(oldRoot.map(pathExists))).some(Boolean)
  if (!anyOld) return
  await fs.mkdir(p.dataRoot, { recursive: true })
  for (const name of ['usersData', 'todoList', 'ocrImages', 'emojis']) {
    const src = join(dataDir, name)
    const dst = join(p.dataRoot, name)
    if ((await pathExists(src)) && !(await pathExists(dst))) {
      await fs.rename(src, dst)
    }
  }
  // 旧根级截屏索引 → 直接放到 ocrImages/ 内（当前索引位置）
  if (await pathExists(rootJson)) {
    await fs.mkdir(p.ocrImages, { recursive: true })
    const dst = join(p.ocrImages, 'ocrHistory.json')
    if (!(await pathExists(dst))) await fs.rename(rootJson, dst)
  }
}

/**
 * 判定目录是否为"旧 BUG 布局散落的数据目录"：
 * 目录下存在 usersData，且其中带 .mypaper 标注或四个系统文件夹之一 →
 * 说明该目录曾是（或被误当作）MyPaperData 本体，四件套直接散落在里面。
 * 仅凭 usersData 名字不可靠（普通用户目录可能恰好同名），必须带 MyPaper 标志才判定。
 */
export async function isScatteredUsersDataDir(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(join(dir, 'usersData'))
    return (
      entries.includes(MARKER_FILE) ||
      SYSTEM_IDS.some((id) => entries.includes(SYSTEM_FOLDERS[id].dir))
    )
  } catch {
    return false
  }
}

/**
 * 在 base 目录的直接子目录（排除 MyPaperData 本身）中查找散落的数据目录。
 * 覆盖两种旧 BUG 残留：
 *  - 用户当初选的目录本身（如 base/某目录 是 MyPaperData 本体）
 *  - 当前数据根目录下残留的散落数据目录
 */
export async function findScatteredDataDirs(base: string): Promise<string[]> {
  const found: string[] = []
  let names: string[]
  try {
    names = await fs.readdir(base)
  } catch {
    return found
  }
  for (const n of names) {
    if (n.toLowerCase() === 'mypaperdata') continue
    const p = join(base, n)
    try {
      const st = await fs.stat(p)
      if (!st.isDirectory()) continue
    } catch {
      continue
    }
    if (await isScatteredUsersDataDir(p)) found.push(p)
  }
  return found
}

/** 数据布局的顶层条目名（散落源收拢时只移动这些，防吞并用户无关文件） */
const DATA_LAYOUT_ITEM_NAMES = ['usersData', 'todoList', 'ocrImages', 'emojis', 'ocrHistory.json']

/**
 * 移动单个条目：目标不存在 → 整体移动（rename，跨盘 cp+rm）；
 * 目标已存在且双方都是目录 → 递归合并内容（同名叶子保留目标，src 版本留在原处）；
 * 其余冲突（文件/类型不同）→ 保留目标，src 版本留在原处。绝不主动删除任何数据。
 */
async function moveEntry(src: string, dest: string): Promise<void> {
  if (!(await pathExists(dest))) {
    try {
      await fs.rename(src, dest)
    } catch {
      // 跨盘：复制后删除
      await fs.cp(src, dest, { recursive: true })
      await fs.rm(src, { recursive: true, force: true })
    }
    return
  }
  const sStat = await fs.stat(src).catch(() => null)
  const dStat = await fs.stat(dest).catch(() => null)
  if (sStat?.isDirectory() && dStat?.isDirectory()) {
    let names: string[]
    try {
      names = await fs.readdir(src)
    } catch {
      return
    }
    for (const name of names) {
      await moveEntry(join(src, name), join(dest, name))
    }
    return
  }
  // 文件冲突或类型不同：目标保留，src 留在原处（不删除）。
  // 例外：.mypaper 是应用生成的元数据（每次启动校验重写），冲突时丢弃 src 版本，
  // 否则骨架残留会让旧 MyPaperData 永远清不干净。
  if (basename(src) === MARKER_FILE) {
    await fs.rm(src, { recursive: true, force: true }).catch(() => {})
  }
}

/** 递归删除空目录（从叶子向上；非空目录与文件一律保留） */
async function removeEmptyDirs(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return
  }
  for (const n of names) {
    const p = join(dir, n)
    const st = await fs.stat(p).catch(() => null)
    if (st?.isDirectory()) await removeEmptyDirs(p)
  }
  try {
    const rest = await fs.readdir(dir)
    if (rest.length === 0) await fs.rm(dir, { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
}

/**
 * 把数据布局整体移动到新位置：散落源（用户目录，只收拢白名单条目）与旧 MyPaperData
 * 的内容并入 newRoot（目录冲突递归合并，任何来源的数据都不删除）。
 * 调用方保证：newRoot 不存在或为空；散落源在前（先占位，旧 MyPaperData 后合并）。
 * 旧 MyPaperData 移空（含空目录清理）后删除；有真实残留则不删并返回，绝不冒险删除。
 */
export async function moveDataLayout(
  oldRoot: string,
  newRoot: string,
  extraSources: string[]
): Promise<void> {
  await fs.mkdir(newRoot, { recursive: true })
  for (const src of [...extraSources, oldRoot]) {
    if (!(await pathExists(src))) continue
    let names: string[]
    try {
      names = await fs.readdir(src)
    } catch {
      continue
    }
    for (const name of names) {
      const s = join(src, name)
      // 源目录包含目标自身（重选旧目录为根时 newRoot 在 src 内部）→ 跳过，勿移动自身
      if (s.toLowerCase() === newRoot.toLowerCase()) continue
      // 散落源是用户目录：只收拢数据白名单条目，勿吞并用户的无关文件
      if (src !== oldRoot && !DATA_LAYOUT_ITEM_NAMES.includes(name)) continue
      await moveEntry(s, join(newRoot, name))
    }
    if (src === oldRoot) {
      // 旧 MyPaperData 是应用专属目录：合并完成后清理空目录壳（骨架残留）
      await removeEmptyDirs(src)
      // 仍非空 → 有真实冲突残留，保留不删（数据安全优先）
      let left: string[]
      try {
        left = await fs.readdir(src)
      } catch {
        continue // 目录已不存在（removeEmptyDirs 已清理）或不可读：无需处理
      }
      if (left.length === 0) {
        await fs.rm(src, { recursive: true, force: true })
      } else {
        console.log('[data-layout] 旧 MyPaperData 有冲突残留未删除（保留）：', left.join(', '))
      }
    }
  }
}
