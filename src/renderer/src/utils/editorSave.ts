// src/renderer/src/utils/editorSave.ts
// 按文件类型序列化并保存编辑器内容：
// docx/md/txt 均优先用 Web Worker 序列化（大文档保存不冻结 UI）；
// Worker 失效（如 dev 模式 vite HMR client 在无 DOM 环境崩溃）时自动回退主线程，保证功能可用。

import { exportToDocx } from '@platejs/docx-io'
import type { Value } from 'platejs'
import { valueToMarkdown, nodesToTxt, markdownToValue } from './editorConvert'
import { sanitizeValue } from './valueSanitize'
import { DOCX_EXPORT_PLUGINS } from './editorPlugins'
import { parseDocxMain, docxHtmlToNodes } from './docxOpenShared'

export { sanitizeValue } from './valueSanitize'

/** docx 导出 Worker（懒创建单例）；id 匹配响应，支持并发保存请求 */
let docxWorker: Worker | null = null
let docxReqId = 0
/** Worker 已确认失效（创建即崩/运行崩溃）：之后直接主线程导出 */
let workerBroken = false
/** 单次导出超时（毫秒）：Worker 无响应时放弃并回退主线程 */
const WORKER_TIMEOUT_MS = 45_000

function getDocxWorker(): Worker {
  if (!docxWorker) {
    docxWorker = new Worker(new URL('../workers/docxExportWorker.ts', import.meta.url), {
      type: 'module'
    })
    docxWorker.onerror = (e) => {
      // Worker 崩溃：标记失效并丢弃单例（下次导出重建或直接回退主线程）
      console.error('[docx-worker] error:', e.message)
      workerBroken = true
      docxWorker = null
    }
  }
  return docxWorker
}

/** 主线程直接导出（Worker 失效时的回退路径） */
async function exportDocxMainThread(value: Value): Promise<Uint8Array> {
  const blob = await exportToDocx(sanitizeValue(value), {
    fontFamily: 'Microsoft YaHei',
    editorPlugins: DOCX_EXPORT_PLUGINS
  })
  return new Uint8Array(await blob.arrayBuffer())
}

/** 在 Worker 中执行 docx 导出（主线程不阻塞）；失败/超时 reject */
function exportDocxWithWorker(value: Value): Promise<Uint8Array> {
  const id = ++docxReqId
  return new Promise((resolve, reject) => {
    const worker = getDocxWorker()
    const onMsg = (e: MessageEvent<{ id: number; ok: boolean; data?: Uint8Array; error?: string }>) => {
      if (e.data.id !== id) return
      cleanup()
      if (e.data.ok && e.data.data) resolve(e.data.data)
      else reject(new Error(e.data.error ?? 'docx 导出失败'))
    }
    const onErr = (e: ErrorEvent) => {
      cleanup()
      reject(new Error(e.message ?? 'docx Worker 异常'))
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('docx Worker 超时'))
    }, WORKER_TIMEOUT_MS)
    const cleanup = (): void => {
      worker.removeEventListener('message', onMsg)
      worker.removeEventListener('error', onErr)
      window.clearTimeout(timer)
    }
    worker.addEventListener('message', onMsg)
    worker.addEventListener('error', onErr)
    // 大文件优化：postMessage 的结构化克隆在主线程执行（大 value 含图片 data URL 可能
    // 阻塞数百 ms），先让出当前帧，避免保存直接打断正在处理的事件（如刚输入的击键）
    const doPost = (): void => {
      worker.postMessage({ id, value, fontFamily: 'Microsoft YaHei' })
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => doPost())
    } else {
      doPost()
    }
  })
}

/**
 * docx 导出入口：优先 Worker（不卡 UI），Worker 失效/超时/出错时
 * 自动回退主线程导出（功能不丢，仅 dev 等异常环境下保存可能短暂阻塞）。
 */
export async function exportDocxInWorker(value: Value): Promise<Uint8Array> {
  if (workerBroken) return exportDocxMainThread(value)
  try {
    return await exportDocxWithWorker(value)
  } catch (err) {
    console.warn('[docx-worker] 回退主线程导出：', err)
    workerBroken = true
    docxWorker = null
    return exportDocxMainThread(value)
  }
}

/** md/txt 序列化 Worker（懒创建单例，同 docxWorker 模式） */
let serialWorker: Worker | null = null
let serialReqId = 0
/** Worker 已确认失效：之后直接主线程序列化 */
let serialWorkerBroken = false
/** 单次序列化超时（毫秒）：大文档克隆+序列化耗时，给足余量 */
const SERIAL_TIMEOUT_MS = 45_000

