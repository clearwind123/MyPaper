// src/renderer/src/components/Tooltip.tsx
// 全局悬停提示组件：白底黑字、延迟显示、同一元素内位置锁定（不跟随鼠标移动）
// 通过事件委托自动识别带 data-tip 的元素：
//   data-tip="文本"              → 单行提示（按钮/图标等，内容与原 title 一致）
//   data-tip-name + data-tip-dir → 两行提示（文件/文件夹：名字含后缀 + 所在目录完整路径）
//   data-tip-size                 → 第三行提示（文件大小，仅文件显示；文件夹不挂此属性）
// 延迟与位置锁定在组件内部统一处理，调用点只需挂 data 属性。

import { useEffect, useRef, type JSX } from 'react'

const DELAY = 400 // 悬停后延迟显示（毫秒）
const PAD = 12 // 提示与鼠标的偏移距离
const EDGE = 4 // 视口边缘安全距离

interface TipEls {
  root: HTMLDivElement
  name: HTMLSpanElement
  dir: HTMLSpanElement
  size: HTMLSpanElement
}

let els: TipEls | null = null
let hoverEl: HTMLElement | null = null // 当前悬停的目标元素
let timer: ReturnType<typeof setTimeout> | null = null
let shown = false // 是否已显示（显示后锁定位置，不跟随）
let candX = 0
let candY = 0 // 延迟期间的候选位置
let lockX = 0
let lockY = 0 // 显示时的锁定位置
let cacheW = 0
let cacheH = 0

// 悬停提示第二行：文件/文件夹所在目录（完整路径去掉最后一段名字）
export function dirOf(path: string): string {
  const idx = path.lastIndexOf('\\')
  return idx > 0 ? path.slice(0, idx) : path
}

/** 文件大小格式化：B / KB / MB / GB（1024 进制，≥100 取整，其余一位小数） */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

// 读取元素上的提示内容并填入 DOM（内容变化时清空尺寸缓存）
function fillContent(el: HTMLElement): void {
  if (!els) return
  const twoLine = el.hasAttribute('data-tip-name')
  if (twoLine) {
    els.name.style.display = ''
    els.name.textContent = el.getAttribute('data-tip-name') ?? ''
    const dir = el.getAttribute('data-tip-dir') ?? ''
    if (dir) {
      els.dir.style.display = ''
      els.dir.textContent = dir
    } else {
      els.dir.style.display = 'none'
    }
  } else {
    els.name.style.display = ''
    els.name.textContent = el.getAttribute('data-tip') ?? ''
    els.dir.style.display = 'none'
  }
  // 第三行：文件大小（仅文件挂 data-tip-size，文件夹/按钮无此属性则隐藏）
  const size = el.getAttribute('data-tip-size')
  if (size) {
    els.size.style.display = ''
    els.size.textContent = size
  } else {
    els.size.style.display = 'none'
  }
  cacheW = 0
  cacheH = 0
}

function hideInternal(): void {
  clearTimer()
  hoverEl = null
  shown = false
  if (els) els.root.style.display = 'none'
}

function position(): void {
  if (!els) return
  const { root } = els
  root.style.display = 'flex'
  if (!cacheW) {
    // 先置于左上角量出真实尺寸，再按视口边缘翻转定位
    root.style.left = '0px'
    root.style.top = '0px'
    cacheW = root.offsetWidth
    cacheH = root.offsetHeight
  }
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = lockX + PAD
  let top = lockY + PAD
  if (left + cacheW > vw - EDGE) left = lockX - cacheW - PAD
  if (top + cacheH > vh - EDGE) top = lockY - cacheH - PAD
  root.style.left = `${Math.max(EDGE, left)}px`
  root.style.top = `${Math.max(EDGE, top)}px`
}

function onMove(e: MouseEvent): void {
  if (!els) return
  const target = e.target as Element | null
  const el = target?.closest<HTMLElement>('[data-tip], [data-tip-name]') ?? null
  if (!el) {
    hideInternal()
    return
  }
  if (el !== hoverEl) {
    // 进入新元素：重新延迟计时
    hoverEl = el
    shown = false
    clearTimer()
    fillContent(el)
    candX = e.clientX
    candY = e.clientY
    timer = setTimeout(() => {
      shown = true
      lockX = candX
      lockY = candY
      position()
    }, DELAY)
  } else if (!shown) {
    // 同一元素、延迟期间移动：更新候选位置（显示时用最新位置）
    candX = e.clientX
    candY = e.clientY
  }
  // shown 时：同一元素内位置锁定，不跟随鼠标
}

export default function Tooltip(): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLSpanElement>(null)
  const dirRef = useRef<HTMLSpanElement>(null)
  const sizeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    els = {
      root: rootRef.current as HTMLDivElement,
      name: nameRef.current as HTMLSpanElement,
      dir: dirRef.current as HTMLSpanElement,
      size: sizeRef.current as HTMLSpanElement
    }
    // 滚动/窗口变化/鼠标离开窗口时隐藏，避免提示错位残留
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('scroll', hideInternal, true)
    window.addEventListener('resize', hideInternal)
    window.addEventListener('mouseleave', hideInternal)
    return () => {
      clearTimer()
      els = null
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('scroll', hideInternal, true)
      window.removeEventListener('resize', hideInternal)
      window.removeEventListener('mouseleave', hideInternal)
    }
  }, [])

  return (
    <div ref={rootRef} className="mypaper-tip" style={{ display: 'none' }}>
      <span ref={nameRef} className="mypaper-tip-name" />
      <span ref={dirRef} className="mypaper-tip-dir" />
      <span ref={sizeRef} className="mypaper-tip-size" />
    </div>
  )
}
