/* Тесты движка. Запуск: node test.js
   Проверяем ровно тот модуль, который грузят и сайт, и Claude Code skill. */
const T = require("./tipograf.js");

const NB = " ", NNB = " ", HY = "‑";

const show = s => s
  .replace(/ /g, "‹NB›")
  .replace(/ /g, "‹nn›")
  .replace(/‑/g, "‹hy›")
  .replace(/[-]/g, c => "‹PUA:" + c.codePointAt(0).toString(16) + "›");

let pass = 0, fail = 0;

/** Прогнать только перечисленные правила (или дефолтные, если ids не задан). */
function run(input, ids) {
  const rules = {};
  if (ids) T.RULES.forEach(r => rules[r.id] = ids.includes(r.id));
  return T.typo(input, ids ? { rules } : undefined).text;
}

function t(name, input, expect, ids) {
  let got;
  try { got = run(input, ids); }
  catch (e) { console.log("✗ " + name + "\n    ИСКЛЮЧЕНИЕ: " + e.message); fail++; return; }
  if (got === expect) { pass++; console.log("✓ " + name); }
  else {
    fail++;
    console.log("✗ " + name);
    console.log("    вход:  " + show(input));
    console.log("    ждали: " + show(expect));
    console.log("    вышло: " + show(got));
  }
}

console.log("── Кавычки (один проход со счётчиком глубины) ──");
t("простые ёлочки", 'Это "тест" тут.', "Это «тест» тут.", ["quotes"]);
t("вложенные лапки", 'Он сказал: "фирма "Заря" ушла".',
  "Он сказал: «фирма „Заря“ ушла».", ["quotes", "quotes-nested"]);
t("вложенность выключена", 'а "б "в" г"', "а «б «в» г»", ["quotes"]);
t("непарная открывающая", 'сказал "привет', "сказал «привет", ["quotes", "quotes-nested"]);
t("кавычка после скобки", 'см. ("тест")', "см. («тест»)", ["quotes", "quotes-nested"]);
t("апостроф", "O'Rurke", "O’Rurke", ["apostrophe"]);

console.log("\n── Сокращения и инициалы ──");
// «д.» намеренно липнет к следующему слову: сокращение не должно висеть
// в конце строки при переносе.
t("т. д.", "и т. д. дальше", "и т." + NB + "д." + NB + "дальше", ["nb-abbr"]);
t("г. Москва", "в г. Москва", "в г." + NB + "Москва", ["nb-abbr"]);
t("инициалы + фамилия", "А. С. Пушкин", "А." + NNB + "С." + NNB + "Пушкин", ["nb-init"]);
t("два автора", "А. С. Пушкин и М. Ю. Лермонтов",
  "А." + NNB + "С." + NNB + "Пушкин и М." + NNB + "Ю." + NNB + "Лермонтов", ["nb-init"]);

console.log("\n── Пробелы и знаки ──");
t("процент — узкий пробел", "Точность 3 %.", "Точность 3" + NNB + "%.", ["nb-units", "nb-num", "sp-punct"]);
t("килограммы", "вес 5 кг тут", "вес 5" + NNB + "кг тут", ["nb-units", "nb-num"]);
t("рубли", "цена 100 ₽", "цена 100" + NNB + "₽", ["nb-units", "nb-num"]);
t("число + слово", "2024 год", "2024" + NB + "год", ["nb-num"]);
t("пробел перед запятой", "слово , и !", "слово, и!", ["sp-punct"]);
t("многоточие", "ушли ... туда", "ушли … туда", ["ellipsis"]);
t("умножение", "10x15", "10×15", ["times"]);
t("диапазон лет", "1941-1945", "1941–1945", ["ndash-num"]);
t("неразрывный дефис", "по-моему", "по" + HY + "моему", ["hyphen-hard"]);
t("стрелка не станет тире", "a -> b", "a → b", ["arrows", "mdash"]);
t("тире из дефиса", "слово - слово", "слово" + NB + "— слово", ["mdash", "mdash-nbsp"]);

console.log("\n── Идемпотентность ──");
const src = '"Дизайн - это не то", - сказал он. И т. д. в г. Москва, А. С. Пушкин, 10x15 см, 3 %.';
const once = run(src), twice = run(once);
if (once === twice) { pass++; console.log("✓ повторная обработка стабильна"); }
else {
  fail++;
  console.log("✗ повторная обработка меняет текст");
  console.log("    1-й: " + show(once));
  console.log("    2-й: " + show(twice));
}

console.log("\n── Чистота вывода ──");
if (/[-]/.test(once)) { fail++; console.log("✗ PUA в выводе: " + show(once)); }
else { pass++; console.log("✓ PUA-символов в выводе нет"); }

if (T.RULES.map(r => r.id).some(n => once.includes(n))) { fail++; console.log("✗ имя правила в выводе"); }
else { pass++; console.log("✓ имён правил в выводе нет"); }

console.log("\n── Целостность ORDER ──");
const inOrder = new Set(T.ORDER);
const missing = T.RULES.filter(r => !inOrder.has(r.id) && r.def).map(r => r.id);
if (missing.length) { fail++; console.log("✗ дефолтные, но не в ORDER: " + missing.join(", ")); }
else { pass++; console.log("✓ все дефолтные правила есть в ORDER"); }

const ghosts = T.ORDER.filter(id => !T.byId[id]);
if (ghosts.length) { fail++; console.log("✗ в ORDER есть несуществующие: " + ghosts.join(", ")); }
else { pass++; console.log("✓ в ORDER нет призраков"); }

console.log("\n── Пустой ввод и мусор ──");
for (const [label, val] of [["пустая строка", ""], ["null", null], ["пробелы", "   "],
                            ["переводы строк", "\n\n"], ["одни кавычки", '""""'],
                            ["длинный текст", "а ".repeat(5000)]]) {
  try { T.typo(val); pass++; console.log("✓ " + label + " не падает"); }
  catch (e) { fail++; console.log("✗ " + label + ": " + e.message); }
}

console.log("\n── API ──");
const r = T.typo('"Тест - раз", 5 кг');
if (r.fixes > 0 && r.rules > 0 && typeof r.text === "string") {
  pass++; console.log("✓ typo() возвращает {text, hits, fixes, rules}");
} else { fail++; console.log("✗ typo() вернул неожиданное: " + JSON.stringify(r)); }

console.log("\n" + "─".repeat(46) + "\nПройдено " + pass + ", провалено " + fail);
process.exit(fail ? 1 : 0);
