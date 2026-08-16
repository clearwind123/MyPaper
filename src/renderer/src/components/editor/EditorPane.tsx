// src/renderer/src/components/editor/EditorPane.tsx
// 富文本编辑器面板：Plate 编辑器实例、文件加载（docx/md/txt）、内容缓存、自动保存、字数统计

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { usePlateEditor, Plate, PlateContent, PlateContainer } from 'platejs/react'
import { BoldPlugin, ItalicPlugin, UnderlinePlugin, StrikethroughPlugin, HighlightPlugin, SubscriptPlugin, SuperscriptPlugin, H1Plugin, H2Plugin, H3Plugin, H4Plugin, H5Plugin, H6Plugin, BlockquotePlugin } from '@platejs/basic-nodes/react'
import { FontSizePlugin, FontColorPlugin, TextAlignPlugin, TextIndentPlugin, LineHeightPlugin } from '@platejs/basic-styles/react'
import { MarkdownPlugin, remarkMdx } from '@platejs/markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { ImagePlugin, MediaProvider } from '@platejs/media/react'
import { TablePlugin, TableRowPlugin, TableCellPlugin, TableCellHeaderPlugin, TableProvider } from '@platejs/table/react'
import { EquationPlugin, InlineEquationPlugin } from '@platejs/math/react'
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from '@platejs/code-block/react'
import { ListPlugin, BulletedListPlugin, NumberedListPlugin, ListItemPlugin, ListItemContentPlugin } from '@platejs/list-classic/react'
import { indentListItems, unindentListItems } from '@platejs/list-classic'
import { HistoryPlugin, KEYS } from 'platejs'
import { HtmlPlugin } from '@platejs/core'
import { FindReplacePlugin } from '@platejs/find-replace'
import { SearchHighlightLeaf } from './SearchHighlightLeaf'
import { createLowlight, common } from 'lowlight'
import {
  TableElement,
  TableRowElement,
  TableCellElement,
  TableCellHeaderElement,
  ImageElement,
  EquationElement,
  InlineEquationElement,
  BlockquoteElement,
  CodeBlockElement
} from './plugins'
import { useAppStore } from '../../store/appStore'
import { useUiStore } from '../../store/uiStore'
import { readPosition } from '../../utils/positionMemory'
import { countWords, txtToNodes } from '../../utils/editorConvert'
import { saveValueToFile, parseMarkdownInWorker, parseDocxInWorker, prewarmDocxWorker } from '../../utils/editorSave'
import { logApp } from '../../utils/logger'
import { textIndentToPlate, convertVmlImages, unwrapWordImageTables, queueFileImageLoad } from '../../utils/htmlNormalize'
import { stripMdHtmlStyles } from '../../utils/mdStyleClean'
import type { Value } from 'platejs'

/** 代码块语法高亮（lowlight，common 语言集） */
const lowlight = createLowlight(common)

