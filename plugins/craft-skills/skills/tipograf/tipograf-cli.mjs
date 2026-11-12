#!/usr/bin/env node
/*  Успешный Типограф — CLI.
 *  Применяет русскую типографику к файлам. Правила живут в tipograf.js.
 *
 *    node tipograf-cli.mjs <файл|glob>...        применить и записать
 *    node tipograf-cli.mjs --check <файл>...     только проверить (exit 1, если есть правки)
 *    node tipograf-cli.mjs --stdin               прочитать stdin → stdout
 *    node tipograf-cli.mjs --off nb-short,minus  выключить правила
 *    node tipograf-cli.mjs --on fractions        включить выключенные по умолчанию
 *    node tipograf-cli.mjs --rules               показать список правил
 *
 *  Markdown-файлы обрабатываются бережно: код, ссылки и frontmatter не трогаются.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";

const require = createRequire(import.meta.url);
const T = require(join(dirname(fileURLToPath(import.meta.url)), "tipograf.js"));

/* ── аргументы ─────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };

const CHECK = has("--check");
const STDIN = has("--stdin");
const QUIET = has("--quiet");

const rules = T.defaults();
for (const id of (val("--off") || "").split(",").filter(Boolean)) {
  if (!(id in rules)) die(`нет правила «${id}». Список: --rules`);
  rules[id] = false;
}
for (const id of (val("--on") || "").split(",").filter(Boolean)) {
  if (!(id in rules)) die(`нет правила «${id}». Список: --rules`);
  rules[id] = true;
}

function die(msg) { console.error("Ошибка: " + msg); process.exit(2); }

/* ── --rules ───────────────────────────────────────────────── */
if (has("--rules")) {
  let group = "";
  for (const r of T.RULES) {
    if (r.group !== group) { group = r.group; console.log("\n" + group); }
    const mark = r.def ? "×" : " ";
    console.log(`  [${mark}] ${r.id.padEnd(14)} ${r.name}${r.hint ? "  — " + r.hint : ""}`);
  }
  console.log("\n[×] — включено по умолчанию");
  process.exit(0);
}

/* ── защита markdown ───────────────────────────────────────────
   Прячем то, что типографить нельзя: fenced-код, inline-код,
   URL и цели ссылок, HTML-теги, frontmatter. Возвращаем на место после.  */
const GUARD = "";   // PUA, как и в движке — в текстах не встречается

function protect(text) {
  const store = [];
  const stash = m => { store.push(m); return GUARD + (store.length - 1) + GUARD; };

  let t = text
    .replace(/^---\n[\s\S]*?\n---\n/, stash)          // frontmatter
    .replace(/```[\s\S]*?```/g, stash)                // ```блоки```
    .replace(/~~~[\s\S]*?~~~/g, stash)
    .replace(/^(?: {4}|\t).*$/gm, stash)              // отступом
    .replace(/`[^`\n]+`/g, stash)                     // `inline`
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, stash)         // [текст](ссылка)
    .replace(/<[^>\n]+>/g, stash)                     // html-теги
    .replace(/\bhttps?:\/\/\S+/g, stash);             // голые URL
  return { t, store };
}

function restore(t, store) {
  return t.replace(new RegExp(GUARD + "(\\d+)" + GUARD, "g"), (m, i) => store[+i]);
}

/* ── обработка одного текста ───────────────────────────────── */
function run(text, isMarkdown) {
  if (!isMarkdown) return T.typo(text, { rules });
  const { t, store } = protect(text);
  const res = T.typo(t, { rules });
  return { ...res, text: restore(res.text, store) };
}

/* ── stdin ─────────────────────────────────────────────────── */
if (STDIN) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const input = Buffer.concat(chunks).toString("utf8");
  process.stdout.write(run(input, false).text);
  process.exit(0);
}

/* ── файлы ─────────────────────────────────────────────────── */
const patterns = argv.filter(a => !a.startsWith("--") &&
  argv[argv.indexOf(a) - 1] !== "--off" && argv[argv.indexOf(a) - 1] !== "--on");

if (!patterns.length) {
  console.error("Укажите файлы. Справка: --rules, --check, --stdin");
  process.exit(2);
}

const files = [];
for (const p of patterns) {
  if (/[*?[]/.test(p)) { for await (const f of glob(p)) files.push(f); }
  else files.push(p);
}
if (!files.length) die("файлы не найдены");

let touched = 0, totalFixes = 0;

for (const file of files) {
  let text;
  try { text = await readFile(file, "utf8"); }
  catch (e) { console.error(`  ${file}: не прочитан (${e.code})`); continue; }

  const md = [".md", ".mdx", ".markdown"].includes(extname(file).toLowerCase());
  const res = run(text, md);

  if (res.text === text) {
    if (!QUIET) console.log(`  ${file}: без изменений`);
    continue;
  }

  touched++; totalFixes += res.fixes;

  const top = Object.entries(res.hits).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id, n]) => `${id}×${n}`).join(", ");
  console.log(`${CHECK ? "≠" : "✓"} ${file}: ${res.fixes} правок  (${top})`);

  if (!CHECK) await writeFile(file, res.text, "utf8");
}

if (!QUIET) {
  console.log("─".repeat(46));
  console.log(CHECK
    ? `Требуют правки: ${touched} из ${files.length}, всего ${totalFixes} мест`
    : `Обработано: ${touched} из ${files.length}, внесено ${totalFixes} правок`);
}

process.exit(CHECK && touched ? 1 : 0);
