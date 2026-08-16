// src/main/logger.ts
// 操作日志：把关键用户操作（打开/关闭/切换/保存/删除/编辑决策等）追加写入
// <userData>/logs/mypaper.log（带时间戳；超过 1MB 自动清空重写，防止无限增长）。
// 用途：排障时对照"用户到底动过什么"（如文件被转成其他格式、标签异常等）

import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

const MAX_LOG_BYTES = 1024 * 1024 // 1MB

function logFilePath(): string {
  return join(app.getPath('userData'), 'logs', 'mypaper.log')
}

/** 追加一行日志（失败静默，不影响功能） */
export async function appendLog(line: string): Promise<void> {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    await fs.mkdir(dir, { recursive: true })
    const file = logFilePath()
    // 日志过大时清空重写，避免无限增长
    try {
      const st = await fs.stat(file)
      if (st.size > MAX_LOG_BYTES) await fs.writeFile(file, '')
    } catch {
      // 文件不存在，忽略
    }
    const stamp = new Date().toISOString()
    await fs.appendFile(file, `[${stamp}] ${line}\n`, 'utf-8')
  } catch {
    // 日志写失败不影响应用功能
  }
}
