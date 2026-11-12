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
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
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
  // ни панель, ни карточка здесь не встают
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no panes' } }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no surface' } }))
  on('ui.close', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'limits' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(statuses.at(-1)).toBe(
    '🤖 Агентов: 0  ·  Σ по API: $1.25  ·  5ч: 24% (↻ 2ч 10м)  ·  ⚠️7д: 86% (↻ 3д 4ч)',
  )

  // /limits там, где не встают ни панель, ни карточка — сводка текстом
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
      '',
      '(панель: no panes; карточка: no surface)',
    ].join('\n'),
  )
})

const PANE = {
  plugin: 'agents-cost',
  component: 'Pane',
  requestId: 'agents-cost-limits',
  props: {
    title: 'Лимиты',
    isFocused: false,
    bodyColumns: 40,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('панель «Лимиты» с полосками рисуется на всех поверхностях', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 1, resetsAt: '2026-11-12T16:55:00Z' },
        { kind: 'seven_day', percentUsed: 11, resetsAt: '2026-11-17T06:00:00Z' },
      ],
      cost: { usd: 0.3 },
    },
  }))
  on('agent.list', () => ({ value: [] }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('command.register', () => ({ value: { command: 'limits' } }))
  let opened = 0
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['vscode'] })) // полосы над вводом нет — панель открывается сама
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  expect(opened).toBe(1)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Неделя$/ }))?.text).toBe('Неделя')
    expect((await ui.find({ type: 'Text', text: /^11%$/ }))?.text).toBe('11%')
    expect((await ui.find({ type: 'Text', text: /сброс через 4д 18ч/ }))?.text).toBe(
      'сброс через 4д 18ч',
    )
    expect((await ui.find({ type: 'Text', text: /по ценам API/ }))?.text).toBe(
      '🤖 Агентов: 0 · Эта сессия: $0.30 (по ценам API)',
    )
    await ui.unmount()
  }
})

test('/limits на телефоне: панель не встала — карточка с полосками в чате, без текста', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-11-12T14:54:00Z' }],
      cost: { usd: 3.37 },
    },
  }))
  on('agent.list', () => ({ value: [] }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('command.register', () => ({ value: { command: 'limits' } }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'mobile places no panes' } }))
  const places: string[] = []
  on('ui.place', (_, e) => {
    places.push(e.id)
    return { value: { isPlaced: true, requestId: 'r1' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  const out = await $.command.run({
    command: 'limits',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 40 },
  })
  expect(out.text).toBe(undefined)
  expect(places.length).toBe(1)

  const ui = await $.ui.mount({
    plugin: 'agents-cost',
    component: 'Placed',
    requestId: 'r1',
    props: { id: places[0]!, plugin: 'agents-cost' },
    surface: 'mobile',
  })
  expect((await ui.find({ type: 'Text', text: /^📊 Лимиты$/ }))?.text).toBe('📊 Лимиты')
  expect((await ui.find({ type: 'Text', text: /^30%$/ }))?.text).toBe('30%')
  expect((await ui.find({ type: 'Text', text: /сброс через/ }))?.text).toBe('сброс через 2ч 54м')
  expect((await ui.find({ type: 'Text', text: /по ценам API/ }))?.text).toBe(
    '🤖 Агентов: 0 · Эта сессия: $3.37 (по ценам API)',
  )
  await ui.unmount()
})

test('/klodik вне Windows объясняет, где он работает', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd: 0 } },
  }))
  on('agent.list', () => ({ value: [] }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({
    command: 'klodik',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(out.text?.startsWith('Клодик — окошко для рабочего стола Windows')).toBe(true)
})

test('над полем ввода: агенты, стоимость запроса и сессии; панель справа сама не открывается', async ($, on) => {
  let usd = 0.5
  let running = 0
  on('ui.status', () => ({ value: undefined }))
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
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('ui.panes', () => ({ value: [] }))
  let opened = 0
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opened).toBe(0)

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

  const band = {
    plugin: 'agents-cost',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  } as const
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band, surface } as never)
    expect((await ui.find({ type: 'Text', text: /Агентов/ }))?.text).toBe(
      '🤖 Агентов: 2  ·  💸 Запрос: $0.30  ·  Σ Сессия: $0.80 (по ценам API)',
    )
    await ui.unmount()
  }
})

test('над полем ввода: полоски лимитов, «Скрыть» и /limits без панели справа', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 28, resetsAt: '2026-11-12T13:10:00Z' },
        { kind: 'seven_day', percentUsed: 66, resetsAt: '2026-11-13T00:10:00Z' },
      ],
      cost: { usd: 0.95 },
    },
  }))
  on('agent.list', () => ({ value: [] }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('ui.panes', () => ({ value: [] }))
  let opened = 0
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opened).toBe(0)

  const band = {
    plugin: 'agents-cost',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 60,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  } as const

  const ui = await $.ui.mount({ ...band, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /^Неделя$/ }))?.text).toBe('Неделя')
  expect((await ui.find({ type: 'Text', text: /^66%$/ }))?.text).toBe('66%')
  expect((await ui.find({ type: 'Text', text: /сброс через 12ч 10м/ }))?.text).toBe('сброс через 12ч 10м')
  expect((await ui.find({ type: 'Text', text: /Агентов/ }))?.text).toBe(
    '🤖 Агентов: 0  ·  Σ Сессия: $0.95 (по ценам API)',
  )

  // «Скрыть» убирает полоски, строка агентов остаётся
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /^66%$/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /Агентов/ }))?.text).toBe(
    '🤖 Агентов: 0  ·  Σ Сессия: $0.95 (по ценам API)',
  )

  // /limits возвращает полоски над полем ввода и не открывает панель справа
  const out = await $.command.run({
    command: 'limits',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(out.text).toBe(undefined)
  expect(opened).toBe(0)
  expect((await ui.find({ type: 'Text', text: /^66%$/ }))?.text).toBe('66%')
  await ui.unmount()
})
