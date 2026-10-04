# Money News

Business, technology and Georgia news that is researched, copy-edited, fact-checked and **translated into Georgian**, every five minutes. Every story carries a trust score (0–100), its sources, and a breakdown of how the score was built. The site is Georgian by default, with an English switch.

One Cloudflare Worker (`moneynews`) serves the site, the API and the pipeline. It replaces the separate `ioane-agent` and `ioane-agent-2` Workers. **To deploy, follow [DEPLOY.md](DEPLOY.md).**

```
 collect ─► Research ─► Copy editor ─► Fact-Checker ─► Georgian ─► Georgian grammar ─► Publish
 (poll      (cluster,    (English;      (trust score,   translator   checker             (only when Georgian
  sources)   draft)       numbers must   double-         (numbers     (case endings,       is checked)
                          not change)    sourcing gate)  must not     verb forms, style)
                                                         change)
 raw_research ─────────► edited ───────► edited + fact_checked ─────────────────────────► published
                         (any stage can end in: rejected)
```

Each stage is a module with the same signature (`StageCtx → result`) in `src/pipeline/` and reads its work from D1 by article status, so stages can run together or in separate invocations, and any one of them can later move to its own Worker.

## Schedule: searching for new information every five minutes

Two modes, chosen with `PIPELINE_MODE`:

| | `staged` (default, **Workers Free**) | `single` (**Workers Paid**) |
|---|---|---|
| Triggers | 5 crons, one minute apart | 1 cron, `*/5 * * * *` |
| Each 5-minute window | `:00` collect · `:01` research + edit · `:02` fact-check + translate · `:03` Georgian grammar + publish · `:04` collect | everything, in order |
| Sources searched per window | about 46 of 301 (two collects of about 23); every feed or search query about every 32 minutes | all 301 every 5 minutes (`FEEDS_PER_RUN=310`) |
| Why | Free allows 50 outbound requests and about 10 ms of CPU **per invocation**, so work is split across invocations | Paid raises both limits a hundredfold |

An article drafted at `:01` is published at `:03`. The five expressions in `wrangler.jsonc` must match `STAGED_CRONS` in `src/pipeline/run.ts` (a test checks that every stage is covered). Free accounts allow five cron triggers in total, so disable the crons on the old agent Workers first.

**CPU on Free.** Parsing feeds is the expensive part. Measured on real feed bodies, parsing costs about 0.34 ms per feed, so a 25-feed collect is roughly 9 ms of parsing before anything else, which is at the edge of Free's limit. If Cloudflare logs `Worker exceeded CPU time limit` (error 1102), lower `FEEDS_PER_RUN` (for example `15`) or move to Workers Paid and `single` mode. The numbers were measured in Node, not on Cloudflare's Free plan, so treat them as a guide.

## Georgian

- **Translator** writes each verified English briefing in natural Georgian (Latin brand names stay Latin with a hyphenated ending, as in `Google-მა`).
- **Georgian grammar checker** is a second, independent pass: spelling, real-word check, case endings (including the narrative case of transitive verbs), verb forms, agreement, singular nouns after numerals, punctuation, English-isms.
- **Georgian proofreader** is a third pass that rewrites nothing. It reads the English and the Georgian side by side and either approves the story or quotes exactly what is wrong (a word that does not exist, a wrong ending, a changed meaning, a sentence no one would write). Code runs first and refuses what a script can see: letters from another script, a word half Latin and half Georgian, archaic letters, Mtavruli capitals, spacing and punctuation errors, a repeated word, a sentence with no full stop. A story that fails goes back to the checker with the quoted problems; a story that cannot get through in 3 attempts is rejected, not published.
- Both stages are guarded in code, not just by prompt: the **digits must be identical** to the English (formatting may change, digits may not) and the text must **really be Georgian**. A failing result is retried and the article is rejected after 3 failed attempts. An LLM outage never counts against an article.
- An article is published only after its Georgian version has been approved by the proofreader. The site does not show a "grammar checked" label; the check simply has to pass first.
- The whole interface is translated (`public/i18n.js`, Georgian by default, English available). Month and weekday names come from tables in the app because some browsers ship no Georgian locale data.
- If the Georgian model is out of quota or not open to the key (HTTP 429, 404 or 403), that call falls back to `GEMINI_MODEL` and the Georgian model is not tried again for 10 minutes, so the Georgian steps slow down instead of stalling; the proofreader still has to approve every story. `GEMINI_MODEL_KA` (set to `gemini-3.8-flash`) lets the three Georgian steps use a stronger model than the rest; the cheap default wrote a non-word into a headline and the checker built on it did not notice.

