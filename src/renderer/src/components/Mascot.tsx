// src/renderer/src/components/Mascot.tsx
// mini 形象（线条版小芽精灵）：与开场动画 splash.html 同款 SVG。
// 用于设置「关于」等界面展示；动画（眨眼/呼吸/叶子摆动）由 ui.css 中同名类驱动。

import type { JSX } from 'react'

export default function Mascot({ size = 200 }: { size?: number }): JSX.Element {
  return (
    <div className="mascot-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 132 132" fill="none" stroke="#2e7d52" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        {/* 头顶叶子（线条） */}
        <g className="leaf leaf-l">
          <path d="M66 40 C 62 26, 48 20, 36 24 C 40 34, 52 40, 66 40 Z" />
        </g>
        <g className="leaf leaf-r">
          <path d="M66 40 C 70 26, 84 20, 96 24 C 92 34, 80 40, 66 40 Z" />
        </g>
        {/* 小芽茎 */}
        <path d="M63.5 38 C 63.5 43, 64.5 45, 66 45 C 67.5 45, 68.5 43, 68.5 38" />
        {/* 圆脑袋（线条） */}
        <circle className="mascot-body" cx="66" cy="76" r="42" stroke="#3f8f63" />
        {/* 眼睛（实心小点 + 高光，眨眼） */}
        <g className="eye eye-l">
          <circle cx="54" cy="72" r="6.2" fill="#2e4a3a" stroke="none" />
          <circle cx="56.2" cy="70.2" r="2.2" fill="#fff" stroke="none" />
        </g>
        <g className="eye eye-r">
          <circle cx="78" cy="72" r="6.2" fill="#2e4a3a" stroke="none" />
          <circle cx="80.2" cy="70.2" r="2.2" fill="#fff" stroke="none" />
        </g>
        {/* 微笑 */}
        <path d="M56 88 Q 66 98, 76 88" />
        {/* 小脚（线条） */}
        <ellipse cx="52" cy="118" rx="8" ry="4.5" />
        <ellipse cx="80" cy="118" rx="8" ry="4.5" />
      </svg>
    </div>
  )
}
