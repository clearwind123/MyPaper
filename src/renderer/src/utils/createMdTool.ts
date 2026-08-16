// src/renderer/src/utils/createMdTool.ts
// markdown 序列化工具编辑器工厂（headless，不渲染，无 DOM 依赖）：
// 主线程（editorConvert）与序列化 Worker（serializationWorker）共用同一份装配，
// 保证两侧 serialize/deserialize 结果完全一致。
// 必须注册与编辑器一致的基础节点插件（段落/标题/列表/引用块/代码块/hr）：
// 否则 deserialize 生成的节点类型（list/listItem 等）与 serialize 识别的类型
// 不匹配，保存 md 时会静默丢失列表等内容（曾导致 md 文件保存后缩水 30%+）。

import { createPlateEditor } from 'platejs/react'
import { MarkdownPlugin, remarkMdx } from '@platejs/markdown'
import {
  BaseBasicBlocksPlugin,
  BaseBasicMarksPlugin,
  BaseBlockquotePlugin,
  BaseCodePlugin,
  BaseHorizontalRulePlugin
} from '@platejs/basic-nodes'
import {
  BaseListPlugin,
  BaseBulletedListPlugin,
  BaseNumberedListPlugin,
  BaseListItemPlugin,
  BaseListItemContentPlugin
} from '@platejs/list-classic'
import { BaseCodeBlockPlugin, BaseCodeLinePlugin } from '@platejs/code-block'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

/** 创建 markdown 转换工具编辑器（每次调用返回独立实例） */
export function createMdTool() {
  return createPlateEditor({
    plugins: [
      BaseBasicBlocksPlugin,
      BaseBasicMarksPlugin,
      BaseBlockquotePlugin,
      BaseCodePlugin,
      BaseHorizontalRulePlugin,
      BaseListPlugin,
      BaseBulletedListPlugin,
      BaseNumberedListPlugin,
      BaseListItemPlugin,
      BaseListItemContentPlugin,
      BaseCodeBlockPlugin,
      BaseCodeLinePlugin,
      MarkdownPlugin.configure({
        // remarkMdx：官方要求，处理 mdx 节点（mdxJsxTextElement 等），否则 serialize 报错
        options: {
          remarkPlugins: [remarkGfm, remarkMath, remarkMdx],
          // image 序列化规则：@platejs/markdown 内置规则键是 mdast 名 'img'，
          // 而 serialize dispatch 按 plate 类型 'image' 查规则 → 查不到走 unreachable 报错输出空。
          // 通过 options.rules（优先级最高）补上 image → mdast image，remark-stringify 输出 ![alt](url)
          rules: {
            image: {
              serialize: (node) => ({
                children: [
                  {
                    alt: node.alt ?? '',
                    title: typeof node.title === 'string' ? node.title : void 0,
                    type: 'image',
                    url: node.url
                  }
                ],
                type: 'paragraph'
              })
            }
          }
        }
      })
    ]
  })
}
