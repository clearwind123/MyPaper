// src/renderer/src/components/dialogs/AiConfigDialog.tsx
// AI 配置对话框：与设置弹窗同款左右两列布局（左列分类导航：文字模型 / 识图模型 / 自定义提示词），
// 配置 OpenAI 兼容接口的 baseURL / API Key / 模型名 / 思考强度 / 视觉模型 / 各功能提示词

import { useState, type JSX } from 'react'
import { Bot, MessageSquareText, Image as ImageIcon, Quote } from 'lucide-react'
import { useUiStore } from '../../store/uiStore'
import { useAppStore } from '../../store/appStore'
import type { AiPrompts } from '../../../../shared/types'

/** 左侧大类导航：文字模型（文本生成）/ 识图模型（图片识别）/ 自定义提示词 */
const CATEGORIES = [
  { id: 'text', label: '文字模型', icon: MessageSquareText },
  { id: 'vision', label: '识图模型', icon: ImageIcon },
  { id: 'prompts', label: '自定义提示词', icon: Quote }
] as const

type CategoryId = (typeof CATEGORIES)[number]['id']

/** 可自定义的提示词列表（key 对应 config.ai.prompts 字段） */
const PROMPT_FIELDS: { key: keyof AiPrompts; label: string; hint: string }[] = [
  { key: 'continue', label: '续写', hint: '根据选中的文本继续写作' },
  { key: 'summarize', label: '总结', hint: '提炼选中文本的核心要点' },
  { key: 'polish', label: '润色', hint: '让表达更流畅、符合学术写作规范' },
  { key: 'translateEn', label: '翻译成英文', hint: '将选中的文本翻译为英文' },
  { key: 'translateZh', label: '翻译成中文', hint: '将选中的文本翻译为中文' }
]

