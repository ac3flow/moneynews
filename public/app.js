// Bulab.news front end. No framework, no build step for JS. Hash routes:
//   #/                 front page        #/t/<tab>[?date=&time=]   a list (Top 10, All, Georgia, topics)
//   #/s/<id>           one whole story   #/about                   how stories are made
// All story text is written with textContent (never innerHTML): it is LLM-generated from web sources.

import { bullets, columns, donut, eventTimeline, funnel, gantt, gauge, hbars, lineChart, network, parliament, pie, radar, radialBars, rose, slope, stackedRows, treemap, waffle, waterfall, wordCloud } from './charts.js';
import { coverMarkup } from './covers.js';
import { h, icon } from './dom.js';
import { DEFAULT_LANG, LANGS, makeT, plural } from './i18n.js';

const TZ = 'Asia/Tbilisi';
const POLL_MS = 30_000;
const DELAYED_AFTER_MS = 12 * 60_000;
const PAGE = 20;

const FALLBACK_TABS = ['top10', 'all', 'georgia', 'ai-tech', 'economics', 'crypto', 'real-estate', 'global-trade', 'geopolitics', 'vc-startups'].map((id) => ({ id }));
const TAB_OF_CATEGORY = { 'AI & Tech': 'ai-tech', Economics: 'economics', Crypto: 'crypto', 'Real Estate': 'real-estate', 'Global Trade': 'global-trade', Geopolitics: 'geopolitics', 'VC & Startups': 'vc-startups' };
const CATEGORY_ORDER = ['AI & Tech', 'Economics', 'Crypto', 'Real Estate', 'Global Trade', 'Geopolitics', 'VC & Startups', 'General'];

const $ = (id) => document.getElementById(id);

// ─── storage (can be blocked; everything works without it) ──────────────────
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

// ─── state ──────────────────────────────────────────────────────────────────
function pickLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(q)) return q;
  const saved = store.get('lang');
  return LANGS.includes(saved) ? saved : DEFAULT_LANG;
}

const S = {
  lang: pickLang(),
  theme: store.get('theme'), // 'light' | 'dark' | null (dark, the brand look)
  tabs: FALLBACK_TABS,
  meta: null,
  skew: 0, // server clock minus local clock, ms
  seen: null, // newest published_at the reader has been shown
  newStories: false,
  route: { name: 'home', a: null, q: new URLSearchParams() },
  token: 0,
};
let t = makeT(S.lang);

// ─── time (Asia/Tbilisi) ────────────────────────────────────────────────────
// Intl supplies only the numbers (in Tbilisi time). Month and weekday NAMES come from tables, because
// not every browser ships Georgian locale data and Intl silently falls back to English without it.
const MONTHS = {
  ka: ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const WEEKDAYS = {
  ka: ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const partsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }); // YYYY-MM-DD

function tbParts(ms) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: +p.day, month: +p.month, year: +p.year, hour: +p.hour, minute: +p.minute, weekday: WEEKDAYS.en.indexOf(p.weekday) };
}
const pad2 = (n) => String(n).padStart(2, '0');

function tb(iso) {
  const p = tbParts(Date.parse(iso));
  const short = `${p.day} ${MONTHS[S.lang][p.month - 1]}`;
  return { time: `${pad2(p.hour)}:${pad2(p.minute)}`, short, date: `${short} ${p.year}`, hour: p.hour };
}

/** "შაბათი, 3 ოქტ" / "Saturday 3 Oct" for a Tbilisi calendar date. */
function longDay(ymd) {
  const p = tbParts(Date.parse(`${ymd}T12:00:00+04:00`));
  return `${WEEKDAYS[S.lang][p.weekday]}${S.lang === 'ka' ? ',' : ''} ${p.day} ${MONTHS[S.lang][p.month - 1]}`;
}

const serverNow = () => Date.now() + S.skew;
const todayTb = () => dayFmt.format(new Date(serverNow()));
const toMin = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
const fromMin = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const snap = (hhmm) => fromMin(toMin(hhmm) - (toMin(hhmm) % 5));
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s ?? '');

