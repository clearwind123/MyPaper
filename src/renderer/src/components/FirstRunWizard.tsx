// src/renderer/src/components/FirstRunWizard.tsx
// 首次启动引导向导（分步版）：欢迎(功能亮点) → 个人资料+数据位置 → 功能 → 启动与新建 → AI 配置；
// 头像/名字/数据目录即时保存，设置项与 AI 配置在点「进入软件/暂不设置」时一次性写入；
// 右上 × = 关闭软件且不清除首次标记（下次打开仍显示向导）；每步切换带方向转场动画

import { useEffect, useState, type JSX } from 'react'
import {
  FolderInput,
  Upload,
  X,
  Check,
  PenLine,
  History,
  Eye,
  ScanSearch,
  Bot,
  ListTodo
} from 'lucide-react'
import { useUiStore } from '../store/uiStore'
import { useAppStore } from '../store/appStore'
import { refreshCurrentTree } from '../hooks/useFileOps'
import type { AppConfig, AiPrompts } from '../../../shared/types'
import ExtSelect, { EXTS } from './dialogs/ExtSelect'
import Mascot from './Mascot'

/** 步骤条：5 步（欢迎 / 个人资料与数据 / 功能 / 启动与新建 / AI 配置） */
const STEPS = ['欢迎', '个人资料与数据', '功能', '启动与新建', 'AI 配置'] as const

/** 欢迎页功能亮点（图标 + 名称 + 一句话） */
const FEATURES = [
  { icon: PenLine, name: '编辑器', desc: 'docx/md/txt 富文本写作' },
  { icon: History, name: '快照', desc: '随时留存版本，一键恢复' },
  { icon: Eye, name: '查看器', desc: 'PDF/表格/图片直接查看' },
  { icon: ScanSearch, name: '识图', desc: '截屏识别文字与内容' },
  { icon: Bot, name: 'AI 助手', desc: '续写、润色、翻译' },
  { icon: ListTodo, name: '待办', desc: '论文任务清单管理' }
] as const

/** 向导设置默认值（与主进程 defaultConfig 一致） */
const DEFAULT_SETTINGS: AppConfig['settings'] = {
  autoSaveInterval: 10,
  autoSaveEnabled: true,
  snapshotOnClose: true,
  ocrMode: 'local',
  ocrZoomPreview: true,
  defaultNewFileExt: 'docx',
  restoreTabs: true,
  cleanupSnapshots: false,
  snapshotCleanupDays: 30,
  snapshotRestoreTarget: 'original-system',
  autoOpenOutline: true,
  autoOpenAux: false,
  rememberPosition: true,
  splashEnabled: true
}

/** 开关行（向导风格：左标签 + 右复选框） */
function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <div className="fw-row">
      <span className="fw-label">{label}</span>
      <input type="checkbox" className="fw-check" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </div>
  )
}

