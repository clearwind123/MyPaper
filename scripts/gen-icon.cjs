// 生成应用图标：build/icon.svg → 多尺寸 PNG → build/icon.ico / build/installer.ico
// 两个图标用途不同（2026-08-09 打包踩坑定案）：
// - icon.ico（exe 图标）：electron-builder rcedit 要求 ≥256px，BMP DIB 格式
//   （PNG 压缩 ICO 嵌入 exe 后 Windows ExtractIconEx 提取不到 → 显示默认图标）
// - installer.ico（NSIS 安装/卸载程序图标）：BMP DIB 格式 + 192px 封顶
//   （png-to-ico 未压缩 32bpp：256px 单张 256KB 超 NSIS 约 256KB 限制）
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

async function main() {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'))
  const toPng = (size) =>
    sharp(svg).resize(size, size).png({ palette: true, colors: 256, compressionLevel: 9 }).toBuffer()
  const png256 = await toPng(256)
  const png192 = await toPng(192)
  const png128 = await toPng(128)
  const png64 = await toPng(64)
  const png48 = await toPng(48)
  const png32 = await toPng(32)
  const png16 = await toPng(16)
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), png256)
  // 坑（2026-08-09 实测）：PNG 压缩 ICO（手写容器）嵌入 exe 后 Windows
  // ExtractIconEx 提取不到图标 → 资源管理器显示默认图标。必须 BMP DIB 格式。
  // exe 图标（icon.ico）与 NSIS 图标（installer.ico）都用 png-to-ico（BMP）：
  // - icon.ico 含 256px 帧（electron-builder 检查 exe 图标必须 ≥256px；BMP 大小
  //   不限——NSIS 的 256KB 限制只针对 installerIcon）
  // - installer.ico 192px 封顶（NSIS 限制 <256KB）
  const pngToIco = (await import('png-to-ico')).default
  const ico = await pngToIco([png256, png128, png64, png48, png32, png16])
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), ico)
  const installerIco = await pngToIco([png192, png128, png48, png32, png16])
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'installer.ico'), installerIco)
  console.log(
    '已生成: icon.ico (BMP 256px)',
    Math.round(ico.length / 1024),
    'KB / installer.ico (BMP 192px)',
    Math.round(installerIco.length / 1024),
    'KB'
  )
}

main().catch((e) => { console.error('失败:', e); process.exit(1) })
