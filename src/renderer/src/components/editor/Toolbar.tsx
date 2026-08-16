// src/renderer/src/components/editor/Toolbar.tsx
// 编辑器工具栏：撤销重做、标题、加粗等 mark、列表、字号、颜色、对齐、缩进、图片、表格、公式、引用块、代码块、emoji

import { useRef, useState, type JSX } from 'react'
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Subscript,
  Superscript,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  IndentIncrease,
  IndentDecrease,
  Type,
  ImagePlus,
  Table2,
  Rows3,
  Columns3,
  Trash2,
  Sigma,
  Minus,
  Grid3x3,
  TextQuote,
  Code2,
  Smile
} from 'lucide-react'
import { insertImage } from '@platejs/media'
import { toggleBulletedList, toggleNumberedList } from '@platejs/list-classic'
import {
  insertTable,
  insertTableRow,
  insertTableColumn,
  deleteRow,
  deleteColumn,
  deleteTable
} from '@platejs/table'
import { insertEquation, insertInlineEquation } from '@platejs/math'
import { toggleCodeBlock } from '@platejs/code-block'
import EmojiPicker from './EmojiPicker'
import { useAppStore } from '../../store/appStore'
import { useUiStore } from '../../store/uiStore'

/** 字体大小档位 12-48px */
const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48]

/** 十种字体颜色（红橙黄绿蓝靛紫黑灰白） */
const FONT_COLORS = [
  { name: '红', value: '#ff0000' },
  { name: '橙', value: '#ff8c00' },
  { name: '黄', value: '#d9a400' },
  { name: '绿', value: '#00a650' },
  { name: '蓝', value: '#0066ff' },
  { name: '靛', value: '#4b0082' },
  { name: '紫', value: '#8b5cf6' },
  { name: '黑', value: '#000000' },
  { name: '灰', value: '#808080' },
  { name: '白', value: '#ffffff' }
]

const HEADINGS = [
  { label: '正文', type: 'p' },
  { label: '标题 1', type: 'h1' },
  { label: '标题 2', type: 'h2' },
  { label: '标题 3', type: 'h3' },
  { label: '标题 4', type: 'h4' },
  { label: '图片', type: 'h5' },
  { label: '表格', type: 'h6' }
]

/** 当前对齐类型 → 图标 */
const ALIGNS = [
  { label: '左对齐', value: 'left', icon: <AlignLeft size={15} /> },
  { label: '居中', value: 'center', icon: <AlignCenter size={15} /> },
  { label: '右对齐', value: 'right', icon: <AlignRight size={15} /> }
]

