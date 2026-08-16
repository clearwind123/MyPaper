# MyAI Browser

轻量级 Windows 桌面 AI 浏览器壳 —— 把常用 AI 网站（ChatGPT、DeepSeek、豆包、Gemini…）装进一个清爽的本地窗口，支持多标签页、站点级登录隔离、下载管理，配置数据本地加密存储。

基于 **WPF + WebView2** 构建（.NET 8）。

---

## ✨ 功能特性

- **多标签页**：每个标签页独立 WebView2 实例，切换不丢页面状态；支持 `Ctrl+T` 新建、`Ctrl+W` 关闭
- **AI 站点栏**：左侧快捷访问 ChatGPT / DeepSeek / 豆包 / Gemini，可自由添加、编辑、删除站点（右键菜单）
- **自建起始页**：内置静态首页（Logo + 标题），不依赖任何第三方页面
- **站点级登录隔离**：每个站点使用独立 WebView2 档案，Cookie / 登录态 / 缓存完全隔离，互不串号
- **下载管理**：接管网页下载，底部状态栏实时显示进度，可取消，保存到指定目录（默认"下载"文件夹）
- **网络代理**：跟随系统代理 / 手动代理 / 禁用代理 三种模式，解决 WebView2 偶发不走系统代理的问题
- **页面缩放**：默认 80%，支持 `Ctrl+滚轮` 缩放、触控板捏合
- **清除浏览数据**：设置中一键清除所有站点的 Cookie、缓存与登录状态
- **本地加密存储**：站点列表与配置使用 Windows DPAPI 加密（当前用户级）；登录态由 WebView2 运行时以 DPAPI 加密保存

---

## 🚀 快速开始

1. 解压本包到任意目录（如 `D:\MyAI Browser`）
2. 双击 **`MyAI Browser.exe`** 启动（无需安装）
3. 首次使用：在左侧站点栏点击站点打开，**每个站点登录一次**（独立档案，互不影响）
4. 在 ⚙ 设置中可配置代理、下载目录、清除浏览数据

### 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+T` | 新建标签页 |
| `Ctrl+W` | 关闭当前标签页 |
| `Ctrl+L` | 聚焦地址栏 |
| `F5` | 刷新当前页面 |
| `Ctrl+滚轮` | 页面缩放 |

---

## 💻 系统要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11（x64） |
| .NET 运行时 | **.NET 8 桌面运行时**（Desktop Runtime） |
| WebView2 运行时 | Windows 11 自带；Windows 10 通常已预装（装过新版 Edge 即有），缺失时需单独安装 |

### 如果缺少组件会怎样？

- **缺少 .NET 8 桌面运行时**：双击 exe 后系统弹出"需要安装 .NET Desktop Runtime"的提示，安装后即可运行。Win10/11 默认都不自带 .NET 8，换新电脑时这一步基本必做。
- **缺少 WebView2 运行时**：软件窗口能打开，但标签页报"初始化失败"、网页空白。Win11 已自带，Win10 装过 Edge 也基本都有。

### 安装地址（均免费）

- .NET 8 桌面运行时：https://dotnet.microsoft.com/zh-cn/download/dotnet/8.0 （选 ".NET Desktop Runtime 8.0.x"）
- WebView2 运行时：https://developer.microsoft.com/microsoft-edge/webview2/ （Evergreen 常青版）

---

## 📁 数据与隐私

- **数据目录**：`%LOCALAPPDATA%\MyAIBrowser\`
  - `sites.json` / `settings.json` —— 站点列表与代理配置（**DPAPI 加密**）
  - `WebView2\` —— 默认档案（起始页/地址栏标签共用）
  - `Profiles\<站点ID>\` —— 各站点独立档案（登录态、Cookie）
- **隐私**：本软件**无任何遥测、统计、云同步**，不向任何服务器上报数据
- **账号安全**：登录态由 WebView2（Chromium 内核）以 Windows DPAPI 加密存储，与 Edge 同级别

---

## ⚠️ 使用提示

- **登录建议**：建议把本软件当作"一个固定设备"使用，不要与日常浏览器频繁切换登录同一账号，避免触发网站风控
- **代理**：若使用 Clash / v2rayN 等代理软件，建议在 ⚙ 设置中选择"跟随系统代理"或手动填写代理地址（如 `127.0.0.1:7890`），改代理后需按提示重启应用生效
- **清除浏览数据**：会清除所有站点登录状态，执行后需重新登录
- **杀毒软件提示**：本程序未做代码签名，部分杀毒软件（尤其 360 / 火绒）首次运行时可能提示"允许"——放行一次即可。程序启动的 msedgewebview2.exe 是微软官方签名组件，可放心放行。若压缩包来自浏览器下载，建议解压前右键 → 属性 → 勾选"解除锁定"

---

## 🛠️ 开发者构建

环境：Windows + .NET 8 SDK

```bash
# Debug 构建
dotnet build MyAIBrowser.csproj

# Release 发布（框架依赖，需目标机安装 .NET 8 桌面运行时）
dotnet build MyAIBrowser.csproj -c Release

# 自包含单文件发布（无需目标机安装 .NET，约 150MB，需要联网下载运行时包）
dotnet publish MyAIBrowser.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

---

## 📌 版本

v1.0.0 · 2026