function ago(iso) {
  const s = Math.max(0, (serverNow() - Date.parse(iso)) / 1000);
  if (s < 60) return t('justNow');
  if (s < 3600) return t('minAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return t('hourAgo', { n: Math.floor(s / 3600) });
  return null;
}
/** Relative for the last day, otherwise "3 Oct, 14:35". */
const whenText = (iso) => ago(iso) ?? `${tb(iso).short}, ${tb(iso).time}`;
const whenTitle = (iso) => t('whenTitle', { date: tb(iso).date, time: tb(iso).time });
const fmtNum = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

// ─── api ────────────────────────────────────────────────────────────────────
// `fresh` bypasses both the browser cache and ours. Used for the meta poll and explicit refreshes.
const memo = new Map();
let freshUntil = 0; // after "new stories" every request skips the browser cache for a few seconds
async function api(path, { fresh = false } = {}) {
  fresh ||= Date.now() < freshUntil;
  const hit = memo.get(path);
  if (!fresh && hit && Date.now() - hit.at < 20_000) return hit.value;
  const res = await fetch(path, { cache: fresh ? 'no-store' : 'default', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const value = await res.json();
  memo.set(path, { at: Date.now(), value });
  return value;
}
const A = (qs) => `/api/articles?lang=${S.lang}&${qs}`;

// ─── routing ────────────────────────────────────────────────────────────────
function parseRoute() {
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: seg[0] || 'home', a: seg[1] ?? null, q: new URLSearchParams(qs) };
}
function go(path) {
  const next = `#${path}`;
  if (location.hash === next) render();
  else location.hash = next;
}
const tabPath = (tab, { date, time } = {}) => {
  // both values are validated, so they need no escaping and the URL stays readable: ?date=2026-10-03&time=14:35
  const q = [validDate(date) ? `date=${date}` : '', validTime(time) ? `time=${time}` : ''].filter(Boolean).join('&');
  return `/t/${tab}${q ? `?${q}` : ''}`;
};
const storyHref = (a) => `#/s/${encodeURIComponent(a.id)}`;

// ─── small view helpers ─────────────────────────────────────────────────────
function catName(c) {
  const v = t(`cat.${c}`);
  return v === `cat.${c}` ? c : v;
}
const tabName = (id) => t(`tab.${id}`);
const safeHref = (u) => (/^https?:\/\//i.test(u) ? u : null);
// A Latin name with a hyphenated Georgian ending ("WTO-მ") must not break after the hyphen. U+2060 is an invisible word joiner.
const tx = (s) => String(s ?? '').replace(/([A-Za-z0-9])-(?=[\u10D0-\u10FF])/g, '$1-\u2060');
const kfOf = (a) => a.figures?.find((f) => /\d/.test(f.value) && f.value.length <= 14)?.value ?? null;

const httpsImg = (u) => /^https:\/\//i.test(u ?? '');

/**
 * A story's picture: the photo that came with its sources (or a public-domain stock photo), hotlinked,
 * with the generated cover art as the fallback if the photo is missing or fails to load.
 */
function cover(a, cls = '', { kf = false, credit = false, eager = false, onFail } = {}) {
  const el = h('div', { class: `media ${cls}`.trim() });
  el.innerHTML = coverMarkup(a.id, a.category); // generated from numbers only, never from story text; it is the placeholder under a photo
  const img = a.image;
  if (img && httpsImg(img.url)) {
    el.classList.add('photo');
    const pic = h('img', { src: img.url, alt: '', loading: eager ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    pic.addEventListener(
      'error',
      () => {
        pic.remove();
        el.querySelector('.credit')?.remove();
        el.classList.remove('photo');
        onFail?.();
      },
      { once: true },
    );
    el.append(pic);
    if (credit && img.credit) el.append(h('span', { class: 'credit', text: t('photoBy', { name: img.credit }) }));
  }
  const k = kf ? kfOf(a) : null;
  if (k) el.append(h('span', { class: 'kf', text: k }));
  return el;
}

function uniqueSources(a) {
  const seen = new Set();
  return (a.sources ?? []).filter((s) => safeHref(s.url) && !seen.has(s.name) && seen.add(s.name));
}

function sourceChips(a) {
  const list = uniqueSources(a).slice(0, 4);
  if (!list.length) return null;
  return h(
    'div',
    { class: 'src-line' },
    h('span', { class: 'lbl', text: `${t('secSources')}:` }),
    list.map((s) => h('a', { class: 'src-chip', href: s.url, target: '_blank', rel: 'noopener noreferrer nofollow', title: s.title }, s.name, icon('out', 11))),
  );
}

function rankItem(a, n) {
  return h(
    'a',
    { class: 'rank-item', href: storyHref(a) },
    h('span', { class: 'rank-num', 'aria-hidden': 'true', text: n }),
    h(
      'span',
      { class: 'rank-body' },
      h('span', { class: 'kicker accent', text: catName(a.category) }),
      h('span', { class: 'rank-title' }, h('span', { class: 'link-reveal', text: tx(a.headline) })),
      h('span', { class: 'rank-meta' }, h('span', { text: whenText(a.published_at), title: whenTitle(a.published_at) })),
    ),
  );
}

function listItem(a, rank) {
  const tab = TAB_OF_CATEGORY[a.category] ?? 'all';
  return h(
    'article',
    { class: 't-item' },
    h(
      'div',
      { class: `t-grid${rank ? ' ranked' : ''}` },
      rank ? h('span', { class: 'big-rank', 'aria-hidden': 'true', text: rank }) : null,
      h(
        'div',
        { class: 't-copy' },
        h('a', { class: 'kicker accent', href: `#/t/${tab}`, text: catName(a.category) }),
        h(
          'a',
          { href: storyHref(a) },
          h('span', { class: 't-title balance' }, h('span', { class: 'link-reveal', text: tx(a.headline) })),
          h('span', { class: 't-sum', text: tx(a.summary) }),
          h(
            'span',
            { class: 'meta-line' },
            h('time', { datetime: a.published_at, title: whenTitle(a.published_at), text: whenText(a.published_at) }),
            a.georgia_related ? h('span', { class: 'kicker accent', text: t('georgiaTag') }) : null,
          ),
        ),
        sourceChips(a),
      ),
      h('a', { class: 't-thumb', href: storyHref(a), tabindex: '-1', 'aria-hidden': 'true' }, cover(a, 'ar-16-10', { kf: true })),
    ),
  );
}

function topicPanel(title, tab, list) {
  return h(
    'div',
    { class: 'panel panel-pad' },
    h('div', { class: 'panel-head' }, h('h2', { text: title }), h('a', { class: 'more-link', href: `#/t/${tab}`, text: `${t('fullList')} →` })),
    h('div', { class: 'rank-list' }, list.length ? list.map((a, i) => rankItem(a, i + 1)) : h('p', { class: 'rank-meta', text: t('emptyTab') })),
  );
}

const shell = (...kids) => h('div', { class: 'shell' }, ...kids);
const skeleton = () => shell(h('div', { class: 'lead-grid' }, h('div', { class: 'skel h1' }), h('div', { class: 'skel h1' })), h('div', { class: 'feat-grid' }, h('div', { class: 'skel h2' }), h('div', { class: 'skel h2' }), h('div', { class: 'skel h2' })));

function emptyBox(title, body, action) {
  return shell(h('div', { class: 'panel empty' }, h('h2', { text: title }), h('p', { text: body }), action ?? null));
}
const retryBtn = () => h('button', { type: 'button', class: 'btn', onclick: () => render(true), text: t('retry') });

// ─── live bar ───────────────────────────────────────────────────────────────
function liveBar() {
  const el = shell(
    h(
      'div',
      { class: 'notice', role: 'status' },
      h('span', { class: 'live-line' }, h('span', { class: 'dot live-dot', 'aria-hidden': 'true' }), h('span', { class: 'live-text', text: t('liveConnecting') })),
      h('button', { type: 'button', class: 'newbtn', hidden: !S.newStories, onclick: showNew, text: t('newBtn') }),
    ),
  );
  queueMicrotask(renderLive);
  return el;
}

function renderLive() {
  const m = S.meta;
  if (!m) return;
  const last = m.lastRunAt ? Date.parse(m.lastRunAt) : null;
  const remaining = Math.max(0, Date.parse(m.nextRunAt) - serverNow());
  let text;
  let cls = 'live';
  if (last === null) {
    text = t('liveWaiting');
    cls = 'late';
  } else if (serverNow() - last > DELAYED_AFTER_MS) {
    text = t('liveDelayed', { time: tb(m.lastRunAt).time });
    cls = 'late';
  } else if (m.writing === false) {
    // the site is running but cannot write new stories (no Gemini key): say so instead of counting down to nothing
    text = t('livePaused', { time: m.lastPublishedAt ? tb(m.lastPublishedAt).time : '–' });
    cls = 'late';
  } else {
    text = remaining === 0 ? t('liveRunning') : t('liveOk', { mm: pad2(Math.floor(remaining / 60000)), ss: pad2(Math.floor((remaining % 60000) / 1000)) });
  }
  for (const el of document.querySelectorAll('.live-text')) el.textContent = text;
  for (const el of document.querySelectorAll('.live-dot')) el.className = `dot live-dot ${cls}`;
  for (const el of document.querySelectorAll('.newbtn')) el.hidden = !S.newStories;
}

async function refreshMeta() {
  try {
    const m = await api('/api/meta', { fresh: true });
    S.skew = Date.parse(m.now) - Date.now();
    const had = S.tabs !== FALLBACK_TABS;
    S.meta = m;
    if (Array.isArray(m.tabs) && m.tabs.length) S.tabs = m.tabs;
    if (S.seen === null) S.seen = m.lastPublishedAt;
    S.newStories = !!(m.lastPublishedAt && S.seen && m.lastPublishedAt > S.seen);
    if (!had) renderNav();
    renderLive();
    if (S.newStories && canAutoRefresh()) showNew();
  } catch {
    for (const el of document.querySelectorAll('.live-text')) el.textContent = t('liveOffline');
    for (const el of document.querySelectorAll('.live-dot')) el.className = 'dot live-dot off';
  }
}

/**
 * New stories appear on their own when the reader is looking at a list from the top and is not in the
 * middle of anything (typing a time, searching, reading a story). Otherwise the "new stories" button waits.
 */
function canAutoRefresh() {
  const r = S.route;
  const listing = r.name === 'home' || (r.name === 't' && !r.q.get('date') && !r.q.get('time'));
  const busy = $('modal').classList.contains('open') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  return listing && !busy && window.scrollY < 150 && document.visibilityState === 'visible';
}

function showNew() {
  S.seen = S.meta?.lastPublishedAt ?? S.seen;
  S.newStories = false;
  memo.clear();
  freshUntil = Date.now() + 8000;
  render(true);
}

// ─── time search ────────────────────────────────────────────────────────────
function timeBar(tab, q) {
  const date = h('input', { type: 'date', value: validDate(q.get('date')) ? q.get('date') : '' });
  const time = h('input', { type: 'time', step: '300', value: validTime(q.get('time')) ? q.get('time') : '' });
  const active = validDate(q.get('date')) || validTime(q.get('time'));
  return h(
    'form',
    {
      class: 'panel timebar',
      onsubmit: (e) => {
        e.preventDefault();
        go(tabPath(tab, { date: date.value, time: time.value ? snap(time.value) : '' }));
      },
    },
    h('h2', { text: t('tsTitle') }),
    h('label', { class: 'field' }, h('span', { text: t('tsDate') }), date),
    h('label', { class: 'field' }, h('span', { text: t('tsTime') }), time),
    h('button', { type: 'submit', class: 'btn', text: t('tsGo') }),
    active ? h('button', { type: 'button', class: 'btn ghost', onclick: () => go(`/t/${tab}`), text: t('tsClear') }) : null,
    h('p', { class: 'hint', text: t('tsHint') }),
  );
}

function filterText(q) {
  const date = validDate(q.get('date')) ? q.get('date') : null;
  const time = validTime(q.get('time')) ? snap(q.get('time')) : null;
  if (time) return t(date ? 'filterDayTime' : 'filterAnyDayTime', { day: date ? longDay(date) : '', from: time, to: fromMin(toMin(time) + 4) });
  return date ? t('filterDay', { day: longDay(date) }) : null;
}

// ─── chart helpers ──────────────────────────────────────────────────────────
// Axis numbers: 120K, 3.4M, and two decimals when the whole range is small (3.12, 3.25), so close values stay distinguishable.
const compact = (n, range = 100) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: range < 5 ? 2 : 1 }).format(n);
/** A line that hovers far above zero would look flat from zero, so its scale starts just below its lowest point, on round numbers. */
function zoomScale(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (!(lo > 0) || hi - lo >= 0.6 * hi) return {};
  const range = Math.max(hi - lo, hi * 0.01);
  const p = 10 ** Math.floor(Math.log10(range / 2));
  const m = range / 2 / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  const yMin = Math.floor((lo - range * 0.25) / step) * step;
  let n = Math.ceil((hi + range * 0.15 - yMin) / step);
  if (n % 2) n++; // an even number of steps puts a whole-number gridline in the middle
  const fix = (x) => Number(x.toFixed(6));
  return { yMin: fix(yMin), yMax: fix(yMin + n * step) };
}

// ─── views ──────────────────────────────────────────────────────────────────
async function viewHome() {
  const list = (await api(A('tab=all&limit=50'))).articles;
  const parts = [liveBar()];

  if (!list.length) {
    parts.push(emptyBox(t('emptyTitle'), t('emptyBody')));
    return parts;
  }

  // Lead: the stories that matter most in the last day and a half (or of everything, if it is a slow day).
  const fresh = list.filter((a) => serverNow() - Date.parse(a.published_at) < 36 * 3600_000);
  const pool = fresh.length >= 3 ? fresh : list;
  // What matters most right now: importance, less a little for every hour since publication (the same rule as the Top 10).
  const lead = (a) => (a.importance ?? 0) - 0.8 * Math.max(0, (serverNow() - Date.parse(a.published_at)) / 3600_000);
  const ranked = [...pool].sort((a, b) => lead(b) - lead(a) || (a.published_at < b.published_at ? 1 : -1));
  const [top, ...rest] = ranked;
  const side = rest.slice(0, 3);
  const feats = rest.slice(3, 6);
  const shown = new Set([top, ...side, ...feats]);

  const hero = h(
    'a',
    { class: 'hero', href: storyHref(top) },
    cover(top, 'scrim', { credit: true, eager: true }),
    h(
      'div',
      { class: 'hero-body' },
      h('div', { class: 'hero-tags' }, h('span', { class: 'pill', text: catName(top.category) }), h('span', { class: 'hero-flag', text: t('topStory') })),
      h('h1', { class: 'balance', text: tx(top.headline) }),
      h('p', { class: 'dek', text: tx(top.summary) }),
      h('div', { class: 'meta-line' }, h('time', { datetime: top.published_at, title: whenTitle(top.published_at), text: whenText(top.published_at) }), h('span', { text: plural(t, 'sources', uniqueSources(top).length) })),
    ),
  );
  parts.push(
    shell(
      h(
        'div',
        { class: `lead-grid${side.length ? '' : ' solo'}` },
        hero,
        side.length
          ? h(
              'aside',
              { class: 'panel panel-pad lead-side' },
              h('div', { class: 'panel-head' }, h('h2', { text: t('alsoTop') })),
              h('div', { class: 'rank-list' }, side.map((a, i) => rankItem(a, i + 2))),
              h('a', { class: 'more-link', href: '#/t/top10', text: `${t('allTop10')} →` }),
            )
          : null,
      ),
      feats.length
        ? h(
            'div',
            { class: 'feat-grid' },
            feats.map((a) =>
              h(
                'a',
                { class: 'feat', href: storyHref(a) },
                cover(a, 'scrim', { credit: true }),
                h('div', { class: 'feat-body' }, h('span', { class: 'pill', text: catName(a.category) }), h('h3', { text: tx(a.headline) }), h('time', { datetime: a.published_at, text: whenText(a.published_at) })),
              ),
            ),
          )
        : null,
    ),
  );

  parts.push(shell(timeBar('all', new URLSearchParams())));

  // Latest stories (chronological) beside topic panels.
  const latestRows = list.filter((a) => !shown.has(a)).slice(0, 10);
  const groups = CATEGORY_ORDER.map((c) => ({ c, items: list.filter((a) => a.category === c).sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)).slice(0, 4) })).filter((g) => g.items.length);
  const georgia = list.filter((a) => a.georgia_related).sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)).slice(0, 4);
  if (latestRows.length) {
    parts.push(
      shell(
        h(
          'section',
          { class: 'sec' },
          h('div', { class: 'split-grid' }, h('div', {}, h('div', { class: 'sec-head' }, h('h2', { text: t('latest') }), h('a', { class: 'more-link', href: '#/t/all', text: `${t('allStories')} →` })), latestRows.map((a) => listItem(a))), h('div', { class: 'side-stack' }, georgia.length ? topicPanel(tabName('georgia'), 'georgia', georgia) : null, groups.slice(0, 2).map((g) => topicPanel(catName(g.c), TAB_OF_CATEGORY[g.c] ?? 'all', g.items)))),
        ),
      ),
    );
  }
  const used = latestRows.length ? 2 : 0;
  const more = groups.slice(used);
  if (more.length)
    parts.push(
      shell(h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h2', { text: t('byTopic') })), h('div', { class: 'topic-grid' }, more.map((g) => topicPanel(catName(g.c), TAB_OF_CATEGORY[g.c] ?? 'all', g.items))))),
    );
  return parts;
}

