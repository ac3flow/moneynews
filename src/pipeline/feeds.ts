// Feed collection helpers. Ported from agent 2's collector (URL normalisation, regex
// RSS/Atom parsing, UA + timeout), hardened for Atom links and numeric entities, and
// extended with an HTML "page" mode for official sites that publish no RSS.

import type { FeedRef } from '../registry/sources';

export interface RawItem {
  title: string;
  url: string;
  snippet: string;
  /** ISO-8601 UTC. For page feeds this is the time the link was first seen. */
  published: string;
  /** https URL of the picture that came with the item, if any. */
  image?: string;
}

export const UA = 'Mozilla/5.0 (compatible; MoneyNews-agent/1.0)';
const FETCH_TIMEOUT_MS = 8000;
// A feed is re-polled every few minutes, so only the newest items can be new. Fewer items = less CPU.
const MAX_ITEMS_PER_FEED = 12;
const PAGE_CLIP = 150_000;

export async function sha(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const TRACKING = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'cmpid', 'mc_cid', 'mc_eid'];

export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of TRACKING) x.searchParams.delete(k);
    x.pathname = x.pathname.replace(/\/+$/, '') || '/';
    return x.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => safeCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m);
}

function safeCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

export function stripHtml(s: string): string {
  let t = decodeEntities(s || ''); // CDATA and one level of entities (markup escaped as &lt;p&gt;)
  t = t.replace(/<[^>]*>/g, ' ');
  if (t.includes('&')) t = decodeEntities(t); // text entities that were nested inside markup
  return t.replace(/\s+/g, ' ').trim();
}

// ─── pictures ───────────────────────────────────────────────────────────────
const MIN_IMAGE_WIDTH = 300; // smaller than this is a thumbnail, too soft for a lead picture
const BAD_IMAGE = /\.(svg|gif|ico)(\?|$)|\/(logo|favicon|avatar|pixel|tracking|spacer|blank)[^/]*$|[?&/_-](1x1|pixel)\b/i;

/** Normalise a picture URL, or return null if it is not worth showing (not https, a logo, a tracking pixel). */
export function cleanImage(u: string | undefined | null): string | null {
  let s = decodeEntities(u ?? '').trim();
  if (s.startsWith('//')) s = `https:${s}`;
  s = s.replace(/^http:\/\//i, 'https://');
  if (s.length > 600) return null;
  try {
    const x = new URL(s);
    if (x.protocol !== 'https:' || !x.hostname.includes('.') || /^[\d.]+$/.test(x.hostname)) return null;
    // the BBC publishes a 240 px thumbnail but serves the same picture at 976 px
    if (x.hostname === 'ichef.bbci.co.uk') x.pathname = x.pathname.replace(/\/(news|ace\/standard)\/\d+\//, '/$1/976/');
    const out = x.toString();
    return BAD_IMAGE.test(out) ? null : out;
  } catch {
    return null;
  }
}

const attr = (tagText: string, name: string): string | undefined => new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tagText)?.[1];

/** The best picture an RSS/Atom item carries: the widest media:content/thumbnail or image enclosure, else the first <img>. */
export function imageOf(block: string, bodyHtml: string): string | null {
  const found: { url: string; width: number }[] = [];
  for (const m of block.matchAll(/<(media:content|media:thumbnail|enclosure)\b[^>]*>/gi)) {
    const t = m[0];
    const url = attr(t, 'url');
    if (!url) continue;
    const type = attr(t, 'type') ?? '';
    const medium = attr(t, 'medium') ?? '';
    const isImage = type.startsWith('image/') || medium === 'image' || m[1]?.toLowerCase() === 'media:thumbnail' || /\.(jpe?g|png|webp|avif)(\?|$)/i.test(url);
    if (!isImage || type.startsWith('video/') || type.startsWith('audio/')) continue;
    found.push({ url, width: Number(attr(t, 'width')) || 0 });
  }
  found.sort((a, b) => b.width - a.width);
  for (const c of found) {
    if (c.width && c.width < MIN_IMAGE_WIDTH) continue;
    const u = cleanImage(c.url);
    if (u) return u;
  }
  const html = decodeEntities(bodyHtml);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const u = cleanImage(attr(m[0], 'src') ?? attr(m[0], 'data-src'));
    const w = Number(attr(m[0], 'width')) || 0;
    if (u && (!w || w >= MIN_IMAGE_WIDTH)) return u;
  }
  return null;
}

