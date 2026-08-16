// src/renderer/src/hooks/useDebouncedValue.ts
// 值防抖 hook：value 变化 delay ms 后才更新返回值。
// 用于大文档下大纲/辅助面板等派生计算：编辑器每次击键 onChange 都会产生
// 新 value 引用，直接 useMemo 会每次全树重算；防抖后输入期间不重算，
// 输入停顿才更新（最终值一致，只是显示延迟，不影响保存数据）。

import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return debounced
}
