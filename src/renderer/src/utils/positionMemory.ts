// src/renderer/src/utils/positionMemory.ts
// 阅读位置记忆：localStorage 持久化各文件的阅读位置（滚动 + 光标）。
// 切换标签/关闭标签（组件卸载）/关闭软件（prepare-close flush）时保存；
// 打开文件/切回标签时恢复。开关由设置 settings.rememberPosition 控制。

export interface PointData {
  path: number[]
  offset: number
}

export interface FilePosition {
  /** 垂直滚动位置（px） */
  s: number
  /** 水平滚动位置（px，可选） */
  l?: number
  /** 编辑器光标/选区（仅可编辑文件 docx/md/txt） */
  sel?: { anchor: PointData; focus: PointData }
}

const STORAGE_KEY = 'mypaper.filePositions'

/** 读取全部位置记录（数据损坏/无则空对象） */
export function readAllPositions(): Record<string, FilePosition> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, FilePosition>
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed
  } catch {
    return {}
  }
}

/** 读取单个文件位置（无记录或数据非法则 null） */
export function readPosition(path: string): FilePosition | null {
  const p = readAllPositions()[path]
  if (!p || typeof p.s !== 'number' || !Number.isFinite(p.s)) return null
  return p
}

/** 写入单个文件位置 */
export function writePosition(path: string, pos: FilePosition): void {
  try {
    const all = readAllPositions()
    all[path] = pos
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* localStorage 满/不可用：静默忽略（功能降级为不记忆） */
  }
}

/** 重命名/移动后迁移位置记录 key（旧路径 → 新路径；文件夹支持前缀匹配） */
export function renamePositionKey(oldPath: string, newPath: string): void {
  const all = readAllPositions()
  const prefix = oldPath.endsWith('\\') ? oldPath : oldPath + '\\'
  let changed = false
  const next: Record<string, FilePosition> = {}
  for (const [k, v] of Object.entries(all)) {
    if (k === oldPath) {
      next[newPath] = v
      changed = true
    } else if (k.startsWith(prefix)) {
      next[newPath + k.slice(oldPath.length)] = v
      changed = true
    } else {
      next[k] = v
    }
  }
  if (!changed) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 静默忽略 */
  }
}
