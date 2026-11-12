# agents-cost

Claude Code mod that opens a **«Лимиты»** panel above the prompt (on every surface: terminal, desktop, and the mobile/web apps) and pins a status line under the prompt showing how many agents are running right now, what the current request and the whole session would cost at API prices, and your plan's usage limits — no need to dig through settings:

```
⏳ Агентов: 2  ·  💸 Запрос: $0.30  ·  Σ по API: $0.80  ·  5ч: 24% (↻ 2ч 10м)  ·  ⚠️7д: 86% (↻ 3д 4ч)
```

The panel:

```
5ч      █░░░░░░░░░  1%   сброс через 4ч 55м
Неделя  █░░░░░░░░░  11%  сброс через 4д 18ч
🤖 Агентов: 0 · Эта сессия: $0.30 (по ценам API)   [Скрыть]
```

Bars turn yellow at 80% and red at 95%. **Скрыть** hides the panel until you run `/limits` again.

`/limits` opens the panel. Where a surface doesn't seat panels (the mobile app), it drops the same bars into the chat as a card that keeps updating; plain text is the last fallback.

The status line:

- `⏳` — Claude is answering, `🤖` — waiting for you; next to it, the number of running subagents.
- `💸 Запрос` — cost of the current request (grows live while it runs, then shows the final figure).
- `Σ по API` — total for the session at API list prices, the same figure `/cost` shows (what you would have paid without a subscription).
- `5ч` / `7д` — how much of the 5-hour and weekly plan limits is used, and `↻` how long until each resets. `⚠️` marks a limit at 80% or more. Shown only on a subscription, after the first response of the session.

Type `/limits` to get the same summary as a message in the chat — handy in the mobile and web apps, which don't draw the status line:

```
📊 Лимиты
5ч: 24% · сброс через 2ч 10м
⚠️ 7д: 86% · сброс через 3д 4ч

🤖 Агентов работает: 2
💸 Последний запрос: $0.30
Σ Сессия по API: $0.80
```

While agents are running the line refreshes every 2 seconds; when idle it refreshes once a minute so the reset countdown stays current.

## Install

At the prompt of a terminal session:

```
/plugin install agents-cost --marketplace cripsberry-stack/claude-agents-cost
```

Answer `y` to add the marketplace, then pick a scope (user scope puts it in every project).

From a shell:

```bash
claude plugin install agents-cost --marketplace cripsberry-stack/claude-agents-cost
```

## Also in this marketplace: craft-skills

Two third-party skills, credited and licensed as their authors set: `/unslop` (turns AI-looking UI into a designed interface, by [heydamir](https://github.com/heydamir/unslop), CC BY 4.0) and `/tipograf` (Russian typography: «ёлочки», em dashes, non-breaking spaces, by [ircitdev](https://github.com/ircitdev/uspeshnyy-tipograf), MIT). See [plugins/craft-skills](plugins/craft-skills/README.md).

```
/plugin install craft-skills --marketplace cripsberry-stack/claude-agents-cost
```
