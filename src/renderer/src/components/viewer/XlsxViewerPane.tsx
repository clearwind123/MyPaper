// src/renderer/src/components/viewer/XlsxViewerPane.tsx
// xlsx 查看器（exceljs 解析 → HTML DOM 表格，绿色主题）：
// - HTML 表格天然支持单元格选中复制（Canvas 渲染表格无法选择——定案铁律）
// - 保留：合并单元格、粗体、背景色、水平对齐、换行文本、列宽、行高
// - 多工作表：底部标签切换
// 说明：.xls 旧格式 exceljs 不支持，仍走 @file-viewer（能看，无法选中）

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import ExcelJS from 'exceljs'
import { useAppStore } from '../../store/appStore'
import { readPosition } from '../../utils/positionMemory'

interface CellData {
  text: string
  bold?: boolean
  bg?: string
  align?: 'left' | 'center' | 'right'
  colSpan?: number
  rowSpan?: number
  /** 被合并区域覆盖的占位格：不渲染 <td>（否则 colspan 后多余 td 顺排错列） */
  skip?: boolean
}

interface SheetData {
  name: string
  rows: CellData[][]
  /** 每列宽度（px 近似值） */
  colWidths: number[]
}

/** exceljs 颜色对象 → CSS 颜色（忽略主题色，仅标准色） */
function fillToCss(fill: unknown): string | undefined {
  const f = fill as { type?: string; fgColor?: { argb?: string } }
  if (!f || f.type !== 'pattern') return undefined
  const argb = f.fgColor?.argb
  if (!argb) return undefined
  return '#' + argb.slice(-6)
}

/** HTML 转义（复制 HTML 表格格式时防注入/错乱） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 单元格值 → 文本 */
function cellToText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toLocaleString()
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; hyperlink?: unknown; richText?: Array<{ text?: string }> }
    if (o.richText) return o.richText.map((r) => r.text ?? '').join('')
    if (o.result !== undefined && o.result !== null) return String(o.result)
    if (o.text !== undefined) return String(o.text)
    return ''
  }
  return String(v)
}

/** 解析合并区域字符串（"A1:B2" 或 "Sheet1!A1:B2" → 行列索引，1-based；解析失败返回 null） */
function parseMergeRange(
  range: string
): { top: number; left: number; bottom: number; right: number } | null {
  // exceljs Range.range 可能带 sheet 前缀（如 "Sheet1!A1:B2"），容忍之
  const m = /^(?:[^!]+!)?([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range)
  if (!m) return null
  const colToNum = (s: string): number =>
    s.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0)
  return {
    top: parseInt(m[2], 10),
    left: colToNum(m[1]),
    bottom: parseInt(m[4], 10),
    right: colToNum(m[3])
  }
}

/** 解析一个工作表为 HTML 表格数据（合并单元格 → rowSpan/colSpan） */
function parseSheet(ws: ExcelJS.Worksheet): SheetData {
  const rows: CellData[][] = []
  const colWidths: number[] = []

  // 列宽（exceljs 宽度 ≈ 字符数，×7.5px 近似；无列定义时 ws.columns 为 null）
  ;(ws.columns ?? []).forEach((col) => {
    if (col.width) colWidths.push(Math.max(24, Math.round(col.width * 7.5)))
  })

  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: CellData[] = []
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const value: CellData = { text: cellToText(cell.value) }
      const style = cell.style
      if (style.font?.bold) value.bold = true
      value.bg = fillToCss(style.fill)
      const hAlign = style.alignment?.horizontal
      if (hAlign === 'left' || hAlign === 'center' || hAlign === 'right') value.align = hAlign
      // 确保数组索引对齐（空单元格补位）
      while (cells.length < colNumber - 1) cells.push({ text: '' })
      cells.push(value)
      void rowNumber
    })
    while (rows.length < rowNumber - 1) rows.push([])
    rows.push(cells)
  })

  // 合并单元格：起始格设 rowSpan/colSpan，覆盖区域格标记 skip（不渲染，防列错位）
  const merges = (ws.model.merges ?? []) as string[]
  for (const range of merges) {
    const parsed = parseMergeRange(range)
    if (!parsed) continue // 解析失败（格式异常）跳过，不破坏表格
    const { top, left, bottom, right } = parsed
    if (top < 1 || left < 1) continue
    const r = top - 1
    const c = left - 1
    if (!rows[r]) rows[r] = []
    while (rows[r].length < c) rows[r].push({ text: '' })
    const cell = rows[r][c]
    cell.rowSpan = bottom - top + 1
    cell.colSpan = right - left + 1
    // 覆盖区域：标记 skip（保留占位索引，渲染时跳过）
    for (let rr = top; rr <= bottom; rr++) {
      if (!rows[rr - 1]) rows[rr - 1] = []
      for (let cc = left; cc <= right; cc++) {
        if (rr === top && cc === left) continue
        rows[rr - 1][cc - 1] = { text: '', skip: true }
      }
    }
  }

  return { name: ws.name || 'Sheet', rows, colWidths }
}