## The site

A news-site layout in green (light and dark): header with search and the EN/ქარ switch, topic navigation, a lead story, ranked lists, topic panels, and a footer. Georgian is the default.

- **Whole stories.** Click any headline to open the full story: what happened, why it matters, key figures and dates, who is affected, risks and uncertainty. Every list row also shows its sources.
- **Source links.** Each story lists every source it was built from, with the publisher, its kind (official, wire, major press, ...), its credibility weight, and a link that opens the original article in a new tab.
- **Charts.** The front page has an "In numbers" section: key-number cards with sparklines (stories published, last 24 hours, average trust, last update) and one per busy topic, stories per hour (columns), stories per day (area), a topic map (treemap), trust by topic (stacked bars), kinds of sources (donut), the pipeline from items collected to stories published (funnel), average trust by day (line), shares of stories about Georgia and backed by an official source (radial rings), the most cited publishers (bars), day-to-day change (waterfall) and when stories appear (a 7-day by 24-hour heatmap). Each story page has a visual summary about the story itself: key-number tiles from its figures, its own chart (see below) or, when it has none, its key figures side by side when two or more share a unit, the trust score on a gauge, the topic's activity over the last week and a timeline of when each source reported. The verification details (claims checked, score breakdown) are not charted. All of it is drawn in the browser from `/api/stats` and `/api/articles/:id` (`public/charts.js`), with no chart library and no inline styles.
- **Pictures.** A story shows the picture that came with its most credible source (`media:content`, `media:thumbnail`, an image enclosure, or the first `<img>` in the feed item), hotlinked from the publisher, with the publisher credited and linked under it. When none of a story's sources supplied one, it shows a public-domain or CC0 photograph from Wikimedia Commons chosen by topic (Georgian stories draw from a Georgia set), always the same photo for the same story, credited to its photographer. The 46 photographs are listed in `src/stock-photos.ts`; nothing is copied into the repository. `SOURCE_PHOTOS` controls it: `all` (default), `primary` (pictures only from official sources) or `off` (stock photos only). Publishers keep the copyright in their pictures, so the credit and link are not a licence: if a publisher objects, or you want no risk at all, set `SOURCE_PHOTOS` to `off`. Browsers fetch the pictures directly, so the publisher's server sees the visitor's IP address; the pages send `referrerpolicy="no-referrer"` and the CSP allows `https:` images for this reason.
- **Search by time.** The time field is `<input type="time" step="300">`: pick a day and a 5-minute slot (Tbilisi time), or only a slot to match any day.
- **Text search.** `/` (or the magnifier) searches headlines and summaries in the current language.

Each story may carry one chart that the Research agent proposes and the code checks. The agent picks the type that fits the numbers the sources state: `bar`, `line` or `area` (values over time), `donut` (parts of a whole), `treemap`, `funnel`, `waterfall`, `gauge`, `radial` (one value on a scale), `bullet` (values against targets), `radar`, or `timeline` (two or more dated events or deadlines, such as a consultation opening and closing, drawn on a time axis with today marked). Stories about rules, consultations and deals usually have dates even when they have no comparable numbers, so the agent is asked to prefer a chart whenever the sources give numbers or dates. It is stored only if every value, target, maximum and timeline date, and every number inside a label or title, appears in the cited items or the draft (a date counts if its day, month and year are stated, or it is the day an item was published), and if its shape fits its type (a funnel never grows, a donut in percent adds up to at most 100, a gauge needs a stated maximum or a percentage). The Translator carries it into Georgian, and the Georgian chart is kept only if its type, maximum, targets, dates, values and digits are identical. A chart that fails a check is dropped; the story itself is never rejected for it. Stories published before charts existed show their bar chart or none, and still get the tiles, gauge and source timeline.

## Configuration

