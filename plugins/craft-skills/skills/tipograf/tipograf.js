/*  Успешный Типограф — движок русской типографики.
 *  Единственный источник правил: его используют и веб-версия (index.html),
 *  и Claude Code skill (tipograf-cli.mjs). Правки вносить только здесь.
 *
 *  Работает и в браузере (глобальный Tipograf), и в Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Tipograf = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";



/* ══════════════════════════════════════════════════════════════
   Символы
══════════════════════════════════════════════════════════════ */
const NB   = " ";  // неразрывный пробел
const NNB  = " ";  // узкий неразрывный
const MDASH= "—";  // —
const NDASH= "–";  // –
const HYP  = "‑";  // неразрывный дефис
const SHY  = "­";  // мягкий перенос

/* Маркеры-плейсхолдеры для отслеживания правок.
   Используем символы из Private Use Area — в реальных текстах не встречаются. */
/* В текст вставляется только пара PUA-скобок с номером правки внутри:
   ⟨OPEN⟩12⟨CLOSE⟩ → FIX[12] = {id, value}.
   Имя правила в текст не пишем: следующее правило прочитает его как обычные
   буквы, а вложенные маркеры ломают разбор (так «quotes-nested» вытекал
   в готовый текст на вложенных кавычках). Внутри скобок только цифры. */
const M_OPEN = "", M_CLOSE = "";
let FIX = [];

const RU = "а-яёА-ЯЁ";
const LET = RU + "a-zA-Z";

/* ══════════════════════════════════════════════════════════════
   Определения правил
   Каждое: {id, group, name, hint, def, fn(text) → text}
   Внутри fn текст оборачивают вызовом mark(replacement, ruleId).
══════════════════════════════════════════════════════════════ */

let HITS = {};        // ruleId → сколько раз сработало
const RULES = [];
const R = (id, group, name, hint, def, fn) => RULES.push({id,group,name,hint,def,fn});

/* Обёртка: помечает подставленный фрагмент, чтобы потом подсветить */
function mark(s, id){
  HITS[id] = (HITS[id]||0)+1;
  const i = FIX.length;
  FIX.push({id, value: s});   // value === "" — это удаление символа
  return M_OPEN + i + M_CLOSE;
}

/* Гоняем replace до стабилизации.
   Нужно там, где совпадения перекрываются («и т. д.», «А. С. Пушкин»):
   после замены regex.lastIndex перескакивает через следующую пару. */
function untilStable(t, fn, limit = 8){
  for (let i = 0; i < limit; i++){
    const next = fn(t);
    if (next === t) return t;
    t = next;
  }
  return t;
}
/* ────────── КАВЫЧКИ ────────── */

/* Одним проходом слева направо со счётчиком глубины.
   Раньше это были два правила: quotes ставило ёлочки, а quotes-nested потом
   искало «…«…» — но к тому моменту кавычки уже спрятаны в маркеры, и regex
   по литералу «  не находил ничего. Глубину надо считать на прямых кавычках.

   Открывающая — та, перед которой начало строки, пробел или открывающая
   скобка/тире. Всё остальное закрывает. */
