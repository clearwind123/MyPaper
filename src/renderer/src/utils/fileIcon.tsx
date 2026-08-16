// src/renderer/src/utils/fileIcon.tsx
// 根据文件扩展名返回对应的 lucide 图标（独立文件以便组件间复用，避免 Fast Refresh 告警）

import type { JSX } from 'react'
import {
  FileText,
  FileCode2,
  File as FileIcon,
  Image as ImageIcon,
  Table as TableIcon,
  FileType2
} from 'lucide-react'

export function fileIcon(ext: string, size = 15): JSX.Element {
  const e = ext.toLowerCase()
  if (e === '.md') return <FileCode2 size={size} />
  if (['.docx', '.doc', '.txt'].includes(e)) return <FileText size={size} />
  if (['.xlsx', '.xls', '.csv'].includes(e)) return <TableIcon size={size} />
  if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp'].includes(e))
    return <ImageIcon size={size} />
  if (e === '.pdf') return <FileType2 size={size} />
  return <FileIcon size={size} />
}
