// src/shared/types.ts
// 主进程与渲染进程共享的类型定义

export type SystemId = 'paper' | 'versions' | 'references' | 'unclassified'

/** 文件夹树节点 */
export interface TreeEntry {
  name: string
  path: string
  type: 'file' | 'folder'
  /** 文件扩展名（含点，如 .docx；文件夹为空串） */
  ext: string
  size: number
  mtimeMs: number
  /** 创建时间（树排序用：按创建时间升序，先创建的在上） */
  birthtimeMs: number
  /** 是否为快照（自身带 .snapshot.json 标记，或位于快照文件夹内——继承只读） */
  isSnapshot: boolean
  /** 是否为快照根（自身带 sidecar，可恢复/去快照标识） */
  isSnapshotRoot: boolean
  children?: TreeEntry[]
}

/** 重名冲突处理方式 */
export type ConflictResolution = 'overwrite' | 'keep-both' | 'rename'

/** 文件操作统一返回 */
export interface OpResult {
  ok: boolean
  error?: string
  /** 发生重名冲突时的目标文件名 */
  conflictName?: string
  /** 本次粘贴实际完成的移动映射（仅 cut 移动模式收集；copy 为空数组） */
  moved?: Array<{ from: string; to: string }>
}

/** 剪贴板模式 */
export type ClipboardMode = 'copy' | 'cut'

/** 可编辑文档扩展名（不含点；不可编辑的查看器文件禁止创建快照） */
export const EDITABLE_FILE_EXTS = ['docx', 'md', 'txt'] as const

/** 搜索结果 */
export interface SearchHit {
  name: string
  path: string
  systemId: SystemId
  type: 'file' | 'folder'
}

/** AI 对话消息（OpenAI 兼容格式） */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** AI 调用结果 */
export interface AiCompleteResult {
  ok: boolean
  text?: string
  error?: string
}

/** 截屏结果（桌面整屏截图 + 显示器/窗口位置，供选区裁剪换算） */
export interface ScreenshotCaptureResult {
  ok: boolean
  error?: string
  /** 整屏截图 data URL（物理像素分辨率） */
  imageDataUrl?: string
  /** 鼠标所在显示器的虚拟桌面坐标与缩放（DIP 坐标换算物理像素用） */
  display?: { x: number; y: number; scaleFactor: number }
  /** 主窗口内容区在屏幕上的位置（DIP） */
  win?: { x: number; y: number }
}

/** 快照 sidecar 标记文件（.snapshot.json）内容 */
export interface SnapshotMarker {
  version: number
  /** 快照类型：文件（旁置 sidecar）或文件夹（包内 sidecar） */
  kind: 'file' | 'folder'
  /** 创建快照时的原路径（恢复时据此寻找原位置） */
  originalPath: string
  /** 原名称（含扩展名） */
  originalName: string
  createdAt: string
}

/** 截屏识别记录（ocrHistory.json 条目） */
export interface OcrHistoryItem {
  id: string
  /** 截图图片文件名（存于 userData/ocrImages/ 下） */
  imageFile: string
  /** 识别文字（未识别为 null；已识别但纯图片/无文字为空字符串） */
  text: string | null
  /** 译文（未翻译为 null） */
  translated: string | null
  /** 创建时间 ISO 字符串 */
  createdAt: string
}

/** 截屏记录列表条目（含缩略图 data URL，主进程生成） */
export interface OcrHistoryEntry extends OcrHistoryItem {
  thumbnailDataUrl: string
}

/** 待办项（todo.json 条目，存于 <dataDir>/todoList/） */
export interface TodoItem {
  id: string
  text: string
  done: boolean
  /** 重要程度 0-2（0 普通 / 1 重要 / 2 紧急） */
  importance: number
  /** 所属日期 YYYY-MM-DD */
  date: string
  createdAt: number
}

/** AI 提示词自定义（字段留空 = 使用内置默认提示词） */
export interface AiPrompts {
  /** 续写 */
  continue: string
  /** 总结 */
  summarize: string
  /** 润色 */
  polish: string
  /** 翻译为英文 */
  translateEn: string
  /** 翻译为中文 */
  translateZh: string
}

/** 应用配置（存于 config.json） */
export interface AppConfig {  /** usersData 根目录绝对路径 */
  dataDir: string
  /** 手册播种标记：存"已播种的应用版本号"（旧格式布尔 true = 旧版已播种，升级后重新播种一次） */
  handbookSeeded?: string | boolean
  /** 用户名（默认 user） */
  userName: string
  /** 头像图片绝对路径（无则 null） */
  avatarPath: string | null
  /** AI 配置（OpenAI 兼容接口：文本读写/续写 + 可选视觉模型识图） */
  ai: {
    baseUrl: string
    apiKey: string
    model: string
    temperature: number
    /** 视觉模型名（可选，填了才走 AI 识图；留空走 tesseract.js 本地 OCR 兜底） */
    visionModel: string
    /** 视觉模型 API Key（可选，留空复用上方 apiKey） */
    visionApiKey: string
    /** 视觉模型 API 地址（可选，留空复用上方 baseUrl；视觉模型可与文本模型不同服务商） */
    visionBaseUrl: string
    /** 各功能提示词自定义（留空 = 内置默认） */
    prompts: AiPrompts
  }
  /** 全局设置项 */
  settings: {
    /** 自动保存间隔（秒，默认 10） */
    autoSaveInterval: number
    /** 自动保存总开关（默认开） */
    autoSaveEnabled: boolean
    /** 关闭软件时自动创建快照（默认开） */
    snapshotOnClose: boolean
    /** 识图方式（默认本地 OCR；AI 识图需在 AI 配置填写视觉模型） */
    ocrMode: 'local' | 'ai'
    /** 截屏预览悬停放大（默认开） */
    ocrZoomPreview: boolean
    /** 新建文件默认后缀（默认 docx） */
    defaultNewFileExt: 'docx' | 'md' | 'txt'
    /** 启动恢复上次标签页（默认开） */
    restoreTabs: boolean
    /** 快照自动清理（默认关；开启后启动软件时清理早于 snapshotCleanupDays 天的快照，进系统回收站） */
    cleanupSnapshots: boolean
    /** 快照自动清理间隔（天，默认 30） */
    snapshotCleanupDays: number
    /** 恢复快照时原路径已不存在 → 落回原系统根目录（original-system）或未分类（unclassified，默认 original-system） */
    snapshotRestoreTarget: 'original-system' | 'unclassified'
    /** 启动时自动打开大纲列表（默认开） */
    autoOpenOutline: boolean
    /** 启动时自动打开辅助面板（默认开） */
    autoOpenAux: boolean
    /** 记忆各文件阅读位置（滚动/光标；切换标签、关闭标签、关闭软件时保存，打开/切回时恢复，默认开） */
    rememberPosition: boolean
    /** 开场动画（启动 splash，默认开） */
    splashEnabled: boolean
  }
  /** 文件夹颜色映射：绝对路径 -> 颜色名（red/orange/yellow/green/cyan/blue/purple/black） */
  folderColors: Record<string, string>
  /** 文件夹树置顶条目路径（按置顶先后顺序；渲染层排序时置顶项在前） */
  pinnedPaths: string[]
  /** 独立窗口位置记忆（key → 屏幕坐标），窗口移动后保存，重开恢复 */
  windowPositions: Record<string, { x: number; y: number }>
}