R("quotes","Кавычки","Ёлочки «…» и вложенные „лапки“",'Прямые " → «…„…“…»',true,t=>{
  const nested = enabled["quotes-nested"];
  const OPEN  = ["«","„"], CLOSE = ["»","“"];
  let depth = 0, out = "";

  for (let i = 0; i < t.length; i++){
    const c = t[i];
    if (c !== '"'){ out += c; continue; }

    const prev = i > 0 ? t[i-1] : "";
    const isOpen = prev === "" || /[\s([{—–\-\n]/.test(prev);

    if (isOpen){
      const lvl = nested ? Math.min(depth, 1) : 0;
      out += mark(OPEN[lvl], lvl ? "quotes-nested" : "quotes");
      depth++;
    } else {
      depth = Math.max(0, depth - 1);
      const lvl = nested ? Math.min(depth, 1) : 0;
      out += mark(CLOSE[lvl], lvl ? "quotes-nested" : "quotes");
    }
  }
  return out;
});
/* Не самостоятельный проход — переключатель для правила выше.
   Держим отдельной строкой, чтобы у пользователя был свой чекбокс. */
R("quotes-nested","Кавычки",'Вложенные „лапки“','«Он сказал „да“»',true,t=>t);
R("apostrophe","Кавычки","Апостроф ’","O'Rurke → O’Rurke",true,t=>
  t.replace(new RegExp(`([${LET}])'([${LET}])`,"gu"),(m,a,b)=>a+mark("’","apostrophe")+b));

/* ────────── ТИРЕ И ДЕФИСЫ ────────── */
R("mdash","Тире и дефисы","Тире вместо дефиса","Слово - слово → слово — слово",true,t=>
  t.replace(/(\s)[-–]([\s ])/gu,(m,a)=>a+mark(MDASH,"mdash")+" "));
R("mdash-start","Тире и дефисы","Тире в начале реплики","«- Привет» → «— Привет»",true,t=>
  t.replace(/^[\s]*[-–](?=\s)/gmu,()=>mark(MDASH,"mdash-start")));
/* Тире уже помечено маркером, в тексте вместо него ⟨OPEN⟩n⟨CLOSE⟩.
   Поэтому ищем и живое тире, и открывающую скобку маркера. */
R("mdash-nbsp","Тире и дефисы","Неразрывный пробел перед тире","Тире не отрывается от слова",true,t=>
  t.replace(new RegExp(`(\\S) (?=${MDASH}|${M_OPEN})`,"gu"),(m,a)=>a+mark(NB,"mdash-nbsp")));

R("ndash-num","Тире и дефисы","Средняя черта в диапазонах","1941-1945 → 1941–1945",true,t=>
  t.replace(/(\d)\s?-\s?(?=\d)/gu,(m,a)=>a+mark(NDASH,"ndash-num")));
R("hyphen-hard","Тире и дефисы","Неразрывный дефис","из-за, кто-то — не рвутся",true,t=>
  t.replace(new RegExp(`([${RU}])-(?=[${RU}])`,"gu"),(m,a)=>a+mark(HYP,"hyphen-hard")));
R("minus","Тире и дефисы","Минус перед числом","-5 °C → −5 °C",false,t=>
  t.replace(/(^|[\s(])-(?=\d)/gmu,(m,a)=>a+mark("−","minus")));

/* ────────── ПРОБЕЛЫ ────────── */
R("sp-dup","Пробелы","Убрать двойные пробелы","«а  б» → «а б»",true,t=>
  t.replace(/ {2,}/g,()=>mark(" ","sp-dup")));
/* % и … исключены: процент отделяется нб-пробелом (nb-units),
   а многоточие в конце фразы примыкает и так. */
R("sp-punct","Пробелы","Пробел перед знаком","«слово ,» → «слово,»",true,t=>
  t.replace(/[ ]+([,.!?;:])/gu,(m,p)=>mark("","sp-punct")+p));
R("sp-after","Пробелы","Пробел после знака","«а,б» → «а, б»",true,t=>
  t.replace(new RegExp(`([,;:])(?=[${LET}])`,"gu"),(m,p)=>p+mark(" ","sp-after")));
R("sp-brackets","Пробелы","Пробелы внутри скобок","«( а )» → «(а)»",true,t=>
  t.replace(/\(\s+/g,()=>"("+mark("","sp-brackets")).replace(/\s+\)/g,()=>mark("","sp-brackets")+")"));
R("nb-short","Пробелы","Нб-пробел после коротких слов","предлоги, союзы, частицы (1–2 буквы)",true,t=>
  t.replace(new RegExp(`(^|[\\s(«„${M_CLOSE}])([${RU}]{1,2}) (?=[${LET}\\d«])`,"gmu"),
    (m,a,w)=>a+w+mark(NB,"nb-short")));
/* «А. С. Пушкин» — узкий нб-пробел и между инициалами, и перед фамилией.
   Прогоняем дважды: второй проход цепляет «С.[ ]Пушкин», позицию которого
   первый проход занял своим lastIndex. */
R("nb-init","Пробелы","Нб-пробел в инициалах","А. С. Пушкин",true,t=>
  untilStable(t, s => s.replace(new RegExp(`([А-ЯЁ]\\.)[ ]+(?=[А-ЯЁ])`,"gu"),
    (m,a)=>a+mark(NNB,"nb-init"))));
/* Только «число + буква». Символы (% ₽ € °) отданы nb-units: там узкий пробел. */
R("nb-num","Пробелы","Нб-пробел между числом и словом","10 кг, 2024 год",true,t=>
  t.replace(new RegExp(`(\\d) (?=[${LET}№])`,"gu"),(m,a)=>a+mark(NB,"nb-num")));
/* «т. д.», «г. Москва», «ул. Тверская» — сокращение не отрывается от слова.
   Длинные варианты раньше коротких, иначе «гг» никогда не совпадёт с «г». */
R("nb-abbr","Пробелы","Нб-пробел в сокращениях","т. е., и т. д., г. Москва",true,t=>{
  const list = ["млрд","млн","тыс","гг","вв","им","ул","пр","стр","обл","руб","коп",
                "т","е","д","п","н","э","г","в","с"];
  const re = new RegExp(`(^|[^${LET}])(${list.join("|")})\\.[ ]+(?=[${LET}\\d])`,"gu");
  return untilStable(t, s => s.replace(re,(m,pre,a)=>pre+a+"."+mark(NB,"nb-abbr")));
});
/* Единицы — узкий нб-пробел. Границу задаём явным lookahead, а не \b:
   после «%» и «°C» идёт точка или запятая, между двумя не-буквами \b не
   срабатывает, и «3 %» оставался с обычным пробелом. */
R("nb-units","Пробелы","Нб-пробел перед единицами","5 кг, 20 °C, 100 %",true,t=>
  t.replace(new RegExp(
    `(\\d)[ ]+(?:(кг|мг|км|см|мм|мл|мин|сек|шт|руб|коп|г|т|м|л|ч|с)(?![${LET}])|(%|°C|°F|₽|\\$|€))`,"gu"),
    (m,a,unit,sym)=>a+mark(NNB,"nb-units")+(unit||sym)));
R("nb-thousand","Пробелы","Разряды в больших числах","1000000 → 1 000 000",false,t=>
  t.replace(/\b(\d{5,})\b/g,(m)=>mark(m.replace(/\B(?=(\d{3})+(?!\d))/g,NNB),"nb-thousand")));
R("trim","Пробелы","Убрать пробелы в конце строк","",true,t=>
  t.replace(/[ \t]+$/gm,()=>mark("","trim")));

/* ────────── ЗНАКИ ────────── */
R("ellipsis","Знаки","Многоточие …","... → …",true,t=>
  t.replace(/\.{3,}/g,()=>mark("…","ellipsis")));
R("copy","Знаки","© ® ™","(c) (r) (tm)",true,t=>
  t.replace(/\((?:c|с)\)/gi,()=>mark("©","copy"))
   .replace(/\((?:r|р)\)/gi,()=>mark("®","copy"))
   .replace(/\(tm\)/gi,()=>mark("™","copy")));
R("times","Знаки","Знак умножения ×","10x15 → 10×15",true,t=>
  t.replace(/(\d)\s?[xх*]\s?(?=\d)/gu,(m,a)=>a+mark("×","times")));
R("plusminus","Знаки","Плюс-минус ±","+/- → ±",true,t=>
  t.replace(/\+\/-/g,()=>mark("±","plusminus")));
R("arrows","Знаки","Стрелки → ←","-> и <-",true,t=>
  t.replace(/<->/g,()=>mark("↔","arrows"))
   .replace(/->/g,()=>mark("→","arrows"))
   .replace(/<-/g,()=>mark("←","arrows")));
R("fractions","Знаки","Дроби ½ ⅓ ¼","1/2 → ½",false,t=>{
  const map={"1/2":"½","1/3":"⅓","2/3":"⅔","1/4":"¼","3/4":"¾","1/8":"⅛"};
  return t.replace(/\b([123])\/([2348])\b/g,(m,a,b)=>{
    const k=a+"/"+b; return map[k]?mark(map[k],"fractions"):m;
  });
});
R("degree","Знаки","Градусы","20 C → 20 °C",false,t=>
  t.replace(/(\d)\s?°?\s?([CFСФ])\b/gu,(m,a,b)=>a+mark(NNB+"°"+(b==="С"?"C":b==="Ф"?"F":b),"degree")));
R("numero","Знаки","Знак номера №","No 5, #5 → № 5",false,t=>
  t.replace(/\b(?:No|Nº|#)\s?(?=\d)/gu,()=>mark("№"+NB,"numero")));
R("shy","Знаки","Убрать мягкие переносы","из копипаста из PDF",true,t=>
  t.replace(new RegExp(SHY,"g"),()=>mark("","shy")));
R("bullets","Знаки","Маркеры списка •","* пункт → • пункт",false,t=>
  t.replace(/^([ \t]*)[*+](?= )/gm,(m,a)=>a+mark("•","bullets")));

/* ────────── ПУНКТУАЦИЯ ────────── */
R("dup-punct","Пунктуация","Убрать дубли знаков","«!!!» → «!»",false,t=>
  t.replace(/([!?,;:])\1+/g,(m,p)=>mark(p,"dup-punct")));
R("upper-after","Пунктуация","Заглавная после точки","",false,t=>
  t.replace(new RegExp(`([.!?]\\s+)([${RU}])`,"gu"),(m,a,b)=>{
    const u=b.toUpperCase();
    return u===b ? m : a+mark(u,"upper-after");
  }));

/* ══════════════════════════════════════════════════════════════
   Порядок применения важен: сначала кавычки/тире, потом пробелы.
══════════════════════════════════════════════════════════════ */
const ORDER = [
  "shy","sp-dup","trim",
  "quotes","quotes-nested","apostrophe",
  "ellipsis","copy","times","plusminus","arrows","fractions","degree","numero","bullets",
  "mdash-start","mdash","ndash-num","hyphen-hard","minus",
  "dup-punct","sp-punct","sp-after","sp-brackets","upper-after",
  // сокращения и инициалы — строго до nb-short: иначе предлог («в г. Москва»)
  // съедает пробел первым и «г.» отрывается от города.
  // nb-units раньше nb-num: иначе «3 %» получит обычный нб-пробел
  // вместо узкого, потому что nb-num матчит любую букву после числа.
  "nb-thousand","nb-abbr","nb-init","nb-units","nb-num","nb-short",
  "mdash-nbsp",
];
const byId = Object.fromEntries(RULES.map(r=>[r.id,r]));
const GROUPS = [...new Set(RULES.map(r=>r.group))];

/* ══════════════════════════════════════════════════════════════
   Движок
══════════════════════════════════════════════════════════════ */
let enabled = {};

function loadPrefs(){
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem("tipograf.rules")||"null"); }catch(_){}
  enabled = {};
  RULES.forEach(r => enabled[r.id] = saved && (r.id in saved) ? !!saved[r.id] : r.def);
}
function savePrefs(){
  try{ localStorage.setItem("tipograf.rules",JSON.stringify(enabled)); }catch(_){}
}

function process(text){
  HITS = {}; FIX = [];
  if (!text) return "";
  let t = text.replace(/\r\n?/g,"\n");
  for (const id of ORDER){
    const r = byId[id];
    if (!r || !enabled[id]) continue;
    try{ t = r.fn(t); }catch(e){ console.warn("rule",id,e); }
  }
  return t;
}

/* Снять маркеры → чистый текст */
const MARK_RE = () => new RegExp(`${M_OPEN}(\\d+)${M_CLOSE}`,"gu");
function unmark(t){
  return t.replace(MARK_RE(),(m,i)=>FIX[+i] ? FIX[+i].value : "");
}

const esc = s => s.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

/* Маркеры → HTML с подсветкой */
function toHTML(t){
  const re = MARK_RE();
  let html = "", last = 0, m;
  const wrapNb = s => s.replace(/[  ]/g,c=>`<span class="nb">${c}</span>`);
  while ((m = re.exec(t))){
    html += wrapNb(esc(t.slice(last,m.index)));
    const fx = FIX[+m[1]] || {id:"?", value:""};
    const id = fx.id, val = fx.value;
    const rule = byId[id];
    const kind = /^nb-|mdash-nbsp/.test(id) ? "nbsp" : "sym";
    const label = rule ? `${rule.name} — ${rule.hint||""}`.replace(/ — $/,"") : id;
    const shown = val === "" ? "" : wrapNb(esc(val));
    html += `<mark class="fix" data-kind="${kind}" data-rule="${id}" title="${esc(label)}">${shown}</mark>`;
    last = m.index + m[0].length;
  }
  html += wrapNb(esc(t.slice(last)));
  return html;
}


/* ── Публичное API ────────────────────────────────────────────── */

/** Прогнать текст. opts.rules — {id: bool}; не указанные берут значение по умолчанию. */
function typo(text, opts){
  const o = opts || {};
  enabled = {};
  RULES.forEach(r => {
    enabled[r.id] = (o.rules && r.id in o.rules) ? !!o.rules[r.id] : r.def;
  });
  const marked = process(text == null ? "" : String(text));
  return {
    text:  unmark(marked),
    hits:  Object.assign({}, HITS),
    fixes: Object.values(HITS).reduce((a, b) => a + b, 0),
    rules: Object.keys(HITS).length,
  };
}

return {
  typo, process, unmark, toHTML, esc,
  RULES, ORDER, byId, GROUPS,
  get HITS(){ return HITS; },
  get FIX(){ return FIX; },
  setEnabled(e){ enabled = e; },
  defaults(){ const e = {}; RULES.forEach(r => e[r.id] = r.def); return e; },
  NB, NNB, MDASH, NDASH, HYP,
};
});
