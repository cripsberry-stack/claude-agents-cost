import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

// Статусы агента, которые считаем «работает»
const ACTIVE = new Set(['pending', 'running', 'waiting'])
const POLL_MS = 2000 // пока что-то работает
const IDLE_POLL_MS = 60_000 // в простое: чтобы обратный отсчёт до сброса лимита не застывал
const WARN_PERCENT = 80 // с этого процента лимит помечается ⚠️

// Подписи окон лимитов
const LIMIT_LABEL: Record<string, string> = {
  five_hour: '5ч',
  seven_day: '7д',
  spend_limit: 'Бюджет',
}

let agents = 0 // активные сабагенты
let isBusy = false // главный чат сейчас отвечает
let totalUsd: number | undefined // стоимость всей сессии
let turnStartUsd: number | undefined // стоимость на старте текущего запроса
let lastRequestUsd: number | undefined // стоимость прошлого запроса
let limits: SessionRateLimit[] = [] // окна лимитов подписки (пусто вне подписки)
let now = 0 // текущее время, мс — для отсчёта до сброса
let timer: { cancel: () => void } | undefined
let idleTimer: { cancel: () => void } | undefined

function money(usd: number): string {
  return usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

// «2ч 10м», «45м», «3д 4ч»
function until(resetsAt: string | undefined): string | undefined {
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(at) || now === 0) return undefined
  const min = Math.max(0, Math.round((at - now) / 60_000))
  if (min < 60) return `${min}м`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}ч ${min % 60}м`
  return `${Math.floor(h / 24)}д ${h % 24}ч`
}

function limitText(l: SessionRateLimit): string {
  const label = LIMIT_LABEL[l.kind] ?? l.kind
  const warn = l.percentUsed >= WARN_PERCENT ? '⚠️' : ''
  const reset = until(l.resetsAt)
  return `${warn}${label}: ${Math.round(l.percentUsed)}%${reset ? ` (↻ ${reset})` : ''}`
}

function draw($: EngineInterface): void {
  const parts = [`${isBusy ? '⏳' : '🤖'} Агентов: ${agents}`]
  if (totalUsd !== undefined) {
    const request =
      isBusy && turnStartUsd !== undefined ? totalUsd - turnStartUsd : lastRequestUsd
    if (request !== undefined) parts.push(`💸 Запрос: ${money(Math.max(0, request))}`)
    parts.push(`Σ по API: ${money(totalUsd)}`)
  }
  for (const l of limits) parts.push(limitText(l))
  $.ui.status(parts.join('  ·  '))
}

// Читает стоимость сессии и попутно обновляет лимиты и время
async function readCost($: EngineInterface): Promise<number | undefined> {
  try {
    now = await $.clock.now()
  } catch {
    // без часов просто не покажем отсчёт
  }
  try {
    const usage = await $.session.usage()
    limits = usage.rateLimits
    return usage.cost?.usd
  } catch {
    return undefined // нет учёта стоимости на этом хосте
  }
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    const list = await $.agent.list()
    agents = list.filter(a => ACTIVE.has(a.status)).length
  } catch {
    // список агентов недоступен — оставляем прошлое значение
  }
  const cost = await readCost($)
  if (cost !== undefined) totalUsd = cost
  draw($)
  // Опрашиваем только пока что-то работает
  if (!isBusy && agents === 0 && timer) {
    timer.cancel()
    timer = undefined
  }
}

function startPolling($: EngineInterface): void {
  if (!timer) timer = $.clock.every(POLL_MS, () => void refresh($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Медленный опрос в простое: лимиты и отсчёт до сброса всегда свежие
    idleTimer?.cancel()
    idleTimer = $.clock.every(IDLE_POLL_MS, () => void refresh($))
    await refresh($)
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      // Новый запрос в главном чате
      isBusy = true
      turnStartUsd = (await readCost($)) ?? totalUsd
    }
    startPolling($)
    void refresh($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    startPolling($)
    void refresh($)
    return result
  }).catch(($, e, next) => next(e)) // сбой счётчика никогда не мешает запуску агента

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.cost) totalUsd = e.cost.usd
    limits = e.rateLimits
    draw($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      isBusy = false
      const cost = await readCost($)
      if (cost !== undefined) totalUsd = cost
      if (totalUsd !== undefined && turnStartUsd !== undefined) {
        lastRequestUsd = Math.max(0, totalUsd - turnStartUsd)
      }
      turnStartUsd = undefined
    }
    await refresh($)
    return result
  })
}
