// AI & Technology gadget/tech hub — curated source directory.
//
// This is a standalone directory for a links/browse UI (featured sources, category
// filters, tag search) — it is NOT a feed poller. It does not plug into the
// news-pipeline's sources.ts (which has a different shape: weights, RSS feeds,
// trust tiers for fact-checking). If you later want these outlets polled into the
// same fact-checked article pipeline as your other topics, that is a separate task:
// each entry would need a weight, domains, and (where available) an RSS feed.
//
// Taxonomy note: two source groups you listed don't map cleanly onto the 7 official
// categories below — "General & Flagships" (The Verge, Engadget, CNET, ...) and
// "AI, Machine Learning & Robotics" research press (KDnuggets, Towards Data Science, ...).
// Both were folded into `ai_gadgets` as the closest fit; their more specific identity
// (smart-home coverage, ai-research focus, etc.) is carried in `tags` instead.
// Cybersecurity, enterprise IT, EV/cleantech and space-tech sources from your flat URL
// list were left out as off-brief for a consumer gadget hub; add a category for them
// if you want that coverage later.

export type AiTechCategoryId =
  | 'ai_gadgets'
  | 'smart_home'
  | 'futuristic_design'
  | 'mobile'
  | 'tv_audio'
  | 'hardware_leaks'
  | 'brand_newsrooms';

export interface AiTechCategory {
  id: AiTechCategoryId;
  label: string;
  description: string;
}

export const AI_TECH_CATEGORIES: AiTechCategory[] = [
  { id: 'ai_gadgets', label: 'AI & Next-Gen Gadgets', description: 'Autonomous gear, AI wearables, robotics, cutting-edge hardware, and the general consumer-tech press that covers them.' },
  { id: 'smart_home', label: 'Smart Home & Major Appliances', description: 'Smart refrigerators, laundry tech, connected kitchen appliances, and home automation.' },
  { id: 'futuristic_design', label: 'Futuristic Design & Concept Hardware', description: 'Aesthetic tech, industrial design, and concept gear — the "Instagram Technology page" of hardware.' },
  { id: 'mobile', label: 'Smartphones & Mobile Ecosystems', description: 'Flagship phones, tablets, foldables, and wearables.' },
  { id: 'tv_audio', label: 'TVs, Audio & Home Theater', description: 'Displays, OLED/Mini-LED panels, hi-fi audio, and wireless headphones.' },
  { id: 'hardware_leaks', label: 'Hardware Leaks & PC Tech', description: 'Component roadmaps, pre-release rumors, laptops, and handhelds.' },
  { id: 'brand_newsrooms', label: 'Official Brand Newsrooms', description: 'Direct corporate press-release hubs for major global manufacturers.' },
];

export interface AiTechSource {
  id: string;
  name: string;
  url: string;
  category: AiTechCategoryId;
  tags: string[];
  description: string;
  featured: boolean;
  /** Lower = higher priority within its category. */
  priority: number;
}

const slug = (s: string): string => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface Raw { name: string; url: string; category: AiTechCategoryId; tags: string[]; description: string; featured?: boolean }