function getSerialWorker(): Worker {
  if (!serialWorker) {
    serialWorker = new Worker(
      new URL('../workers/serializationWorker.ts', import.meta.url),
      { type: 'module' }
    )
    serialWorker.onerror = (e) => {
      console.error('[serial-worker] error:', e.message)
      serialWorkerBroken = true
      serialWorker = null
    }
  }
  return serialWorker
}

/** 主线程序列化（Worker 失效时的回退路径，逻辑与 Worker 内完全一致） */
function serializeMainThread(kind: 'md' | 'txt', value: Value): string {
  return kind === 'md' ? valueToMarkdown(sanitizeValue(value)) : nodesToTxt(value)
}

/** 在 Worker 中序列化 md/txt（主线程不阻塞）；失败/超时 reject */
function serializeTextWithWorker(kind: 'md' | 'txt', value: Value): Promise<string> {
  const id = ++serialReqId
  return new Promise((resolve, reject) => {
    const worker = getSerialWorker()
    const onMsg = (e: MessageEvent<{ id: number; ok: boolean; text?: string; error?: string }>) => {
      if (e.data.id !== id) return
      cleanup()
      if (e.data.ok && e.data.text !== undefined) resolve(e.data.text)
      else reject(new Error(e.data.error ?? '序列化失败'))
    }
    const onErr = (e: ErrorEvent) => {
      cleanup()
      reject(new Error(e.message ?? '序列化 Worker 异常'))
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('序列化 Worker 超时'))
    }, SERIAL_TIMEOUT_MS)
    const cleanup = (): void => {
      worker.removeEventListener('message', onMsg)
      worker.removeEventListener('error', onErr)
      window.clearTimeout(timer)
    }
    worker.addEventListener('message', onMsg)
    worker.addEventListener('error', onErr)
    // 同 docx：大 value 结构化克隆在主线程，先让出当前帧
    const doPost = (): void => {
      worker.postMessage({ id, kind, value })
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => doPost())
    } else {
      doPost()
    }
  })
}

/**
 * md/txt 序列化入口：优先 Worker（不卡 UI），Worker 失效/超时/出错时
 * 自动回退主线程序列化（功能不丢，仅 dev 等异常环境下保存可能短暂阻塞）。
 */
async function serializeTextInWorker(kind: 'md' | 'txt', value: Value): Promise<string> {
  if (serialWorkerBroken) return serializeMainThread(kind, value)
  try {
    return await serializeTextWithWorker(kind, value)
  } catch (err) {
    console.warn('[serial-worker] 回退主线程序列化：', err)
    serialWorkerBroken = true
    serialWorker = null
    return serializeMainThread(kind, value)
  }
}

/** 在 Worker 中解析 markdown（md 打开：大文档 deserialize 移出主线程）；失败/超时 reject */
function parseMarkdownWithWorker(text: string): Promise<Value> {
  const id = ++serialReqId
  return new Promise((resolve, reject) => {
    const worker = getSerialWorker()
    const onMsg = (e: MessageEvent<{ id: number; ok: boolean; value?: Value; error?: string }>) => {
      if (e.data.id !== id) return
      cleanup()
      if (e.data.ok && e.data.value) resolve(e.data.value)
      else reject(new Error(e.data.error ?? 'markdown 解析失败'))
    }
    const onErr = (e: ErrorEvent) => {
      cleanup()
      reject(new Error(e.message ?? '序列化 Worker 异常'))
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('序列化 Worker 超时'))
    }, SERIAL_TIMEOUT_MS)
    const cleanup = (): void => {
      worker.removeEventListener('message', onMsg)
      worker.removeEventListener('error', onErr)
      window.clearTimeout(timer)
    }
    worker.addEventListener('message', onMsg)
    worker.addEventListener('error', onErr)
    // 传 md 文本（比传 value 树小很多，克隆开销低）
    worker.postMessage({ id, kind: 'mdParse', text })
  })
}

/**
 * md 打开入口：优先 Worker 解析（大文档 deserialize 不冻结 UI），
 * Worker 失效/超时/出错时回退主线程 markdownToValue（功能不丢）。
 */
export async function parseMarkdownInWorker(text: string): Promise<Value> {
  if (serialWorkerBroken) return markdownToValue(text)
  try {
    return await parseMarkdownWithWorker(text)
  } catch (err) {
    console.warn('[serial-worker] 回退主线程解析 markdown：', err)
    serialWorkerBroken = true
    serialWorker = null
    return markdownToValue(text)
  }
}

