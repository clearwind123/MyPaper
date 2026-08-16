// src/renderer/src/utils/editorPlugins.ts
// docx 导出序列化专用插件集（base 插件，非 /react 路径）：
// exportToDocx 的 editorPlugins 需要 base 插件（react 插件含组件 hooks，
// 静态渲染会抛 Invalid hook call；官网明确要求 base 插件）

import { BaseBasicMarksPlugin, BaseHeadingPlugin, BaseBlockquotePlugin, BaseHighlightPlugin } from '@platejs/basic-nodes'
import {
  BaseFontSizePlugin,
  BaseFontColorPlugin,
  BaseTextAlignPlugin,
  BaseTextIndentPlugin,
  BaseLineHeightPlugin,
  BaseFontFamilyPlugin,
  BaseFontWeightPlugin,
  BaseFontBackgroundColorPlugin
} from '@platejs/basic-styles'
import {
  BaseTablePlugin,
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin
} from '@platejs/table'
import { BaseImagePlugin } from '@platejs/media'
import { BaseEquationPlugin, BaseInlineEquationPlugin } from '@platejs/math'
import {
  BaseCodeBlockPlugin,
  BaseCodeLinePlugin,
  BaseCodeSyntaxPlugin
} from '@platejs/code-block'
import {
  BaseListPlugin,
  BaseBulletedListPlugin,
  BaseNumberedListPlugin,
  BaseListItemPlugin,
  BaseListItemContentPlugin
} from '@platejs/list-classic'
import { DocxExportPlugin } from '@platejs/docx-io'
import { KEYS } from 'platejs'
import {
  EquationElementDocx,
  InlineEquationElementDocx,
  CodeBlockElementDocx,
  ImageElementDocx,
  TableElementDocx,
  TableRowElementDocx,
  TableCellElementDocx,
  TableCellHeaderElementDocx,
  BlockquoteElementDocx
} from './docxComponents'

/**
 * docx 导出序列化插件集（base 版本，覆盖编辑器所有元素类型）
 * + DocxExportPlugin 覆盖公式/代码块的 DOCX 专用静态组件（官网 DocxExportKit 模式）
 */
export const DOCX_EXPORT_PLUGINS = [
  BaseBasicMarksPlugin,
  BaseHighlightPlugin,
  BaseHeadingPlugin,
  BaseBlockquotePlugin,
  BaseFontSizePlugin,
  BaseFontColorPlugin,
  BaseTextAlignPlugin,
  BaseTextIndentPlugin,
  BaseLineHeightPlugin,
  BaseFontFamilyPlugin,
  BaseFontWeightPlugin,
  BaseFontBackgroundColorPlugin,
  BaseTablePlugin,
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin,
  BaseImagePlugin,
  BaseEquationPlugin,
  BaseInlineEquationPlugin,
  BaseCodeBlockPlugin,
  BaseCodeLinePlugin,
  BaseCodeSyntaxPlugin,
  BaseListPlugin,
  BaseBulletedListPlugin,
  BaseNumberedListPlugin,
  BaseListItemPlugin,
  BaseListItemContentPlugin,
  // DOCX 专用组件：公式显示 LaTeX 源码（KaTeX 不工作于 DOCX）、代码块 pre>code 等宽、图片/表格/引用块（含备注）
  DocxExportPlugin.configure({
    override: {
      components: {
        [KEYS.equation]: EquationElementDocx,
        [KEYS.inlineEquation]: InlineEquationElementDocx,
        [KEYS.codeBlock]: CodeBlockElementDocx,
        [KEYS.img]: ImageElementDocx,
        [KEYS.table]: TableElementDocx,
        [KEYS.tr]: TableRowElementDocx,
        [KEYS.td]: TableCellElementDocx,
        [KEYS.th]: TableCellHeaderElementDocx,
        [KEYS.blockquote]: BlockquoteElementDocx
      }
    }
  })
]
