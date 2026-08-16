import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileViewerRenderers } from '@file-viewer/vite-plugin'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * CSP script-src 按模式注入：dev 需要 'unsafe-inline'（@vitejs/plugin-react 的
 * react-refresh preamble 是内联脚本，去掉会破坏 HMR）；生产构建收紧为仅 'self'
 * （无内联脚本），杜绝渲染层任何注入脚本执行（XSS 兜底）。
 */
function cspScriptSrc(dev: boolean): Plugin {
  return {
    name: `csp-script-src-${dev ? 'dev' : 'build'}`,
    apply: dev ? 'serve' : 'build',
    transformIndexHtml(html) {
      return html.replace('%SCRIPT_SRC%', dev ? "'unsafe-inline'" : '')
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [
      // CSP 占位符替换（dev 放行内联 / build 收紧）
      cspScriptSrc(true),
      cspScriptSrc(false),
      // exclude docxComponents.tsx：它是 docx 导出专用静态组件（会被 docx Worker 加载），
      // plugin-react 的 fast refresh 会给 .tsx 注入 import.meta.hot → vite 注入 @vite/client
      // → Worker 无 DOM 加载即崩（2026-08-08 定位：docx-worker document is not defined 根因）。
      // exclude 后仍由 esbuild 正常转 JSX，只是没有 HMR（改动需刷新，无碍）。
      react({ exclude: /docxComponents\.tsx$/ }),
      // 广泛文件查看器：自动发现已装的 @file-viewer/preset-* 并复制 worker/WASM/字体资产
      fileViewerRenderers({ copyAssets: true })
    ],
    // @file-viewer 资产（public/vendor）含 .otf 字体，Windows 下被锁定会导致 watch EBUSY 崩溃
    server: {
      watch: {
        ignored: ['**/public/vendor/**']
      }
    },
    // Web Worker 构建格式：vite 7 默认 iife 不支持代码分割（三个 Worker 的依赖链
    // 如 docx-io/mammoth 会拆多 chunk → build 报 "worker.format iife ... code-splitting"）。
    // 改 es（module 类型），与 new Worker(..., { type: 'module' }) 一致；仅影响 build。
    worker: {
      format: 'es'
    },
    resolve: {
      // docx 导入导出链路（mammoth/htmlparser2/html-to-docx）依赖 Node 内置模块，提供浏览器 polyfill
      alias: {
        path: 'path-browserify',
        events: 'events',
        buffer: 'buffer',
        // 大文件优化（2026-08-08）：decode-named-character-reference 的 package.json exports
        // 里 browser 条件指向 index.dom.js——它在【模块顶层】执行 document.createElement("i")，
        // Web Worker 无 DOM → 加载即崩（md 序列化 Worker、docx 导出 Worker 都依赖它）。
        // 重定向到无 DOM 的表驱动版 index.js（纯 JS 字符实体表，解码结果与 DOM 版完全一致，
        // 主线程/Worker 行为统一，不再依赖 DOM）。必须用绝对路径绕开 exports 子路径限制。
        'decode-named-character-reference': resolve(
          __dirname,
          'node_modules/decode-named-character-reference/index.js'
        )
      }
    }
  }
})
