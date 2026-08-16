// src/renderer/src/components/todo/TodoWindow.tsx
// 待办清单窗口根组件（#todo 入口，独立窗口，无边框自绘标题栏）：
// 标题栏：待办清单（图标+文字）+ 置顶/最小化/最大化/关闭；
// 主体：按日期分组（今天/昨天/日期）的待办列表，支持添加（日期+重要程度）、
// 完成勾选、重要程度切换（普通/重要/紧急）、删除

import { useEffect, useMemo, useState, type JSX } from 'react'
import { CheckCheck, ChevronDown, ClipboardList, Minus, Pin, PinOff, Search, Square, Trash2, X } from 'lucide-react'
import TodoDatePicker from './TodoDatePicker'
import ConfirmDialog from '../dialogs/ConfirmDialog'
import { useUiStore } from '../../store/uiStore'
import type { TodoItem } from '../../../../shared/types'

/** 今日日期 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 日期分组标题：今天/昨天/日期 */
function dateLabel(date: string): string {
  const today = todayStr()
  if (date === today) return `今天（${date}）`
  const y = new Date()
  y.setDate(y.getDate() - 1)
  const p = (n: number): string => String(n).padStart(2, '0')
  const yest = `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`
  if (date === yest) return `昨天（${date}）`
  return date
}

/** 重要程度文案与样式等级 */
const IMP_LABELS = ['普通', '重要', '紧急']