const RAW: Raw[] = [
  // ── AI & Next-Gen Gadgets ────────────────────────────────────────────────
  { name: 'The Verge', url: 'https://www.theverge.com', category: 'ai_gadgets', tags: ['general', 'reviews', 'smartphones', 'ai-hardware'], description: 'Broad consumer-tech newsroom covering gadgets, AI, and the companies behind them.', featured: true },
  { name: 'Engadget', url: 'https://www.engadget.com', category: 'ai_gadgets', tags: ['general', 'reviews', 'gadgets'], description: 'Long-running gadget review and news outlet spanning phones, wearables, and smart devices.' },
  { name: 'CNET', url: 'https://www.cnet.com', category: 'ai_gadgets', tags: ['general', 'reviews', 'smart-home', 'appliances'], description: 'Consumer-tech reviews and news site with dedicated kitchen, smart-home, and appliance coverage.' },
  { name: "Tom's Guide", url: 'https://www.tomsguide.com', category: 'ai_gadgets', tags: ['general', 'reviews', 'buying-guides'], description: 'Consumer-tech reviews and buying-guide site covering gadgets, wearables, and smart devices.' },
  { name: 'TechRadar', url: 'https://www.techradar.com', category: 'ai_gadgets', tags: ['general', 'reviews', 'gadgets'], description: 'Consumer-tech news and reviews hub covering phones, computing, and smart devices.' },
  { name: 'Gizmodo', url: 'https://gizmodo.com', category: 'ai_gadgets', tags: ['general', 'gadgets', 'culture'], description: 'Gadget and tech-culture news site known for irreverent coverage of new devices.' },
  { name: 'Ars Technica', url: 'https://arstechnica.com', category: 'ai_gadgets', tags: ['general', 'deep-dives', 'ai-hardware'], description: 'Technically detailed reporting on hardware, AI, and the tech industry for a power-user audience.', featured: true },
  { name: 'Mashable', url: 'https://mashable.com', category: 'ai_gadgets', tags: ['general', 'culture', 'gadgets'], description: 'Consumer-tech and digital-culture news site covering gadget launches and trends.' },
  { name: 'Trusted Reviews', url: 'https://www.trustedreviews.com', category: 'ai_gadgets', tags: ['general', 'reviews'], description: 'UK-based consumer-electronics review site spanning phones, TVs, and appliances.' },
  { name: 'Wired', url: 'https://www.wired.com', category: 'ai_gadgets', tags: ['general', 'ai-hardware', 'culture'], description: 'Technology and culture magazine known for in-depth features on AI, hardware, and emerging tech.', featured: true },
  { name: 'TechCrunch', url: 'https://techcrunch.com', category: 'ai_gadgets', tags: ['general', 'startups-gadgets', 'launches'], description: 'Tech-industry and startup news outlet that also covers major consumer-gadget launches.' },
  { name: 'ReadWrite', url: 'https://readwrite.com', category: 'ai_gadgets', tags: ['general', 'iot', 'ai-hardware'], description: 'Technology news site covering IoT, AI, and emerging consumer hardware.' },
  { name: 'SlashGear', url: 'https://www.slashgear.com', category: 'ai_gadgets', tags: ['general', 'reviews', 'gadgets'], description: 'Consumer-tech news and review outlet covering phones, cars, and smart gadgets.' },
  { name: 'Pocket-lint', url: 'https://www.pocket-lint.com', category: 'ai_gadgets', tags: ['general', 'reviews', 'wearables'], description: 'Consumer-electronics news and reviews site with a focus on wearables and mobile tech.' },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com', category: 'ai_gadgets', tags: ['ai-research', 'ai-hardware', 'deep-dives'], description: "MIT's technology journalism outlet, known for rigorous coverage of AI and emerging hardware.", featured: true },
  { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai', category: 'ai_gadgets', tags: ['ai-research', 'ai-hardware', 'enterprise-ai'], description: "VentureBeat's dedicated AI vertical, covering models, chips, and enterprise AI products." },
  { name: 'Unite.AI', url: 'https://www.unite.ai', category: 'ai_gadgets', tags: ['ai-research', 'ai-hardware'], description: 'AI-focused news and explainer site covering machine learning, robotics, and AI hardware.' },
  { name: 'Synced Review', url: 'https://syncedreview.com', category: 'ai_gadgets', tags: ['ai-research'], description: 'AI research-news outlet summarizing new models, papers, and industry developments.' },
  { name: 'MarkTechPost', url: 'https://www.marktechpost.com', category: 'ai_gadgets', tags: ['ai-research'], description: 'AI and machine-learning news site covering new research, models, and tools.' },
  { name: 'AI News (artificialintelligence-news.com)', url: 'https://www.artificialintelligence-news.com', category: 'ai_gadgets', tags: ['ai-research', 'enterprise-ai'], description: 'Industry news outlet tracking AI adoption, products, and policy.' },
  { name: 'KDnuggets', url: 'https://www.kdnuggets.com', category: 'ai_gadgets', tags: ['ai-research', 'data-science'], description: 'Long-running data-science and machine-learning news and tutorial site.' },
  { name: 'Towards Data Science', url: 'https://towardsdatascience.com', category: 'ai_gadgets', tags: ['ai-research', 'data-science'], description: 'Publication of data-science and machine-learning tutorials and analysis.' },
  { name: 'AI News (ai-news.io)', url: 'https://www.ai-news.io', category: 'ai_gadgets', tags: ['ai-research'], description: 'News aggregator tracking daily developments across the AI industry.' },
  { name: 'The AI Digest', url: 'https://theaidigest.org', category: 'ai_gadgets', tags: ['ai-research'], description: 'Newsletter-style publication summarizing notable AI developments and releases.' },
  { name: 'The Gadget Flow', url: 'https://thegadgetflow.com', category: 'ai_gadgets', tags: ['gadgets', 'discovery', 'crowdfunding'], description: 'Gadget-discovery site spotlighting new and crowdfunded hardware products.' },
  { name: 'Product Hunt', url: 'https://www.producthunt.com', category: 'ai_gadgets', tags: ['gadgets', 'discovery', 'launches'], description: 'Community-driven launch platform where new hardware and software products are surfaced daily.' },

  // ── Smart Home & Major Appliances ────────────────────────────────────────
  { name: 'Reviewed (Appliances)', url: 'https://www.reviewed.com/appliances', category: 'smart_home', tags: ['appliances', 'reviews'], description: "USA Today's product-review arm's dedicated appliance testing and buying-guide section.", featured: true },
  { name: 'Digital Trends (Home)', url: 'https://www.digitaltrends.com', category: 'smart_home', tags: ['smart-home', 'appliances', 'general'], description: 'Consumer-tech outlet with a dedicated home and smart-appliance coverage section.' },
  { name: 'The Ambient', url: 'https://www.theambient.com', category: 'smart_home', tags: ['smart-home', 'home-automation'], description: 'Publication dedicated entirely to smart-home devices and home-automation news.', featured: true },
  { name: 'Wirecutter (Appliances)', url: 'https://www.nytimes.com/wirecutter/', category: 'smart_home', tags: ['appliances', 'reviews', 'buying-guides'], description: "The New York Times's product-recommendation arm, with extensive tested appliance buying guides." },
  { name: 'Good Housekeeping (Appliances)', url: 'https://www.goodhousekeeping.com', category: 'smart_home', tags: ['appliances', 'reviews'], description: "Consumer lifestyle magazine's test-lab-backed appliance reviews and buying guides." },
  { name: 'IoT For All', url: 'https://www.iotforall.com', category: 'smart_home', tags: ['iot', 'home-automation'], description: 'Industry publication covering IoT platforms, devices, and home-automation trends.' },
  { name: 'Stacey on IoT', url: 'https://staceyoniot.com', category: 'smart_home', tags: ['iot', 'home-automation'], description: "Independent newsletter and podcast covering IoT and smart-home technology, run by journalist Stacey Higginbotham." },
  { name: 'SmartHome.com', url: 'https://www.smarthome.com', category: 'smart_home', tags: ['smart-home', 'home-automation', 'retail'], description: 'Smart-home device retailer and resource site covering product news and buying guides.' },

  // ── Futuristic Design & Concept Hardware ─────────────────────────────────
  { name: 'Yanko Design', url: 'https://www.yankodesign.com', category: 'futuristic_design', tags: ['industrial-design', 'concept-tech'], description: 'Industrial-design publication spotlighting futuristic and concept product designs.', featured: true },
  { name: 'Dezeen Tech', url: 'https://www.dezeen.com/technology', category: 'futuristic_design', tags: ['industrial-design', 'concept-tech'], description: "Dezeen's technology vertical, covering design-forward hardware and architecture-adjacent tech.", featured: true },
  { name: 'Designboom', url: 'https://www.designboom.com', category: 'futuristic_design', tags: ['industrial-design', 'concept-tech'], description: 'Design and architecture magazine that regularly covers concept hardware and product design.' },
  { name: 'Uncrate', url: 'https://uncrate.com', category: 'futuristic_design', tags: ['lifestyle-tech', 'gear'], description: "Men's lifestyle and gear site spotlighting premium and design-led gadgets." },
  { name: 'Gear Patrol', url: 'https://www.gearpatrol.com', category: 'futuristic_design', tags: ['lifestyle-tech', 'gear'], description: 'Lifestyle and gear publication covering premium, design-conscious hardware.' },
  { name: 'Trend Hunter', url: 'https://www.trendhunter.com', category: 'futuristic_design', tags: ['concept-tech', 'trend-spotting'], description: 'Trend-spotting platform that aggregates emerging product and design concepts.' },
  { name: 'New Atlas', url: 'https://newatlas.com', category: 'futuristic_design', tags: ['concept-tech', 'science', 'ai-hardware'], description: 'Science and technology magazine covering emerging inventions, concept vehicles, and futuristic hardware.' },
  { name: 'Cool Hunting', url: 'https://www.coolhunting.com', category: 'futuristic_design', tags: ['industrial-design', 'lifestyle-tech'], description: 'Design and culture publication covering innovative product and technology design.' },

  // ── Smartphones & Mobile Ecosystems ──────────────────────────────────────
  { name: 'GSMArena', url: 'https://www.gsmarena.com', category: 'mobile', tags: ['smartphones', 'specs', 'reviews'], description: 'Phone-specification database and news site, a reference standard for device specs.', featured: true },
  { name: 'Gizmochina', url: 'https://www.gizmochina.com', category: 'mobile', tags: ['smartphones', 'china-tech'], description: 'News site focused on Chinese smartphone brands and devices.' },
  { name: 'Android Authority', url: 'https://www.androidauthority.com', category: 'mobile', tags: ['smartphones', 'android', 'reviews'], description: 'Android-focused news, reviews, and analysis site.', featured: true },
  { name: 'Android Police', url: 'https://www.androidpolice.com', category: 'mobile', tags: ['smartphones', 'android'], description: 'Android news and app-focused publication covering devices and platform updates.' },
  { name: '9to5Mac', url: 'https://9to5mac.com', category: 'mobile', tags: ['smartphones', 'apple', 'leaks'], description: 'Apple-focused news site covering iPhone, iOS, and product leaks.', featured: true },
  { name: 'MacRumors', url: 'https://www.macrumors.com', category: 'mobile', tags: ['smartphones', 'apple', 'leaks'], description: 'Apple rumor and news site tracking upcoming product leaks and releases.' },
  { name: '9to5Google', url: 'https://9to5google.com', category: 'mobile', tags: ['smartphones', 'android', 'google'], description: 'Google and Android-focused news and leaks site.' },
  { name: 'PhoneArena', url: 'https://www.phonearena.com', category: 'mobile', tags: ['smartphones', 'specs', 'reviews'], description: 'Phone news, reviews, and specification comparison site.' },
  { name: 'XDA Developers', url: 'https://www.xda-developers.com', category: 'mobile', tags: ['smartphones', 'android', 'modding'], description: 'Android enthusiast and developer community site covering devices, ROMs, and modding.' },
  { name: 'SamMobile', url: 'https://www.sammobile.com', category: 'mobile', tags: ['smartphones', 'samsung', 'leaks'], description: 'Samsung-dedicated news site covering Galaxy device leaks, updates, and releases.' },

  // ── TVs, Audio & Home Theater ────────────────────────────────────────────
  { name: 'RTINGS', url: 'https://www.rtings.com', category: 'tv_audio', tags: ['tv-displays', 'audio', 'lab-tested'], description: 'Lab-tested TV, monitor, and audio reviews with detailed measured performance data.', featured: true },
  { name: 'FlatpanelsHD', url: 'https://www.flatpanelshd.com', category: 'tv_audio', tags: ['tv-displays', 'oled'], description: 'Display-industry news site specializing in OLED, Mini-LED, and TV panel technology.' },
  { name: "What Hi-Fi?", url: 'https://www.whathifi.com', category: 'tv_audio', tags: ['audio', 'hi-fi', 'reviews'], description: 'Hi-fi audio and home-theater equipment review publication.' },
  { name: 'SoundGuys', url: 'https://www.soundguys.com', category: 'tv_audio', tags: ['audio', 'headphones', 'reviews'], description: 'Headphone and audio-equipment review site with measured sound-quality testing.' },
  { name: 'AVForums', url: 'https://www.avforums.com', category: 'tv_audio', tags: ['tv-displays', 'audio', 'home-theater'], description: 'UK-based audio-visual news, reviews, and community forum for home-theater enthusiasts.' },

  // ── Hardware Leaks & PC Tech ──────────────────────────────────────────────
  { name: 'Notebookcheck', url: 'https://www.notebookcheck.net', category: 'hardware_leaks', tags: ['laptops', 'leaks', 'benchmarks'], description: 'Laptop and mobile-hardware review site known for detailed benchmarking.' },
  { name: 'VideoCardz', url: 'https://videocardz.com', category: 'hardware_leaks', tags: ['leaks', 'gpus', 'roadmaps'], description: 'GPU and PC-component leak and roadmap tracking site.', featured: true },
  { name: "Tom's Hardware", url: 'https://www.tomshardware.com', category: 'hardware_leaks', tags: ['pc-hardware', 'benchmarks', 'leaks'], description: 'Long-running PC hardware news, reviews, and benchmarking publication.', featured: true },
  { name: 'GamersNexus', url: 'https://gamersnexus.net', category: 'hardware_leaks', tags: ['pc-hardware', 'benchmarks'], description: 'PC hardware review outlet known for rigorous, engineering-depth component testing.' },
  { name: 'ServeTheHome', url: 'https://www.servethehome.com', category: 'hardware_leaks', tags: ['pc-hardware', 'servers', 'enterprise'], description: 'Server and enterprise-hardware review and news site.' },
  { name: 'TechPowerUp', url: 'https://www.techpowerup.com', category: 'hardware_leaks', tags: ['pc-hardware', 'gpus', 'benchmarks'], description: 'PC hardware news and GPU/CPU database site with community benchmarking tools.' },
  { name: 'Guru3D', url: 'https://www.guru3d.com', category: 'hardware_leaks', tags: ['pc-hardware', 'gpus', 'reviews'], description: 'PC hardware review site with a long history of GPU and driver coverage.' },
  { name: 'Wccftech', url: 'https://wccftech.com', category: 'hardware_leaks', tags: ['pc-hardware', 'leaks', 'semiconductors'], description: 'Hardware and semiconductor news site covering leaks and roadmap rumors.' },
  { name: 'ExtremeTech', url: 'https://www.extremetech.com', category: 'hardware_leaks', tags: ['pc-hardware', 'semiconductors'], description: 'Technology and PC hardware news site with coverage of chips and computing trends.' },
  { name: 'PCGamer Hardware', url: 'https://www.pcgamer.com/hardware', category: 'hardware_leaks', tags: ['pc-hardware', 'gaming'], description: "PC Gamer's hardware vertical, covering components, benchmarks, and buying advice." },

  // ── Official Brand Newsrooms ──────────────────────────────────────────────
  { name: 'Samsung Newsroom', url: 'https://news.samsung.com', category: 'brand_newsrooms', tags: ['brand-press', 'smartphones', 'appliances'], description: "Samsung's official global press hub covering mobile, appliances, and display announcements.", featured: true },
  { name: 'Apple Newsroom', url: 'https://www.apple.com/newsroom', category: 'brand_newsrooms', tags: ['brand-press', 'smartphones'], description: "Apple's official press-release hub for product launches and company news.", featured: true },
  { name: 'Google Blog', url: 'https://blog.google', category: 'brand_newsrooms', tags: ['brand-press', 'ai-hardware', 'smartphones'], description: "Google's official blog covering product launches, AI announcements, and company news.", featured: true },
  { name: 'LG Newsroom', url: 'https://www.lgnewsroom.com', category: 'brand_newsrooms', tags: ['brand-press', 'appliances', 'tv-displays'], description: "LG's official global press hub for appliance, TV, and mobile announcements." },
  { name: 'Dyson Newsroom', url: 'https://www.dyson.com/newsroom', category: 'brand_newsrooms', tags: ['brand-press', 'appliances'], description: "Dyson's official press hub for product launches and company announcements." },
  { name: 'Bosch Home', url: 'https://www.bosch-home.com', category: 'brand_newsrooms', tags: ['brand-press', 'appliances'], description: "Bosch's home-appliance division site, including product and press information." },
  { name: 'Sony Press', url: 'https://www.sony.com/en/Press', category: 'brand_newsrooms', tags: ['brand-press', 'tv-displays', 'audio'], description: "Sony's official press-release hub for electronics, audio, and display announcements." },
  { name: 'Haier Global News', url: 'https://www.haier.com/global/news', category: 'brand_newsrooms', tags: ['brand-press', 'appliances'], description: "Haier's global newsroom covering appliance and smart-home product announcements." },
  { name: 'Whirlpool Corp News', url: 'https://www.whirlpoolcorp.com/news', category: 'brand_newsrooms', tags: ['brand-press', 'appliances'], description: "Whirlpool Corporation's official newsroom for appliance and corporate announcements." },
  { name: 'Panasonic Global Newsroom', url: 'https://news.panasonic.com/global', category: 'brand_newsrooms', tags: ['brand-press', 'appliances', 'electronics'], description: "Panasonic's global press hub for electronics and appliance announcements." },
  { name: 'Miele', url: 'https://www.miele.com', category: 'brand_newsrooms', tags: ['brand-press', 'appliances'], description: "Miele's corporate site, including press and product-announcement information." },
  { name: 'Electrolux Group Newsroom', url: 'https://www.electroluxgroup.com/en/newsroom/', category: 'brand_newsrooms', tags: ['brand-press', 'appliances'], description: "Electrolux Group's corporate newsroom for appliance and sustainability announcements." },
  { name: 'SharkNinja', url: 'https://www.sharkninja.com', category: 'brand_newsrooms', tags: ['brand-press', 'appliances'], description: "SharkNinja's corporate site covering its home-appliance and kitchen product lines." },
  { name: 'Philips News', url: 'https://www.philips.com/a-w/about/news.html', category: 'brand_newsrooms', tags: ['brand-press', 'appliances', 'tv-displays'], description: "Philips's official news hub for product and corporate announcements." },
  { name: 'Xiaomi Discover', url: 'https://www.mi.com/global/discover/', category: 'brand_newsrooms', tags: ['brand-press', 'smartphones', 'ai-hardware'], description: "Xiaomi's product-discovery hub covering new device launches and announcements." },
];

export const AI_TECH_SOURCES: AiTechSource[] = (() => {
  const counters = new Map<AiTechCategoryId, number>();
  return RAW.map((r) => {
    const n = (counters.get(r.category) ?? 0) + 1;
    counters.set(r.category, n);
    return {
      id: slug(r.name),
      name: r.name,
      url: r.url,
      category: r.category,
      tags: r.tags,
      description: r.description,
      featured: r.featured ?? false,
      priority: n,
    };
  });
})();

// ─── Lookups & helpers ────────────────────────────────────────────────────

export const AI_TECH_SOURCE_BY_ID = new Map(AI_TECH_SOURCES.map((s) => [s.id, s]));

export const AI_TECH_CATEGORY_BY_ID = new Map(AI_TECH_CATEGORIES.map((c) => [c.id, c]));

/** All sources in a category, sorted by priority (lower = first). */
export function sourcesByCategory(category: AiTechCategoryId): AiTechSource[] {
  return AI_TECH_SOURCES.filter((s) => s.category === category).sort((a, b) => a.priority - b.priority);
}

/** All sources carrying a given tag, sorted featured-first then priority. */
export function sourcesByTag(tag: string): AiTechSource[] {
  const t = tag.toLowerCase();
  return AI_TECH_SOURCES.filter((s) => s.tags.includes(t)).sort((a, b) => Number(b.featured) - Number(a.featured) || a.priority - b.priority);
}

/** Tier-1 featured sources only, grouped by category order then priority. */
export function featuredSources(): AiTechSource[] {
  const order = new Map(AI_TECH_CATEGORIES.map((c, i) => [c.id, i]));
  return AI_TECH_SOURCES.filter((s) => s.featured).sort((a, b) => (order.get(a.category)! - order.get(b.category)!) || a.priority - b.priority);
}

/** Simple case-insensitive search over name, description, and tags. */
export function searchSources(query: string): AiTechSource[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return AI_TECH_SOURCES.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.tags.some((t) => t.includes(q)));
}

/** Every distinct tag in use, alphabetically — for building a tag-filter UI. */
export const ALL_TAGS: string[] = [...new Set(AI_TECH_SOURCES.flatMap((s) => s.tags))].sort();

/** Total source count per category — for showing counts next to category filters. */
export function countsByCategory(): Record<AiTechCategoryId, number> {
  const out = Object.fromEntries(AI_TECH_CATEGORIES.map((c) => [c.id, 0])) as Record<AiTechCategoryId, number>;
  for (const s of AI_TECH_SOURCES) out[s.category]++;
  return out;
}
