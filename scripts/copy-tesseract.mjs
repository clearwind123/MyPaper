// scripts/copy-tesseract.mjs
// 复制 tesseract.js 本地化资产到渲染层 public/（worker / core wasm / 语言包），
// 使本地 OCR 完全离线运行（不依赖 CDN）。npm install 后由 postinstall 自动执行。

import { mkdirSync, copyFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 复制单个文件（跳过已存在，避免每次 install 覆盖） */
function copy(src, dest) {
  if (!existsSync(src)) {
    console.log(`[copy-tesseract] 源不存在，跳过: ${src}`)
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  console.log(`[copy-tesseract] ${src} -> ${dest}`)
}

const nm = join(root, 'node_modules')
const pub = join(root, 'src', 'renderer', 'public')

// worker 脚本
copy(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(pub, 'tesseract', 'worker.min.js'))
// core（simd-lstm：体积小、精度高、需浏览器 SIMD；Electron 现代 Chromium 均支持）
copy(
  join(nm, 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'),
  join(pub, 'tesseract-core', 'tesseract-core-simd-lstm.wasm.js')
)
copy(
  join(nm, 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm'),
  join(pub, 'tesseract-core', 'tesseract-core-simd-lstm.wasm')
)
// 语言包（简体中文 + 英文）
copy(
  join(nm, '@tesseract.js-data', 'chi_sim', '4.0.0', 'chi_sim.traineddata.gz'),
  join(pub, 'tesseract-data', 'chi_sim.traineddata.gz')
)
copy(
  join(nm, '@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz'),
  join(pub, 'tesseract-data', 'eng.traineddata.gz')
)