async function viewTab(r) {
  const id = r.a ?? 'all';
  if (!S.tabs.some((x) => x.id === id)) return viewNotFound();
  const date = validDate(r.q.get('date')) ? r.q.get('date') : '';
  const time = validTime(r.q.get('time')) ? snap(r.q.get('time')) : '';
  const base = `tab=${id}&limit=${PAGE}${date ? `&date=${date}` : ''}${time ? `&time=${time}` : ''}`;
  const first = await api(A(base));
  const ranked = id === 'top10';
  const filter = filterText(r.q);
  const isCat = !['top10', 'all', 'georgia'].includes(id);

  const rows = h('div', { class: 'list-wrap' }, first.articles.map((a, i) => listItem(a, ranked ? i + 1 : 0)));
  const holder = h('div', {});
  let cursor = first.nextBefore;
  const more = h('button', { type: 'button', class: 'btn ghost loadmore', text: t('more'), hidden: !cursor });
  more.addEventListener('click', async () => {
    more.disabled = true;
    try {
      const next = await api(A(`${base}&before=${encodeURIComponent(cursor)}`));
      rows.append(...next.articles.map((a) => listItem(a, 0)));
      cursor = next.nextBefore;
      more.hidden = !cursor;
    } catch (e) {
      holder.replaceChildren(h('p', { class: 'foot-note', text: t('errBody', { err: e.message }) }));
    }
    more.disabled = false;
  });

  document.title = `${tabName(id)} · ${t('docTitle')}`;
  return [
    liveBar(),
    shell(
      h('div', { class: 'page-top' }, h('h1', { text: tabName(id) }), h('p', { text: isCat ? t('tabNoteCat', { name: tabName(id) }) : t(`tabNote.${id}`) })),
      timeBar(id, r.q),
      filter ? h('p', { class: 'filter-line' }, h('span', { text: filter }), h('span', { class: 'muted', text: plural(t, 'stories', first.articles.length) })) : null,
      first.articles.length ? [rows, more, holder] : h('div', { class: 'panel empty' }, h('h2', { text: filter ? t('emptySlotTitle') : t('emptyTitle') }), h('p', { text: filter ? t('emptySlotBody') : t('emptyBody') })),
    ),
  ];
}

