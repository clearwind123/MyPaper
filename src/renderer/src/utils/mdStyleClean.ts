// src/renderer/src/utils/mdStyleClean.ts
// md 不支持格式的清理工具（主线程 / 序列化 Worker 共用，无 DOM 依赖）：
// md 语法承载不了字号/颜色/背景色/字体/字重，这些 mark 若保留会在保存 md 时被
// @platejs/markdown 的 fontRules 序列化成 `<span style="...">` 字面量（MDX），
// 重新打开时 withoutMdx 无法还原成格式，字面量以纯文本显示在编辑器里（污染）。
// 因此：
// ① 粘贴 HTML 前剥离这些 style（md 文件才执行，docx 保留）
// ② md 反序列化后删除残留的对应 mark（对已污染文件兜底）
// 与 fontRules（@platejs/markdown）序列化的 5 个 key 保持一致：
// backgroundColor / color / fontFamily / fontSize / fontWeight

import type { Value } from 'platejs'

/** md 承载不了的文本 mark 列表（与 @platejs/markdown fontRules 的 key 一一对应） */
const MD_UNSUPPORTED_MARKS = ['fontSize', 'color', 'backgroundColor', 'fontFamily', 'fontWeight']

/** 删除文本节点上的 md 不支持 mark（原地修改，返回同一引用） */
export function stripMdMarks(value: Value): Value {
  const walk = (nodes: unknown[]): void => {
    for (const node of nodes) {
      if (typeof node !== 'object' || node === null) continue
      const n = node as { text?: string; children?: unknown[] }
      if (typeof n.text === 'string') {
        for (const key of MD_UNSUPPORTED_MARKS) {
          if (key in n) delete (n as Record<string, unknown>)[key]
        }
      } else if (Array.isArray(n.children)) {
        walk(n.children)
      }
    }
  }
  walk(value)
  return value
}

/** 剥离 HTML 元素 style 中的 md 不支持属性（粘贴前调用；root 为 DOMParser 产物） */
export function stripMdHtmlStyles(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const style = el.style
    if (!style) return
    let removed = false
    for (const prop of ['font-size', 'color', 'background-color', 'font-family', 'font-weight']) {
      if (style.getPropertyValue(prop)) {
        style.removeProperty(prop)
        removed = true
      }
    }
    // style 清空后移除 style 属性，避免残留 style="" 干扰反序列化
    if (removed && style.length === 0) el.removeAttribute('style')
  })
}

/**
 * 已污染 md 里序列化产物字面量标签的形态（@platejs/markdown 固定输出格式）：
 * - fontRules 5 种 mark：<span style="font-size: 16px;">…</span>
 *   （开标签必带 style；闭合标签 </span> 无属性，单独匹配）
 * - underline：<u>…</u>
 * withoutMdx 反序列化时这些标签无法还原成格式，以纯文本显示在编辑器里；
 * 保存时还会被转义成 \<span …> 继续写回文件（污染无法自愈）。这里按精确形态删除。
 * 开标签要求带 style（裸手写 <span> 讲解文本保留）；<u> 与闭合标签形态唯一，直接匹配
 * （误删仅损失标签本身，包裹的文字保留）。
 */
const MD_LITERAL_TAG = /^<span\s+style="[^"]*">$|^<u>$|^<\/span>$|^<\/u>$/

/**
 * 删除 value 中形如序列化产物字面量的独立文本节点（原地修改，返回同一引用）。
 * 只删非 code 文本：反引号代码（inlineCode）里的 <span> 是用户代码内容，不误伤。
 */
export function stripMdLiteralTags(value: Value): Value {
  const clean = (nodes: unknown[]): void => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i] as { text?: string; code?: boolean; children?: unknown[] }
      if (typeof node.text === 'string') {
        if (!node.code && MD_LITERAL_TAG.test(node.text)) nodes.splice(i, 1)
      } else if (Array.isArray(node.children)) {
        clean(node.children)
      }
    }
  }
  clean(value)
  return value
}
