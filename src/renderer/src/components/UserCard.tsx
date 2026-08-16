// src/renderer/src/components/UserCard.tsx
// 点击左侧头像弹出的用户资料小卡片：大头像 + 名字（上下居中排布），点击卡片外任意处关闭

import { useEffect, useRef, type JSX } from 'react'
import { useAppStore } from '../store/appStore'

/** 点击左侧头像弹出的用户资料小卡片 */
export default function UserCard({ onClose }: { onClose: () => void }): JSX.Element {
  const config = useAppStore((s) => s.config)
  const avatarDataUrl = useAppStore((s) => s.avatarDataUrl)
  const name = config?.userName || 'User'
  const cardRef = useRef<HTMLDivElement>(null)

  // 点击卡片外任意一处（含紧贴边缘/圆角外透明区）即关闭：document 级 mousedown 判定，
  // 比"overlay onClick"更可靠——overlay 方案在卡片圆角外的透明命中区会误判为卡片内
  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [onClose])

  return (
    <>
      {/* 透明遮罩：拦截点击防止穿透到下方 UI（关闭由 document 监听负责） */}
      <div className="user-card-overlay" />
      <div className="user-card" ref={cardRef}>
        <div className={`user-card-avatar${avatarDataUrl ? ' has-avatar' : ''}`}>
          {avatarDataUrl ? (
            <img className="user-card-avatar-img" src={avatarDataUrl} alt="" />
          ) : null}
        </div>
        <div className="user-card-name" data-tip={name}>
          {name}
        </div>
      </div>
    </>
  )
}
