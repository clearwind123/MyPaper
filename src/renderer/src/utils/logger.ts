// src/renderer/src/utils/logger.ts
// 操作日志：渲染层关键操作发往主进程，写入 <userData>/logs/mypaper.log（排障用）。
// 只记录关键事件（打开/切换/关闭/保存/删除/预览转正式决策等），不记录每次输入。

/** 追加一行操作日志（失败静默） */
export function logApp(event: string, detail?: string): void {
  try {
    window.api.logApp(detail ? `${event} ${detail}` : event)
  } catch {
    // 日志失败不影响功能
  }
}