const dayNumber = (ymd) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000);
/** "31 Dec 2026" for a calendar date written YYYY-MM-DD (no time zone involved). */
const dateLabel = (ymd, { year = true } = {}) => `${+ymd.slice(8, 10)} ${MONTHS[S.lang][+ymd.slice(5, 7) - 1]}${year ? ` ${ymd.slice(0, 4)}` : ''}`;

function datedEvents(items, aria) {
  const today = dayNumber(todayTb());
  const sameYear = new Set(items.map((i) => i.date.slice(0, 4))).size === 1;
  return eventTimeline(
    items.map((i) => {
      const d = dayNumber(i.date) - today;
      return { label: i.label, day: dayNumber(i.date), short: dateLabel(i.date, { year: !sameYear }), long: dateLabel(i.date), rel: d === 0 ? t('tlToday') : d > 0 ? plural(t, 'inDays', d) : plural(t, 'daysAgo', -d) };
    }),
    { today, todayLabel: t('tlToday'), aria },
  );
}

/**
 * A story with too few graphs of its own still shows its key figures: two or more that share a unit (percent, a currency,
 * billions) become bars, and a lone percentage becomes a gauge. Returns null when nothing can be drawn.
 */
function figureGraph(figures) {
  const MONEY = /^(%|percent|პროცენტ|[$€£]|usd|eur|gel|dollars?|euros?|bn|mn|billion|million|trillion|მლრდ|მლნ|ტრლნ|დოლარ|ევრო|ლარ)/i;
  const groups = new Map();
  for (const f of figures) {
    const m = /^\s*([$€£])?\s*([−-]?\d[\d\s,]*(?:\.\d+)?)\s*(.*?)\s*$/.exec(f.value);
    if (!m || !f.label) continue;
    const num = Number(m[2].replace(/[\s,]/g, '').replace('−', '-'));
    const unit = `${m[1] ?? ''}${m[3]}`.toLowerCase().replace(/[\s.]+/g, '');
    if (!Number.isFinite(num) || !MONEY.test(unit)) continue;
    groups.set(unit, [...(groups.get(unit) ?? []), { label: f.label, value: Math.abs(num), text: f.value, unit }]);
  }
  const best = [...groups.values()].sort((x, y) => y.length - x.length)[0];
  if (best && best.length >= 2) return { title: t('vzFigures'), body: hbars(best.slice(0, 6)) };
  const pct = [...groups.values()].flat().find((f) => /^(%|percent|პროცენტ)/i.test(f.unit) && f.value <= 100);
  return pct ? { title: pct.label, body: gauge(pct.value, 100, { text: pct.text, aria: `${pct.label}: ${pct.text}` }) } : null;
}

