// src/renderer/src/components/dialogs/SettingsDialog.tsx
// 设置弹窗：左右两列布局（左侧大类导航 + 右侧具体设置项），白色背景；
// 覆盖个人资料、数据位置、功能（自动保存/快照/识图）、启动与新建四类设置

import { useEffect, useState, type JSX } from 'react'
import { User, FolderOpen, FolderInput, Settings, FileText, Info } from 'lucide-react'
import { useUiStore } from '../../store/uiStore'
import { useAppStore } from '../../store/appStore'
import type { AppConfig } from '../../../../shared/types'
import ExtSelect, { EXTS } from './ExtSelect'
import Mascot from '../Mascot'

/** 设置默认值（与主进程 defaultConfig 一致） */
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

/** 左侧大类导航（id 同时决定右侧渲染哪一组设置项；功能 = 自动保存 + 快照 + 识图） */
const CATEGORIES = [
  { id: 'profile', label: '个人资料', icon: User },
  { id: 'data', label: '数据位置', icon: FolderOpen },
  { id: 'features', label: '功能', icon: Settings },
  { id: 'general', label: '启动与新建', icon: FileText },
  { id: 'about', label: '关于', icon: Info }
] as const

type CategoryId = (typeof CATEGORIES)[number]['id']

/** 数据位置-子文件夹（只读展示，跟随 MyPaperData 自动移动） */
const DATA_SUBDIRS = [
  { name: 'usersData', label: '文档数据 usersData' },
  { name: 'todoList', label: '待办清单 todoList' },
  { name: 'ocrImages', label: '截屏记录 ocrImages' },
  { name: 'emojis', label: '表情包 emojis' }
] as const