export default function XlsxViewerPane({ path }: { path: string }): JSX.Element {
  const [sheets, setSheets] = useState<SheetData[] | null>(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // 单元格选区（0-based，含两端；r2/c2 可能小于 r1/c1）
  const [sel, setSel] = useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null)
  const dragRef = useRef<{ r: number; c: number } | null>(null)
  // 滚动容器 ref（阅读位置保存/恢复用）
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // 全局视图缩放（Ctrl+滚轮）：占位层布局放大撑开滚动范围 + transform 视觉放大表格
  const viewZoom = useAppStore((s) => s.viewZoom)

  // 用 useLayoutEffect：cleanup 在 DOM 移除/更新前同步执行，保存阅读位置能读到旧容器
  useLayoutEffect(() => {
    let cancelled = false
    setSheets(null)
    setError(null)
    setActive(0)
    setSel(null)
    void (async () => {
      try {
        const { buffer: bytes } = await window.api.readFile(path)
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(ab)
        if (cancelled) return
        setSheets(wb.worksheets.map((ws) => parseSheet(ws)))
        // 恢复上次阅读位置（等表格渲染稳定后双 rAF 设置滚动）
        const cfg = useAppStore.getState().config
        if (cfg?.settings.rememberPosition) {
          const pos = readPosition(path)
          if (pos) {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (bodyRef.current) {
                  bodyRef.current.scrollTop = pos.s || 0
                  if (pos.l) bodyRef.current.scrollLeft = pos.l
                }
              })
            )
          }
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    })()
    return () => {
      cancelled = true
      // 阅读位置保存已移至 App 注册的 flushPosition 回调（事件驱动）——
      // 卸载 cleanup 保存会被 StrictMode 挂载时模拟卸载污染成 {s:0}（2026-08-14 根因）
    }
  }, [path])

  const sheet = sheets?.[active]

  // 单元格选区复制：同时写入纯文本（\t/\n）与 HTML 表格两种格式——
  // 粘贴到本软件编辑器/Word/Excel 得到表格（Plate html.deserialize 识别 <table>），
  // 粘贴到记事本等得到制表符分隔文本
  useEffect(() => {
    const onCopy = (e: ClipboardEvent): void => {
      if (!sel || !sheet) return
      const r1 = Math.min(sel.r1, sel.r2)
      const r2 = Math.max(sel.r1, sel.r2)
      const c1 = Math.min(sel.c1, sel.c2)
      const c2 = Math.max(sel.c1, sel.c2)
      const lines: string[] = []
      const htmlRows: string[] = []
      for (let r = r1; r <= r2; r++) {
        const row = sheet.rows[r]
        const parts: string[] = []
        const cells: string[] = []
        for (let c = c1; c <= c2; c++) {
          const cell = row?.[c]
          const text = cell?.text ?? ''
          parts.push(text)
          const attrs: string[] = []
          if (cell?.rowSpan && cell.rowSpan > 1) attrs.push(`rowspan="${cell.rowSpan}"`)
          if (cell?.colSpan && cell.colSpan > 1) attrs.push(`colspan="${cell.colSpan}"`)
          cells.push(`<td${attrs.length ? ' ' + attrs.join(' ') : ''}>${escapeHtml(text)}</td>`)
        }
        lines.push(parts.join('\t'))
        htmlRows.push(`<tr>${cells.join('')}</tr>`)
      }
      const text = lines.join('\n')
      const html = `<table><tbody>${htmlRows.join('')}</tbody></table>`
      e.preventDefault()
      const item = new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' })
      })
      void navigator.clipboard.write([item]).catch(() => {
        // 兜底：仅纯文本
        void navigator.clipboard.writeText(text)
      })
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [sel, sheet])

  const cellInSel = (r: number, c: number): boolean => {
    if (!sel) return false
    const r1 = Math.min(sel.r1, sel.r2)
    const r2 = Math.max(sel.r1, sel.r2)
    const c1 = Math.min(sel.c1, sel.c2)
    const c2 = Math.max(sel.c1, sel.c2)
    return r >= r1 && r <= r2 && c >= c1 && c <= c2
  }

  const body = useMemo(() => {
    if (!sheet) return null
    return (
      <table className="xlsx-table" onMouseUp={() => (dragRef.current = null)}>
        <colgroup>
          {sheet.colWidths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          {sheet.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) =>
                cell.skip ? null : (
                  <td
                    key={ci}
                    rowSpan={cell.rowSpan}
                    colSpan={cell.colSpan}
                    className={[
                      cell.bold ? 'xlsx-bold' : '',
                      cell.align ? `xlsx-${cell.align}` : '',
                      cellInSel(ri, ci) ? 'xlsx-cell-selected' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={cell.bg ? { background: cell.bg } : undefined}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      dragRef.current = { r: ri, c: ci }
                      setSel({ r1: ri, c1: ci, r2: ri, c2: ci })
                    }}
                    onMouseEnter={() => {
                      if (dragRef.current) {
                        setSel((s) => (s ? { ...s, r2: ri, c2: ci } : s))
                      }
                    }}
                  >
                    {cell.text}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, sel])

  if (error) {
    return <div className="viewer-message">表格打开失败：{error}</div>
  }
  if (!sheets || !body) {
    return <div className="viewer-message">正在加载表格…</div>
  }

  return (
    <div className="xlsx-viewer" onMouseDown={(e) => {
      // 点击表格外部空白清除选区
      if (e.target === e.currentTarget) {
        dragRef.current = null
        setSel(null)
      }
    }}>
      <div className="xlsx-viewer-body" ref={bodyRef}>
        {/* 占位层（布局 = 容器 × 缩放比例，撑开滚动范围）+ transform scale（表格视觉放大，左上锚点） */}
        <div
          className="xlsx-zoom-stage"
          style={{ width: `${viewZoom * 100}%`, height: `${viewZoom * 100}%` }}
        >
          <div
            className="xlsx-zoom-scale"
            style={{ transform: `scale(${viewZoom})`, transformOrigin: 'top left' }}
          >
            {body}
          </div>
        </div>
      </div>
      <div className="xlsx-viewer-tabs">
        {sheets.map((s, i) => (
          <button
            key={i}
            className={`xlsx-tab ${i === active ? 'xlsx-tab-active' : ''}`}
            onClick={() => setActive(i)}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  )
}