| Name | Kind | Default | Meaning |
|---|---|---|---|
| `GEMINI_API_KEY` | secret | – | Required for any drafting, editing, fact-checking or translating. Without it the Worker still collects sources but publishes nothing. |
| `ADMIN_KEY` | secret | – | Enables `POST /api/run[/stage]`, sent as `x-admin-key` or `Authorization: Bearer`. Unset = endpoint disabled. |
| `GEMINI_MODEL` | var | `gemini-3.5-flash-lite` | Same variable agent 2 uses. Google retires old models for new accounts (`gemini-2.5-flash` now answers 404 "no longer available to new users"); current names are at <https://ai.google.dev/gemini-api/docs/models>. |
| `GEMINI_MODEL_KA` | var | `gemini-3.8-flash` | Model for the Georgian steps: translate, grammar correction, proofreading. Falls back to `GEMINI_MODEL` if removed. |
| `GEMINI_BASE_URL` | var | Google's endpoint | Route calls through a gateway (e.g. Cloudflare AI Gateway). |
| `PIPELINE_MODE` | var | `staged` | `staged` (Free) or `single` (Paid). |
| `FEEDS_PER_RUN` | var | `25` | Sources per collect. Feeds are split into `ceil(301 / FEEDS_PER_RUN)` groups visited in turn: `25` → 13 groups of about 23. Use `310` with `single` on Paid. |
| `WEB_SEARCH` | var | `bing,gdelt` | Open-web news search providers: `bing`, `gdelt`, both, or `off`. See Sources. |
| `MAX_ARTICLES_PER_RUN` | var | `4` | New drafts per research run, and the batch size of every later stage. |
| `PUBLISH_THRESHOLD` | var | `60` | Minimum trust score to publish. |
| `SOURCE_PHOTOS` | var | `all` | `all`: show the picture a source supplied. `primary`: only from official sources. `off`: stock photos only. |

**Per-invocation budget (Free allows 50 outbound requests and 50 D1 queries).** Measured in the test suite with three stories moving through every stage: a collect makes 25 outbound requests and 6 D1 calls; the busiest invocation (research + edit) makes 2 Gemini calls and 19 D1 calls (26 counting each statement inside a batch). A stage makes one Gemini call, or two if the first response fails validation.

## Trust score

`score = credibility (0–40) + corroboration (0–25) + primary evidence (0–20) + claim support (0–15) − penalties`

| Component | How it is computed |
|---|---|
| Credibility | Best non-social source weight, scaled (5.0 → 40) |
| Corroboration | Independent non-social publishers: 1 → 5, 2 → 20, 3+ → 25 |
| Primary evidence | Best source 5.0 → 20, 4.5 → 14, 4.0 → 10, 3.5 → 5 |
| Claim support | Share of the article's claims the sources back, checked by the LLM against each source's excerpt |
| Penalty | −30 per contradicted claim |

A story advances only if **all** gates pass; a high score alone is never enough:
1. at least one non-social source (Hacker News, Reddit and X only help discover stories);
2. two independent publishers **or** one primary source (central bank, statistics office, regulator, ministry, journal);
3. no claim contradicted by its sources;
4. at least 70% of claims supported;
5. score ≥ `PUBLISH_THRESHOLD`.

Source weights live in `src/registry/sources.ts` (5.0 primary/official, 4.5 wires, 4.0 major financial press, 3.5 specialist press and company newsrooms, 2.5–3.0 commentary, 1.0–2.0 social). Sources the spec did not place in a tier were assigned by analogy: exchanges and rating agencies 4.0, trade press 3.5, consultancy research 3.0, aggregators 3.0, blogs and newsletters 2.5. Change a number there and scoring follows. Every decision, with its breakdown and reject reasons, is stored in `pipeline_events`; the UI shows the breakdown when a story is expanded.

## Sources

The registry holds the 13 categories from the brief plus Geopolitics: 412 sources, polled through 301 feeds (251 RSS or Atom, 9 scraped news listings, 41 open-web search queries). The rest have no public feed, or the site refuses automated requests; they still carry a weight, so a citation of them is judged correctly. Reuters has no public feed; Bloomberg and the Wall Street Journal are read through their public section feeds. At most 12 newest items are read per feed.