/** 编辑器基础插件集（阶段③基础；工具栏功能与更多插件后续轮次追加） */
const EDITOR_PLUGINS = [  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  HighlightPlugin,
  SubscriptPlugin,
  SuperscriptPlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  BlockquotePlugin.withComponent(BlockquoteElement),
  HistoryPlugin,
  FontSizePlugin,
  FontColorPlugin,
  TextAlignPlugin,
  // 首行缩进：默认只对段落 p 生效，扩展目标加入标题（h1-h4），否则标题无法缩进
  // targetPluginToInject：仿 TextAlignPlugin 官方做法，反序列化 HTML 时读 text-indent
  // 内联样式 → textIndent 节点属性（保留 Word 文档/粘贴内容的首行缩进）
  TextIndentPlugin.configure({
    inject: {
      targetPlugins: [KEYS.p, ...KEYS.heading],
      targetPluginToInject: () => ({
        parsers: {
          html: {
            deserializer: {
              parse: ({ element, node }: { element: HTMLElement; node: Record<string, unknown> }) => {
                const ti = element.style?.textIndent
                if (ti) {
                  const unit = textIndentToPlate(ti)
                  if (unit !== null) node[KEYS.textIndent] = unit
                }
              }
            }
          }
        }
      })
    }
  }),
  LineHeightPlugin,
  ImagePlugin.withComponent(ImageElement),
  ListPlugin,
  BulletedListPlugin,
  NumberedListPlugin,
  ListItemPlugin,
  ListItemContentPlugin,
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(TableRowElement),
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
  EquationPlugin.withComponent(EquationElement),
  InlineEquationPlugin.withComponent(InlineEquationElement),
  CodeBlockPlugin.configure({
    // node.component：自定义容器组件（带备注按钮），保持 pre>code 结构
    node: { component: CodeBlockElement },
    // defaultLanguage 'auto'：代码块未标注语言（lang 为空）时用 lowlight 自动识别，
    // 否则 plaintext 无 token 不产生高亮（用户反馈"没高亮"的根因）
    options: { lowlight, defaultLanguage: 'auto' }
  }),
  CodeLinePlugin,
  CodeSyntaxPlugin.configure({
    // 语法高亮修复（2026-08）：lowlight 的 hljs-* 语义类在 leaf.className 上，
    // Plate 默认 leaf 渲染会丢弃它（DOM 只有 slate-code_syntax），导致无高亮配色。
    // 通过 node.props 把 leaf.className 合并进 span 的 class，供 ui.css 的 hljs 配色命中。
    node: { props: ({ leaf }) => ({ className: leaf?.className }) }
  }),
  MarkdownPlugin.configure({
    // remarkMdx：与导出链路一致，处理 mdx 节点（否则 serialize/deserialize 遇 mdx 报错）
    options: { remarkPlugins: [remarkGfm, remarkMath, remarkMdx] }
  }),
  // 查找替换：search 选项由 FindReplacePanel 控制，匹配文本用 SearchHighlightLeaf 高亮
  FindReplacePlugin.configure({
    render: { node: SearchHighlightLeaf }
  }),
  // 粘贴 HTML 归一化（覆盖 core 默认 HtmlPlugin）：
  // ① text-indent 内联样式由 TextIndentPlugin 反序列化器读取（保留首行缩进）
  // ② Word 剪贴板 VML 图片 → <img>
  // ③ file:// 本地图片异步读文件转 data URL
  // ④ md 文件剥离 font-size/color 等 md 承载不了的 style（防保存时序列化成
  //    `<span style="...">` 字面量污染 md，见 mdStyleClean；docx 不受影响）
  HtmlPlugin.configure({
    parser: {
      format: 'text/html',
      deserialize: ({ api, data }) => {
        const doc = new DOMParser().parseFromString(data, 'text/html')
        convertVmlImages(doc.body)
        unwrapWordImageTables(doc.body)
        const st = useAppStore.getState()
        const active = st.openFiles.find((f) => f.path === st.activeFile)
        if (active && active.ext.toLowerCase() === '.md') {
          stripMdHtmlStyles(doc.body)
        }
        const fragment = api.html.deserialize({ element: doc.body })
        queueFileImageLoad()
        return fragment
      }
    }
  })
]

/** 按扩展名把文件内容转换为 slate 节点（docx 用 docx-io 导入，md 用 markdown，txt 纯文本） */

