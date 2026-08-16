// src/renderer/src/main.tsx
// 渲染进程入口：注入 Node polyfill（docx-io 依赖全局 Buffer），挂载 React 应用

import { Buffer } from 'buffer'

// docx 导入导出链路（docx-io/mammoth）依赖 Node 全局 Buffer，vite 只在模块层 polyfill，
// 这里显式注入全局变量
;(globalThis as Record<string, unknown>).Buffer = Buffer

import React, { type JSX } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CaptureRoot from './components/ocr/CaptureRoot'
import OcrHistoryWindow from './components/ocr/OcrHistoryWindow'
import TodoWindow from './components/todo/TodoWindow'
import './app.css'
import './ui.css'

// hash 路由：#capture = 识图遮罩窗口；#ocr-history = 截屏记录窗口；#todo = 待办清单窗口
function renderRoot(): JSX.Element {
  const hash = window.location.hash.replace(/^#/, '').split('?')[0]
  if (hash === 'capture') return <CaptureRoot />
  if (hash === 'ocr-history') return <OcrHistoryWindow />
  if (hash === 'todo') return <TodoWindow />
  return <App />
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{renderRoot()}</React.StrictMode>
)
