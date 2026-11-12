# craft-skills

Два сторонних скилла для Claude Code в одном плагине.

| Скилл | Что делает | Источник | Лицензия |
|---|---|---|---|
| `/unslop` | Превращает «навайбкоженный», AI-шный интерфейс в продуманный дизайн: аудит, направление, затем правки отступов, цвета, иконок, текста, шрифтов, вёрстки, визуала и анимации. React, Tailwind, HTML/CSS. | [heydamir/unslop](https://github.com/heydamir/unslop) (коммит `97daa3e`), автор Damir Sokolovsky ([@heydamir](https://x.com/heydamir)) | CC BY 4.0 |
| `/tipograf` | Русская типографика скриптом, а не моделью: ёлочки «…», длинные тире —, неразрывные пробелы, `×`, `…`. Markdown обрабатывает бережно. | [ircitdev/uspeshnyy-tipograf](https://github.com/ircitdev/uspeshnyy-tipograf) (коммит `cd376af`), автор Александр Успешный | MIT |

Изменения относительно оригиналов: из unslop убран файл `agents/openai.yaml` (нужен только Codex); в tipograf путь `~/.claude/skills/tipograf/` в `SKILL.md` заменён на «папку навыка», чтобы скилл работал из плагина.

## Установка

```
/plugin install craft-skills --marketplace cripsberry-stack/claude-agents-cost
```

Для `unslop`: снимок живого сайта и видео-история требуют Playwright (`npm install -D playwright && npx playwright install chromium`), видео — ещё ffmpeg. Для `tipograf` нужен только Node.js.
