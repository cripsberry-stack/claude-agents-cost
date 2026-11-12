import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit, Snap } from '../types'

// Статусы агента, которые считаем «работает»
const ACTIVE = new Set(['pending', 'running', 'waiting'])
const POLL_MS = 2000 // пока что-то работает
const IDLE_POLL_MS = 60_000 // в простое: чтобы обратный отсчёт до сброса лимита не застывал
const WARN_PERCENT = 80 // с этого процента лимит помечается ⚠️ / жёлтым
const DANGER_PERCENT = 95 // красным
const BAR_CELLS = 10 // ширина полоски в панели
const PANE = 'agents-cost-limits'
const CARD_PREFIX = 'limits-' // карточки /limits в чате

// Подписи окон: короткие для строки статуса, полные для панели
const SHORT_LABEL: Record<string, string> = { five_hour: '5ч', seven_day: '7д', spend_limit: 'Бюджет' }
const PANE_LABEL: Record<string, string> = { five_hour: '5ч', seven_day: 'Неделя', spend_limit: 'Бюджет' }

// Снимок для панели; при смене полей поменять тег shape
const EMPTY: Snap = { agents: 0, isBusy: false, totalUsd: null, requestUsd: null, limits: [], now: 0 }
const snap = atom({ plugin: 'agents-cost', key: 'snap' } as const, EMPTY, { shape: 'snap-1' })
const isHidden = atom({ plugin: 'agents-cost', key: 'isHidden' } as const, false)

let agents = 0 // активные сабагенты
let isBusy = false // главный чат сейчас отвечает
let totalUsd: number | undefined // стоимость всей сессии
let turnStartUsd: number | undefined // стоимость на старте текущего запроса
let lastRequestUsd: number | undefined // стоимость прошлого запроса
let limits: Limit[] = [] // окна лимитов подписки (пусто вне подписки)
let now = 0 // текущее время, мс — для отсчёта до сброса
let timer: { cancel: () => void } | undefined
let idleTimer: { cancel: () => void } | undefined
let lastStatusJson = '' // что последним записали для Клодика
let lastStatusAt = 0 // когда записали

function money(usd: number): string {
  return usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

function toLimits(list: SessionRateLimit[]): Limit[] {
  return list.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt ?? null }))
}