/** docx 打开 Worker（懒创建单例，同 serialWorker 模式） */
let docxOpenWorker: Worker | null = null
let docxOpenBroken = false
let docxOpenReqId = 0
/** 单次解析超时（毫秒）：大文档 mammoth+反序列化耗时，给足余量 */
const DOCX_OPEN_TIMEOUT_MS = 60_000

function getDocxOpenWorker(): Worker {
  if (!docxOpenWorker) {
    docxOpenWorker = new Worker(new URL('../workers/docxOpenWorker.ts', import.meta.url), {
      type: 'module'
    })
    docxOpenWorker.onerror = (e) => {
      console.error('[docx-open-worker] error:', e.message)
      docxOpenBroken = true
      docxOpenWorker = null
    }
  }
  return docxOpenWorker
}

/**
 * docx 打开入口：mammoth 转换（zip 解压 + HTML 生成的耗时大头）在 Worker 中执行，
 * DOMParser + deserialize（DOMParser 是 window 专属 API，Worker 无）在主线程执行——
 * 打开卡顿从"数秒全主线程"降到"仅 deserialize 几百 ms"。
 * buffer 走 transferable 零拷贝；Worker 失效/超时/出错时回退主线程 parseDocxMain。
 */
export async function parseDocxInWorker(buffer: ArrayBuffer): Promise<Value> {
  if (docxOpenBroken) return parseDocxMain(buffer)
  try {
    const html = await new Promise<string>((resolve, reject) => {
      const id = ++docxOpenReqId
      const worker = getDocxOpenWorker()
      const onMsg = (e: MessageEvent<{ id: number; ok: boolean; html?: string; error?: string }>) => {
        if (e.data.id !== id) return
        cleanup()
        if (e.data.ok && e.data.html !== undefined) resolve(e.data.html)
        else reject(new Error(e.data.error ?? 'docx 解析失败'))
      }
      const onErr = (e: ErrorEvent) => {
        cleanup()
        reject(new Error(e.message ?? 'docx 打开 Worker 异常'))
      }
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new Error('docx 打开 Worker 超时'))
      }, DOCX_OPEN_TIMEOUT_MS)
      const cleanup = (): void => {
        worker.removeEventListener('message', onMsg)
        worker.removeEventListener('error', onErr)
        window.clearTimeout(timer)
      }
      worker.addEventListener('message', onMsg)
      worker.addEventListener('error', onErr)
      // buffer transferable：零拷贝传给 Worker，不阻塞主线程
      worker.postMessage({ id, buffer }, { transfer: [buffer] })
    })
    // DOMParser + deserialize 在主线程（Worker 无 DOMParser）
    return docxHtmlToNodes(html)
  } catch (err) {
    console.warn('[docx-open-worker] 回退主线程解析：', err)
    docxOpenBroken = true
    docxOpenWorker = null
    return parseDocxMain(buffer)
  }
}

/**
 * 预热 docx 保存 Worker：打开/编辑 docx 期间提前创建 Worker 并加载依赖链
 * （首次加载约 8MB 依赖，dev 下需数秒），避免关闭时第一次保存才加载而"卡一下"。
 * Worker 懒创建单例：预热后正常保存直接复用。
 */
export function prewarmDocxWorker(): void {
  if (!docxOpenBroken && !docxWorker) getDocxWorker()
}

/**
 * 预热 md/txt 序列化 Worker（同 prewarmDocxWorker 逻辑，供 md/txt 打开后预热）。
 */
export function prewarmSerialWorker(): void {
  if (!serialWorkerBroken && !serialWorker) getSerialWorker()
}

/**
 * 将编辑器 value 保存到指定文件（按扩展名选择格式）。
 * docx/md/txt 序列化均优先在 Web Worker 中执行（失效时自动回退主线程），
 * 大文档保存不冻结 UI。
 * @returns 是否保存成功（不支持的扩展名返回 false）
 */
export async function saveValueToFile(
  path: string,
  ext: string,
  value: Value
): Promise<boolean> {
  const e = ext.toLowerCase()

  if (e === '.docx') {
    const buf = await exportDocxInWorker(value)
    await window.api.writeFile(path, buf)
    return true
  }

  if (e === '.md') {
    const text = await serializeTextInWorker('md', value)
    await window.api.writeFile(path, text)
    return true
  }

  if (e === '.txt') {
    const text = await serializeTextInWorker('txt', value)
    await window.api.writeFile(path, text)
    return true
  }

  return false
}
