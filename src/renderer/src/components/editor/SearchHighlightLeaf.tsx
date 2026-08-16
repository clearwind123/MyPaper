// src/renderer/src/components/editor/SearchHighlightLeaf.tsx
// 查找替换高亮 leaf：渲染匹配文本的黄色高亮（FindReplacePlugin 的 render.node）

import { PlateLeaf, type PlateLeafProps } from 'platejs/react'

/** 搜索匹配高亮（黄色背景） */
export function SearchHighlightLeaf(props: PlateLeafProps): React.JSX.Element {
  return <PlateLeaf {...props} className="search-highlight" />
}