export default function FirstRunWizard({ onDone }: { onDone: () => void }): JSX.Element {
  const stored = useAppStore((s) => s.config)
  const avatarDataUrl = useAppStore((s) => s.avatarDataUrl)
  const setAvatarDataUrl = useAppStore((s) => s.setAvatarDataUrl)
  const setConfig = useAppStore((s) => s.setConfig)
  // 当前步骤（0 欢迎 ~ 4 AI）与转场方向（1 前进 / -1 后退）
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const [busy, setBusy] = useState(false)
  // 退出动画中：点「进入软件/暂不设置」后先淡出再卸载（丝滑过渡进主界面）
  const [leaving, setLeaving] = useState(false)
  const [dataRoot, setDataRoot] = useState('')
  const [nameInput, setNameInput] = useState('User')
  // 设置项与 AI 配置：本地暂存，进入软件时一次性写入
  const [s, setS] = useState<AppConfig['settings']>(() => ({
    ...DEFAULT_SETTINGS,
    ...(stored?.settings ?? {})
  }))
  const [ai, setAi] = useState({
    baseUrl: stored?.ai.baseUrl ?? '',
    apiKey: stored?.ai.apiKey ?? '',
    model: stored?.ai.model ?? '',
    temperature: String(stored?.ai.temperature ?? 0.7),
    visionModel: stored?.ai.visionModel ?? '',
    visionApiKey: stored?.ai.visionApiKey ?? '',
    visionBaseUrl: stored?.ai.visionBaseUrl ?? ''
  })

  // 加载：默认数据根路径 + 已保存的头像/名字
  useEffect(() => {
    void window.api.getDataRoot().then(setDataRoot)
    void window.api.getConfig().then((cfg) => {
      if (!cfg) return
      setNameInput(cfg.userName || 'User')
      if (cfg.avatarPath) void window.api.readAvatar().then(setAvatarDataUrl)
    })
  }, [setAvatarDataUrl])

  /** 步骤切换：记录方向并跳转（已完成步骤可从步骤条点击回跳） */
  const go = (next: number): void => {
    if (busy || leaving || next === step) return
    setDir(next > step ? 1 : -1)
    setStep(next)
  }

  /** 上传头像：选择图片 → 复制到 userData/avatars 并保存配置 */
  const chooseAvatar = async (): Promise<void> => {
    try {
      const res = await window.api.chooseAvatar()
      if (!res.config) return // 取消选择
      setConfig(res.config)
      setAvatarDataUrl(res.avatarDataUrl)
      useUiStore.getState().showToast('success', '头像已更新')
    } catch (err) {
      useUiStore.getState().showToast('error', `上传头像失败：${String(err)}`)
    }
  }

  /** 保存名字：失焦/回车时立即保存 */
  const saveName = async (): Promise<void> => {
    const name = nameInput.trim()
    if (!name) {
      setNameInput('User')
      return
    }
    const cfg = await window.api.getConfig()
    if (name === cfg?.userName) return
    try {
      const next = await window.api.updateConfig({ userName: name.slice(0, 20) })
      setConfig(next)
      setNameInput(next.userName)
    } catch (err) {
      useUiStore.getState().showToast('error', `名字保存失败：${String(err)}`)
    }
  }

  /** 更改数据目录：整体移动到所选位置后刷新树（即时保存） */
  const chooseDataDir = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const res = await window.api.changeDataRoot()
      if (res.ok && res.dataRoot) {
        // 刷新页面显示的新路径（主进程已改 config.dataDir，state 不同步会导致"改了但还显示默认路径"）
        setDataRoot(res.dataRoot)
        useUiStore.getState().showToast('success', '数据目录已设置')
        await refreshCurrentTree()
      } else if (!res.canceled) {
        useUiStore.getState().showToast('error', res.error ?? '设置失败')
      }
    } catch (err) {
      useUiStore.getState().showToast('error', `设置失败：${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 退出动画：淡出 300ms 后卸载向导（进入软件） */
  const exitWithFade = (): void => {
    setLeaving(true)
    window.setTimeout(() => onDone(), 320)
  }

  /** 一次性写入向导暂存的设置 + AI 配置，然后清除首次标记进入软件 */
  const enterApp = async (): Promise<void> => {
    if (busy || leaving) return
    setBusy(true)
    try {
      const temp = parseFloat(ai.temperature)
      await window.api.updateConfig({
        settings: s,
        ai: {
          baseUrl: ai.baseUrl.trim(),
          apiKey: ai.apiKey.trim(),
          model: ai.model.trim(),
          temperature: Number.isFinite(temp) ? Math.min(2, Math.max(0, temp)) : 0.7,
          visionModel: ai.visionModel.trim(),
          visionApiKey: ai.visionApiKey.trim(),
          visionBaseUrl: ai.visionBaseUrl.trim(),
          prompts: stored?.ai.prompts ?? ({ continue: '', summarize: '', polish: '', translateEn: '', translateZh: '' } satisfies AiPrompts)
        }
      })
      await window.api.firstRunDone()
      exitWithFade()
    } catch (err) {
      useUiStore.getState().showToast('error', `保存失败：${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 暂不设置（欢迎页）：不写入设置，用默认配置直接进入软件 */
  const skip = (): void => {
    if (leaving) return
    void window.api.firstRunDone()
    useUiStore.getState().showToast('info', '数据保存在默认位置，可在设置中更改')
    exitWithFade()
  }

  return (
    <div className={`first-run-overlay${leaving ? ' leaving' : ''}`}>
      <div className="first-run-card">
        {/* 右上角关闭按钮：样式与主界面窗口控制×一致；点击 = 关闭软件（不清除首次启动标记，下次打开仍显示向导） */}
        <button
          className="win-btn win-btn-close first-run-close"
          data-tip="关闭"
          onClick={() => window.api.close()}
        >
          <X size={14} />
        </button>

        {/* 顶部步骤条（第一页欢迎不显示） */}
        {step > 0 && (
          <div className="fw-steps">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={`fw-step-item${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
                data-tip={i < step ? '点击返回' : undefined}
                onClick={() => i < step && go(i)}
              >
                <span className="fw-step-dot">{i < step ? <Check size={12} /> : i + 1}</span>
                <span className="fw-step-label">{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* 步骤内容（key 变化重新挂载触发转场动画，方向由 dir 决定） */}
        <div key={step} className={`fw-step ${dir > 0 ? 'fw-step-next' : 'fw-step-prev'}`}>
          {/* 第 1 步：欢迎（小精灵 logo + MyPaper + 功能亮点） */}
          {step === 0 && (
            <div className="fw-step-content fw-welcome">
              <div className="fw-welcome-mascot">
                <Mascot size={110} />
              </div>
              <div className="first-run-logo">MyPaper</div>
              <div className="fw-features">
                {FEATURES.map((f) => (
                  <div className="fw-feature" key={f.name}>
                    <f.icon size={18} className="fw-feature-icon" />
                    <div>
                      <div className="fw-feature-name">{f.name}</div>
                      <div className="fw-feature-desc">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 第 2 步：个人资料 + 数据位置（保持原界面样式） */}
          {step === 1 && (
            <div className="fw-step-content">
              <div className="first-run-profile">
                <div className={`first-run-avatar${avatarDataUrl ? ' has-avatar' : ''}`}>
                  {avatarDataUrl ? <img className="first-run-avatar-img" src={avatarDataUrl} alt="" /> : null}
                </div>
                <button className="btn-primary first-run-avatar-btn" disabled={busy} onClick={() => void chooseAvatar()}>
                  <Upload size={13} />
                  上传头像
                </button>
                <div className="first-run-name-row">
                  <span className="first-run-name-label">名字</span>
                  <input
                    className="dialog-input first-run-name-input"
                    value={nameInput}
                    maxLength={20}
                    placeholder="User"
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={() => void saveName()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                  />
                  <span className="first-run-name-spacer" />
                </div>
              </div>
              <div className="first-run-data">
                <div className="first-run-data-title">数据目录</div>
                <div className="first-run-data-row">
                  <span className="first-run-data-path" data-tip={dataRoot}>
                    {dataRoot || '读取中…'}
                  </span>
                  <button
                    className="icon-btn"
                    data-tip="更改位置"
                    disabled={busy || !dataRoot}
                    onClick={() => void chooseDataDir()}
                  >
                    <FolderInput size={15} />
                  </button>
                </div>
                <div className="first-run-data-desc">
                  所有文档、快照、截屏记录与待办将存放在该目录下的 MyPaperData 文件夹中
                </div>
              </div>
            </div>
          )}

          {/* 第 3 步：功能（自动保存 / 快照 / 识图） */}
          {step === 2 && (
            <div className="fw-step-content">
              <div className="fw-block">
                <div className="fw-block-title">自动保存</div>
                <div className="fw-row">
                  <span className="fw-label">自动保存间隔（秒）</span>
                  <input
                    className="dialog-input fw-input"
                    type="number"
                    min={5}
                    value={s.autoSaveInterval}
                    onChange={(e) =>
                      setS({ ...s, autoSaveInterval: Math.max(5, Number(e.target.value) || 10) })
                    }
                  />
                </div>
                <Toggle
                  label="自动保存"
                  checked={s.autoSaveEnabled}
                  onChange={(v) => setS({ ...s, autoSaveEnabled: v })}
                />
                <div className="fw-hint">
                  自动保存不会保存为快照，点击自动保存按钮会切换打开/关闭自动保存状态
                </div>
              </div>
              <div className="fw-block">
                <div className="fw-block-title">快照</div>
                <Toggle
                  label="关闭软件时自动快照"
                  checked={s.snapshotOnClose}
                  onChange={(v) => setS({ ...s, snapshotOnClose: v })}
                />
                <Toggle
                  label="快照自动清理"
                  checked={s.cleanupSnapshots}
                  onChange={(v) => setS({ ...s, cleanupSnapshots: v })}
                />
                {s.cleanupSnapshots && (
                  <div className="fw-row">
                    <span className="fw-label">快照自动清理间隔（天）</span>
                    <input
                      className="dialog-input fw-input"
                      type="number"
                      min={1}
                      step={1}
                      value={s.snapshotCleanupDays}
                      onChange={(e) =>
                        setS({
                          ...s,
                          snapshotCleanupDays: Math.max(1, Math.floor(Number(e.target.value) || 30))
                        })
                      }
                    />
                  </div>
                )}
                <div className="fw-hint">超过所选天数的快照会在启动软件时自动移入系统回收站</div>
              </div>
              <div className="fw-block">
                <div className="fw-block-title">识图</div>
                <div className="fw-row">
                  <span className="fw-label">识图方式</span>
                  <ExtSelect
                    className="ext-select-settings"
                    value={s.ocrMode}
                    onChange={(v) => setS({ ...s, ocrMode: v })}
                    options={
                      [
                        { value: 'local', label: '本地 OCR（默认）' },
                        { value: 'ai', label: 'AI 识图' }
                      ] as const
                    }
                  />
                </div>
                <div className="fw-hint">
                  本地 OCR 只能识别文字，免费离线；AI 识图需在最后一步配置视觉模型
                </div>
                <Toggle
                  label="截屏预览悬停放大"
                  checked={s.ocrZoomPreview}
                  onChange={(v) => setS({ ...s, ocrZoomPreview: v })}
                />
                <div className="fw-hint">开启后，在截屏记录中鼠标悬停图片可放大预览</div>
              </div>
            </div>
          )}

          {/* 第 4 步：启动与新建 */}
          {step === 3 && (
            <div className="fw-step-content">
              <div className="fw-block">
                <div className="fw-block-title">新建文件</div>
                <div className="fw-row">
                  <span className="fw-label">默认新建文件后缀</span>
                  <ExtSelect
                    className="ext-select-settings"
                    value={s.defaultNewFileExt}
                    onChange={(v) => setS({ ...s, defaultNewFileExt: v })}
                    options={EXTS}
                  />
                </div>
                <div className="fw-hint">新建文件时默认使用的文件格式</div>
              </div>
              <div className="fw-block">
                <div className="fw-block-title">启动恢复</div>
                <Toggle
                  label="启动恢复上次标签页"
                  checked={s.restoreTabs}
                  onChange={(v) => setS({ ...s, restoreTabs: v })}
                />
                <Toggle
                  label="启动时自动打开大纲列表"
                  checked={s.autoOpenOutline}
                  onChange={(v) => setS({ ...s, autoOpenOutline: v })}
                />
                <Toggle
                  label="启动时自动打开辅助面板"
                  checked={s.autoOpenAux}
                  onChange={(v) => setS({ ...s, autoOpenAux: v })}
                />
                <Toggle
                  label="记忆阅读位置"
                  checked={s.rememberPosition}
                  onChange={(v) => setS({ ...s, rememberPosition: v })}
                />
                <div className="fw-hint">
                  启动软件时自动恢复上次关闭时的工作状态；记忆阅读位置 = 切换/关闭文件时记住滚动与光标，下次打开从上次位置继续
                </div>
              </div>
              <div className="fw-block">
                <div className="fw-block-title">启动动画</div>
                <Toggle
                  label="启动时显示开场动画"
                  checked={s.splashEnabled}
                  onChange={(v) => setS({ ...s, splashEnabled: v })}
                />
                <div className="fw-hint">开启后每次启动软件都会播放开场动画</div>
              </div>
            </div>
          )}

          {/* 第 5 步：AI 配置（可跳过，不填则本地 OCR + 无 AI） */}
          {step === 4 && (
            <div className="fw-step-content">
              <div className="fw-block fw-ai-block">
                <div className="fw-block-title">文字模型</div>
                <div className="fw-row fw-ai-row">
                  <span className="fw-label">API 地址</span>
                  <input
                    className="dialog-input fw-input fw-ai-input"
                    placeholder="https://api.openai.com/v1"
                    value={ai.baseUrl}
                    onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
                  />
                </div>
                <div className="fw-row fw-ai-row">
                  <span className="fw-label">API Key</span>
                  <input
                    className="dialog-input fw-input fw-ai-input"
                    type="password"
                    placeholder="sk-..."
                    value={ai.apiKey}
                    onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
                  />
                </div>
                <div className="fw-row fw-ai-row">
                  <span className="fw-label">模型名</span>
                  <input
                    className="dialog-input fw-input fw-ai-input"
                    placeholder="deepseek-v4-flash"
                    value={ai.model}
                    onChange={(e) => setAi({ ...ai, model: e.target.value })}
                  />
                </div>
                <div className="fw-row fw-ai-row">
                  <span className="fw-label">思考强度</span>
                  <input
                    className="dialog-input fw-input fw-ai-input"
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={ai.temperature}
                    onChange={(e) => setAi({ ...ai, temperature: e.target.value })}
                  />
                </div>
                <div className="fw-hint">范围 0 ~ 2，越高越有创造性</div>
                <div className="fw-hint fw-hint-sum">
                  推荐使用多模态 AI 模型（文字 + 识图一体），这样就无需再配置识图模型
                </div>
              </div>
              <div className="fw-block fw-ai-block">
                <div className="fw-block-title">识图模型（可选）</div>
                <div className="fw-row fw-ai-row">
                  <span className="fw-label">API 地址</span>
                  <input
                    className="dialog-input fw-input fw-ai-input"
                    placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                    value={ai.visionBaseUrl}
                    onChange={(e) => setAi({ ...ai, visionBaseUrl: e.target.value })}
                  />
                </div>
                <div className="fw-row fw-ai-row">
                  <span className="fw-label">模型名</span>
                  <input
                    className="dialog-input fw-input fw-ai-input"
                    placeholder="Qwen3.7-plus"
                    value={ai.visionModel}
                    onChange={(e) => setAi({ ...ai, visionModel: e.target.value })}
                  />
                </div>
                <div className="fw-row fw-ai-row">
                  <span className="fw-label">模型 API Key</span>
                  <input
                    className="dialog-input fw-input fw-ai-input"
                    type="password"
                    placeholder="sk-..."
                    value={ai.visionApiKey}
                    onChange={(e) => setAi({ ...ai, visionApiKey: e.target.value })}
                  />
                </div>
                <div className="fw-hint">
                  不配置 AI 也能使用全部本地功能（本地 OCR 可识别文字）；识图方式需在「功能」步选择 AI 识图
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部导航：欢迎页 = 暂不设置 + 下一步；设置页 = 上一步（左）+ 进入软件（中，浅绿）+ 下一步（右） */}
        <div className="fw-nav">
          <div className="fw-nav-left">
            {step > 0 && (
              <button className="btn-plain" disabled={busy || leaving} onClick={() => go(step - 1)}>
                上一步
              </button>
            )}
          </div>
          {step > 0 && (
            <div className="fw-nav-center">
              <button className="btn-primary fw-enter-btn" disabled={busy || leaving} onClick={() => void enterApp()}>
                进入软件
              </button>
            </div>
          )}
          <div className="fw-nav-right">
            {step === 0 && (
              <button className="btn-plain" disabled={busy || leaving} onClick={skip}>
                暂不设置
              </button>
            )}
            {step < STEPS.length - 1 && (
              <button className="btn-primary" disabled={busy || leaving} onClick={() => go(step + 1)}>
                下一步
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
