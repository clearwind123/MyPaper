// src/renderer/src/components/editor/AiAssistantPanel.tsx
// AI 助手交互：选中文字 → 点 AI 按钮 → 命令条+功能菜单（图标+文字）→ 引用块样式预览框（浅绿、aiPreview 标记）→ 结果操作条

import { useEffect, useRef, useState, type JSX } from 'react'
import {
  ArrowLeftRight,
  ArrowUp,
  Check,
  Copy,
  FileText,
  Languages,
  ListPlus,
  PenLine,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
  X
} from 'lucide-react'
import type { Point, TRange } from 'platejs'
import { PathApi } from 'platejs'
import { useAppStore, type EditorInstance } from '../../store/appStore'
import { useUiStore } from '../../store/uiStore'
import type { AiMessage, AiCompleteResult, AiPrompts } from '../../../../shared/types'

/** 内置默认提示词（用户未自定义时使用；自定义存于 config.ai.prompts，留空 = 用默认） */
const DEFAULT_PROMPTS: AiPrompts = {
  continue:
    '你是专业的论文写作助手。根据用户提供的文本内容，以相同风格和语气自然地续写下去，保持内容连贯、逻辑合理。只输出续写的内容，不要任何解释。',
  summarize:
    '你是专业的论文写作助手。用简洁的语言总结用户提供的文本，提炼核心要点，输出条理清晰的中文总结。只输出总结内容，不要任何解释。',
  polish:
    '你是专业的论文写作助手。对用户提供的文本进行润色，使表达更流畅、用词更准确、逻辑更清晰，符合学术写作规范。保持原文意思不变，只输出润色后的文本，不要任何解释。',
  translateEn:
    '你是专业的翻译助手。将用户提供的文本翻译为英文（学术翻译，术语准确）。只输出译文，不要任何解释。',
  translateZh:
    '你是专业的翻译助手。将用户提供的文本翻译为中文（学术翻译，术语准确）。只输出译文，不要任何解释。'
}

/** 取提示词：用户自定义非空则用自定义，否则用内置默认 */
function resolvePrompt(key: keyof AiPrompts): string {
  const custom = useAppStore.getState().config?.ai.prompts?.[key]
  return custom && custom.trim() ? custom.trim() : DEFAULT_PROMPTS[key]
}

interface MenuItem {
  id: string
  label: string
  icon: typeof FileText
  system: string
}

const MENU_ITEMS: MenuItem[] = [
  {
    id: 'continue',
    label: '续写',
    icon: PenLine,
    system: DEFAULT_PROMPTS.continue
  },
  {
    id: 'summarize',
    label: '总结',
    icon: FileText,
    system: DEFAULT_PROMPTS.summarize
  },
  {
    id: 'polish',
    label: '润色',
    icon: Wand2,
    system: DEFAULT_PROMPTS.polish
  },
  {
    id: 'translate',
    label: '翻译',
    icon: Languages,
    system: DEFAULT_PROMPTS.translateEn
  }
]

type Phase = 'input' | 'generating' | 'result'

/** 判断点 a 是否在点 b 之后（用于取选区文本末尾） */
function isPointAfter(a: Point, b: Point): boolean {
  const cmp = PathApi.compare(a.path, b.path)
  if (cmp !== 0) return cmp > 0
  return a.offset > b.offset
}

/** 取选区在文本顺序上的末尾点 */
function rangeEnd(sel: TRange): Point {
  return isPointAfter(sel.anchor, sel.focus) ? sel.anchor : sel.focus
}

/** 预览节点判定：官方 blockquote 类型 + aiPreview 标记（自定义节点会被 normalize 处理，官方类型稳定） */
const isAiPreviewNode = (n: { type?: string; aiPreview?: boolean }): boolean =>
  n.type === 'blockquote' && n.aiPreview === true

/** 移除编辑器中的所有预览节点（放弃/失败/关闭时清理）。倒序遍历删除，避免路径漂移 */
function removeAllPreviews(editor: EditorInstance | null): void {
  if (!editor) return
  for (let i = editor.children.length - 1; i >= 0; i--) {
    if (isAiPreviewNode(editor.children[i] as { type?: string; aiPreview?: boolean })) {
      try {
        editor.tf.removeNodes({ at: [i] })
      } catch (e) {
        console.error('[ai] remove preview failed', e)
      }
    }
  }
}