const STOP_EN = new Set('the and for with from that this have has had been were was are will would could should may might not but its their they them his her our your you who what when how why can about into over under after before than then also more most such new says said say just now one two three per via off out get take make according report reports reported while which where there these those other some any each both being does did very still only'.split(' '));
const STOP_KA = new Set('და რომ არის იყო იქნება ამ ეს ის იმ თუ კი ან არ მისი მათი მის მას ასევე შესახებ შემდეგ წინ წლის დღეს გუშინ ახალი ბოლო ყველა როგორც მაგრამ რადგან სადაც ჯერ უკვე კიდევ მხოლოდ აქვს აქვთ უნდა შეიძლება თუმცა რაც რასაც მიხედვით'.split(' '));

/**
 * The words a story is built around, from its own text: how often each is used (grouped by stem, so "bank" and "banks" count
 * together), with the organisations and places it names kept whole and counted extra. Up to 16, weighted 1 to 5.
 */
function keyTerms(a) {
  const text = [a.headline, a.summary, a.what_happened, a.why_it_matters, a.risks_uncertainty].join(' ');
  const stems = new Map();
  const bump = (key, form, n) => {
    const e = stems.get(key) ?? { n: 0, forms: new Map() };
    e.n += n;
    e.forms.set(form, (e.forms.get(form) ?? 0) + n);
    stems.set(key, e);
  };
  for (const w of text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
    const low = w.toLowerCase();
    const ka = /[\u10d0-\u10ff]/.test(low);
    if (low.length < 4 || /^\d/.test(low) || (ka ? STOP_KA : STOP_EN).has(low)) continue;
    bump(ka ? low.slice(0, 5) : low.replace(/(ies|es|s)$/, ''), low, 1);
  }
  const names = (a.affected_entities ?? []).filter((e) => e.length >= 3);
  const inName = new Set(names.flatMap((e) => e.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []));
  const terms = [...stems.values()]
    .map((e) => ({ text: [...e.forms].sort((x, y) => y[1] - x[1])[0][0], n: e.n }))
    .filter((e) => !inName.has(e.text))
    .concat(names.map((e) => ({ text: e, n: 3 + (text.toLowerCase().split(e.toLowerCase()).length - 1) })));
  const top = terms.sort((x, y) => y.n - x.n).slice(0, 16);
  if (top.length < 6) return [];
  const max = top[0].n;
  const sized = top.map((e) => ({ text: e.text, w: e.n / max >= 0.8 ? 5 : e.n / max >= 0.55 ? 4 : e.n / max >= 0.35 ? 3 : e.n / max >= 0.2 ? 2 : 1 }));
  // the biggest words in the middle, the smaller ones around them
  const ordered = [];
  sized.forEach((e, i) => (i % 2 === 0 ? ordered.push(e) : ordered.unshift(e)));
  return ordered;
}