export default function Toolbar({ ext }: { ext: string }): JSX.Element | null {
  const editor = useAppStore((s) => s.editor)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 按文件类型裁剪按钮组：
  // docx = 富文本全量；md = 保留 markdown 标准语法语义（标题/加粗/斜体/删除线/列表/引用块/代码块/emoji）；
  // txt = 纯文本仅保留 撤销/重做/emoji（其余格式保存为 txt 时会丢失，展示即误导）
  const extLower = ext.toLowerCase()
  const isDocx = extLower === '.docx'
  const isTxt = extLower === '.txt'
  const showHeadings = !isTxt // 标题下拉
  const showMarks = !isTxt // 格式组整体（加粗/斜体/删除线等基础 marks）
  const showUnderline = isDocx // 下划线（md 无标准语法）
  const showHighlight = isDocx // 高亮（md 无标准语法）
  const showSubSup = isDocx // 上下标（md 无标准语法）
  const showLists = !isTxt // 列表（md 标准语法）
  const showFontSize = isDocx // 字号（md 无语法，会存成 MDX span）
  const showColor = isDocx // 颜色（md 无语法）
  const showAlign = isDocx // 对齐（md 无语法）
  const showIndent = isDocx // 缩进（md 无语法）
  const showImage = !isTxt // 图片（md 标准语法 ![alt](url)，本地图保存内嵌 data URL）
  const showTable = !isTxt // 表格（md GFM 表格语法）
  const showEquation = isDocx // 公式（md 无标准语法）
  const showQuoteCode = !isTxt // 引用块 + 代码块（md 标准语法；txt 保存纯文本会丢）

  // 订阅选区/内容版本号：变化时触发重渲染，刷新按钮激活态
  useAppStore((s) => s.selectionTick)

  if (!editor) return null

  const marks = (editor.api.marks() ?? {}) as Record<string, unknown>
  const hasMark = (key: string): boolean => !!editor.api.hasMark(key)
  const inBlock = (type: string): boolean => editor.api.some({ match: { type } as never })
  const inBlockAlign = (align: string): boolean =>
    editor.api.some({ match: { textAlign: align } as never })

  const toggleMenu = (key: string): void => {
    setOpenMenu((k) => (k === key ? null : key))
  }

  const applyHeading = (type: string): void => {
    if (type === 'p') {
      editor.tf.setNodes({ type: 'p' })
    } else {
      editor.tf.toggleBlock(type)
    }
  }

  const applyFontSize = (px: number): void => {
    editor.tf.fontSize.addMark(`${px}px`)
  }

  const applyColor = (value: string): void => {
    editor.tf.color.addMark(value)
  }

  // 图片：本地文件 → data URL → 插入
  const pickImage = (file: File | undefined): void => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') insertImage(editor, reader.result)
    }
    reader.onerror = () => {
      useUiStore.getState().showToast('error', '图片读取失败')
    }
    reader.readAsDataURL(file)
  }

  const inTable = (): boolean => editor.api.some({ match: { type: 'td' } as never })

  // 三线表：给光标所在表格设置 threeLine 标记
  const toggleThreeLine = (): void => {
    const above = (
      editor as unknown as {
        above: (opts: { match: (n: unknown) => boolean }) => [unknown, number[]] | undefined
      }
    ).above
    const entry = above.call(editor, {
      match: (n) => (n as { type?: string }).type === 'table'
    })
    if (!entry) return
    const tableNode = entry[0] as { threeLine?: boolean }
    editor.tf.setNodes({ threeLine: !tableNode.threeLine } as never, { at: entry[1] })
  }

  const currentAlign = ALIGNS.find((a) => inBlockAlign(a.value))

  return (
    <div className="toolbar">
      {openMenu && <div className="toolbar-overlay" onClick={() => setOpenMenu(null)} />}

      <div className="toolbar-group">
        <button className="tool-btn" data-tip="撤销" onClick={() => editor.tf.undo()}>
          <Undo2 size={15} />
        </button>
        <button className="tool-btn" data-tip="重做" onClick={() => editor.tf.redo()}>
          <Redo2 size={15} />
        </button>
      </div>

      {/* 标题下拉 */}
      {showHeadings && (
        <div className="toolbar-group toolbar-select">
          <button className="tool-btn tool-btn-select" data-tip="标题样式" onClick={() => toggleMenu('heading')}>
            <Type size={15} />
          </button>
          <div className={`toolbar-dropdown ${openMenu === 'heading' ? 'toolbar-dropdown-open' : ''}`}>
            {HEADINGS.map((h) => (
              <button
                key={h.type}
                className={`toolbar-dropdown-item ${inBlock(h.type) ? 'toolbar-dropdown-item-active' : ''}`}
                onClick={() => applyHeading(h.type)}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showMarks && (
        <div className="toolbar-group">
          <button className={`tool-btn ${hasMark('bold') ? 'tool-btn-active' : ''}`} data-tip="加粗" onClick={() => editor.tf.bold.toggle()}>
            <Bold size={15} />
          </button>
          <button className={`tool-btn ${hasMark('italic') ? 'tool-btn-active' : ''}`} data-tip="斜体" onClick={() => editor.tf.italic.toggle()}>
            <Italic size={15} />
          </button>
          {showUnderline && (
            <button className={`tool-btn ${hasMark('underline') ? 'tool-btn-active' : ''}`} data-tip="下划线" onClick={() => editor.tf.underline.toggle()}>
              <Underline size={15} />
            </button>
          )}
          <button className={`tool-btn ${hasMark('strikethrough') ? 'tool-btn-active' : ''}`} data-tip="删除线" onClick={() => editor.tf.strikethrough.toggle()}>
            <Strikethrough size={15} />
          </button>
          {showHighlight && (
            <button className={`tool-btn ${hasMark('highlight') ? 'tool-btn-active' : ''}`} data-tip="高亮（黄）" onClick={() => editor.tf.highlight.toggle()}>
              <Highlighter size={15} />
            </button>
          )}
          {showSubSup && (
            <>
              <button className={`tool-btn ${hasMark('subscript') ? 'tool-btn-active' : ''}`} data-tip="下标" onClick={() => editor.tf.subscript.toggle()}>
                <Subscript size={15} />
              </button>
              <button className={`tool-btn ${hasMark('superscript') ? 'tool-btn-active' : ''}`} data-tip="上标" onClick={() => editor.tf.superscript.toggle()}>
                <Superscript size={15} />
              </button>
            </>
          )}
        </div>
      )}

      {/* 列表下拉 */}
      {showLists && (
        <div className="toolbar-group toolbar-select">
          <button
            className={`tool-btn tool-btn-select ${inBlock('ul') || inBlock('ol') ? 'tool-btn-active' : ''}`}
            data-tip="列表"
            onClick={() => toggleMenu('list')}
          >
            <List size={15} />
          </button>
          <div className={`toolbar-dropdown ${openMenu === 'list' ? 'toolbar-dropdown-open' : ''}`}>
            <button className={`toolbar-dropdown-item ${inBlock('ul') ? 'toolbar-dropdown-item-active' : ''}`} onClick={() => toggleBulletedList(editor)}>
              <List size={13} /> 无序列表
            </button>
            <button className={`toolbar-dropdown-item ${inBlock('ol') ? 'toolbar-dropdown-item-active' : ''}`} onClick={() => toggleNumberedList(editor)}>
              <ListOrdered size={13} /> 有序列表
            </button>
          </div>
        </div>
      )}

      {/* 字号下拉 */}
      {showFontSize && (
        <div className="toolbar-group toolbar-select">
          <button className="tool-btn tool-btn-select" data-tip="字体大小" onClick={() => toggleMenu('fontSize')}>
            <span>{String(marks.fontSize ?? '字号')}</span>
          </button>
          <div className={`toolbar-dropdown ${openMenu === 'fontSize' ? 'toolbar-dropdown-open' : ''}`}>
            {FONT_SIZES.map((n) => (
              <button key={n} className="toolbar-dropdown-item" onClick={() => applyFontSize(n)}>
                {n}px
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 颜色下拉 */}
      {showColor && (
        <div className="toolbar-group toolbar-select">
          <button className="tool-btn tool-btn-color" data-tip="字体颜色" onClick={() => toggleMenu('color')}>
            <span className="toolbar-color-label">A</span>
          </button>
          <div className={`toolbar-dropdown toolbar-dropdown-colors ${openMenu === 'color' ? 'toolbar-dropdown-open' : ''}`}>
            {FONT_COLORS.map((c) => (
              <button
                key={c.value}
                className="toolbar-color-item"
                data-tip={c.name}
                style={{ background: c.value }}
                onClick={() => applyColor(c.value)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 对齐下拉 */}
      {showAlign && (
        <div className="toolbar-group toolbar-select">
          <button className="tool-btn tool-btn-select" data-tip="对齐" onClick={() => toggleMenu('align')}>
            {currentAlign?.icon ?? <AlignLeft size={15} />}
          </button>
          <div className={`toolbar-dropdown ${openMenu === 'align' ? 'toolbar-dropdown-open' : ''}`}>
            {ALIGNS.map((a) => (
              <button
                key={a.value}
                className={`toolbar-dropdown-item ${inBlockAlign(a.value) ? 'toolbar-dropdown-item-active' : ''}`}
                onClick={() => editor.tf.textAlign.setNodes(a.value)}
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 缩进下拉 */}
      {showIndent && (
        <div className="toolbar-group toolbar-select">
          <button className="tool-btn tool-btn-select" data-tip="缩进" onClick={() => toggleMenu('indent')}>
            <IndentIncrease size={15} />
          </button>
          <div className={`toolbar-dropdown ${openMenu === 'indent' ? 'toolbar-dropdown-open' : ''}`}>
            <button className="toolbar-dropdown-item" onClick={() => editor.tf.setNodes({ textIndent: 1 })}>
              <IndentIncrease size={13} /> 首行缩进
            </button>
            <button className="toolbar-dropdown-item" onClick={() => editor.tf.unsetNodes('textIndent')}>
              <IndentDecrease size={13} /> 取消缩进
            </button>
          </div>
        </div>
      )}

      {/* 图片 + 表格 + 公式（按类型裁剪：md 放开图片/表格，公式仅 docx） */}
      {(showImage || showTable || showEquation) && (
        <div className="toolbar-group">
          {showImage && (
            <>
              <button className="tool-btn" data-tip="插入图片" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus size={15} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept="image/*"
                onChange={(e) => {
                  pickImage(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </>
          )}

          {/* 表格下拉 */}
          {showTable && (
            <div className="toolbar-select">
            <button
              className={`tool-btn tool-btn-select ${inTable() ? 'tool-btn-active' : ''}`}
              data-tip="表格"
              onClick={() => toggleMenu('table')}
            >
              <Table2 size={15} />
            </button>
            <div className={`toolbar-dropdown ${openMenu === 'table' ? 'toolbar-dropdown-open' : ''}`}>
              <button
                className="toolbar-dropdown-item"
                onClick={() => { insertTable(editor, { colCount: 3, rowCount: 3, header: false }) }}
              >
                <Grid3x3 size={13} /> 插入表格（3×3）
              </button>
              <button className="toolbar-dropdown-item" disabled={!inTable()} onClick={() => { insertTableRow(editor) }}>
                <Rows3 size={13} /> 插入行
              </button>
              <button className="toolbar-dropdown-item" disabled={!inTable()} onClick={() => { insertTableColumn(editor) }}>
                <Columns3 size={13} /> 插入列
              </button>
              <button className="toolbar-dropdown-item" disabled={!inTable()} onClick={() => { deleteRow(editor) }}>
                <Minus size={13} /> 删除行
              </button>
              <button className="toolbar-dropdown-item" disabled={!inTable()} onClick={() => { deleteColumn(editor) }}>
                <Minus size={13} /> 删除列
              </button>
              <button className="toolbar-dropdown-item" disabled={!inTable()} onClick={toggleThreeLine}>
                三线表
              </button>
              <button className="toolbar-dropdown-item toolbar-dropdown-item-danger" disabled={!inTable()} onClick={() => { deleteTable(editor) }}>
                <Trash2 size={13} /> 删除表格
              </button>
            </div>
          </div>
          )}

          {/* 公式下拉 */}
          {showEquation && (
            <div className="toolbar-select">
              <button className="tool-btn tool-btn-select" data-tip="数学公式" onClick={() => toggleMenu('math')}>
                <Sigma size={15} />
              </button>
              <div className={`toolbar-dropdown ${openMenu === 'math' ? 'toolbar-dropdown-open' : ''}`}>
                <button className="toolbar-dropdown-item" onClick={() => { insertEquation(editor) }}>
                  块级公式
                </button>
                <button className="toolbar-dropdown-item" onClick={() => { insertInlineEquation(editor, '') }}>
                  行内公式
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* 引用块 + 代码块（md 标准语法；txt 保存纯文本会丢）+ emoji（纯字符，所有类型可保存） */}
      {showQuoteCode && (
        <>
          <button
            className={`tool-btn ${inBlock('blockquote') ? 'tool-btn-active' : ''}`}
            data-tip="引用块"
            onClick={() => {
              editor.tf.blockquote.toggle()
              editor.api.redecorate()
            }}
          >
            <TextQuote size={15} />
          </button>
          <button
            className={`tool-btn ${inBlock('code_block') ? 'tool-btn-active' : ''}`}
            data-tip="代码块"
            onClick={() => {
              toggleCodeBlock(editor)
              editor.api.redecorate()
            }}
          >
            <Code2 size={15} />
          </button>
        </>
      )}
      {/* emoji 下拉 */}
      <div className="toolbar-select">
        <button
          className={`tool-btn tool-btn-select ${openMenu === 'emoji' ? 'tool-btn-active' : ''}`}
          data-tip="插入 emoji"
          onClick={() => toggleMenu('emoji')}
        >
          <Smile size={15} />
        </button>
        <div
          className={`toolbar-dropdown toolbar-dropdown-emoji ${openMenu === 'emoji' ? 'toolbar-dropdown-open' : ''}`}
        >
          <EmojiPicker editor={editor} onInsert={() => setOpenMenu(null)} />
        </div>
      </div>
    </div>
  )
}
