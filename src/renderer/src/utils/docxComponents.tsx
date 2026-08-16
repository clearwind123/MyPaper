// src/renderer/src/utils/docxComponents.tsx
// DOCX 导出专用静态组件（官网 DocxExportKit 模式，内联样式适配 Word）：
// 公式用 LaTeX 源码 + Cambria Math 字体（KaTeX 不工作于 DOCX）；
// 代码块用等宽字体 + 灰底 + 语法着色（保留缩进）

import type { JSX } from 'react'
import type { SlateElementProps } from 'platejs/static'
import { SlateElement } from 'platejs/static'

/* ---------- 公式（DOCX 版） ---------- */

/** DOCX 块级公式：显示 LaTeX 源码（Cambria Math），居中 */
export function EquationElementDocx(props: SlateElementProps): JSX.Element {
  const tex = (props.element as { texExpression?: string }).texExpression ?? ''
  return (
    <SlateElement {...props}>
      <p
        style={{
          fontFamily: 'Cambria Math, Consolas, monospace',
          fontSize: '12pt',
          margin: '8pt 0',
          textAlign: 'center'
        }}
      >
        {tex || '[空公式]'}
      </p>
      {props.children}
    </SlateElement>
  )
}

/** DOCX 行内公式：显示 LaTeX 源码（Cambria Math） */
export function InlineEquationElementDocx(props: SlateElementProps): JSX.Element {
  const tex = (props.element as { texExpression?: string }).texExpression ?? ''
  return (
    <SlateElement {...props} as="span">
      <span style={{ fontFamily: 'Cambria Math, Consolas, monospace' }}>{tex || '[公式]'}</span>
      {props.children}
    </SlateElement>
  )
}

/* ---------- 代码块（DOCX 版） ---------- */

/** 递归提取节点文本 */
function nodeTextOf(node: unknown): string {
  if (typeof node === 'object' && node !== null) {
    const n = node as { text?: string; children?: unknown[] }
    if (typeof n.text === 'string') return n.text
    if (Array.isArray(n.children)) return n.children.map(nodeTextOf).join('')
  }
  return ''
}

/**
 * DOCX 代码块：标准 pre > code 结构（html-to-docx 对 pre 特殊处理：Courier 等宽），
 * 每行文本 + <br> 换行，避免 div/p 嵌套导致内容丢失；
 * 备注**不再渲染为 code 内第一行**（修复"保存后第一行变备注"）——改为 pre 后独立灰色小段落，
 * docx 导入时识别该段落并绑定回代码块
 */
export function CodeBlockElementDocx(props: SlateElementProps): JSX.Element {
  const element = props.element as { note?: string; children?: unknown[] }
  const note = element.note ?? ''
  // 提取每一行代码文本（code_block > code_line > text）
  const lines = (element.children ?? [])
    .map((line) => nodeTextOf(line))
    .filter((t) => t !== undefined)
  return (
    <>
      <SlateElement {...props} as="pre">
        <code
          style={{
            fontFamily: "'Courier New', Consolas, monospace",
            fontSize: '10pt',
            whiteSpace: 'pre-wrap',
            display: 'block',
            backgroundColor: '#f5f5f5',
            border: '1px solid #e0e0e0',
            margin: '8pt 0',
            padding: '12pt'
          }}
        >
          {lines.map((line, i) => (
            <span key={i}>
              {line.replace(/ /g, '\u00A0')}
              {i < lines.length - 1 && <br />}
            </span>
          ))}
        </code>
      </SlateElement>
      {note && (
        <p
          style={{
            fontFamily: "'Microsoft YaHei', sans-serif",
            fontSize: '9pt',
            color: '#888888',
            margin: '2pt 0 8pt 0'
          }}
        >
          📌 备注：{note}
        </p>
      )}
    </>
  )
}

/* ---------- 图片（DOCX 版） ---------- */

/** DOCX 图片：渲染 <img>（data URL 直接内嵌） */
export function ImageElementDocx(props: SlateElementProps): JSX.Element {
  const url = (props.element as { url?: string }).url ?? ''
  return (
    <SlateElement {...props}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <img
        src={url}
        alt=""
        style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '8pt 0' }}
      />
    </SlateElement>
  )
}

/* ---------- 引用块（DOCX 版，含备注） ---------- */

/** DOCX 引用块：左边框 + 备注（如节点有 note 属性）；段落间插 <br> 保留换行（docx-io 对 blockquote 内容走 run 拼接，不加分隔会合并成一段；不能包 p，run 上下文会忽略块级元素） */
export function BlockquoteElementDocx(props: SlateElementProps): JSX.Element {
  const element = props.element as { note?: string; children?: unknown[] }
  const note = element.note ?? ''
  // 提取每段文本（blockquote > p > text）
  const paragraphs = (element.children ?? [])
    .map((p) => nodeTextOf(p))
    .filter((t) => t !== '')
  return (
    <SlateElement {...props} as="blockquote">
      <div
        style={{
          borderLeft: '3px solid #55a97c',
          paddingLeft: '12pt',
          color: '#555',
          margin: '6pt 0'
        }}
      >
        {paragraphs.map((para, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {para}
          </span>
        ))}
        {note && (
          <span>
            <br />
            <span style={{ fontFamily: "'Microsoft YaHei', sans-serif", fontSize: '10pt', color: '#2f7d57' }}>
              📌 备注：{note}
            </span>
          </span>
        )}
      </div>
    </SlateElement>
  )
}

/* ---------- 表格（DOCX 版） ---------- *//** DOCX 表格容器 */
export function TableElementDocx(props: SlateElementProps): JSX.Element {
  return (
    <SlateElement
      {...props}
      as="table"
      style={{
        borderCollapse: 'collapse',
        width: '100%',
        margin: '8pt 0'
      }}
    >
      <tbody>{props.children}</tbody>
    </SlateElement>
  )
}

/** DOCX 表格行 */
export function TableRowElementDocx(props: SlateElementProps): JSX.Element {
  return <SlateElement {...props} as="tr" />
}

/** DOCX 表格单元格（td） */
export function TableCellElementDocx(props: SlateElementProps): JSX.Element {
  return (
    <SlateElement
      {...props}
      as="td"
      style={{ border: '1px solid #ccc', padding: '6pt', textAlign: 'left' }}
    />
  )
}

/** DOCX 表头单元格（th） */
export function TableCellHeaderElementDocx(props: SlateElementProps): JSX.Element {
  return (
    <SlateElement
      {...props}
      as="th"
      style={{ border: '1px solid #ccc', padding: '6pt', textAlign: 'left', fontWeight: 'bold' }}
    />
  )
}