/** 开关行 */
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
    <label className="set-row">
      <span className="set-label">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export default function SettingsDialog(): JSX.Element {
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const stored = useAppStore((s) => s.config)
  const setConfig = useAppStore((s) => s.setConfig)
  const avatarDataUrl = useAppStore((s) => s.avatarDataUrl)
  const setAvatarDataUrl = useAppStore((s) => s.setAvatarDataUrl)
  const [activeCat, setActiveCat] = useState<CategoryId>('profile')
  const [usersDataPath, setUsersDataPath] = useState('')
  const [version, setVersion] = useState('')
  const [nameInput, setNameInput] = useState(stored?.userName || 'User')
  const [s, setS] = useState<AppConfig['settings']>(() => ({
    ...DEFAULT_SETTINGS,
    ...(stored?.settings ?? {})
  }))
  // 是否已配置可用识图模型（识图模型或文字模型兜底，与主进程 ai:vision 一致；AI 识图模式的提示依据）
  const hasVisionModel = !!(stored?.ai.visionModel?.trim() || stored?.ai.model?.trim())

  useEffect(() => {
    void window.api.getDataDir().then(setUsersDataPath)
    void window.api.getAppVersion().then(setVersion)
  }, [])

  /** MyPaperData 目录（usersData 的父级） */
  const dataRoot = usersDataPath ? usersDataPath.replace(/[\\/]usersData$/, '') : ''

  /** 更改 MyPaperData 目录：先确认无打开标签页，整体移动后刷新显示 */
  const changeDataRoot = async (): Promise<void> => {
    if (useAppStore.getState().openFiles.length > 0) {
      useUiStore.getState().showToast('error', '请先关闭所有已打开的标签页，再更改数据目录')
      return
    }
    try {
      const res = await window.api.changeDataRoot()
      if (!res.ok) {
        if (res.canceled) return
        useUiStore.getState().showToast('error', res.error ?? '更改失败')
        return
      }
      setUsersDataPath(`${res.dataRoot}\\usersData`)
      useUiStore.getState().showToast('success', '数据目录已移动')
    } catch (err) {
      useUiStore.getState().showToast('error', `更改失败：${String(err)}`)
    }
  }

  /** 修改名字：失焦/回车时立即保存（实时更新到左侧栏） */
  const saveName = async (): Promise<void> => {
    const name = nameInput.trim()
    if (!name || name === stored?.userName) {
      setNameInput(stored?.userName || 'User')
      return
    }
    try {
      const next = await window.api.updateConfig({ userName: name.slice(0, 20) })
      setConfig(next)
      setNameInput(next.userName)
    } catch (err) {
      useUiStore.getState().showToast('error', `名字保存失败：${String(err)}`)
    }
  }

  /** 上传头像：立即复制到 userData/avatars 并保存配置；取消（config 为 null）不更新 */
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

  /** 恢复默认头像 */
  const clearAvatar = async (): Promise<void> => {
    try {
      const next = await window.api.clearAvatar()
      setConfig(next)
      setAvatarDataUrl(null)
      useUiStore.getState().showToast('success', '已恢复默认头像')
    } catch (err) {
      useUiStore.getState().showToast('error', `操作失败：${String(err)}`)
    }
  }

  const save = async (): Promise<void> => {
    const next = await window.api.updateConfig({ settings: s })
    setConfig(next)
    setSettingsOpen(false)
  }

  const restoreDefaults = (): void => {
    setS({ ...DEFAULT_SETTINGS })
  }

  return (
    <div className="dialog-overlay">
      <div
        className="dialog dialog-settings"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setSettingsOpen(false)
        }}
      >
        <div className="dialog-title">
          <span>
            <Settings size={17} className="dialog-title-icon" />
            设置
          </span>
          <button className="icon-btn dialog-close" data-tip="关闭" onClick={() => setSettingsOpen(false)}>
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
            {activeCat === 'profile' && (
              <div className="set-section">
                <div className="set-profile">
                  <div className="set-profile-row1">
                    <span className="set-label">头像</span>
                    <div className="set-profile-avatar-area">
                      <div className={`set-avatar set-profile-avatar${avatarDataUrl ? ' has-avatar' : ''}`}>
                        {avatarDataUrl ? (
                          <img className="set-avatar-img" src={avatarDataUrl} alt="" />
                        ) : null}
                      </div>
                    </div>
                    <div className="set-profile-btns">
                      <button className="btn-plain" onClick={() => void chooseAvatar()}>
                        上传头像
                      </button>
                      <button className="btn-plain" onClick={() => void clearAvatar()}>
                        恢复默认
                      </button>
                    </div>
                  </div>
                  <div className="set-profile-name">
                    <span className="set-label">名字</span>
                    <div className="set-profile-name-area">
                      <input
                        className="dialog-input set-profile-name-input"
                        value={nameInput}
                        maxLength={20}
                        placeholder="User"
                        onChange={(e) => setNameInput(e.target.value)}
                        onBlur={() => void saveName()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        }}
                      />
                    </div>
                    <div className="set-profile-name-spacer" />
                  </div>
                </div>
                <div className="set-hint">头像与名字修改后立即生效，显示在左侧栏</div>
              </div>
            )}

            {activeCat === 'data' && (
              <div className="set-section">
                <div className="set-row set-data-root">
                  <span className="set-label">MyPaperData</span>
                  <span className="set-value" data-tip={dataRoot}>
                    {dataRoot || '读取中…'}
                  </span>
                  <span className="set-row-actions">
                    <button
                      className="icon-btn"
                      data-tip="更改位置"
                      disabled={!dataRoot}
                      onClick={() => void changeDataRoot()}
                    >
                      <FolderInput size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      data-tip="在文件资源管理器中打开"
                      disabled={!dataRoot}
                      onClick={() => void window.api.openPath(dataRoot)}
                    >
                      <FolderOpen size={14} />
                    </button>
                  </span>
                </div>
                <div className="set-hint">
                  所有数据都存放在 MyPaperData 文件夹内；更改位置时整体移动，子文件夹自动跟随
                </div>
                <div className="set-data-sub">
                  {DATA_SUBDIRS.map((d) => {
                    const p = dataRoot ? `${dataRoot}\\${d.name}` : ''
                    return (
                      <div className="set-row" key={d.name}>
                        <span className="set-label">{d.label}</span>
                        <span className="set-value" data-tip={p}>
                          {p || '—'}
                        </span>
                        <button
                          className="icon-btn"
                          data-tip="在文件资源管理器中打开"
                          disabled={!p}
                          onClick={() => void window.api.openPath(p)}
                        >
                          <FolderOpen size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>
                <div className="set-hint">
                  子文件夹位置跟随 MyPaperData 自动变化，不可单独修改；更改前请先关闭所有已打开的标签页
                </div>
              </div>
            )}

            {activeCat === 'features' && (
              <>
                <div className="set-section">
                  <div className="set-row">
                    <span className="set-label">自动保存间隔（秒）</span>
                    <input
                      className="dialog-input set-input"
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
                  <div className="set-hint">
                    自动保存不会保存为快照，点击自动保存按钮会切换打开/关闭自动保存状态
                  </div>
                </div>

                <div className="set-section">
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
                    <>
                      <div className="set-row">
                        <span className="set-label">快照自动清理间隔（天）</span>
                        <input
                          className="dialog-input set-input"
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
                      <div className="set-hint">
                        超过所选天数的快照会在启动软件时自动移入系统回收站
                      </div>
                    </>
                  )}
                  <div className="set-row">
                    <span className="set-label">快照恢复位置（原位置不存在时）</span>
                    <ExtSelect
                      className="ext-select-settings"
                      value={s.snapshotRestoreTarget}
                      onChange={(v) => setS({ ...s, snapshotRestoreTarget: v })}
                      options={[
                        { value: 'original-system', label: '回到原系统根目录' },
                        { value: 'unclassified', label: '未分类' }
                      ] as const}
                    />
                  </div>
                  <div className="set-hint">原路径存在时始终恢复到原位置；此选项仅决定原路径已删除时的落点</div>
                </div>

                <div className="set-section">
                  <div className="set-row">
                    <span className="set-label">识图方式</span>
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
                  <div className={`set-hint ${s.ocrMode === 'ai' && !hasVisionModel ? 'set-hint-error' : ''}`}>
                    {s.ocrMode === 'local'
                      ? '本地 OCR 只能识别文字，免费离线；AI 识图需在此切换并配置视觉模型'
                      : hasVisionModel
                        ? 'AI 识图可识别文字和描述图片内容，需消耗 API 额度'
                        : '未配置识图模型：将使用文字模型识图（需支持多模态）；也可在 AI 配置 → 识图模型单独配置'}
                  </div>
                  <Toggle
                    label="截屏预览悬停放大"
                    checked={s.ocrZoomPreview}
                    onChange={(v) => setS({ ...s, ocrZoomPreview: v })}
                  />
                  <div className="set-hint">开启后，在截屏记录中鼠标悬停图片可放大预览</div>
                </div>
              </>
            )}

            {activeCat === 'general' && (
              <>
                <div className="set-section">
                  <div className="set-row">
                    <span className="set-label">默认新建文件后缀</span>
                    <ExtSelect
                      className="ext-select-settings"
                      value={s.defaultNewFileExt}
                      onChange={(v) => setS({ ...s, defaultNewFileExt: v })}
                      options={EXTS}
                    />
                  </div>
                  <div className="set-hint">新建文件时默认使用的文件格式</div>
                </div>

                <div className="set-section">
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
                  <div className="set-hint">
                    启动软件时自动恢复上次关闭时的工作状态；开启「记忆阅读位置」后，切换标签/关闭文件/关闭软件时记住滚动与光标位置，下次打开从上次位置继续
                  </div>
                </div>

                <div className="set-section">
                  <Toggle
                    label="启动时显示开场动画"
                    checked={s.splashEnabled}
                    onChange={(v) => setS({ ...s, splashEnabled: v })}
                  />
                  <div className="set-hint">开启后每次启动软件都会播放开场动画</div>
                </div>
              </>
            )}

            {activeCat === 'about' && (
              <div className="set-section">
                <div className="set-about">
                  {/* 200×200 mini 形象（线条版小芽精灵，动画与开场动画同款） */}
                  <div className="set-about-mascot">
                    <Mascot size={200} />
                  </div>
                  <div className="set-about-logo">MyPaper</div>
                  <div className="set-about-version">版本 {version || '…'}</div>
                  <div className="set-about-copy">© 2026 MyPaper</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="dialog-actions">
          <button className="btn-plain" onClick={restoreDefaults}>
            恢复默认设置
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn-plain" onClick={() => setSettingsOpen(false)}>
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