// «2ч 10м», «45м», «3д 4ч»
function until(resetsAt: string | null, at: number): string | undefined {
  const reset = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(reset) || at === 0) return undefined
  const min = Math.max(0, Math.round((reset - at) / 60_000))
  if (min < 60) return `${min}м`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}ч ${min % 60}м`
  return `${Math.floor(h / 24)}д ${h % 24}ч`
}

// Стоимость текущего (идёт) или прошлого запроса
function requestUsd(): number | undefined {
  if (totalUsd === undefined) return undefined
  const usd = isBusy && turnStartUsd !== undefined ? totalUsd - turnStartUsd : lastRequestUsd
  return usd === undefined ? undefined : Math.max(0, usd)
}

function limitText(l: Limit): string {
  const label = SHORT_LABEL[l.kind] ?? l.kind
  const warn = l.percentUsed >= WARN_PERCENT ? '⚠️' : ''
  const reset = until(l.resetsAt, now)
  return `${warn}${label}: ${Math.round(l.percentUsed)}%${reset ? ` (↻ ${reset})` : ''}`
}

// Строка статуса (терминал) + снимок для панели (все поверхности)
async function draw($: EngineInterface): Promise<void> {
  const request = requestUsd()
  const parts = [`${isBusy ? '⏳' : '🤖'} Агентов: ${agents}`]
  if (totalUsd !== undefined) {
    if (request !== undefined) parts.push(`💸 Запрос: ${money(request)}`)
    parts.push(`Σ по API: ${money(totalUsd)}`)
  }
  for (const l of limits) parts.push(limitText(l))
  $.ui.status(parts.join('  ·  '))

  const next: Snap = {
    agents,
    isBusy,
    totalUsd: totalUsd ?? null,
    requestUsd: request ?? null,
    limits,
    now,
  }
  try {
    await update($, snap, () => next)
  } catch {
    // панель не обновилась — строка статуса уже показана
  }
  void writeStatus($, next)
}

// ── Клодик: окошко на рабочем столе Windows (desktop/klodik.ps1) ──

// ~/.claude этого компьютера — из пути плагина (он всегда лежит внутри .claude)
function claudeDir($: EngineInterface): string | undefined {
  const root = $.plugin.root
  const m = /^(.*?[\\/]\.claude)(?:[\\/]|$)/.exec(root)
  return m?.[1]
}

function isWindows($: EngineInterface): boolean {
  return /^[A-Za-z]:[\\/]/.test($.plugin.root)
}

function join(dir: string, name: string): string {
  return `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`
}

// Статус для Клодика: при изменении сразу, без изменений — раз в 50 с, чтобы он знал, что Claude Code жив
async function writeStatus($: EngineInterface, s: Snap): Promise<void> {
  const dir = claudeDir($)
  if (!dir) return
  const body = JSON.stringify({ isBusy: s.isBusy, agents: s.agents, totalUsd: s.totalUsd, limits: s.limits })
  const at = s.now || Date.now()
  if (body === lastStatusJson && at - lastStatusAt < 50_000) return
  lastStatusJson = body
  lastStatusAt = at
  try {
    await $.fs.write(join(join(dir, 'klodik'), 'status.json'), `${body.slice(0, -1)},"updatedAt":${at}}`)
  } catch {
    // нет доступа к папке — Клодик просто будет спать
  }
}

// /klodik: кладёт окошко в ~/.claude/klodik и запускает (только Windows)
async function startKlodik($: EngineInterface): Promise<string> {
  const dir = claudeDir($)
  if (!isWindows($) || !dir) {
    return 'Клодик — окошко для рабочего стола Windows. Запусти /klodik в локальном Claude Code на своём ПК (в облачном чате и не на Windows он не работает).'
  }
  const target = join(dir, 'klodik')
  try {
    const src = join(join($.plugin.root, 'desktop'), 'klodik.ps1')
    const script = await $.fs.read(src)
    // Windows PowerShell 5.1 читает кириллицу верно только с BOM
    await $.fs.write(join(target, 'klodik.ps1'), script.startsWith('\uFEFF') ? script : `\uFEFF${script}`)
    await $.fs.write(join(target, 'klodik.cmd'), await $.fs.read(join(join($.plugin.root, 'desktop'), 'klodik.cmd')))
    lastStatusJson = '' // сразу свежий статус
    await refresh($)
    await $.process.run(['cmd.exe', '/c', join(target, 'klodik.cmd')], { timeoutMs: 15_000 })
  } catch (err) {
    return `Не получилось запустить Клодика: ${String(err)}`
  }
  return [
    'Клодик запущен — он в правом нижнем углу экрана.',
    'Таскай мышкой куда хочешь, наведи курсор — лимиты, двойной клик — сводка, правый клик — меню и «Выход».',
    `Запускать без Claude: ${join(target, 'klodik.cmd')}`,
  ].join('\n')
}

// Сводка для /limits — по строке на пункт
function report(): string {
  const lines = ['📊 Лимиты']
  if (limits.length === 0) {
    lines.push('пока нет данных — появятся после первого ответа (только на подписке)')
  }
  for (const l of limits) {
    const label = SHORT_LABEL[l.kind] ?? l.kind
    const warn = l.percentUsed >= WARN_PERCENT ? '⚠️ ' : ''
    const reset = until(l.resetsAt, now)
    lines.push(`${warn}${label}: ${Math.round(l.percentUsed)}%${reset ? ` · сброс через ${reset}` : ''}`)
  }
  lines.push('', `🤖 Агентов работает: ${agents}`)
  const request = requestUsd()
  if (request !== undefined) lines.push(`💸 Последний запрос: ${money(request)}`)
  if (totalUsd !== undefined) lines.push(`Σ Сессия по API: ${money(totalUsd)}`)
  return lines.join('\n')
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
    limits = toLimits(usage.rateLimits)
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
  await draw($)
  // Быстро опрашиваем только пока что-то работает
  if (!isBusy && agents === 0 && timer) {
    timer.cancel()
    timer = undefined
  }
}

function startPolling($: EngineInterface): void {
  if (!timer) timer = $.clock.every(POLL_MS, () => void refresh($))
}

type Elements = ReturnType<EngineInterface['ui']['resolve']>

// Полоски лимитов + строка агентов/стоимости; общая для панели и карточки
function limitsView($: EngineInterface, ui: Elements, s: Snap, hide?: () => Promise<void>) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      {s.limits.length === 0 && (
        <Text dimColor>Лимиты появятся после первого ответа (только на подписке)</Text>
      )}
      {s.limits.map(l => {
        const pct = Math.round(l.percentUsed)
        const filled = Math.min(BAR_CELLS, Math.max(pct > 0 ? 1 : 0, Math.round((pct / 100) * BAR_CELLS)))
        const color = pct >= DANGER_PERCENT ? 'error' : pct >= WARN_PERCENT ? 'warning' : 'success'
        const reset = until(l.resetsAt, s.now)
        return (
          <Box key={l.kind} flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Box width={7}>
              <Text bold>{PANE_LABEL[l.kind] ?? l.kind}</Text>
            </Box>
            <Text mono>
              <Text color={color}>{'█'.repeat(filled)}</Text>
              <Text color="subtle">{'█'.repeat(BAR_CELLS - filled)}</Text>
            </Text>
            <Text bold>{pct}%</Text>
            {reset && <Text dimColor>сброс через {reset}</Text>}
          </Box>
        )
      })}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
        <Text dimColor>
          {s.isBusy ? '⏳' : '🤖'} Агентов: {s.agents}
          {s.totalUsd !== null ? ` · Эта сессия: ${money(s.totalUsd)} (по ценам API)` : ''}
        </Text>
        {hide && (
          <Button key="hide" role="dismiss" onPress={hide}>
            Скрыть
          </Button>
        )}
      </Box>
    </Box>
  )
}

async function openPane($: EngineInterface): Promise<void> {
  try {
    await $.ui.open({ id: PANE, title: 'Лимиты' })
  } catch {
    // поверхность без панелей — остаются строка статуса и /limits
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Медленный опрос в простое: лимиты и отсчёт до сброса всегда свежие
    idleTimer?.cancel()
    idleTimer = $.clock.every(IDLE_POLL_MS, () => void refresh($))
    try {
      await $.command.register({
        name: 'limits',
        description: 'Лимиты 5ч/неделя, сколько агентов работает и стоимость сессии по API',
      })
    } catch {
      // команда не зарегистрировалась — строка статуса и панель всё равно работают
    }
    try {
      await $.command.register({
        name: 'klodik',
        description: 'Клодик на рабочем столе Windows: перетаскивается, показывает работу и лимиты',
      })
    } catch {
      // без команды Клодика всё остальное работает
    }
    await refresh($)
    if (!(await read($, isHidden))) await openPane($)
    return result
  })

  on('command.run', { command: 'klodik' }, async $ => ({ text: await startKlodik($) }))

  // /limits: показать панель; где панели не встают (телефон) — карточка в чате;
  // текст — только если не получилось ни то ни другое
  on('command.run', { command: 'limits' }, async $ => {
    await refresh($)
    await update($, isHidden, () => false)
    const why: string[] = [] // почему не встали панель и карточка — пишем под текстом
    try {
      const opened = await $.ui.open({ id: PANE, title: 'Лимиты' })
      if (opened.isPlaced) return {}
      why.push(`панель: ${opened.reason}`)
    } catch (err) {
      why.push(`панель: ${String(err)}`)
    }
    try {
      // Новый id на каждый вызов: карточка встаёт в конец чата, а не на старое место
      const placed = await $.ui.place({ id: `${CARD_PREFIX}${now || Date.now()}` })
      if (placed.isPlaced) return {}
      why.push(`карточка: ${placed.reason}`)
    } catch (err) {
      why.push(`карточка: ${String(err)}`)
    }
    return { text: `${report()}\n\n(${why.join('; ')})` }
  })

  // Закрыл панель сам (крестик / Esc) — не открываем её снова до /limits
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, isHidden, () => true)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const hide = async () => {
      await update($, isHidden, () => true)
      await $.ui.close({ id: PANE })
    }
    return limitsView($, $.ui.resolve(e), await read($, snap), hide)
  })

  // Карточка /limits в чате: тот же рисунок с рамкой, без «Скрыть» (она уходит вверх с чатом)
  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== 'agents-cost' || !e.props.id.startsWith(CARD_PREFIX)) return next(e)
    const ui = $.ui.resolve(e)
    return (
      <ui.Box borderStyle="round" borderColor="subtle" paddingX={1} flexDirection="column">
        <ui.Text bold>📊 Лимиты</ui.Text>
        {limitsView($, ui, await read($, snap))}
      </ui.Box>
    )
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
    limits = toLimits(e.rateLimits)
    await draw($)
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