const TAG_RES = new Map<string, RegExp>();
function tag(block: string, name: string): string {
  let re = TAG_RES.get(name);
  if (!re) {
    re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
    TAG_RES.set(name, re);
  }
  return re.exec(block)?.[1] ?? '';
}

function linkOf(block: string): string {
  // Atom: prefer rel="alternate" (or no rel), which may be self-closing.
  for (const m of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const attrs = m[1] ?? '';
    const href = /href=["']([^"']+)["']/i.exec(attrs)?.[1];
    const rel = /rel=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (href && (!rel || rel === 'alternate')) return decodeEntities(href);
  }
  // RSS: <link>https://…</link>
  return stripHtml(tag(block, 'link'));
}

// Workers Free allows ~10 ms of CPU per invocation, so parsing must stay cheap: stop scanning after
// MAX_ITEMS_PER_FEED items (OpenAI's feed has >1,000) and clip long bodies before stripping markup.
const RAW_FIELD_CLIP = 2500;
const clipRaw = (s: string): string => (s.length > RAW_FIELD_CLIP ? s.slice(0, RAW_FIELD_CLIP) : s);

export function parseFeed(xml: string, now: number = Date.now()): RawItem[] {
  const out: RawItem[] = [];
  const blocks = /<(item|entry)[\s>][\s\S]*?<\/\1>/gi;
  let m: RegExpExecArray | null;
  for (let n = 0; n < MAX_ITEMS_PER_FEED && (m = blocks.exec(xml)); n++) {
    const b = m[0];
    const title = stripHtml(tag(b, 'title'));
    const link = linkOf(b);
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const dateRaw = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const d = new Date(stripHtml(dateRaw));
    const published = Number.isNaN(d.getTime()) ? new Date(now) : d;
    const body = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content');
    const snippet = stripHtml(clipRaw(body)).slice(0, 600);
    const image = imageOf(b.length > 20_000 ? b.slice(0, 20_000) : b, body.slice(0, 6000));
    out.push({ title, url: normUrl(link), snippet, published: published.toISOString(), ...(image ? { image } : {}) });
  }
  return out;
}

/** HTML listing -> items. An anchor counts when its resolved path matches `pattern`. */
export function parsePage(html: string, pageUrl: string, pattern: string, now: number = Date.now()): RawItem[] {
  const re = new RegExp(pattern);
  const seen = new Set<string>();
  const out: RawItem[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let abs: URL;
    try {
      abs = new URL(decodeEntities(m[1] ?? ''), pageUrl);
    } catch {
      continue;
    }
    if (!re.test(abs.pathname)) continue;
    const url = normUrl(abs.toString());
    // Listings often put the date in the link text ("02 ოქტომბერი 2026, 17:20 Headline"): keep only the headline.
    const text = stripHtml(m[2] ?? '').replace(/^\d{1,2}\s+\p{L}+\s+\d{4},?\s+\d{1,2}:\d{2}\s*/u, '').replace(/^\d{1,2}:\d{2}\s+/, '');
    if (text.length < 15 || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: clip(text, 140), url, snippet: text.slice(0, 600), published: new Date(now).toISOString() });
    if (out.length >= MAX_ITEMS_PER_FEED) break;
  }
  return out;
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 30)).trim();
}

/** Fetch and parse one feed. Throws on HTTP/network failure (callers use allSettled). */
export async function fetchFeed(feed: FeedRef, now: number = Date.now()): Promise<RawItem[]> {
  const res = await fetch(feed.url, {
    headers: { 'user-agent': UA, accept: feed.kind === 'rss' ? 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*' : 'text/html,*/*' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Page listings can be 300 KB of markup; the newest links come first, so the head of the page is enough (and CPU is scarce).
  const body = feed.kind === 'page' ? (await res.text()).slice(0, PAGE_CLIP) : await res.text();
  const items = feed.kind === 'rss' ? parseFeed(body, now) : parsePage(body, feed.url, feed.pattern ?? '.', now);
  if (items.length === 0) throw new Error('no items parsed');
  return items;
}