/** One chart from the optional, source-checked spec the Research agent proposed (bar when the type is missing). */
function specChart(c) {
  const val = (n) => `${fmtNum(n)}${c.unit === '%' ? '%' : c.unit ? ` ${c.unit}` : ''}`;
  const items = c.items;
  const values = items.map((i) => i.value);
  const aria = c.title;
  switch (c.type) {
    case 'line':
    case 'area':
      return lineChart({ labels: items.map((i) => i.label), series: [{ values, area: c.type === 'area', cls: 's1', tip: (i) => `${items[i].label}: ${val(values[i])}` }], ...(c.type === 'line' ? zoomScale(values) : {}), fmt: (n) => compact(n, Math.max(...values) - Math.min(...values)), aria });
    case 'donut':
      return donut(items.map((i) => ({ label: i.label, n: Math.max(0, i.value), text: val(i.value) })), { aria });
    case 'treemap':
      return treemap(items.map((i) => ({ label: i.label, n: Math.max(0, i.value), text: val(i.value) })), { aria });
    case 'funnel':
      return funnel(items.map((i) => ({ label: i.label, value: i.value, text: val(i.value) })), { aria });
    case 'waterfall':
      return waterfall(items.map((i, k) => ({ label: i.label, value: i.value, text: k === 0 ? val(i.value) : `${i.value > 0 ? '+' : i.value < 0 ? '−' : ''}${val(Math.abs(i.value))}` })));
    case 'gauge': {
      const [it] = items;
      return gauge(it.value, c.max ?? 100, { text: val(it.value), label: it.label, aria });
    }
    case 'radial': {
      const [it] = items;
      return radialBars([{ label: it.label, value: it.value, max: c.max ?? 100, text: val(it.value) }], { center: { value: val(it.value), label: it.label }, aria });
    }
    case 'bullet':
      return bullets(items.map((i) => ({ label: i.label, value: i.value, target: i.target, text: val(i.value), targetText: t('targetN', { n: val(i.target) }) })));
    case 'timeline':
      return datedEvents(items, aria);
    case 'column':
      return columns({ labels: items.map((i) => i.label), series: [{ name: c.title, values }], fmt: (n) => compact(n, Math.max(...values)), aria });
    case 'grouped':
    case 'stacked': {
      const names = c.series ?? [];
      if (c.type === 'stacked') return stackedRows({ rows: items.map((i) => ({ label: i.label, parts: i.values ?? [] })), names, fmt: (n) => val(n), aria });
      return columns({ labels: items.map((i) => i.label), series: names.map((name, k) => ({ name, values: items.map((i) => i.values?.[k] ?? 0) })), fmt: (n) => compact(n, Math.max(...items.flatMap((i) => i.values ?? [0]))), aria });
    }
    case 'slope':
      return slope(items.map((i) => ({ label: i.label, a: i.value, b: i.to ?? i.value, aText: val(i.value), bText: val(i.to ?? i.value) })), { from: c.series?.[0] ?? '', to: c.series?.[1] ?? '', aria });
    case 'gantt': {
      const sameYear = new Set(items.flatMap((i) => [i.date.slice(0, 4), i.end.slice(0, 4)])).size === 1;
      return gantt(items.map((i) => ({ label: i.label, start: dayNumber(i.date), end: dayNumber(i.end), range: `${dateLabel(i.date, { year: !sameYear })} – ${dateLabel(i.end)}` })), { today: dayNumber(todayTb()), todayLabel: t('tlToday'), aria });
    }
    case 'network':
      return network({ nodes: items.map((i) => ({ label: i.label })), links: c.links ?? [], aria });
    case 'pie':
      return pie(items.map((i) => ({ label: i.label, n: Math.max(0, i.value), text: val(i.value) })), { aria });
    case 'waffle':
      return waffle(items[0].value, { text: val(items[0].value), label: items[0].label, aria });
    case 'rose':
      return rose(items.map((i) => ({ label: i.label, n: Math.max(0, i.value), text: val(i.value) })), { aria });
    case 'parliament':
      return parliament(items.map((i) => ({ label: i.label, n: i.value, text: String(i.value) })), { center: String(values.reduce((t, v) => t + v, 0)), aria });
    case 'radar':
      return radar(items.map((i) => ({ label: i.label, value: i.value, text: val(i.value) })), { max: c.max ?? (c.unit === '%' ? 100 : Math.max(...values) * 1.1), aria });
    default:
      return hbars(items.map((i) => ({ label: i.label, value: i.value, text: val(i.value) })));
  }
}

/**
 * The story told in graphs: up to three source-checked graphs of different types, each describing a part of this story. A story
 * with fewer than two gets its key figures drawn (bars, or a gauge for one percentage) and a cloud of its key words, so every
 * story has real graphs. Goes under "About this story".
 */
function storyGraphs(a, data) {
  const items = (data.charts ?? []).map((c) => ({ title: c.title, body: specChart(c) }));
  if (items.length < 2) {
    const figures = figureGraph(a.figures ?? []);
    if (figures) items.push(figures);
  }
  if (items.length < 2) {
    const terms = keyTerms(a);
    if (terms.length) items.push({ title: t('vzTerms'), body: wordCloud(terms, { aria: t('vzTerms') }) });
  }
  if (!items.length) return null;
  return h('section', { class: 'panel panel-pad art-viz', 'aria-labelledby': 'viz-h' }, h('h2', { id: 'viz-h', class: 'h-sm', text: t('vizTitle') }), items.map((i) => h('figure', { class: 'graph-block' }, h('figcaption', { text: i.title }), i.body)));
}

