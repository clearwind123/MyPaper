// src/renderer/src/components/dialogs/ExtSelect.tsx
// 自绘下拉（泛型）：按钮 + 弹出面板（选项悬停浅绿 --green-50、点击 --green-100，与新建文件夹颜色下拉一致）；
// 替代原生 <select>（原生弹层悬停色是系统渲染，无法定制）。
// 用于：新建文件对话框（后缀）、设置-默认新建文件后缀 / 快照恢复位置 / 识图方式

import { useEffect, useRef, useState, type JSX } from 'react'
import { ChevronDown } from 'lucide-react'

/** 可选后缀（与全局设置 defaultNewFileExt 一致） */
export const EXTS: { value: 'docx' | 'md' | 'txt'; label: string }[] = [
  { value: 'docx', label: '.docx' },
  { value: 'md', label: '.md' },
  { value: 'txt', label: '.txt' }
]

export interface ExtSelectOption<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T
  onChange: (v: T) => void
  /** 选项列表（任意字符串枚举） */
  options: ExtSelectOption<T>[]
  /** 附加类名（控制按钮在具体场景中的宽度/位置，如设置里的输入框样式） */
  className?: string
}

export default function ExtSelect<T extends string>({
  value,
  onChange,
  options,
  className
}: Props<T>): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 点击下拉外部任意处关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const label = options.find((x) => x.value === value)?.label ?? value

  return (
    <div className={`ext-select-wrap ${className ?? ''}`} ref={wrapRef}>
      <button type="button" className="ext-select-btn" onClick={() => setOpen((v) => !v)}>
        <span>{label}</span>
        <ChevronDown size={14} className="ext-select-arrow" />
      </button>
      {open && (
        <div className="ext-select-panel">
          {options.map((x) => (
            <button
              key={x.value}
              type="button"
              className={`ext-select-item ${x.value === value ? 'active' : ''}`}
              onClick={() => {
                onChange(x.value)
                setOpen(false)
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