async function loadValue(path: string, ext: string): Promise<Value> {
  const { buffer } = await window.api.readFile(path)
  const e = ext.toLowerCase()

  if (e === '.docx') {
    // 空文件（新建的未命名.docx）不是合法 zip：按空文档打开
    if (buffer.length === 0) {
      return [{ type: 'p', children: [{ text: '' }] }]
    }
    // 大文件优化：mammoth 转换 + HTML 反序列化在 Worker 中执行（buffer transferable 零拷贝；
    // 自定义 styleMap / 预处理 / 缩进反序列化 / 备注还原逻辑在 docxOpenShared，两侧一致；
    // Worker 失效时自动回退主线程，功能不丢）
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer
    const nodes = await parseDocxInWorker(ab)
    // 预热 docx 导出 Worker：首次加载约 8MB 依赖（dev 下需数秒），
    // 提前加载避免关闭/保存时才创建而等待
    prewarmDocxWorker()
    return nodes
  }

  if (e === '.md') {
    const text = new TextDecoder().decode(buffer)
    // 大文件优化：md 解析（deserialize）在 Worker 中执行，大文档打开不冻结 UI
    return parseMarkdownInWorker(text)
  }

  if (e === '.txt') {
    // 大文件保护：超过 2MB 或 5 万行的 txt 不再塞进编辑器（避免卡死）
    if (buffer.length > 2 * 1024 * 1024) {
      throw new Error('txt 文件超过 2MB，为避免卡顿请用其他工具打开')
    }
    const text = new TextDecoder().decode(buffer)
    if (text.split('\n').length > 50000) {
      throw new Error('txt 文件行数超过 5 万行，为避免卡顿请用其他工具打开')
    }
    return txtToNodes(text)
  }

  // 其他类型（html/pdf 等）：不塞进编辑器（正常入口已拦截并走系统默认程序打开）
  throw new Error(`不支持在编辑器中打开 ${e || '未知'} 类型文件，请用系统默认程序打开`)
}

