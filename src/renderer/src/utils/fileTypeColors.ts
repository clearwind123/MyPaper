// src/renderer/src/utils/fileTypeColors.ts
// 文件图标内置配色（按扩展名自动上色，无需用户配置）。
// 分类依据 @file-viewer 支持的文件类型（office/document/image/markdown/code/archive/media 等），
// 颜色与软件绿色主题协调，同文件夹八色体系。

/** 内置配色（扩展名小写、不带点 → 颜色值） */
const TYPE_COLORS: Record<string, string> = {
  // Word 系（蓝）
  docx: '#4a82c4',
  docm: '#4a82c4',
  dotx: '#4a82c4',
  dotm: '#4a82c4',
  doc: '#4a82c4',
  dot: '#4a82c4',
  rtf: '#4a82c4',
  odt: '#4a82c4',
  // PowerPoint 系（橙）
  ppt: '#e8943a',
  pptx: '#e8943a',
  pptm: '#e8943a',
  potx: '#e8943a',
  potm: '#e8943a',
  ppsx: '#e8943a',
  ppsm: '#e8943a',
  odp: '#e8943a',
  // 表格系（绿）
  xlsx: '#4a9c6d',
  xltx: '#4a9c6d',
  xlsm: '#4a9c6d',
  xlsb: '#4a9c6d',
  xls: '#4a9c6d',
  xlt: '#4a9c6d',
  xltm: '#4a9c6d',
  csv: '#4a9c6d',
  tsv: '#4a9c6d',
  ods: '#4a9c6d',
  fods: '#4a9c6d',
  numbers: '#4a9c6d',
  // PDF（红）
  pdf: '#e05b4e',
  // 图片系（青）
  png: '#3ba3a3',
  jpg: '#3ba3a3',
  jpeg: '#3ba3a3',
  gif: '#3ba3a3',
  svg: '#3ba3a3',
  webp: '#3ba3a3',
  bmp: '#3ba3a3',
  ico: '#3ba3a3',
  tif: '#3ba3a3',
  tiff: '#3ba3a3',
  avif: '#3ba3a3',
  // Markdown（棕）
  md: '#a67c52',
  markdown: '#a67c52',
  // 纯文本（灰）
  txt: '#8a8a8a',
  // 代码文本（深灰）
  js: '#6b7280',
  jsx: '#6b7280',
  ts: '#6b7280',
  tsx: '#6b7280',
  py: '#6b7280',
  java: '#6b7280',
  c: '#6b7280',
  cpp: '#6b7280',
  h: '#6b7280',
  cs: '#6b7280',
  go: '#6b7280',
  rs: '#6b7280',
  php: '#6b7280',
  rb: '#6b7280',
  json: '#6b7280',
  xml: '#6b7280',
  html: '#6b7280',
  htm: '#6b7280',
  css: '#6b7280',
  scss: '#6b7280',
  less: '#6b7280',
  sql: '#6b7280',
  sh: '#6b7280',
  bat: '#6b7280',
  yaml: '#6b7280',
  yml: '#6b7280',
  ini: '#6b7280',
  // 压缩包（黄）
  zip: '#d9b93c',
  zipx: '#d9b93c',
  jar: '#d9b93c',
  war: '#d9b93c',
  ear: '#d9b93c',
  apk: '#d9b93c',
  cbz: '#d9b93c',
  '7z': '#d9b93c',
  rar: '#d9b93c',
  tar: '#d9b93c',
  gz: '#d9b93c',
  bz2: '#d9b93c',
  // OFD / Typst（紫）
  ofd: '#8b6bbd',
  typ: '#8b6bbd',
  typst: '#8b6bbd',
  // 邮件（蓝灰）
  eml: '#7f9bb3',
  msg: '#7f9bb3',
  mbox: '#7f9bb3',
  // 视频（玫红）
  mp4: '#c25e8a',
  avi: '#c25e8a',
  mov: '#c25e8a',
  mkv: '#c25e8a',
  flv: '#c25e8a',
  webm: '#c25e8a',
  wmv: '#c25e8a',
  m4v: '#c25e8a',
  mpg: '#c25e8a',
  mpeg: '#c25e8a',
  // 音频（亮蓝）
  mp3: '#5b8def',
  wav: '#5b8def',
  flac: '#5b8def',
  aac: '#5b8def',
  ogg: '#5b8def',
  wma: '#5b8def',
  m4a: '#5b8def',
  // 电子书（棕，同 md）
  epub: '#a67c52'
}

/** 取文件图标颜色（未收录返回 undefined = 默认灰色） */
export function fileTypeColor(ext: string): string | undefined {
  const key = ext.toLowerCase().replace(/^\./, '')
  return TYPE_COLORS[key]
}
