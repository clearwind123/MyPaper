# MyPaper

**本地优先的论文写作桌面软件** —— 把论文写作、文档管理、版本快照、识图翻译、AI 辅助、待办管理整合在一个窗口里。文档默认只保存在你自己的电脑上（AI 联网功能除外）。

基于 **Electron + React 19 + TypeScript + Plate v53** 构建，Windows x64 平台。

## ✨ 核心特性

| 特性 | 说明 |
| --- | --- |
| **docx 无损往返** | 打开、编辑、保存 `.docx` / `.md` / `.txt`，内容与格式完整保留（首行缩进、高亮、颜色、字号、对齐等） |
| **富文本编辑器** | 基于 Plate v53：标题、列表、表格（含三线表）、图片、数学公式（KaTeX）、查找替换、大纲/辅助面板；工具栏按文件类型智能裁剪 |
| **版本快照** | 一键快照 + 关闭软件自动备份，误改误删随时恢复；支持按日期文件夹归档与自动清理 |
| **广泛文件查看** | PDF（可选中复制）、xlsx（矩形选区复制为表格）、PPT、图片、压缩包等直接查看，无需切换软件；Ctrl+滚轮全局缩放 |
| **AI 助手** | 续写、总结、润色、翻译（自定义提示词），接入任意 OpenAI 兼容接口；编辑器/查看器均可使用 |
| **识图翻译** | 截图识别文字（本地 tesseract OCR 离线可用 / AI 视觉模型），图片内容即时翻译 |
| **待办清单** | 按日期分组的待办管理，支持重要程度标记 |
| **阅读位置记忆** | 切换/关闭标签、关闭软件时记住每个文件的滚动与光标位置，下次打开从上次位置继续 |
| **本地优先** | 所有文档、快照、截屏记录、待办均存放在本地 `MyPaperData` 目录，可整体迁移 |

## 📦 安装

- **安装版**：`MyPaper-Setup-1.0.0.exe`（NSIS 向导式安装，可选安装目录，创建桌面/开始菜单快捷方式）
- **免安装版**：解压 `win-unpacked/` 目录直接运行 `MyPaper.exe`

首次启动会播放开场动画并进入 5 步引导向导：选择**数据根目录** → 自动创建 `MyPaperData/`（`usersData` 文档、`todoList` 待办、`ocrImages` 截屏、`emojis` 表情包）。

> AI 功能需自行配置 OpenAI 兼容接口（API 地址 / Key / 模型名）；除 AI 外软件完全离线运行。

## 🔧 开发

环境要求：Node.js ≥ 22、Git ≥ 2.41（补丁工具依赖）。

```powershell
# 安装依赖（postinstall 自动重打 patches 并复制 PDF/OCR 资产）
npm install

# 开发模式（HMR；主进程/preload 改动需手动重启 dev）
npm run dev

# 类型检查（node + web 两端）
npm run typecheck

# 构建（输出到 out/）
npm run build

# 打包 Windows 安装包（electron-builder + NSIS）
npm run build:win
```

## 🧱 技术栈

- **桌面框架**：Electron 43 + electron-vite 5（Vite 7）
- **界面**：React 19 + TypeScript，原生 CSS（CSS 变量，无 UI 组件库）
- **富文本编辑器**：Plate v53（npm 主包名 `platejs`）
  - docx 双向：`@platejs/docx-io`（导入底层 mammoth），4 份 patch-package 补丁保证往返保真
  - markdown 双向：`@platejs/markdown`；html 序列化：Plate HtmlPlugin
- **AI / OCR**：OpenAI 兼容接口（主进程转发防 CORS）；tesseract.js 本地 OCR（chi_sim + eng，资产本地化）
- **查看器**：pdfjs-dist（PDF）、exceljs（xlsx）、@file-viewer（其余格式）
- **状态管理**：zustand
- **打包**：electron-builder（NSIS）

## 📁 目录结构

```
src/
├── main/          # 主进程（窗口、IPC、文件系统、配置、快照、手册播种）
├── preload/       # contextBridge 暴露 window.api（含类型声明）
├── renderer/      # 渲染进程（React）
│   └── src/
│       ├── components/   # 界面组件（文件夹树/编辑器/查看器/对话框/OCR/待办）
│       ├── store/        # zustand 全局状态（appStore / uiStore）
│       ├── hooks/        # 树操作 / 文件操作 / 防抖
│       ├── workers/      # 三个 Web Worker（docx 导出 / 序列化 / docx 打开）
│       └── utils/        # 转换/序列化/位置记忆/备注往返等工具
└── shared/types.ts # 主/渲染共享类型
patches/           # patch-package 补丁（postinstall 自动重打）
scripts/           # 构建辅助脚本（复制 PDF cmaps / tesseract 资产 / 图标）
build/             # 图标、手册种子（handbook）
```

## 🛡 隐私

- 除 AI 功能外，软件**完全离线运行**：文档、OCR（本地模式）、快照均不离开你的电脑
- AI 功能调用你自行配置的 AI 服务接口，请求由本机主进程转发
- 数据目录内结构：`<数据根目录>/MyPaperData/{usersData, todoList, ocrImages, emojis}`

## 🤖 AI 辅助开发声明

本项目部分开发流程由 AI 编码助手辅助完成（代码生成、审查与修复）；所有代码均经过人工审核后合并。本项目采用 [MIT](LICENSE) 协议开源，AI 辅助生成的内容同样遵循该协议。

## 📄 License

[MIT](LICENSE) © 2026 MyPaper
