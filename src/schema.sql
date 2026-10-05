CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    headline TEXT NOT NULL,
    summary TEXT NOT NULL,
    what_happened TEXT NOT NULL,
    why_it_matters TEXT NOT NULL,
    figures_dates TEXT,
    affected_entities TEXT,
    risks_uncertainty TEXT,
    category TEXT DEFAULT 'General',
    georgia_related INTEGER DEFAULT 0,
    source_links TEXT NOT NULL, -- JSON array of [{title, url, trust_score}]
    trust_score INTEGER DEFAULT 0,
    grammar_checked INTEGER DEFAULT 0,
    fact_checked INTEGER DEFAULT 0,
    status TEXT DEFAULT 'raw_research', -- 'raw_research' -> 'edited' -> 'published' / 'rejected'
    published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_published ON articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_trust_score ON articles(trust_score DESC);
CREATE INDEX IF NOT EXISTS idx_category ON articles(category);

-- ─────────────────────────────────────────────────────────────────────────────
-- Operational tables (not part of the content model above). All timestamps UTC.
-- ─────────────────────────────────────────────────────────────────────────────

-- Rolling pool of items collected by the Research agent. Permanent archive:
-- nothing is deleted. An item is "used" once an article cites it.
CREATE TABLE IF NOT EXISTS feed_items (
    id TEXT PRIMARY KEY,                -- sha256(normalized URL), first 32 hex chars
    source_id TEXT NOT NULL,            -- registry id, or registrable domain if unregistered
    source_name TEXT NOT NULL,
    feed_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    snippet TEXT,
    published_at TEXT NOT NULL,         -- ISO-8601 UTC
    fetched_at TEXT NOT NULL,           -- ISO-8601 UTC
    via_social INTEGER DEFAULT 0,       -- discovered through a social aggregator
    georgia INTEGER DEFAULT 0,
    category_hint TEXT,
    offered_count INTEGER DEFAULT 0,    -- times sent to the Research LLM without becoming an article
    article_id TEXT                     -- set when cited by an article
);

CREATE INDEX IF NOT EXISTS idx_feed_items_pool ON feed_items(article_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_fetched ON feed_items(fetched_at);

-- Georgian (and any future language) versions of an article. The English text stays in `articles`.
-- A row is created by the Translator (grammar_checked = 0) and finished by the Georgian Grammar
-- Checker (grammar_checked = 1). An article is published only once its 'ka' row is finished.
CREATE TABLE IF NOT EXISTS article_translations (
    article_id TEXT NOT NULL,
    lang TEXT NOT NULL,                 -- 'ka'
    headline TEXT NOT NULL,
    summary TEXT NOT NULL,
    what_happened TEXT NOT NULL,
    why_it_matters TEXT NOT NULL,
    figures_dates TEXT,
    affected_entities TEXT,
    risks_uncertainty TEXT,
    grammar_checked INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (article_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_translations_pending ON article_translations(lang, grammar_checked, created_at);

-- Optional bar chart per article and language, built only from numbers the sources state
-- (checked in code before it is stored). `data` is JSON: {title, unit, items: [{label, value}]}.
CREATE TABLE IF NOT EXISTS article_charts (
    article_id TEXT NOT NULL,
    lang TEXT NOT NULL,                 -- 'en' (written by Research) | 'ka' (written by the Translator)
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (article_id, lang)
);

-- A picture a feed item came with (media:content, media:thumbnail, an image enclosure, or the first <img> in the
-- item). Hotlinked, never copied. Only items that offered one have a row.
CREATE TABLE IF NOT EXISTS item_images (
    item_id TEXT PRIMARY KEY,           -- feed_items.id
    url TEXT NOT NULL
);

-- The picture a story shows when one of its sources supplied one, with the credit that goes under it.
-- Stories without a row get a public-domain stock photo chosen when they are read (src/stock-photos.ts).
CREATE TABLE IF NOT EXISTS article_images (
    article_id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    credit TEXT NOT NULL,               -- publisher name
    credit_url TEXT NOT NULL,           -- the article the picture came with
    weight REAL NOT NULL,               -- that publisher's credibility weight (SOURCE_PHOTOS=primary keeps only 5.0)
    created_at TEXT NOT NULL
);

-- How much each story matters (0-100), used to rank the front page and the Top 10. Written when the story is drafted:
-- the Research agent's judgement, the number of independent publishers, official source and Georgia bonuses (importance.ts).
CREATE TABLE IF NOT EXISTS article_importance (
    article_id TEXT PRIMARY KEY,
    score INTEGER NOT NULL,             -- the combined 0-100 score
    llm INTEGER NOT NULL,               -- the Research agent's own rating
    publishers INTEGER NOT NULL,        -- independent publishers among the sources
    created_at TEXT NOT NULL
);

-- One row per pipeline execution (cron or manual). Doubles as the run lock (one live run per scope).
CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'all',  -- which stages this run covers, e.g. 'collect' or 'research+edit'
    trigger TEXT NOT NULL,              -- 'cron' | 'manual'
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,               -- 'running' | 'ok' | 'error'
    stats TEXT                          -- JSON
);

CREATE INDEX IF NOT EXISTS idx_runs_started ON pipeline_runs(started_at DESC);

-- Audit trail: every stage decision per article (incl. trust-score breakdown and
-- reject reasons) and per-feed failures.
CREATE TABLE IF NOT EXISTS pipeline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    article_id TEXT,
    stage TEXT NOT NULL,                -- 'collect' | 'research' | 'edit' | 'fact_check' | 'translate' | 'ka_grammar' | 'publish' | 'feed'
    outcome TEXT NOT NULL,              -- 'ok' | 'rejected' | 'error' | 'skipped'
    detail TEXT,                        -- JSON
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_article ON pipeline_events(article_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_stage ON pipeline_events(stage, id DESC);

-- Gemini requests made per model per quota day (the day resets at midnight Pacific, like Google's own quota).
-- Written by the call budget (src/pipeline/budget.ts) so the pipeline can stay under a free-tier allowance.
CREATE TABLE IF NOT EXISTS llm_usage (
    day TEXT NOT NULL,                  -- YYYY-MM-DD in America/Los_Angeles
    model TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, model)
);
