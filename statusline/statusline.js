#!/usr/bin/env node
// Строка статуса Claude Code для Linux / macOS / облачных чатов (то же, что statusline.ps1 для Windows):
//   ■■■■□□□□ 49% · 5ч 75% ↻2ч10м · нед 46% ↻3д4ч · 💸 $0.30 · Σ $4.33 API
// Полоска — заполнение контекста, 5ч / нед — лимиты подписки, 💸 — текущий запрос, Σ — вся сессия по ценам API.
// Настройка в ~/.claude/settings.json:
//   "statusLine": { "type": "command", "command": "node ~/.claude/statusline.js", "refreshInterval": 2 }

const fs = require('fs')
const os = require('os')
const path = require('path')

const paint = (code, text) => `\x1b[${code}m${text}\x1b[0m`
const heat = p => (p >= 90 ? '31' : p >= 70 ? '33' : '32')
const money = v => (v > 0 && v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`)

// « ↻45м», « ↻2ч10м», « ↻3д4ч» до сброса окна (resets_at — секунды Unix)
function left(resetsAt) {
  if (!resetsAt) return ''
  const min = Math.floor((resetsAt * 1000 - Date.now()) / 60000)
  if (min < 0) return ''
  if (min < 60) return ` ↻${min}м`
  const h = Math.floor(min / 60)
  if (h < 24) return ` ↻${h}ч${min % 60}м`
  return ` ↻${Math.floor(h / 24)}д${h % 24}ч`
}

function limit(label, w) {
  if (!w || w.used_percentage == null) return null
  const p = Number(w.used_percentage)
  return paint(heat(p), `${label} ${Math.round(p)}%`) + paint('90', left(w.resets_at))
}

// Стоимость запроса: рост суммы с начала текущего запроса (по prompt_id)
function requestCost(j, total) {
  const file = path.join(os.tmpdir(), `claude-statusline-${j.session_id || 'session'}.json`)
  let start = total
  try {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'))
    start = st.prompt_id === (j.prompt_id ?? null) ? st.start : st.last
  } catch {
    // первый запуск в сессии
  }
  try {
    fs.writeFileSync(file, JSON.stringify({ prompt_id: j.prompt_id ?? null, start, last: total }))
  } catch {
    // нет доступа к временной папке — покажем от первого запуска
  }
  return Math.max(0, total - start)
}

function render(j) {
  const parts = []
  const ctx = j.context_window?.used_percentage
  if (ctx != null) {
    const p = Number(ctx)
    const n = Math.min(8, Math.round(p / 12.5))
    parts.push(paint(heat(p), '■'.repeat(n)) + paint('90', '■'.repeat(8 - n)) + ` ${Math.round(p)}%`)
  }
  const five = limit('5ч', j.rate_limits?.five_hour)
  if (five) parts.push(five)
  const week = limit('нед', j.rate_limits?.seven_day)
  if (week) parts.push(week)
  const total = j.cost?.total_cost_usd
  if (total != null) {
    parts.push(`💸 ${money(requestCost(j, Number(total)))}`)
    parts.push(`Σ ${money(Number(total))} API`)
  }
  return parts.join(' · ')
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => (raw += chunk))
process.stdin.on('end', () => {
  try {
    process.stdout.write(render(JSON.parse(raw)) || 'statusline: нет данных')
  } catch {
    process.stdout.write('statusline: нет данных')
  }
})