export default function EditorPane(): JSX.Element {
  const activeFile = useAppStore((s) => s.activeFile)
  const openFiles = useAppStore((s) => s.openFiles)
  const config = useAppStore((s) => s.config)
  // 全局视图缩放（Ctrl+滚轮调整）：作用于编辑器内容容器（CSS zoom 布局级缩放）
  const viewZoom = useAppStore((s) => s.viewZoom)
  const editor = usePlateEditor({
    plugins: EDITOR_PLUGINS,
    // 大文件优化（2026-08-08）：chunking 分块渲染。默认 chunkSize 1000 对大文档仍偏大
    // （6k 段落 = 6 chunks，每次击键重渲染 1000 段落的 chunk 仍卡）；
    // 调小到 100：6k 段落 = 60 chunks，每次击键只重渲染 1 个 chunk（100 段落）
    chunking: { chunkSize: 100 }
  })
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const loadingRef = useRef(false)

  // 注册编辑器实例供工具栏使用；卸载时清空
  useEffect(() => {
    if (editor) useAppStore.getState().setEditor(editor)
    return () => useAppStore.getState().setEditor(null)
  }, [editor])

  const active = openFiles.find((f) => f.path === activeFile) ?? null

  // 编辑器是否处于用户焦点（用户输入时编辑器必聚焦；加载/切换等程序行为不聚焦，
  // 以此区分"用户编辑"与"程序加载"，避免预览标签被误转正式）
  const editorFocusedRef = useRef(false)

  // 最近一次加载 setValue 的时间：Plate 的 onChange 是异步迟到的（StrictMode 下
  // effects 双跑、setValue 内部还会重建 value 引用），无法用引用比较拦截；
  // 改为时间窗：加载后 500ms 内的 onChange 一律视为程序回传（跳过，不标脏不转正式），
  // 真实用户输入必然发生在加载完成之后（用户先看内容、聚焦编辑器，>500ms）
  const lastLoadTimeRef = useRef(0)
  // 加载代次：快速切换标签时旧文件的异步 loadValue 完成后丢弃（不覆盖新文件内容）
  const loadGenRef = useRef(0)

  // 大文件优化（2026-08-08）：
  // ① 字数统计防抖：每次击键全树 countWords（数十万字符）会卡输入，改输入停顿 500ms 才统计；
  //    用 path 校验避免切换文件后残留 timer 覆盖新文件字数
  const wordCountTimerRef = useRef<number | null>(null)
  const wordCountPathRef = useRef<string | null>(null)
  const lastValueForCountRef = useRef<Value | null>(null)
  // ② 最近一次用户编辑时间：自动保存顺延判断（用户正在输入时跳过本轮保存，避免打断打字）
  const lastUserEditRef = useRef(0)
  // ③ selectionTick 节流：光标移动 100ms 内只通知一次（工具栏订阅 selectionTick，
  //    大文档中每次光标移动都全量重渲染工具栏 = "点击光标定位卡顿"主因）
  const lastSelectionTickRef = useRef(0)

  // 卸载时清理防抖 timer
  useEffect(
    () => () => {
      if (wordCountTimerRef.current !== null) window.clearTimeout(wordCountTimerRef.current)
    },
    []
  )

  // 卸载（切换标签/关闭标签）时保存阅读位置已移至 App 注册的 flushPosition 回调
  // （activateFile/closeFile/closeTabsUnder 事件驱动，DOM 还在时保存真实滚动值）。
  // 不能用卸载 cleanup 保存：StrictMode 挂载时模拟卸载会把 {s:0} 污染进位置记录，
  // 覆盖真实位置，导致"永远记不住位置"（2026-08-14 根因，已实测复现）。

  /** 恢复文件阅读位置（滚动 + 光标）：等 DOM 渲染稳定后分帧设置，越界静默放弃 */
  const restorePosition = useCallback((path: string): void => {
    const cfg = useAppStore.getState().config
    if (!cfg?.settings.rememberPosition) return
    const pos = readPosition(path)
    if (!pos) return
    // 竞态防护：快速切换标签时本实例的 rAF/setTimeout 可能残留，切走后必须放弃
    // （否则旧实例的 timer 会把新文件的滚动设成旧文件的位置）
    const isStillActive = (): boolean => useAppStore.getState().activeFile === path
    // 校验 Slate path 是否存在于当前文档树（防止保存的光标路径在文档结构变化后越界，
    // select 设置无效路径会在 Plate 渲染期抛 "Cannot find a descendant at path" 崩溃）
    const pathExists = (value: unknown[], p: number[]): boolean => {
      let nodes: unknown[] = value
      for (let i = 0; i < p.length; i++) {
        const idx = p[i]
        if (idx < 0 || idx >= nodes.length) return false
        const n = nodes[idx] as { children?: unknown[] }
        if (i === p.length - 1) return true
        if (!Array.isArray(n.children)) return false
        nodes = n.children
      }
      return false
    }
    // 保存滚动位置（记录上次实际设置值：chunking 渲染中内容高度不足时会被 clamp）
    let lastApplied = 0
    const applyScroll = (): void => {
      if (!isStillActive()) return
      const sc = document.querySelector<HTMLElement>('.editor-scroll')
      if (!sc) return
      sc.scrollTop = pos.s || 0
      if (pos.l) sc.scrollLeft = pos.l
      lastApplied = sc.scrollTop
    }
    // 先恢复光标（select 会触发 scroll-into-view 滚动到光标处），
    // 再等两帧覆盖滚动位置（阅读位置优先于光标位置）
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const sel = pos.sel
        const ed = useAppStore.getState().editor
        if (sel && ed && isStillActive()) {
          const value = ed.children as unknown[]
          // 光标路径越界（内容已变化）：静默放弃光标恢复，从开头阅读
          if (pathExists(value, sel.anchor.path) && pathExists(value, sel.focus.path)) {
            try {
              ed.tf.select({ anchor: sel.anchor, focus: sel.focus } as never)
            } catch {
              /* 仍失败则静默放弃 */
            }
          }
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => applyScroll())
        )
      })
    )
    // chunking 分块渲染：首屏 DOM 高度不足导致 scrollTop 被 clamp（设不上去）。
    // 500ms 后内容已长高，若用户未滚动（scrollTop 仍是上次设置值）则重设一次提升精度
    window.setTimeout(() => {
      if (!isStillActive()) return
      const sc = document.querySelector<HTMLElement>('.editor-scroll')
      if (sc && sc.scrollTop === lastApplied) {
        sc.scrollTop = pos.s || 0
        if (pos.l) sc.scrollLeft = pos.l
      }
    }, 500)
  }, [])

  /** 保存当前激活文件（成功后清除脏标记；失败返回 false 并 toast，不误报已保存） */
  const saveCurrent = useCallback(async (): Promise<boolean> => {
    if (!active) return false
    const value = useAppStore.getState().fileValues[active.path]
    if (!value) return false
    let ok = false
    try {
      ok = await saveValueToFile(active.path, active.ext, value)
    } catch (err) {
      console.error('[save] 保存异常：', err)
      useUiStore.getState().showToast('error', `保存失败：${String(err)}`)
      return false
    }
    logApp('[保存]', `${active.name} (${active.ext}) ok=${ok}`)
    if (ok) {
      useAppStore.setState((s) => ({
        dirtyPaths: { ...s.dirtyPaths, [active.path]: false }
      }))
    }
    return ok
  }, [active])

  // 加载文件：activeFile 变化时，从缓存取或读取转换。
  // 无论缓存命中与否都先显示"加载中"界面（rAF 分帧保证至少渲染一帧），
  // 大文件解析耗时较长时该界面正好覆盖卡顿期，给用户明确反馈。
  useEffect(() => {
    if (!activeFile || loadingRef.current) return
    // 从 store 取当前激活文件：不依赖 active 对象引用——之前依赖 [activeFile, active, editor]，
    // openFiles 任何变化（预览转正式/关闭标签/新建标签）都会让 active 产生新引用 → effect 重跑
    // → 重新 setValue 全量重挂载（大文档几百 ms）= "转正式卡顿"根因
    const active = useAppStore.getState().openFiles.find((f) => f.path === activeFile)
    if (!active) return
    // 加载期间置标记：setValue 会触发 onChange，不能误判为"用户编辑"（预览转正式）
    loadingRef.current = true
    setLoading(true)
    setLoadErr('')
    const gen = ++loadGenRef.current
    const raf = requestAnimationFrame(() => {
      const cached = useAppStore.getState().fileValues[active.path]
      const st = useAppStore.getState()
      if (cached) {
        logApp('[打开] 加载(缓存)', `${active.name} (${active.ext})`)
        // 取消可能残留的字数防抖 timer（避免旧文件字数覆盖新文件）
        if (wordCountTimerRef.current !== null) window.clearTimeout(wordCountTimerRef.current)
        lastLoadTimeRef.current = Date.now()
        // 引用相同则跳过（编辑器当前值就是该缓存，无需重挂载）
        if (cached !== editor.children) {
          editor.tf.setValue(cached)
          // 加载内容不计入撤销历史：撤销基线 = 加载后的内容（否则撤销会回到空文档）
          editor.history.undos = []
          editor.history.redos = []
        }
        loadingRef.current = false
        setLoading(false)
        // 切换优化：字数直接用缓存（每次切换全树 countWords 是切换卡顿来源之一）
        const cachedCount = st.wordCounts[active.path]
        useAppStore.setState({
          wordCount: cachedCount ?? countWords(cached),
          wordCounts: cachedCount
            ? st.wordCounts
            : { ...st.wordCounts, [active.path]: countWords(cached) },
          dirtyPaths: { ...st.dirtyPaths, [active.path]: false }
        })
        restorePosition(active.path)
        return
      }
      logApp('[打开] 加载(磁盘)', `${active.name} (${active.ext})`)
      void loadValue(active.path, active.ext)
        .then((nodes) => {
          // 竞态防护：期间已切换到其他文件（代次不匹配），丢弃本次结果
          if (gen !== loadGenRef.current) return
          if (wordCountTimerRef.current !== null) window.clearTimeout(wordCountTimerRef.current)
          lastLoadTimeRef.current = Date.now()
          editor.tf.setValue(nodes)
          // 加载内容不计入撤销历史：撤销基线 = 加载后的内容
          editor.history.undos = []
          editor.history.redos = []
          const wc = countWords(nodes)
          useAppStore.setState((s) => ({
            fileValues: { ...s.fileValues, [active.path]: nodes },
            wordCount: wc,
            wordCounts: { ...s.wordCounts, [active.path]: wc },
            // 加载触发的 onChange 会把文件误标脏，这里清掉
            dirtyPaths: { ...s.dirtyPaths, [active.path]: false }
          }))
          restorePosition(active.path)
        })
        .catch((err) => {
          if (gen !== loadGenRef.current) return
          setLoadErr(`打开文件失败：${String(err)}`)
        })
        .finally(() => {
          if (gen !== loadGenRef.current) return
          loadingRef.current = false
          setLoading(false)
        })
    })
    // 快速切换标签时：取消未执行的 rAF；重置标记避免新文件被误判为"加载中"而卡住
    return () => {
      cancelAnimationFrame(raf)
      loadingRef.current = false
    }
  }, [activeFile, editor])

  // 自动保存定时器
  useEffect(() => {
    if (!config?.settings.autoSaveEnabled || !active) return
    const interval = Math.max((config.settings.autoSaveInterval || 10), 5) * 1000
    const timer = setInterval(() => {
      const st = useAppStore.getState()
      if (st.dirtyPaths[active.path]) {
        // 大文件优化：用户最近 2s 内有编辑动作则顺延到下一轮，
        // 避免自动保存打断输入（保存序列化在输入间隙进行）
        if (Date.now() - lastUserEditRef.current < 2000) return
        void saveCurrent()
      }
    }, interval)
    return () => clearInterval(timer)
  }, [config, active, saveCurrent])

  // 切换优化：Plate 子树用 useMemo 隔离——onChange/onSelectionChange 闭包只依赖 refs
  // （path/isPreview），切换普通文件（isSnapshot 不变）时 Plate 子树不重渲染，
  // 避免每次切换标签都全树协调（大文档数百 ms 卡顿来源之一）
  const activePathRef = useRef('')
  const activeIsPreviewRef = useRef(false)
  activePathRef.current = active?.path ?? ''
  activeIsPreviewRef.current = active?.isPreview ?? false
  const plateReadOnly = active?.isSnapshot ?? false
  const plateTree = useMemo(
    () => (
      <MediaProvider>
        <TableProvider>
          <Plate
            editor={editor}
            readOnly={plateReadOnly}
            onSelectionChange={() => {
              // 大文件优化：光标移动 100ms 内只 bump 一次（Toolbar 订阅 selectionTick
              // 全量重渲染，频繁光标移动 = 大文档点击/移动光标卡顿主因之一）
              const now = Date.now()
              if (now - lastSelectionTickRef.current >= 100) {
                lastSelectionTickRef.current = now
                useAppStore.getState().bumpSelectionTick()
              }
            }}
            onChange={({ value }) => {
              const path = activePathRef.current
              // 程序加载（setValue）的 onChange 是异步迟到的：加载后 500ms 窗口内，
              // 无焦点的一律跳过（不标脏、不转正式、不更新缓存）——那是加载回传；
              // 有焦点 = 用户在加载完成后立即开始输入，仍正常处理（否则快速输入
              // 并切换标签时，fileValues 缓存是旧内容，输入会丢失）
              if (Date.now() - lastLoadTimeRef.current < 500 && !editorFocusedRef.current) {
                return
              }
              if (!path) return
              useAppStore.setState((s) => ({
                fileValues: { ...s.fileValues, [path]: value },
                dirtyPaths: { ...s.dirtyPaths, [path]: true }
              }))
              // 大文件优化：字数统计防抖（输入停顿 500ms 才全树统计），
              // 避免每次击键 countWords 全树扫描卡输入；path 校验防残留 timer 覆盖新文件
              lastUserEditRef.current = Date.now()
              lastValueForCountRef.current = value
              wordCountPathRef.current = path
              if (wordCountTimerRef.current !== null) window.clearTimeout(wordCountTimerRef.current)
              wordCountTimerRef.current = window.setTimeout(() => {
                const p = wordCountPathRef.current
                const v = lastValueForCountRef.current
                if (p && v && useAppStore.getState().activeFile === p) {
                  const wc = countWords(v)
                  useAppStore.setState((s) => ({
                    wordCount: wc,
                    wordCounts: { ...s.wordCounts, [p]: wc }
                  }))
                }
              }, 500)
              // 预览标签被"用户编辑"时转正式（VS Code 行为）。
              // 判断依据：编辑器有焦点 = 用户交互（输入/粘贴/格式化）；
              // 加载/切换标签时 setValue 也会触发 onChange，但编辑器无焦点，不转正式
              if (activeIsPreviewRef.current) {
                const focused = editorFocusedRef.current
                const loading = loadingRef.current
                const name =
                  useAppStore.getState().openFiles.find((f) => f.path === path)?.name ?? path
                logApp(
                  '[编辑] onChange决策',
                  `${name} focused=${focused} loading=${loading} → ${
                    focused && !loading ? '转正式' : '保持预览'
                  }`
                )
                if (focused && !loading) {
                  useAppStore.getState().promotePreview(path)
                }
              }
            }}
          >
            <PlateContainer className="editor-scroll">
              <PlateContent
                className="plate-content"
                placeholder="开始写作…"
                spellCheck={false}
              />
            </PlateContainer>
          </Plate>
        </TableProvider>
      </MediaProvider>
    ),
    [editor, plateReadOnly]
  )

  if (!editor) {
    return <div className="editor-loading">编辑器初始化中…</div>
  }

  if (!active) {
    return <></>
  }

  if (loading) {
    return <div className="editor-loading">加载中…</div>
  }

  if (loadErr) {
    return (
      <div className="editor-loading">
        {loadErr}
        <button className="btn-plain" onClick={() => setLoadErr('')}>
          关闭
        </button>
      </div>
    )
  }

  return (
    <div
      className="editor-pane"
      onFocusCapture={() => {
        editorFocusedRef.current = true
      }}
      onBlurCapture={() => {
        editorFocusedRef.current = false
      }}
      onKeyDownCapture={(e) => {
        // 输入框/文本域（备注、公式、AI 指令等）的按键不经过编辑器处理，
        // 否则 Enter/Backspace 会被下面的代码块/缩进逻辑拦截（备注输入 Enter 会误触发退出代码块）
        const tag = (e.target as HTMLElement | null)?.tagName ?? ''
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        // Tab 键 = 缩进（Word 式）：
        // 代码块内插入制表符（代码缩进）；列表内缩进/缩出列表层级；其他段落设首行缩进 +1/-1
        if (e.key === 'Tab') {
          if (editor.api.some({ match: { type: 'code_line' } as never })) {
            e.preventDefault()
            e.stopPropagation()
            editor.tf.insertText('\t')
            return
          }
          if (editor.api.some({ match: { type: 'li' } as never })) {
            e.preventDefault()
            e.stopPropagation()
            if (e.shiftKey) unindentListItems(editor)
            else indentListItems(editor)
            return
          }
          e.preventDefault()
          e.stopPropagation()
          const block = editor.api.block()
          const cur = (block?.[0]?.[KEYS.textIndent] as number | undefined) ?? 0
          if (e.shiftKey) {
            const next = Math.max(0, cur - 1)
            if (next === 0) editor.tf.unsetNodes('textIndent')
            else editor.tf.setNodes({ textIndent: next })
          } else {
            editor.tf.setNodes({ textIndent: cur + 1 })
          }
          return
        }
        if (e.key !== 'Enter' || e.shiftKey) return
        // 代码块内空行按 Enter：退出代码块（在代码块后插入空段落并聚焦）
        const codeLine = editor.api.block({ match: { type: 'code_line' } as never })
        if (codeLine) {
          const node = codeLine[0] as { children?: { text?: string }[] }
          const isEmpty =
            node.children?.length === 1 && (node.children[0].text ?? '') === ''
          if (isEmpty) {
            const codeBlock = editor.api.block({ match: { type: 'code_block' } as never })
            if (codeBlock) {
              e.preventDefault()
              e.stopPropagation()
              const nextPath = [codeBlock[1][0] + 1]
              editor.tf.insertNodes({ type: 'p', children: [{ text: '' }] }, { at: nextPath })
              editor.tf.select(nextPath)
            }
          }
        }
      }}
    >
      {/* zoom 放在 useMemo 外层的包裹 div 上：plateTree 被 useMemo 缓存（大文件优化），
          直接改内部 style 不会随 viewZoom 更新；外层 div 订阅 viewZoom 实时缩放。
          （.editor-pane > div 强制 static，不影响 .editor-scroll 的 absolute 参照） */}
      <div style={{ zoom: viewZoom }}>{plateTree}</div>
    </div>
  )
}
