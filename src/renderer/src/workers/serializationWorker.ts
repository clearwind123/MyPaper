// src/renderer/src/workers/serializationWorker.ts
// md/txt 序列化 Worker：把 valueToMarkdown / nodesToTxt 的重计算移出渲染进程主线程，
// 大文档保存（30w 字 md 的 remark 序列化、大 txt 文本提取）不再冻结 UI。
// 与 docxExportWorker 同模式：主线程 postMessage，失败/超时回退主线程序列化。
// mdTool 由 createMdTool 工厂创建（与主线程 editorConvert 同一份装配，结果一致）。

import { createMdTool } from '../utils/createMdTool'
import { stripMdMarks, stripMdLiteralTags } from '../utils/mdStyleClean'
import { sanitizeValue } from '../utils/valueSanitize'
import { injectNotesForMd, restoreNotesFromMd } from '../utils/mdNotes'
import type { Value } from 'platejs'

interface SerializeRequest {
  id: number
  kind: 'md' | 'txt' | 'mdParse'
  value?: Value
  text?: string
}

interface SerializeResponse {
  id: number
  ok: boolean
  text?: string
  value?: Value
  error?: string
}

/** 序列化工具编辑器（headless，模块级单例，与主线程同一工厂） */
const mdTool = createMdTool()

function extractText(node: unknown): string {
  if (typeof node === 'object' && node !== null) {
    const n = node as { text?: string; children?: unknown[] }
    if (typeof n.text === 'string') return n.text
    if (Array.isArray(n.children)) return n.children.map(extractText).join('')
  }
  return ''
}

/** slate 节点 → 纯文本（段落间换行），与主线程 nodesToTxt 逻辑一致 */
function nodesToTxt(value: Value): string {
  return value.map(extractText).join('\n')
}

/** value → markdown（与主线程 valueToMarkdown 逻辑一致：先注入备注标记） */
function valueToMarkdown(value: Value): string {
  mdTool.tf.setValue(injectNotesForMd(value))
  return mdTool.api.markdown.serialize()
}

self.onmessage = (e: MessageEvent<SerializeRequest>) => {
  const { id, kind } = e.data
  try {
    if (kind === 'mdParse') {
      // md 打开：markdown 文本 → slate 节点（与主线程 markdownToValue 一致：
      // withoutMdx 跳过 htmlToJsx 预处理，避免反引号代码内 HTML 标签被改写截断；
      // stripMdMarks 清理残留的 fontSize/color 等 md 承载不了的 mark；
      // restoreNotesFromMd 还原「📌 备注：」标记为节点 note 属性）
      const nodes = mdTool.api.markdown.deserialize(e.data.text ?? '', {
        withoutMdx: true
      })
      const res: SerializeResponse = {
        id,
        ok: true,
        value: restoreNotesFromMd(stripMdLiteralTags(stripMdMarks(nodes as Value)))
      }
      postMessage(res)
      return
    }
    const value = e.data.value
    if (!value) throw new Error('缺少 value')
    const text = kind === 'md' ? valueToMarkdown(sanitizeValue(value)) : nodesToTxt(value)
    const res: SerializeResponse = { id, ok: true, text }
    postMessage(res)
  } catch (err) {
    const res: SerializeResponse = { id, ok: false, error: String(err) }
    postMessage(res)
  }
}
