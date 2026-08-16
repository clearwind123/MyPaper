// src/main/system-folders.ts
// 四个系统文件夹常量、usersData 初始化与启动检测补建（隐藏 .mypaper 标注）

import { promises as fs } from 'fs'
import { join } from 'path'
import type { SystemId } from '../shared/types'

export type { SystemId }

export const SYSTEM_FOLDERS: Record<SystemId, { dir: string; label: string }> = {
  paper: { dir: 'PaperWriting', label: '论文写作' },
  versions: { dir: 'Versions', label: '版本管理' },
  references: { dir: 'References', label: '参考文献' },
  unclassified: { dir: 'Unclassified', label: '未分类文件' }
}

export const SYSTEM_IDS = Object.keys(SYSTEM_FOLDERS) as SystemId[]

/** usersData 根目录下的隐藏标注文件 */
export const MARKER_FILE = '.mypaper'

interface SystemMarker {
  version: number
  systems: Record<SystemId, string>
  createdAt: string
}

async function readMarker(dataDir: string): Promise<SystemMarker | null> {
  try {
    const raw = await fs.readFile(join(dataDir, MARKER_FILE), 'utf-8')
    const marker = JSON.parse(raw) as SystemMarker
    // 校验标注内容是否与当前系统清单一致
    const ok =
      marker &&
      typeof marker.version === 'number' &&
      marker.systems &&
      SYSTEM_IDS.every((id) => marker.systems[id] === SYSTEM_FOLDERS[id].dir)
    return ok ? marker : null
  } catch {
    return null
  }
}

/**
 * 确保 usersData 目录与四个系统文件夹存在且带标注。
 * 首次初始化会创建全部；之后每次启动检测，缺哪个补哪个，不破坏已有文件。
 */
export async function ensureSystemFolders(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })

  // 补齐缺失的系统文件夹
  for (const id of SYSTEM_IDS) {
    const dirPath = join(dataDir, SYSTEM_FOLDERS[id].dir)
    await fs.mkdir(dirPath, { recursive: true })
  }

  // 标注文件缺失或内容不完整时写入
  const existing = await readMarker(dataDir)
  if (!existing) {
    const marker: SystemMarker = {
      version: 1,
      systems: Object.fromEntries(SYSTEM_IDS.map((id) => [id, SYSTEM_FOLDERS[id].dir])) as Record<
        SystemId,
        string
      >,
      createdAt: new Date().toISOString()
    }
    await fs.writeFile(join(dataDir, MARKER_FILE), JSON.stringify(marker, null, 2), 'utf-8')
  }
}

/** 读取数据目录下标注的系统文件夹绝对路径 */
export function systemDirPath(dataDir: string, id: SystemId): string {
  return join(dataDir, SYSTEM_FOLDERS[id].dir)
}
