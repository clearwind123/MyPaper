// src/renderer/src/components/WordCount.tsx
// 状态栏字数显示独立组件：单独订阅 wordCount，避免 App 整体随字数变化重渲染
// （大文件优化：之前 App.tsx 订阅 wordCount，每次击键更新字数 → 整个界面重渲染）

import type { JSX } from 'react'
import { useAppStore } from '../store/appStore'

export default function WordCount(): JSX.Element {
  const wordCount = useAppStore((s) => s.wordCount)
  return <span>字数：{wordCount}</span>
}
