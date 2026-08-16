// src/renderer/src/components/todo/TodoDatePicker.tsx
// 自绘日期选择器：绿色主题日历弹层（原生 input[type=date] 弹层内部配色无法定制，
// 自绘以统一软件 UI 风格）。支持年/月切换、今天快捷选择、选中深绿/今天浅绿描边

import { useState, type JSX } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  value: string
  onChange: (date: string) => void
}

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function toStr(y: number, m: number, d: number): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${y}-${p(m + 1)}-${p(d)}`
}

export default function TodoDatePicker({ value, onChange }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const sel = value ? new Date(`${value}T00:00:00`) : new Date()
  const [viewYear, setViewYear] = useState(sel.getFullYear())
  const [viewMonth, setViewMonth] = useState(sel.getMonth())

  const now = new Date()
  const todayStr = toStr(now.getFullYear(), now.getMonth(), now.getDate())

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const startWeekday = new Date(viewYear, viewMonth, 1).getDay()

  // 月份网格：前导空白 + 1..天数
  const cells: (number | null)[] = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const prevMonth = (): void => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1)
      setViewMonth(11)
    } else setViewMonth(viewMonth - 1)
  }

  const nextMonth = (): void => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1)
      setViewMonth(0)
    } else setViewMonth(viewMonth + 1)
  }

  const pick = (d: number): void => {
    onChange(toStr(viewYear, viewMonth, d))
    setOpen(false)
  }

  const pickToday = (): void => {
    onChange(todayStr)
    setOpen(false)
  }

  return (
    <div className="todo-datepicker">
      <button className="todo-datepicker-btn" data-tip="选择日期" onClick={() => setOpen(!open)}>
        <span>{value === todayStr ? `今天（${value}）` : value || '选择日期'}</span>
        <ChevronDown
          size={13}
          className={`todo-datepicker-caret ${open ? 'todo-datepicker-caret-open' : ''}`}
        />
      </button>
      {open && (
        <>
          <div className="todo-datepicker-mask" onClick={() => setOpen(false)} />
          <div className="todo-datepicker-panel">
            <div className="todo-datepicker-head">
              <button className="icon-btn" data-tip="上个月" onClick={prevMonth}>
                <ChevronLeft size={15} />
              </button>
              <span className="todo-datepicker-title">
                {viewYear} 年 {viewMonth + 1} 月
              </span>
              <button className="icon-btn" data-tip="下个月" onClick={nextMonth}>
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="todo-datepicker-grid">
              {WEEK_LABELS.map((w) => (
                <span key={w} className="todo-datepicker-week">
                  {w}
                </span>
              ))}
              {cells.map((d, i) =>
                d === null ? (
                  <span key={i} className="todo-datepicker-cell" />
                ) : (
                  <button
                    key={i}
                    className={`todo-datepicker-day ${
                      value === toStr(viewYear, viewMonth, d) ? 'todo-datepicker-day-selected' : ''
                    } ${
                      toStr(viewYear, viewMonth, d) === todayStr ? 'todo-datepicker-day-today' : ''
                    }`}
                    onClick={() => pick(d)}
                  >
                    {d}
                  </button>
                )
              )}
            </div>
            <div className="todo-datepicker-foot">
              <button className="todo-datepicker-today" onClick={pickToday}>
                今天
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
