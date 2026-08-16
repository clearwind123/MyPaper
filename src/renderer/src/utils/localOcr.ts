// src/renderer/src/utils/localOcr.ts
// 本地 OCR（tesseract.js v7 浏览器 ESM bundle）：懒加载单例 Worker，
// 资产全部本地化（public/tesseract、public/tesseract-core、public/tesseract-data），离线可用
// 语言：简体中文（chi_sim）+ 英文（eng）；Worker 崩溃时丢弃单例，下次调用自动重建

import Tesseract from 'tesseract.js/dist/tesseract.esm.min.js'

let workerPromise: Promise<Tesseract.Worker> | null = null

function createOcrWorker(): Promise<Tesseract.Worker> {
  // 相对路径：dev 下解析到 http://localhost:5173/tesseract/；打包后 file:// 下解析到
  // app.asar/out/renderer/tesseract/（asar 内 fetch/new Worker 实测可用）。
  // 原根绝对路径 '/tesseract/...' 在打包后 file:// 协议下指向磁盘根目录 → 本地 OCR 失效。
  return Tesseract.createWorker(['chi_sim', 'eng'], 1, {
    workerPath: './tesseract/worker.min.js',
    corePath: './tesseract-core/tesseract-core-simd-lstm.wasm.js',
    langPath: './tesseract-data/',
    gzip: true
  })
}

/** 识别图片中的文字（data URL → 文本；纯图片/无文字返回空字符串；失败抛错） */
export async function recognizeImage(dataUrl: string): Promise<string> {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((err) => {
      workerPromise = null
      throw err
    })
  }
  const worker = await workerPromise
  try {
    const { data } = await worker.recognize(dataUrl)
    return (data.text ?? '').trim()
  } catch (err) {
    // Worker 崩溃：丢弃单例，下次重建
    workerPromise = null
    throw err
  }
}
