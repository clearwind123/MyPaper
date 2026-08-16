// src/renderer/src/workers/docxExportWorker.ts
// docx 导出 Worker：把 exportToDocx 的重计算移出渲染进程主线程，
// 大文档（数万字+表格图片）保存时 UI 不再冻结。
// docx-io 整条链（virtual-dom 渲染 + juice + html-to-docx + jszip）无 DOM 依赖，可在 Worker 运行。
//
// 【历史坑（2026-08-08）】@platejs/math（katex）的 base 插件曾 import katex.min.css，
// vite 把 css import 转成 JS 模块（顶层执行 updateStyle 访问 document），Worker 无 DOM 加载即崩。
// 已通过 patch @platejs/math（patches/）把 css import 从 base 版移到 react 版——
// 主线程编辑器（react 版）公式样式保留，Worker 链（base 版）不再含 css。此处 document stub
// 仅为防御性保留（防止未来依赖链出现其他顶层 DOM 引用）。
// 【注意】Worker 是独立全局，主线程 main.tsx 注入的 globalThis.Buffer 不生效；
// docx-io 导出链对 Buffer 有 typeof 保护（运行时才用），主体注入 polyfill 即可。

import type { Value } from 'platejs'
import { Buffer as BufferPolyfill } from 'buffer'
import { exportToDocx } from '@platejs/docx-io'
import { DOCX_EXPORT_PLUGINS } from '../utils/editorPlugins'
import { sanitizeValue } from '../utils/valueSanitize'

interface DocxExportRequest {
  id: number
  value: Value
  fontFamily?: string
}

interface DocxExportResponse {
  id: number
  ok: boolean
  data?: Uint8Array
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

// 防御性 stub + Buffer polyfill（onmessage 注册前注入即可，docx-io 的 Buffer 用法有 typeof 保护）
self.document = createWorkerDocumentStub()
self.Buffer = BufferPolyfill

self.onmessage = async (e: MessageEvent<DocxExportRequest>) => {
  const { id, value, fontFamily } = e.data
  try {
    const blob = await exportToDocx(sanitizeValue(value), {
      fontFamily: fontFamily ?? 'Microsoft YaHei',
      editorPlugins: DOCX_EXPORT_PLUGINS
    })
    const buf = await blob.arrayBuffer()
    const res: DocxExportResponse = { id, ok: true, data: new Uint8Array(buf) }
    postMessage(res, { transfer: [buf] })
  } catch (err) {
    const res: DocxExportResponse = { id, ok: false, error: String(err) }
    postMessage(res)
  }
}
