import type { EngineInterface, Register } from 'claude-code'

// Статусы агента, которые считаем «работает»
const ACTIVE = new Set(['pending', 'running', 'waiting'])
const POLL_MS = 2000

let agents = 0 // активные сабагенты
let isBusy = false // главный чат сейчас отвечает
let totalUsd: number | undefined // стоимость всей сессии
let turnStartUsd: number | undefined // стоимость на старте текущего запроса
let lastRequestUsd: number | undefined // стоимость прошлого запроса
let timer: { cancel: () => void } | undefined

function money(usd: number): string {
  return usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

function draw($: EngineInterface): void {
  const parts = [`${isBusy ? '⏳' : '🤖'} Агентов: ${agents}`]
  if (totalUsd !== undefined) {
    const request =
      isBusy && turnStartUsd !== undefined ? totalUsd - turnStartUsd : lastRequestUsd
    if (request !== undefined) parts.push(`💸 Запрос: ${money(Math.max(0, request))}`)
    parts.push(`Σ Сессия: ${money(totalUsd)}`)
  }
  $.ui.status(parts.join('  ·  '))
}

async function readCost($: EngineInterface): Promise<number | undefined> {
  try {
    return (await $.session.usage()).cost?.usd
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
    if (e.cost) {
      totalUsd = e.cost.usd
      draw($)
    }
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
