// scripts/copy-pdfjs-cmaps.mjs
// 把 pdfjs-dist 的 CMap 资源复制到 renderer 的 public 目录
//（CID 编码中文字体（Type0）渲染必需；postinstall 自动执行，npm install 后不丢）
import { cpSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pdfjs-dist', 'cmaps')
const dest = join(root, 'src', 'renderer', 'public', 'cmaps')

if (!existsSync(src)) {
  console.error('[copy-cmaps] pdfjs-dist/cmaps 不存在，请先安装 pdfjs-dist')
  process.exit(1)
}
cpSync(src, dest, { recursive: true })
console.log('[copy-cmaps] CMap 资源已复制到', dest)