async function viewStory(r) {
  if (!r.a) return viewNotFound();
  let data;
  try {
    data = await api(`/api/articles/${encodeURIComponent(r.a)}?lang=${S.lang}`);
  } catch (e) {
    if (String(e.message).includes('404')) return viewNotFound();
    throw e;
  }
  const a = data.article;
  const tab = TAB_OF_CATEGORY[a.category] ?? 'all';
  const relatedRes = await api(A(`tab=${tab}&limit=6`)).catch(() => ({ articles: [] }));
  const related = relatedRes.articles.filter((x) => x.id !== a.id).slice(0, 3);
  const srcs = uniqueSources({ sources: a.sources });
  const paras = a.what_happened.split(/\n+/).map((s) => s.trim()).filter(Boolean);

  document.title = `${a.headline} · ${t('docTitle')}`;
  const about = h(
    'div',
    { class: 'panel panel-pad about art-about' },
    h('p', { class: 'kicker muted', text: t('aboutTitle') }),
    h(
      'dl',
      {},
      h('div', {}, h('dt', { text: t('aboutCategory') }), h('dd', {}, h('a', { href: `#/t/${tab}`, text: catName(a.category) }))),
      h('div', {}, h('dt', { text: t('aboutPublished') }), h('dd', { class: 'tnum', title: whenTitle(a.published_at), text: `${tb(a.published_at).date}, ${tb(a.published_at).time}` })),
      a.fact_checked ? h('div', {}, h('dt', { text: t('aboutFacts') }), h('dd', {}, h('span', { class: 'vbadge' }, icon('check', 14), t('verified')))) : null,
    ),
  );

  const read = h(
    'div',
    { class: 'panel read-panel' },
    h('section', {}, h('h2', { class: 'h-md', text: t('secWhat') }), h('div', { class: 'prose sp-top' }, paras.map((p) => h('p', { text: tx(p) })))),
    h('section', { class: 'sumbox', 'aria-labelledby': 'why-h' }, h('h2', { id: 'why-h', text: t('secWhy') }), h('p', { text: tx(a.why_it_matters) })),
    a.figures.length
      ? h('section', { class: 'block' }, h('h2', { class: 'h-sm', text: t('secFigures') }), h('ul', { class: 'fig-list' }, a.figures.map((f) => (f.label ? h('li', {}, h('span', { text: f.label }), h('b', { text: f.value })) : h('li', { class: 'plain' }, h('b', { text: f.value }))))))
      : null,
    a.affected_entities.length ? h('section', { class: 'block' }, h('h2', { class: 'h-sm', text: t('secAffected') }), h('div', { class: 'chips' }, a.affected_entities.map((e) => h('span', { class: 'chip', text: e })))) : null,
    a.risks_uncertainty ? h('section', { class: 'sumbox risk', 'aria-labelledby': 'risk-h' }, h('h2', { id: 'risk-h', text: t('secRisks') }), h('p', { text: tx(a.risks_uncertainty) })) : null,
    srcs.length
      ? h(
          'section',
          { class: 'block', 'aria-labelledby': 'src-h' },
          h('h2', { id: 'src-h', class: 'h-sm', text: t('secSources') }),
          h('p', { class: 'src-note', text: t('srcNote') }),
          h(
            'ul',
            { class: 'src-list' },
            srcs.map((s) =>
              h(
                'li',
                {},
                h(
                  'a',
                  { class: 'src', href: s.url, target: '_blank', rel: 'noopener noreferrer nofollow' },
                  h('span', {}, h('b', { text: s.name }), h('small', { text: s.title }), h('span', { class: 'src-meta' }, h('span', { text: t(`tier.${s.tier}`) }))),
                  h('span', { class: 'go' }, t('srcOpen'), icon('out', 15)),
                ),
              ),
            ),
          ),
        )
      : null,
    related.length ? h('section', { class: 'related block', 'aria-labelledby': 'rel-h' }, h('h2', { id: 'rel-h', class: 'h-md', text: t('related') }), related.map((x) => listItem(x))) : null,
  );

  const img = a.image;
  const credit = img && httpsImg(img.url) && safeHref(img.credit_url) ? h('a', { class: 'photo-credit', href: img.credit_url, target: '_blank', rel: 'noopener noreferrer nofollow', text: t('photoBy', { name: img.credit }) }) : null;
  const hero = h(
    'header',
    { class: 'art-hero' },
    cover(a, 'flush', { eager: true, onFail: () => credit?.remove() }),
    credit,
    h(
      'div',
      { class: 'shell' },
      h(
        'div',
        { class: 'art-hero-in' },
        h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/', text: t('crumbHome') }), h('span', { 'aria-hidden': 'true', text: '/' }), h('a', { class: 'cur', href: `#/t/${tab}`, text: catName(a.category) })),
        h('h1', { class: 'balance', text: tx(a.headline) }),
        h('p', { class: 'dek', text: tx(a.summary) }),
        h(
          'div',
          { class: 'meta-line' },
          h('time', { class: 'ico', datetime: a.published_at, title: whenTitle(a.published_at) }, icon('clock', 14), `${tb(a.published_at).date}, ${tb(a.published_at).time}`),
          a.georgia_related ? h('span', { text: t('georgiaTag') }) : null,
          h('span', { text: plural(t, 'sources', srcs.length) }),
        ),
      ),
    ),
  );

  return [h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i', { id: 'prog' })), h('article', {}, hero, shell(h('div', { class: 'art-wrap' }, h('div', { class: 'art-grid' }, read, h('div', { class: 'art-side' }, about, storyGraphs(a, data))))))];
}

function viewAbout() {
  document.title = `${t('aboutPageTitle')} · ${t('docTitle')}`;
  const steps = ['Research', 'Editor', 'Fact', 'Translator'].map((k) => [t(`how${k}Label`), t(`how${k}`)]);
  const kinds = ['w5', 'w45', 'w4', 'w35', 'w25', 'w1'];
  return shell(
    h(
      'div',
      { class: 'page-top' },
      h('h1', { text: t('aboutPageTitle') }),
      h('p', { text: t('aboutPageLead') }),
      h('ol', { class: 'steps' }, steps.map(([label, text]) => h('li', {}, h('b', { text: label }), ' ', text))),
      h('h2', { class: 'h-md sp-top-lg', text: t('aboutKinds') }),
      h('ul', { class: 'kinds' }, kinds.map((k) => h('li', { text: t(k) }))),
      h('h2', { class: 'h-md sp-top-lg', text: t('howGatesTitle') }),
      h('p', { text: t('howGates') }),
      h('h2', { class: 'h-md sp-top-lg', text: t('howSearchTitle') }),
      h('p', { text: t('howSearch') }),
    ),
  );
}

function viewNotFound() {
  return emptyBox(t('notFound'), t('notFoundBody'), h('a', { class: 'btn', href: '#/', text: t('backHome') }));
}

// ─── chrome: header, nav, footer ────────────────────────────────────────────
function wordmark(extra = {}) {
  return h('a', { class: 'wordmark', href: '#/', ...extra }, h('b', { text: 'BULAB' }), h('span', { text: '.news' }));
}

function renderHeader() {
  const other = S.lang === 'ka' ? 'en' : 'ka';
  $('hdr').replaceChildren(
    h(
      'div',
      { class: 'shell' },
      h(
        'div',
        { class: 'hdr-row' },
        wordmark({ 'aria-label': t('brandAria') }),
        h(
          'div',
          { class: 'hdr-tools' },
          h('button', { type: 'button', class: 'search-btn', onclick: openSearch, 'aria-label': t('searchAria') }, icon('search'), h('span', { text: t('searchPlaceholder') }), h('kbd', { text: '/' })),
          h('button', { type: 'button', class: 'icon-btn search-icon', onclick: openSearch, 'aria-label': t('searchAria') }, icon('search')),
          h('button', { type: 'button', class: 'icon-btn lang-btn', onclick: () => setLang(other), 'aria-label': `${t('langAria')}: ${other.toUpperCase()}`, lang: other }, h('i', { class: S.lang === 'ka' ? 'on' : '', text: 'ქარ' }), h('i', { 'aria-hidden': 'true', text: '/' }), h('i', { class: S.lang === 'en' ? 'on' : '', text: 'EN' })),
          h('button', { type: 'button', class: 'icon-btn', onclick: toggleTheme, 'aria-label': t('themeAria') }, icon(isDark() ? 'sun' : 'moon')),
        ),
      ),
    ),
    h('nav', { class: 'nav', 'aria-label': t('navAria') }, h('div', { class: 'shell' }, h('button', { type: 'button', class: 'nav-arrow', 'aria-label': t('navLeft'), onclick: () => scrollNav(-1) }, icon('left', 16)), h('div', { class: 'nav-scroll', id: 'nav-scroll' }), h('button', { type: 'button', class: 'nav-arrow', 'aria-label': t('navRight'), onclick: () => scrollNav(1) }, icon('right', 16)))),
  );
  renderNav();
}

function scrollNav(dir) {
  $('nav-scroll')?.scrollBy({ left: dir * 260 });
}

function renderNav() {
  const box = $('nav-scroll');
  if (!box) return;
  const r = S.route;
  const cur = r.name === 'home' ? 'home' : r.name === 't' ? (r.a ?? 'all') : null;
  box.replaceChildren(h('a', { href: '#/', 'aria-current': cur === 'home' ? 'page' : null, text: t('crumbHome') }), ...S.tabs.map((tab) => h('a', { href: `#/t/${tab.id}`, 'aria-current': cur === tab.id ? 'page' : null, text: tabName(tab.id) })));
  box.querySelector('[aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function renderFooter() {
  $('foot').replaceChildren(
    h(
      'div',
      { class: 'shell' },
      h(
        'div',
        { class: 'foot-grid' },
        h('div', {}, wordmark({ 'aria-label': t('brandAria') }), h('p', { class: 'foot-tag', text: t('footTag') })),
        h(
          'div',
          { class: 'foot-cols' },
          h('div', {}, h('h2', { text: t('footTopics') }), h('ul', {}, S.tabs.map((tab) => h('li', {}, h('a', { href: `#/t/${tab.id}`, text: tabName(tab.id) }))))),
          h('div', {}, h('h2', { text: t('footPages') }), h('ul', {}, h('li', {}, h('a', { href: '#/', text: t('crumbHome') })), h('li', {}, h('a', { href: '#/about', text: t('aboutPageTitle') })))),
        ),
      ),
      h('div', { class: 'foot-base' }, h('span', { text: t('footCopy', { year: new Date().getFullYear() }) }), h('span', { text: t('footTime') })),
    ),
  );
}

// ─── theme and language ─────────────────────────────────────────────────────
const isDark = () => S.theme !== 'light'; // dark is the brand look; light only when the reader picks it
function applyTheme() {
  if (S.theme) document.documentElement.setAttribute('data-theme', S.theme);
  else document.documentElement.removeAttribute('data-theme');
}
function toggleTheme() {
  S.theme = isDark() ? 'light' : 'dark';
  store.set('theme', S.theme);
  applyTheme();
  renderHeader();
}

function setLang(lang) {
  if (lang === S.lang) return;
  S.lang = lang;
  t = makeT(lang);
  store.set('lang', lang);
  applyLang();
  renderHeader();
  renderFooter();
  render(true);
}
function applyLang() {
  document.documentElement.lang = S.lang;
  document.title = t('docTitle');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('docDesc'));
  $('skip').textContent = t('skip');
  $('q').placeholder = t('searchPlaceholder');
  $('q').setAttribute('aria-label', t('searchAria'));
  $('modal-close').textContent = t('searchClose');
  $('modal').setAttribute('aria-label', t('searchAria'));
}

// ─── search ─────────────────────────────────────────────────────────────────
let searchTimer = 0;
let searchFrom = null;
function openSearch() {
  searchFrom = document.activeElement;
  $('modal').classList.add('open');
  $('res').replaceChildren(h('p', { class: 'modal-hint', text: t('searchStart') }));
  $('q').value = '';
  $('q').focus();
}
function closeSearch() {
  $('modal').classList.remove('open');
  searchFrom?.focus?.();
}
async function runSearch() {
  const q = $('q').value.trim();
  if (q.length < 2) return $('res').replaceChildren(h('p', { class: 'modal-hint', text: t('searchStart') }));
  try {
    const j = await api(A(`tab=all&limit=8&q=${encodeURIComponent(q)}`));
    if ($('q').value.trim() !== q) return; // superseded by newer typing
    $('res').replaceChildren(
      ...(j.articles.length
        ? j.articles.map((a) => h('a', { href: storyHref(a), onclick: closeSearch }, h('small', { text: `${catName(a.category)} · ${whenText(a.published_at)}` }), h('b', { text: tx(a.headline) })))
        : [h('p', { class: 'modal-hint', text: t('searchNone') })]),
    );
  } catch (e) {
    $('res').replaceChildren(h('p', { class: 'modal-hint', text: t('errBody', { err: e.message }) }));
  }
}
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);
});
$('modal-close').addEventListener('click', closeSearch);
$('modal').addEventListener('click', (e) => {
  if (e.target === $('modal')) closeSearch();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('modal').classList.contains('open')) return closeSearch();
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault();
    openSearch();
  }
});