- **Open-web search.** Besides the named outlets, the agent searches the news web by topic. 32 Bing News queries (about ten results each, from the last 24 hours) and 9 GDELT queries (up to 40 results each, GDELT being a free index of news from tens of thousands of publishers) cover economics, trade, startups and venture capital, marketing, real estate, crypto, AI, geopolitics and Georgia. A result is credited to the publisher it came from (a registered outlet, or just its domain, weighted 2.0 like any unknown publisher), never to the search, and the page it links to is the publisher's own. Aggregators that only repeat other sites (MSN, Yahoo, Google News, AOL, Flipboard and the like) are left out, so a syndicated copy cannot count as a second source. Unknown publishers can corroborate a story, but they cannot lift it over the publish threshold on their own: before a cluster is sent to the model its best possible trust score is computed (every claim backed), and a cluster that cannot reach the threshold is not drafted. GDELT asks for one request every five seconds, so at most one GDELT query runs per collect. **Terms:** Bing's RSS terms allow personal, non-commercial use; set `WEB_SEARCH` to `gdelt` or `off` if that does not fit how the site is used. GDELT is free to use with attribution.
- **Topic balance.** Which clusters are drafted each run is decided by priority plus a lift for topics with few stories in the last 24 hours (4 for none, 2 for one, and so on), and each pick counts against its topic, so one busy area cannot crowd the others out. The same run drafts up to `MAX_ARTICLES_PER_RUN` stories.
- **Georgia.** NBG, GeoStat, the Ministry of Finance and the Georgian Stock Exchange publish no RSS, so their HTML news listings are read by link pattern (`kind: 'page'`). The first time a listing is seen, its existing links are recorded as old news so a backlog does not flood the pool. The Revenue Service has no scrapeable listing and is weight-only.
- **Georgian outlets.** Netgazeti has a feed. Interpressnews (English edition), Georgia Today, Imedi, Kvira and Liberali have none, so their news listings are read by link pattern. Georgian-language headlines are matched across outlets by word root, so two Georgian outlets covering the same event can corroborate each other. Tabula, BM.ge, 1TV, Rustavi 2, Agenda.ge, Presa and Business Media refuse automated requests or have no feed, so they are weight-only. The three broadcasters (Imedi, 1TV, Rustavi 2) are weighted 3.0 (commentary): their coverage can be partisan.
- **Geopolitics.** Eleven feeds feed the topic: the BBC, Guardian, New York Times and WSJ/Bloomberg world and politics sections, Deutsche Welle, France 24, Al Jazeera, Euronews, Foreign Policy, the Council on Foreign Relations, UN News, the Council of the EU and the US State Department. The Research agent attributes every claim to whoever made it.
- **Weights for sources the brief did not place** follow the tiers by analogy: news sites and trade press 3.5, think tanks and company blogs 3.0, newsletters and how-to blogs 2.5. Change a number in `src/registry/sources.ts` and scoring follows.
- **Additions beyond the brief:** Civil.ge (Georgian press, so official Georgian data has independent corroboration), and the trade feeds agent 2 already polled (Marketing Dive, HousingWire, Supply Chain Dive, FreightWaves, Banking Dive, Finextra, Realtor.com).
- **Importance.** The Top 10 and the front-page lead rank by importance, not by trust. When the Research agent drafts a story it also rates how much the story matters (0 to 100: reach, size, whether it is a decision or a shock rather than commentary, how new), and the score stored with the story combines that rating (55%), how many independent publishers report it (30%), a bonus for an official source (8) and for Georgia (7). The trust score still decides whether a story is published at all. Stories from before this existed use a stand-in from their trust score.
- **Not polled on purpose:** the general Nature and Science feeds. They carry essays and non-business science that would pass the primary-source rule and crowd out news.
- A dead or blocked feed never fails a run: it is logged to `pipeline_events` (`stage = 'feed'`) and counted in `/api/status`.

## API

