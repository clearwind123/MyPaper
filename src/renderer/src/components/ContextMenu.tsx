// src/renderer/src/components/ContextMenu.tsx
// 通用右键菜单组件：支持图标、子菜单、危险项、点击外部关闭

import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  /** 子菜单（hover 展开） */
  children?: MenuItem[]
  separatorAfter?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const [pos, setPos] = useState({ left: x, top: y })

  // 菜单位置限制在窗口内（简单 clamp，菜单估计宽 220 / 高 320）
  useEffect(() => {
    setPos({
      left: Math.min(x, window.innerWidth - 240),
      top: Math.min(y, window.innerHeight - 340)
    })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const renderItem = (item: MenuItem, index: number): JSX.Element => {
    if (item.separatorAfter) {
      return (
        // 容器必须带 ctx-item-wrap：hover 展开子菜单（.ctx-item-wrap:hover > .ctx-submenu）
        <div className="ctx-item-wrap" key={index}>
          <button
            className={`ctx-item ${item.danger ? 'ctx-item-danger' : ''} ${
              item.disabled ? 'ctx-item-disabled' : ''
            }`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.onClick?.()
              onClose()
            }}
          >
            <span className="ctx-item-icon">{item.icon}</span>
            <span className="ctx-item-label">{item.label}</span>
            {item.children && (
              <span className="ctx-item-arrow">
                <ChevronRight size={12} />
              </span>
            )}
          </button>
          {item.children && (
            <div className="ctx-submenu">
              {item.children.map((child, childIndex) => (
                <div key={childIndex}>
                  <button
                    className={`ctx-item ${child.danger ? 'ctx-item-danger' : ''} ${
                      child.disabled ? 'ctx-item-disabled' : ''
                    }`}
                    disabled={child.disabled}
                    onClick={() => {
                      if (child.disabled) return
                      child.onClick?.()
                      onClose()
                    }}
                  >
                    <span className="ctx-item-icon">{child.icon}</span>
                    <span className="ctx-item-label">{child.label}</span>
                  </button>
                  {child.separatorAfter && <div className="ctx-sep" />}
                </div>
              ))}
            </div>
          )}
          <div className="ctx-sep" />
        </div>
      )
    }
    return (
      <div key={index} className="ctx-item-wrap">
        <button
          className={`ctx-item ${item.danger ? 'ctx-item-danger' : ''} ${
            item.disabled ? 'ctx-item-disabled' : ''
          }`}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return
            item.onClick?.()
            onClose()
          }}
        >
          <span className="ctx-item-icon">{item.icon}</span>
          <span className="ctx-item-label">{item.label}</span>
          {item.children && (
            <span className="ctx-item-arrow">
              <ChevronRight size={12} />
            </span>
          )}
        </button>
        {item.children && (
          <div className="ctx-submenu">
            {item.children.map((child, ci) => (
              <div key={ci}>
                <button
                  className={`ctx-item ${child.danger ? 'ctx-item-danger' : ''} ${
                    child.disabled ? 'ctx-item-disabled' : ''
                  }`}
                  disabled={child.disabled}
                  onClick={() => {
                    if (child.disabled) return
                    child.onClick?.()
                    onClose()
                  }}
                >
                  <span className="ctx-item-icon">{child.icon}</span>
                  <span className="ctx-item-label">{child.label}</span>
                </button>
                {child.separatorAfter && <div className="ctx-sep" />}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Portal 到 body：脱离编辑器等容器（祖先的 transform/contain 会让 fixed 定位错乱）
  return createPortal(
    <>
      <div
        className="ctx-overlay"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div className="ctx-menu" style={pos}>
        {items.map(renderItem)}
      </div>
    </>,
    document.body
  )
}