// ─── render ─────────────────────────────────────────────────────────────────
const VIEWS = { home: viewHome, t: viewTab, s: viewStory, about: viewAbout };

async function render(keepScroll = false) {
  const r = (S.route = parseRoute());
  const token = ++S.token;
  renderNav();
  document.querySelector('.progress')?.remove();
  const main = $('main');
  main.replaceChildren(skeleton());
  if (!keepScroll) window.scrollTo(0, 0);
  document.title = t('docTitle');
  let out;
  try {
    out = await (VIEWS[r.name] ?? viewNotFound)(r);
  } catch (e) {
    out = emptyBox(t('errTitle'), t('errBody', { err: e.message }), retryBtn());
  }
  if (token !== S.token) return; // a newer navigation took over
  const nodes = [out].flat().filter(Boolean);
  main.replaceChildren(...nodes);
  renderLive();
  onScroll();
}

function onScroll() {
  $('hdr').classList.toggle('stuck', window.scrollY > 4);
  const bar = $('prog');
  if (bar) {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
  }
}

// ─── boot ───────────────────────────────────────────────────────────────────
async function boot() {
  applyTheme();
  applyLang();
  S.route = parseRoute();
  renderHeader();
  renderFooter();
  addEventListener('hashchange', () => render());
  addEventListener('scroll', onScroll, { passive: true });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => !S.theme && renderHeader());
  await refreshMeta();
  renderFooter();
  await render();
  setInterval(renderLive, 1000);
  setInterval(() => document.visibilityState === 'visible' && refreshMeta(), POLL_MS); // a background tab polls nothing: every poll is a D1 read
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshMeta());
}
boot();