export default function TodoWindow(): JSX.Element {
  const [items, setItems] = useState<TodoItem[]>([])
  const [text, setText] = useState('')
  const [date, setDate] = useState(todayStr())
  const [importance, setImportance] = useState(0)
  const [pinned, setPinned] = useState(false)
  // 搜索
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  // 分组折叠（折叠的日期集合）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    void window.api.todoList().then(setItems)
  }, [])

  const save = (next: TodoItem[]): void => {
    setItems(next)
    void window.api.todoSave(next)
  }

  const add = (): void => {
    const t = text.trim()
    if (!t) return
    const item: TodoItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: t,
      done: false,
      importance,
      date,
      createdAt: Date.now()
    }
    save([...items, item])
    setText('')
  }

  const toggleDone = (id: string): void => {
    save(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)))
  }

  const cycleImportance = (id: string): void => {
    save(items.map((i) => (i.id === id ? { ...i, importance: (i.importance + 1) % 3 } : i)))
  }

  const remove = (id: string): void => {
    save(items.filter((i) => i.id !== id))
  }

  // 某日期组的全部完成 / 全部删除
  const markAllDone = (d: string): void => {
    save(items.map((i) => (i.date === d ? { ...i, done: true } : i)))
  }

  const removeGroup = (d: string): void => {
    // 整组删除不可撤销：先确认再删
    const count = items.filter((i) => i.date === d).length
    useUiStore.getState().showConfirm(
      `确定删除 ${d} 的全部 ${count} 条待办吗？此操作不可撤销。`,
      () => save(items.filter((i) => i.date !== d))
    )
  }

  const toggleGroup = (d: string): void => {
    setCollapsed((prev) => {
      const s = new Set(prev)
      if (s.has(d)) s.delete(d)
      else s.add(d)
      return s
    })
  }

  // 搜索过滤 + 按日期分组（新日期在上），组内按创建时间
  const filtered = useMemo(() => {
    const q = searchText.trim()
    return q ? items.filter((i) => i.text.includes(q)) : items
  }, [items, searchText])

  const groups = useMemo(() => {
    const map = new Map<string, TodoItem[]>()
    for (const item of filtered) {
      const arr = map.get(item.date) ?? []
      arr.push(item)
      map.set(item.date, arr)
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(
        ([d, list]) =>
          [d, list.sort((a, b) => a.createdAt - b.createdAt)] as [string, TodoItem[]]
      )
  }, [filtered])

  return (
    <div className="todo-window">
      {/* 自绘标题栏（无边框窗口，与主窗口/截屏统计窗口风格一致） */}
      <div className="todo-titlebar">
        <span className="todo-title">
          <ClipboardList size={16} className="todo-title-icon" />
          待办清单
        </span>
        <span className="todo-winbtns">
          <button
            className={`win-btn ${pinned ? 'win-btn-pinned' : ''}`}
            data-tip={pinned ? '取消置顶' : '置顶窗口'}
            onClick={() => {
              setPinned(!pinned)
              window.api.toggleAlwaysOnTop()
            }}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button className="win-btn" data-tip="最小化" onClick={() => window.api.minimize()}>
            <Minus size={14} />
          </button>
          <button className="win-btn" data-tip="最大化" onClick={() => window.api.toggleMaximize()}>
            <Square size={13} />
          </button>
          <button className="win-btn win-btn-close" data-tip="关闭" onClick={() => window.api.close()}>
            <X size={15} />
          </button>
        </span>
      </div>

      <div className="todo-body">
        {/* 添加区：日期+重要程度一行；文字输入+添加一行 */}
        <div className="todo-add">
          <div className="todo-add-meta">
            <TodoDatePicker value={date} onChange={setDate} />
            <span className="todo-add-imp-label">重要程度：</span>
            {IMP_LABELS.map((label, idx) => (
              <button
                key={label}
                className={`todo-imp-btn ${importance === idx ? `todo-imp-btn-active todo-imp-btn-${idx}` : ''}`}
                onClick={() => setImportance(idx)}
              >
                {label}
              </button>
            ))}
            <button
              className={`icon-btn todo-search-btn ${searchOpen ? 'todo-search-btn-active' : ''}`}
              data-tip="搜索待办"
              onClick={() => setSearchOpen(!searchOpen)}
            >
              <Search size={15} />
            </button>
          </div>
          {searchOpen && (
            <div className="todo-search">
              <input
                className="todo-search-input"
                type="text"
                placeholder="搜索待办内容…"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                autoFocus
              />
              <button
                className="icon-btn"
                data-tip="清除搜索"
                onClick={() => {
                  setSearchText('')
                  setSearchOpen(false)
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="todo-add-row">
            <input
              className="todo-add-text"
              type="text"
              placeholder="添加待办事项，回车确认…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add()
              }}
            />
            <button className="btn-primary todo-add-btn" onClick={add}>
              添加
            </button>
          </div>
        </div>

        {/* 按日期分组列表 */}
        <div className="todo-list">
          {groups.length === 0 ? (
            <div className="todo-empty">
              <span className="todo-empty-icon" />
              <span className="todo-empty-text">
                {searchText.trim() ? '没有找到匹配的待办' : '暂无待办，添加一条吧'}
              </span>
            </div>
          ) : (
            groups.map(([d, list]) => (
              <div key={d} className="todo-group">
                <div className="todo-group-header">
                  <button
                    className="todo-group-title"
                    data-tip="展开/收起"
                    onClick={() => toggleGroup(d)}
                  >
                    <ChevronDown
                      size={14}
                      className={`todo-group-caret ${collapsed.has(d) ? 'todo-group-caret-collapsed' : ''}`}
                    />
                    {dateLabel(d)}
                  </button>
                  <span className="todo-group-actions">
                    <button className="icon-btn" data-tip="该组全部完成" onClick={() => markAllDone(d)}>
                      <CheckCheck size={14} />
                    </button>
                    <button
                      className="icon-btn todo-group-delete"
                      data-tip="删除该组全部"
                      onClick={() => removeGroup(d)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
                {!collapsed.has(d) &&
                  list.map((item) => (
                    <div key={item.id} className={`todo-item ${item.done ? 'todo-item-done' : ''}`}>
                      <button
                        className={`todo-check ${item.done ? 'todo-check-on' : ''}`}
                        data-tip={item.done ? '标记未完成' : '标记完成'}
                        onClick={() => toggleDone(item.id)}
                      >
                        {item.done ? '✓' : ''}
                      </button>
                      <button
                        className={`todo-imp todo-imp-${item.importance}`}
                        data-tip={`重要程度：${IMP_LABELS[item.importance]}（点击切换）`}
                        onClick={() => cycleImportance(item.id)}
                      />
                      <span className="todo-text">{item.text}</span>
                      <button
                        className="icon-btn todo-delete"
                        data-tip="删除"
                        onClick={() => remove(item.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
              </div>
            ))
          )}
        </div>
      </div>
      {/* 整组删除确认（独立窗口内） */}
      <ConfirmState />
    </div>
  )
}

/** 订阅全局确认框并渲染（独立窗口无主窗口的对话框挂载点） */
function ConfirmState(): JSX.Element | null {
  const confirm = useUiStore((s) => s.confirm)
  return confirm ? <ConfirmDialog request={confirm} /> : null
}
