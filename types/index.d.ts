// Что мод держит в $.state: снимок для панели «Лимиты»
export type Limit = { kind: string; percentUsed: number; resetsAt: string | null }

export type Snap = {
  agents: number // активные сабагенты
  isBusy: boolean // главный чат сейчас отвечает
  totalUsd: number | null // стоимость сессии по ценам API
  requestUsd: number | null // текущий или прошлый запрос
  limits: Limit[] // окна лимитов подписки
  now: number // время снимка, мс
}

declare module 'claude-code' {
  interface PluginState {
    'agents-cost': { snap: Shaped<Snap>; isHidden: boolean }
  }
}
