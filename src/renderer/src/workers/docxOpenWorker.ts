// src/renderer/src/workers/docxOpenWorker.ts
// docx 打开 Worker：把 mammoth 转换 + HTML 反序列化移出渲染进程主线程，
// 大文档（2.6MB 表格图片 docx）打开时 UI 不再冻结。
// 与 docxExportWorker 同模式：主线程 postMessage（buffer 走 transferable 零拷贝），
// 失败/超时回退主线程 parseDocxMain。
// 【注意】mammoth 必须静态 import（vite dev 下 Worker 里动态 import 依赖链会挂起，
// 2026-08-08 经验）；document stub + Buffer 为防御性注入（防止依赖链 DOM 引用）。

import mammoth from 'mammoth'
import { Buffer as BufferPolyfill } from 'buffer'
import { mammothToHtml } from '../utils/docxOpenShared'

interface DocxOpenRequest {
  id: number
  buffer: ArrayBuffer
}

interface DocxOpenResponse {
  id: number
  ok: boolean
  html?: string
  error?: string
}

/** 最小 document stub（防御性）：覆盖 updateStyle 注入等 DOM 调用，样式本身丢弃 */
function createWorkerDocumentStub(): Document {
  const el = (): unknown => ({
    setAttribute: () => {},
    getAttribute: () => null,
    appendChild: () => {},
    removeChild: () => {},
    insertAdjacentElement: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
    sheet: null,
    textContent: '',
    innerHTML: '',
    dataset: {},
    nextSibling: null,
    classList: { add: () => {}, remove: () => {}, contains: () => false }
  })
  return {
    createElement: () => el(),
    createElementNS: () => el(),
    head: el(),
    body: el(),
    documentElement: el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
  } as unknown as Document
}

// 防御性 stub + Buffer polyfill（onmessage 注册前注入即可）
self.document = createWorkerDocumentStub()
self.Buffer = BufferPolyfill

self.onmessage = async (e: MessageEvent<DocxOpenRequest>) => {
  const { id, buffer } = e.data
  try {
    // 只做 mammoth 转换（zip 解压 + HTML 生成的耗时大头，纯 JS 无 DOM）；
    // DOMParser/deserialize 无 Worker 支持（DOMParser 是 window 专属 API），在主线程执行
    const html = await mammothToHtml(buffer, mammoth)
    const res: DocxOpenResponse = { id, ok: true, html }
    postMessage(res)
  } catch (err) {
    const res: DocxOpenResponse = { id, ok: false, error: String(err) }
    postMessage(res)
  }
}