/**
 * 在指定文本点插入预览节点（引用块样式）。
 * 注意：必须"select 定位 + 无 at 插入"，显式 at 的 insertNodes/replaceNodes 会被 normalize 破坏。
 */
function insertPreviewBlock(editor: EditorInstance, at: Point, text: string): void {
  editor.tf.select({ anchor: at, focus: at })
  editor.tf.insertNodes({ type: 'blockquote', aiPreview: true, children: [{ text }] })
}

export default function AiAssistantPanel(): JSX.Element {
  const setAiOpen = useUiStore((s) => s.setAiOpen)
  // 订阅编辑器实例：null = 查看器模式（非 docx/md/txt），AI 走页面选中文字 + 结果面板展示
  const editor = useAppStore((s) => s.editor)
  const [phase, setPhase] = useState<Phase>('input')
  const [cmd, setCmd] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [barTop, setBarTop] = useState(8)
  const [barCentered, setBarCentered] = useState(true)

  // 打开时记录的选区（替换选中用）与选中文本
  const srcSelection = useRef<TRange | null>(null)
  const srcText = useRef('')
  const insertPoint = useRef<Point | null>(null)
  const lastMessages = useRef<AiMessage[] | null>(null)
  const lastResult = useRef('')
  // 组件挂载状态：卸载后丢弃迟到的 AI 结果（不写文档、不 setState）
  const mountedRef = useRef(true)
  // 本组件是否正在生成：cleanup 只在自身请求在途时 abort，避免误杀其他 AI 请求
  // （主进程 ai:abort 已按窗口隔离，不会跨窗口误杀；同窗口内面板关闭只中止本窗口请求）
  const ownRequestRef = useRef(false)

  // 打开时：记录选区与文本，把命令条定位到选中文字下方
  useEffect(() => {
    const editorNow = useAppStore.getState().editor
    if (editorNow) {
      const sel = editorNow.selection
      if (sel) {
        srcSelection.current = sel
        const t = editorNow.api.string(sel) ?? ''
        if (t.trim()) srcText.current = t.trim()
      }
      const contentEl = document.querySelector('.workspace-content') as HTMLElement | null
      if (sel && !editorNow.api.isCollapsed() && contentEl) {
        const dom = editorNow.api.toDOMRange?.(sel)
        const rect = dom?.getBoundingClientRect()
        if (rect) {
          const crect = contentEl.getBoundingClientRect()
          const barW = 460
          const left = Math.min(Math.max(rect.left - crect.left, 8), crect.width - barW - 8)
          setBarTop(rect.bottom - crect.top + 6)
          setBarCentered(false)
          ;(document.querySelector('.ai-command-bar') as HTMLElement | null)?.style.setProperty(
            'left',
            `${left}px`
          )
        }
      }
    } else {
      // 查看器模式（无编辑器）：取页面选中的文字（PDF/HTML/文本等可选中内容）
      const selText = window.getSelection()?.toString().trim() ?? ''
      if (selText) srcText.current = selText
    }
    // 右键菜单预设动作：打开面板后直接执行对应功能（续写/总结/润色/翻译）
    const preset = useUiStore.getState().aiPresetAction
    if (preset) {
      useUiStore.getState().setAiPresetAction(null)
      const item = MENU_ITEMS.find((m) => m.id === preset)
      if (item && srcText.current) {
        void startGenerate([
          {
            role: 'system',
            content:
              item.id === 'translate'
                ? /[\u4e00-\u9fff]/.test(srcText.current)
                  ? resolvePrompt('translateEn')
                  : resolvePrompt('translateZh')
                : resolvePrompt(item.id as keyof AiPrompts)
          },
          { role: 'user', content: srcText.current }
        ])
      }
    }
    // 关闭/卸载时：中止自身请求并清理未处理的预览节点
    return () => {
      mountedRef.current = false
      if (ownRequestRef.current) window.api.aiAbort()
      removeAllPreviews(useAppStore.getState().editor)
    }
  }, [])

  /** 错误统一走标准 toast（与全应用一致；不再用 .ai-error-banner 横幅） */
  const toastErr = (msg: string): void => {
    useUiStore.getState().showToast('error', msg)
  }

  /** 执行生成：插入占位预览框 → 调 AI → 在原插入点重建带结果的预览框；
   *  查看器模式（无编辑器）：不插入文档，结果直接展示在面板中 */
  const startGenerate = async (messages: AiMessage[]): Promise<void> => {
    const editorNow = useAppStore.getState().editor
    const sel = srcSelection.current
    if (!srcText.current) {
      toastErr('请先在文档中选中文字')
      return
    }
    if (editorNow && !sel) {
      toastErr('请先在文档中选中文字')
      return
    }
    setMenuOpen(false)
    lastMessages.current = messages
    // 记录发起时上下文：await 期间用户可能切文件/关闭面板，返回后校验避免错位写入
    const fileAtStart = useAppStore.getState().activeFile
    ownRequestRef.current = true
    if (editorNow && sel) {
      const pt = rangeEnd(sel)
      insertPoint.current = pt
      try {
        insertPreviewBlock(editorNow, pt, '正在生成…')
      } catch (e) {
        console.error('[ai] insert preview failed', e)
        toastErr('预览框插入失败，请重新选中文字后重试')
        return
      }
    }
    setPhase('generating')

    // aiComplete 可能 reject（IPC 异常）：清理预览与状态，避免 UI 卡死在"正在生成…"
    let res: AiCompleteResult
    try {
      res = await window.api.aiComplete(messages)
    } catch (err) {
      ownRequestRef.current = false
      if (!mountedRef.current) return
      if (useAppStore.getState().activeFile !== fileAtStart) return
      removeAllPreviews(useAppStore.getState().editor)
      setPhase('input')
      toastErr(`AI 请求异常：${String(err)}`)
      return
    }
    ownRequestRef.current = false
    // 卸载后：丢弃结果（cleanup 已清理预览）
    if (!mountedRef.current) return
    // 生成期间切换了文件：插入点/选区属于旧文档，丢弃结果，避免错位插入或误删新文档预览
    if (useAppStore.getState().activeFile !== fileAtStart) {
      setPhase('input')
      toastErr('已切换到其他文件，本次生成结果已丢弃')
      return
    }
    const editorAfter = useAppStore.getState().editor
    if (res.ok) {
      lastResult.current = res.text ?? ''
      if (editorAfter && insertPoint.current) {
        try {
          // 删除占位预览，在原插入点重建带结果的预览框（同一已验证路径）
          removeAllPreviews(editorAfter)
          insertPreviewBlock(editorAfter, insertPoint.current, lastResult.current)
          setPhase('result')
        } catch (err2) {
          console.error('[ai] result write failed', err2)
          removeAllPreviews(editorAfter)
          setPhase('input')
          toastErr('结果写入预览框失败，请重试')
        }
      } else {
        // 查看器模式：结果不插入文档，由面板展示（可复制）
        setPhase('result')
      }
    } else {
      removeAllPreviews(editorAfter)
      setPhase('input')
      if (res.error && res.error !== '已停止') toastErr(res.error)
      else if (editorAfter && !insertPoint.current) toastErr('预览框插入失败，请重新选中文字后重试')
    }
  }

  /** 点击菜单功能 */
  const pickMenu = (item: MenuItem): void => {
    const text = srcText.current
    if (!text) {
      toastErr('请先在文档中选中文字')
      return
    }
    const system =
      item.id === 'translate'
        ? /[\u4e00-\u9fff]/.test(text)
          ? resolvePrompt('translateEn')
          : resolvePrompt('translateZh')
        : resolvePrompt(item.id as keyof AiPrompts)
    void startGenerate([
      { role: 'system', content: system },
      { role: 'user', content: text }
    ])
  }

  /** 发送自定义指令 */
  const sendCustom = (): void => {
    const text = cmd.trim()
    if (!text) return
    if (!srcText.current) {
      toastErr('请先在文档中选中文字')
      return
    }
    setCmd('')
    void startGenerate([
      {
        role: 'system',
        content: `你是论文写作助手。请严格按用户的指令处理其提供的文本，只输出处理后的文本，不要任何解释。用户指令：${text}`
      },
      { role: 'user', content: srcText.current }
    ])
  }

  /** 确认插入：删除预览框，在原插入点插入普通段落（内容保留在文档中） */
  const accept = (): void => {
    const editor = useAppStore.getState().editor
    const pt = insertPoint.current
    if (!editor || !pt) return
    try {
      removeAllPreviews(editor)
      editor.tf.select({ anchor: pt, focus: pt })
      editor.tf.insertNodes({ type: 'p', children: [{ text: lastResult.current }] })
    } catch (e) {
      console.error('[ai] accept failed', e)
      toastErr('确认插入失败，请改用替换或放弃后重试')
      return
    }
    setAiOpen(false)
  }

  /** 替换选中：先删预览框（遍历匹配，无 path 依赖），再用生成内容替换原选中的文字 */
  const replaceSelection = (): void => {
    const editor = useAppStore.getState().editor
    const sel = srcSelection.current
    if (!editor || !sel) return
    try {
      removeAllPreviews(editor)
    } catch (e) {
      console.error('[ai] remove preview failed', e)
    }
    const lines = lastResult.current.split('\n')
    editor.tf.select(sel)
    editor.tf.insertText(lines[0] ?? '')
    for (const line of lines.slice(1)) {
      editor.tf.insertBreak()
      editor.tf.insertText(line)
    }
    setAiOpen(false)
  }

  /** 放弃：删除预览框，回到输入态 */
  const discard = (): void => {
    removeAllPreviews(useAppStore.getState().editor)
    setPhase('input')
  }

  /** 重试：用同一指令重新生成 */
  const retry = (): void => {
    if (lastMessages.current) void startGenerate(lastMessages.current)
  }

  return (
    <>
      {/* 命令条：选中文字下方（或顶部居中） */}
      {phase === 'input' && (
        <div
          className={`ai-command-bar ${barCentered ? 'ai-command-bar-centered' : ''}`}
          style={barCentered ? undefined : { top: barTop }}
        >
          <Sparkles size={16} className="ai-command-spark" />
          <input
            className="ai-command-input"
            placeholder="输入创作指令或从列表中选择指令"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') sendCustom()
              if (e.key === 'Escape') setAiOpen(false)
            }}
          />
          <button className="ai-send-btn" data-tip="发送" onClick={sendCustom}>
            <ArrowUp size={14} />
          </button>
          <button
            className={`ai-menu-btn ${menuOpen ? 'ai-menu-btn-active' : ''}`}
            data-tip="功能菜单"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <ListPlus size={16} />
          </button>
          <button className="ai-close-btn" data-tip="关闭 AI 助手" onClick={() => setAiOpen(false)}>
            <X size={14} />
          </button>

          {menuOpen && (
            <div className="ai-menu">
              <div className="ai-menu-title">根据所选文字创作</div>
              {MENU_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <button key={item.id} className="ai-menu-item" onClick={() => pickMenu(item)}>
                    <Icon size={14} className="ai-menu-icon" />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 生成中：底部中央悬浮提示条 */}
      {phase === 'generating' && (
        <div className="ai-generating-bar">
          <Sparkles size={15} className="ai-command-spark" />
          <span>正在生成…</span>
          <button className="btn-plain ai-stop-btn" onClick={() => window.api.aiAbort()}>
            停止生成
          </button>
        </div>
      )}

      {/* 生成完成：底部中央悬浮操作条（预览框外部的功能按钮） */}
      {phase === 'result' && (
        <>
          {/* 查看器模式（无编辑器）：结果不插入文档，面板直接展示可选中/复制 */}
          {!editor && <div className="ai-viewer-result">{lastResult.current}</div>}
          <div className="ai-result-bar">
            {editor && (
              <button
                className="ai-pill-btn ai-pill-primary"
                data-tip="将生成内容保留在文档中（光标后）"
                onClick={accept}
              >
                <Check size={14} /> 确认插入
              </button>
            )}
            {editor && (
              <button
                className="ai-pill-btn"
                data-tip="用生成内容替换选中的文字"
                onClick={replaceSelection}
              >
                <ArrowLeftRight size={14} /> 替换选中
              </button>
            )}
            {!editor && (
              <button
                className="ai-pill-btn"
                data-tip="复制生成结果"
                onClick={() => {
                  void navigator.clipboard.writeText(lastResult.current)
                }}
              >
                <Copy size={14} /> 复制结果
              </button>
            )}
            <button className="ai-pill-btn" data-tip="重新生成" onClick={retry}>
              <RefreshCw size={14} /> 重试
            </button>
            <button className="ai-pill-btn" data-tip="放弃本次生成" onClick={discard}>
              <Trash2 size={14} /> 放弃
            </button>
          </div>
        </>
      )}
    </>
  )
}