export default function AiConfigDialog(): JSX.Element {
  const setAiConfigOpen = useUiStore((s) => s.setAiConfigOpen)
  const stored = useAppStore((s) => s.config)
  const setConfig = useAppStore((s) => s.setConfig)
  const [activeCat, setActiveCat] = useState<CategoryId>('text')

  const [baseUrl, setBaseUrl] = useState(stored?.ai.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(stored?.ai.apiKey ?? '')
  const [model, setModel] = useState(stored?.ai.model ?? '')
  const [temperature, setTemperature] = useState(String(stored?.ai.temperature ?? 0.7))
  const [visionModel, setVisionModel] = useState(stored?.ai.visionModel ?? '')
  const [visionApiKey, setVisionApiKey] = useState(stored?.ai.visionApiKey ?? '')
  const [visionBaseUrl, setVisionBaseUrl] = useState(stored?.ai.visionBaseUrl ?? '')
  const [prompts, setPrompts] = useState<AiPrompts>(() => ({
    continue: stored?.ai.prompts?.continue ?? '',
    summarize: stored?.ai.prompts?.summarize ?? '',
    polish: stored?.ai.prompts?.polish ?? '',
    translateEn: stored?.ai.prompts?.translateEn ?? '',
    translateZh: stored?.ai.prompts?.translateZh ?? ''
  }))

  const save = async (): Promise<void> => {
    const temp = parseFloat(temperature)
    try {
      const next = await window.api.updateConfig({
        ai: {
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          model: model.trim(),
          temperature: Number.isFinite(temp) ? Math.min(2, Math.max(0, temp)) : 0.7,
          visionModel: visionModel.trim(),
          visionApiKey: visionApiKey.trim(),
          visionBaseUrl: visionBaseUrl.trim(),
          prompts: {
            continue: prompts.continue.trim(),
            summarize: prompts.summarize.trim(),
            polish: prompts.polish.trim(),
            translateEn: prompts.translateEn.trim(),
            translateZh: prompts.translateZh.trim()
          }
        }
      })
      setConfig(next)
      setAiConfigOpen(false)
      useUiStore.getState().showToast('success', '保存成功')
    } catch (err) {
      useUiStore.getState().showToast('error', `保存失败：${String(err)}`)
    }
  }

  return (
    <div className="dialog-overlay">
      <div
        className="dialog dialog-settings ai-config-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setAiConfigOpen(false)
        }}
      >
        <div className="dialog-title">
          <span>
            <Bot size={17} className="dialog-title-icon" />
            AI 配置
          </span>
          <button className="icon-btn dialog-close" data-tip="关闭" onClick={() => setAiConfigOpen(false)}>
            ✕
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={`settings-nav-item${activeCat === c.id ? ' active' : ''}`}
                onClick={() => setActiveCat(c.id)}
              >
                <c.icon size={14} />
                <span>{c.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-body">
            {activeCat === 'text' && (
              <div className="set-section">
                <div className="set-row">
                  <span className="set-label">API 地址</span>
                  <input
                    className="dialog-input ai-set-input"
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>
                <div className="set-hint">OpenAI 兼容接口地址（baseURL），可填任意供应商</div>
                <div className="set-row">
                  <span className="set-label">API Key</span>
                  <input
                    className="dialog-input ai-set-input"
                    type="password"
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <div className="set-hint">服务商提供的密钥</div>
                <div className="set-row">
                  <span className="set-label">模型名</span>
                  <input
                    className="dialog-input ai-set-input"
                    placeholder="deepseek-v4-flash"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </div>
                <div className="set-hint">如 deepseek-v4-flash</div>
                <div className="set-row">
                  <span className="set-label">思考强度</span>
                  <input
                    className="dialog-input ai-set-input ai-set-temp"
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                  />
                </div>
                <div className="set-hint">范围 0 ~ 2，越高越有创造性</div>
                <div className="set-hint ai-set-summary">
                  推荐使用多模态 AI 模型（文字 + 识图一体），这样就无需再配置识图模型
                </div>
              </div>
            )}

            {activeCat === 'vision' && (
              <div className="set-section">
                <div className="set-row">
                  <span className="set-label">API地址</span>
                  <input
                    className="dialog-input ai-set-input"
                    placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                    value={visionBaseUrl}
                    onChange={(e) => setVisionBaseUrl(e.target.value)}
                  />
                </div>
                <div className="set-hint">可选，留空复用上方 API 地址</div>
                <div className="set-row">
                  <span className="set-label">模型名</span>
                  <input
                    className="dialog-input ai-set-input"
                    placeholder="Qwen3.7-plus"
                    value={visionModel}
                    onChange={(e) => setVisionModel(e.target.value)}
                  />
                </div>
                <div className="set-hint">留空 = 不使用 AI 识图</div>
                <div className="set-row">
                  <span className="set-label">模型API Key</span>
                  <input
                    className="dialog-input ai-set-input"
                    type="password"
                    placeholder="sk-..."
                    value={visionApiKey}
                    onChange={(e) => setVisionApiKey(e.target.value)}
                  />
                </div>
                <div className="set-hint">可选，留空复用上方 API Key</div>
                <div className="set-hint ai-set-summary">
                  填写视觉模型后，识别图片文字走 AI 视觉模型；留空则用本地 OCR 兜底。
                  视觉模型可与文字模型不同服务商（如文本用 DeepSeek、识图用百炼千问）。
                  注意：识图模式需在「设置 → 功能 → 识图方式」中选择 AI 识图才会生效。
                </div>
              </div>
            )}

            {activeCat === 'prompts' && (
              <div className="set-section">
                {PROMPT_FIELDS.map((f) => (
                  <div key={f.key}>
                    <div className="ai-prompt-row">
                      <span className="set-label">{f.label}</span>
                      <textarea
                        className="dialog-input ai-set-textarea"
                        value={prompts[f.key]}
                        onChange={(e) => setPrompts({ ...prompts, [f.key]: e.target.value })}
                      />
                    </div>
                    <div className="set-hint">{f.hint}</div>
                  </div>
                ))}
                <div className="set-hint ai-set-summary">
                  各提示词会作为 AI 的系统指令使用，留空则使用内置默认提示词；修改后点击「保存」生效。
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="dialog-actions">
          <span style={{ flex: 1 }} />
          <button className="btn-plain" onClick={() => setAiConfigOpen(false)}>
            取消
          </button>
          <button className="btn-primary" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