| Endpoint | |
|---|---|
| `GET /api/articles?lang=&tab=&date=&time=&q=&limit=&before=` | `lang`: `en` (default) or `ka`. In `ka`, only stories whose Georgian version passed the grammar checker are listed, with the Georgian text. `tab`: `top10`, `all`, `georgia`, `ai-tech`, `economics`, `crypto`, `marketing`, `real-estate`, `global-trade`, `geopolitics`, `vc-startups`. `top10` is the ten stories that matter most right now: `importance`, minus 0.8 for every hour since publication, `LIMIT 10`. Every story has `importance` (0 to 100). `time=HH:MM` matches the 5-minute slot `[HH:MM, HH:MM+5)` in Asia/Tbilisi, on any day, or on `date=YYYY-MM-DD` if given. `q` (2+ characters) searches headline and summary (the Georgian text for `lang=ka`). Each source has `tier`: `primary`, `wire`, `major`, `specialist`, `commentary`, `unclassified` or `social`. Each story has an `image`: `{url, credit, credit_url, kind}` where `kind` is `source` or `stock`. Timestamps in the response are UTC. |
| `GET /api/articles/:id?lang=` | One story plus its trust breakdown, its optional `chart` (`{title, unit, items:[{label, value}]}`) and a `timeline` of the cited items (`{name, url, at}`, oldest first). |
| `GET /api/stats` | Numbers for the front-page charts: `perHour` (24 buckets), `byCategory`, `trustSpread`, `sourceTiers`, `avgTrust`. |
| `GET /api/slots?date=&tab=` | Stories per 5-minute slot (feeds the tape in the UI). |
| `GET /api/meta` | Tabs, counts, next cron slot, last run, and `writing` (false when no Gemini key is set, which the site shows as "new stories are paused"). |
| `GET /api/status` | Health: last run, queue sizes, feed errors in 24h, and `warnings` (for example a missing `GEMINI_API_KEY`). No secrets. |
| `GET /api/admin/events?stage=&outcome=&article=&limit=` | Admin only. The audit trail, newest first: what a stage decided and why (for example the words the Georgian proofreader quoted). |
| `GET /api/admin/runs?scope=&status=&limit=` | Admin only. Recent pipeline runs with their duration and per-stage results; a run still `running` long after it started died mid-way (for example by hitting the CPU limit). |
| `POST /api/run[/stage]` | Admin only. Runs the whole pipeline, or one stage (`collect`, `research`, `edit`, `fact_check`, `translate`, `ka_grammar`, `publish`), now. |

All stored timestamps are UTC ISO-8601. The browser renders them in `Asia/Tbilisi`.

## Database

`schema.sql` holds the `articles` table exactly as specified, plus operational tables: `article_translations` (the Georgian text, one row per article and language), `article_charts` (the optional bar chart, one row per article and language), `feed_items` (the rolling pool of collected items), `item_images` and `article_images` (the picture a feed item came with, and the one a story shows with its credit), `pipeline_runs` (also the run lock, one live run per scope) and `pipeline_events` (audit trail). The Worker creates these tables itself on first use (`src/db-init.ts`, generated from `schema.sql` by `npm run build`), so a fresh database needs no setup. It is safe to re-run. If a different `articles` table already exists in the target database, `CREATE TABLE IF NOT EXISTS` will not change it, so use a fresh database.

Articles, translations and feed items are never deleted. Run and event logs older than 30 days are trimmed daily. Drafts not published within 24 hours are rejected as stale.

## Develop

```bash
npm install
npm run build                        # regenerates src/schema.ts and the stylesheet
npm run db:init && npm run db:seed   # local D1 + clearly-labelled "[Sample]" stories, in both languages
npm run dev                          # http://localhost:8787
curl "http://localhost:8787/__scheduled?cron=2-59%2F5+*+*+*+*"   # fire one staged trigger
npm test                             # unit + integration tests (real SQLite semantics)
npm run typecheck
```

`seed.sql` is demo content for local use only. Never run it against production.

## Known limits

- **The Georgian has not been read by a native speaker.** The interface text, the agents' prompts and the demo content were written without native review. The proofreader pass and the code guards catch a lot, but they are models and scripts, not a person, and cannot be tested here against a live model. Before launch, have a Georgian speaker read the interface strings in `public/i18n.js` and a day of generated stories, and consider `GEMINI_MODEL_KA` set to a larger model (`gemini-3.8-flash`). The default `gemini-3.5-flash-lite` is the cheapest tier and the one most likely to slip on Georgian grammar.
- **Gemini calls are tested against a fake, not live.** The request shape is the same as agent 2's working call plus `system_instruction`; the environment this was built in had no key. Check `GET /api/status` after the first cron runs (`warnings` says if the key is missing; a redeploy that drops it leaves the site up but unable to write stories, and `keep_vars` in `wrangler.jsonc` is there to stop dashboard variables being replaced by a deploy): `lastError` shows the latest stage-level failure (for example Gemini rejecting the model name).
- **The Free plan's CPU limit is the main risk** (see above). Workers Paid removes it.
- **Fact-checking judges claims against feed excerpts** (title plus up to 600 characters), not full articles. Briefings are therefore short, and the Research prompt forbids facts the excerpts do not state. Translation fidelity is guarded by the digit check and the grammar pass, not by a second fact-check of the Georgian.
- **Source titles are shown as published** (mostly English), even in the Georgian interface.
- **Syndicated copies count as separate publishers** when they appear under another domain.
- `ioane-agent` (agent 1) was not available to read, so nothing from it was carried over.
