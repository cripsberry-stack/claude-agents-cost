import { expect, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-12T12:00:00Z')

test('строка показывает агентов, стоимость запроса и сессии', async ($, on) => {
  const statuses: (string | undefined)[] = []
  let usd = 0.5
  let running = 0

  // Хуки ниже стоят на месте движка
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd } },
  }))
  on('agent.list', () => ({
    value: Array.from({ length: running }, (_, i) => ({
      id: `a${i}`,
      description: 'task',
      type: 'general-purpose',
      status: 'running' as const,
    })),
  }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('command.register', () => ({ value: { command: 'limits' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(statuses.at(-1)).toBe('🤖 Агентов: 0  ·  Σ по API: $0.50')

  // Запрос пошёл: запустились 2 агента, потрачено 30 центов
  await $.turn.start({ text: 'сделай сайт', turnId: 't1' })
  running = 2
  usd = 0.8
  await $.turn.complete({
    answer: 'готово',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'completed',
  } as never)

  expect(statuses.at(-1)).toBe('🤖 Агентов: 2  ·  💸 Запрос: $0.30  ·  Σ по API: $0.80')
})

test('строка показывает лимиты 5ч / 7д и время до сброса', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-11-12T14:10:00Z' },
        { kind: 'seven_day', percentUsed: 86, resetsAt: '2026-11-15T16:00:00Z' },
      ],
      cost: { usd: 1.25 },
    },
  }))
  on('agent.list', () => ({ value: [] }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('command.register', () => ({ value: { command: 'limits' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(statuses.at(-1)).toBe(
    '🤖 Агентов: 0  ·  Σ по API: $1.25  ·  5ч: 24% (↻ 2ч 10м)  ·  ⚠️7д: 86% (↻ 3д 4ч)',
  )

  // /limits — та же сводка текстом в чат
  const out = await $.command.run({
    command: 'limits',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(out.text).toBe(
    [
      '📊 Лимиты',
      '5ч: 24% · сброс через 2ч 10м',
      '⚠️ 7д: 86% · сброс через 3д 4ч',
      '',
      '🤖 Агентов работает: 0',
      'Σ Сессия по API: $1.25',
    ].join('\n'),
  )
})
