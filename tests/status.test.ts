import { expect, test } from 'claude-code/testing'

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
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(statuses.at(-1)).toBe('🤖 Агентов: 0  ·  Σ Сессия: $0.50')

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

  expect(statuses.at(-1)).toBe('🤖 Агентов: 2  ·  💸 Запрос: $0.30  ·  Σ Сессия: $0.80')
})
