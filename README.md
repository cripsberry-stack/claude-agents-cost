# agents-cost

Claude Code mod that pins a status line under the prompt showing how many agents are running right now, what the current request costs, and what the whole session has cost so far:

```
⏳ Агентов: 2  ·  💸 Запрос: $0.30  ·  Σ Сессия: $0.80
```

- `⏳` — Claude is answering, `🤖` — waiting for you; next to it, the number of running subagents.
- `💸 Запрос` — cost of the current request (grows live while it runs, then shows the final figure).
- `Σ Сессия` — total for the session, the same figure `/cost` shows (API list prices).

While agents are running the line refreshes every 2 seconds; when everything is idle polling stops.

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
