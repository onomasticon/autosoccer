/**
 * Annotated design screenshots for PR review (Chromium via Playwright).
 *
 * Pages and components: numbered callouts are drawn on the live page around real elements,
 * then the screenshot is composed next to a numbered legend. Flows: each step is captured after
 * performing the real interaction and laid out as a numbered storyboard.
 *
 *   node scripts/annotate.mjs --base http://localhost:3000 --out docs/media/design-mockup/annotated \
 *     --match <matchId> --article <slug>
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const base = opt("base", "http://localhost:3000");
const out = opt("out", "out/annotated");
const matchId = opt("match");
const articleSlug = opt("article");
const only = opt("only");
mkdirSync(out, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const viewer = 'section[data-testid="match-viewer"]';

/** Each note: sel (first visible match), text. Optional pad. */
const PAGES = [
  {
    name: "01-home-desktop",
    title: "Homepage — desktop",
    path: "/",
    viewport: DESKTOP,
    notes: [
      {
        sel: 'header a[aria-label="Auto Soccer home"]',
        text: "Ink rule across the top; heavy italic wordmark in wide Barlow with twin gradient coral slashes.",
      },
      { sel: "header p", text: "Tagline “The AI-managed soccer league” (xl+ only)." },
      {
        sel: 'nav[aria-label="Main"] a[aria-current="page"]',
        text: "Upright semi-condensed nav, as in the mockup; the current section is a skewed deep-coral pill.",
      },
      {
        sel: 'header div[aria-hidden="true"].absolute',
        text: "Oversized gradient stripes bleeding off the top edge (coral, peach, violet, lilac); decorative.",
      },
      {
        sel: 'header a[aria-label="Search"]',
        text: "Search (teams, stories, personalities) and a menu panel with secondary links.",
      },
      {
        sel: 'section[aria-label="Scores"] p',
        text: "Yellow parallelogram MATCHWEEK label overlapping a lavender bar with a slanted end. Round in progress, else the latest with results.",
      },
      {
        sel: '[data-testid="score-ticker"] li',
        text: "Result: crest · short name · score · short name · crest · FT chip. Links to the match centre.",
      },
      {
        sel: '[data-testid="ticker-next"]',
        text: "NEXT: the next unplayed fixture and its kick-off (full names for screen readers).",
      },
      {
        sel: '[data-testid="lead-story"] h2',
        text: "Lead story on a soft blush ground: gradient kind tab, heavy wide italic headline, slanted coral underline. Prefers the report on the featured match.",
      },
      {
        sel: '[data-testid="lead-story"] .mt-auto',
        text: "Byline: illustrated portrait, name, role, time and the AI-generated disclosure.",
      },
      {
        sel: '[data-testid="lead-story"] > div:first-child',
        text: "Hero art in a slanted panel: gradient stripes around the crests of the clubs in the story. Decorative, never fake match imagery.",
      },
      {
        sel: '[data-testid="score-bug"]',
        text: "Gradient violet frame with a navy inner frame; score bug flush in the corner (team chips deepened only if AA needs it). Pitch has nets, corner arcs, patterned ball.",
      },
      {
        sel: `${viewer} > div:last-child`,
        text: "Control bar: play, replay time, gradient scrubber, speed (cycles 0.5×–8×), full screen.",
      },
      { sel: `${viewer} ~ p`, text: "Honesty caption: genuine autosoccer-sim replay with engine version." },
      {
        sel: 'section[aria-labelledby="latest-stories"]',
        text: "Tinted panel, gradient tab with lighter trailing slashes, white inner box. Story rows with upright headlines.",
      },
      {
        sel: 'section[aria-labelledby="table-heading"] tbody tr',
        text: "Coral gradient tab; # Team P W D L GD Pts with a rounded yellow leader row.",
      },
      {
        sel: 'section[aria-labelledby="schedule"]',
        text: "Upcoming matches: MW chip, crests, short names, kick-off. Falls back to latest results once the season ends.",
      },
      {
        sel: '[data-testid="voices-strip"]',
        text: "Voices strip: lavender block with a slanted end, short dividers, portraits on warm tiles, AI disclosure.",
      },
    ],
  },
  {
    name: "02-home-mobile",
    title: "Homepage — mobile (390 px)",
    path: "/",
    viewport: MOBILE,
    notes: [
      {
        sel: "header button[aria-controls]",
        text: "Menu button replaces the nav below 1024 px (keyboard + Escape to close).",
      },
      {
        sel: 'section[aria-label="Scores"]',
        text: "Ticker scrolls horizontally and is keyboard focusable; label shortens to “MW 03”.",
      },
      {
        sel: '[data-testid="lead-story"] > div:first-child',
        text: "Hero art switches to a landscape banner so crests aren't cropped.",
      },
      { sel: viewer, text: "Replay keeps its aspect ratio; overlay and controls scale down." },
      {
        sel: 'section[aria-labelledby="table-heading"]',
        text: "Compact table drops W/D/L on phones (P, GD, Pts remain).",
      },
      { sel: '[data-testid="voices-strip"]', text: "Voices stack vertically." },
    ],
  },
  {
    name: "03-match-centre",
    title: "Match centre",
    path: () => `/matches/${matchId}`,
    viewport: DESKTOP,
    notes: [
      { sel: 'nav[aria-label="Main"] a[aria-current="page"]', text: "Match centres count as “Matches” in the nav." },
      { sel: "main header", text: "Scoreboard: round, date, crests, final score, FT status." },
      { sel: '[data-testid="score-bug"]', text: "Same broadcast frame as the homepage, with full controls." },
      { sel: `${viewer} ~ div`, text: "Jump to goal: chips seek the replay to each official goal." },
      {
        sel: 'section[aria-labelledby="timeline"]',
        text: "Official timeline from the simulator event log (violet tab header).",
      },
      {
        sel: 'section[aria-labelledby="stats"]',
        text: "Statistics, lineups, tactics and match record use the same tab headers.",
      },
      {
        sel: 'section[aria-labelledby="provenance"]',
        text: "Match record: seed, pinned sim version, final hash, verified replay.",
      },
    ],
  },
  {
    name: "04-team",
    title: "Team page",
    path: "/teams/red-rock-rovers",
    viewport: DESKTOP,
    notes: [
      { sel: 'nav[aria-label="Main"] a[aria-current="page"]', text: "Teams is current." },
      { sel: "main header", text: "Club header: crest, position, points, record, GD, form." },
      {
        sel: 'section[aria-labelledby="upcoming"]',
        text: "Upcoming fixtures now show the kick-off time instead of “TBD”.",
      },
      { sel: '[data-testid="budget-meter"]', text: "Manager compute budget meter." },
      {
        sel: '[data-testid="manager-notebook"]',
        text: "The AI manager's notebook (memory rewritten after every match).",
      },
      {
        sel: 'section[aria-labelledby="team-news"]',
        text: "Team news cards with the new category tags and portraits.",
      },
    ],
  },
  {
    name: "05-table",
    title: "League table",
    path: "/table",
    viewport: DESKTOP,
    notes: [
      { sel: "main h1", text: "Page title: yellow eyebrow, oversized italic title, slashes and coral underline bar." },
      {
        sel: '[data-testid="standings-table"] tbody tr',
        text: "Leader row in yellow with a “Top” tag and screen-reader “(leader)”.",
      },
    ],
  },
  {
    name: "06-fixtures",
    title: "Matches (fixtures & results)",
    path: "/fixtures",
    viewport: DESKTOP,
    notes: [
      { sel: 'nav[aria-label="Main"] a[aria-current="page"]', text: "“Matches” in the nav is the fixtures list." },
      {
        sel: '[data-testid="fixture-card"]',
        text: "Played fixture: score box and FT chip, links to the match centre.",
      },
      {
        sel: 'section[aria-labelledby="round-4"] [data-testid="fixture-card"]',
        text: "Upcoming fixture: kick-off day and time.",
      },
    ],
  },
  {
    name: "07-news",
    title: "News",
    path: "/news",
    viewport: DESKTOP,
    notes: [
      {
        sel: '[data-testid="article-card"]',
        text: "Article card: category tag (lavender report, yellow tactical analysis, coral opinion), headline, standfirst, AI byline.",
      },
    ],
  },
  {
    name: "08-article",
    title: "Article",
    path: () => `/news/${articleSlug}`,
    viewport: DESKTOP,
    notes: [
      { sel: "main h1", text: "Headline uses balanced wrapping so scores like 5–0 don't split." },
      { sel: '[aria-label="About this article"]', text: "AI disclosure panel, unchanged." },
      { sel: 'section[aria-labelledby="sources"]', text: "Sources: every claim links to an official fact." },
      { sel: 'section[aria-labelledby="related"]', text: "Related stories under a violet tab header." },
    ],
  },
  {
    name: "09-personalities",
    title: "Personalities (journalists)",
    path: "/journalists",
    viewport: DESKTOP,
    notes: [
      { sel: 'nav[aria-label="Main"] a[aria-current="page"]', text: "“Personalities” is the journalists index." },
      {
        sel: '[data-testid="agent-profile-card"]',
        text: "Profile cards use the same illustrated portraits as bylines and the voices strip.",
      },
    ],
  },
  {
    name: "09b-search",
    title: "Search",
    path: "/search?q=rovers",
    viewport: DESKTOP,
    notes: [
      { sel: 'header a[aria-label="Search"]', text: "The header search icon opens this page." },
      { sel: 'form[role="search"]', text: "Plain GET form, so results have shareable URLs. Every term must match." },
      { sel: 'section[aria-labelledby="r-teams"]', text: "Teams, stories and personalities, each under a tab header." },
    ],
  },
];

const COMPONENTS = [
  {
    name: "10-component-tabs-panels",
    title: "SectionHeader, Panel, Slashes, FixtureRow, ArticleCard row",
    section: "header-tabs",
    notes: [
      {
        sel: '[data-section="header-tabs"] h2[class*="grad-violet"]',
        text: "Tab header: violet gradient parallelogram, white italic Barlow Semi Condensed, lighter trailing slashes.",
      },
      {
        sel: '[data-section="header-tabs"] h2[class*="grad-coral"]',
        text: "Coral tone: coral-deep to warm coral gradient, kept at ≥3:1 for the large white type.",
      },
      {
        sel: '[data-section="header-tabs"] .flex.items-center.gap-4',
        text: "Slashes: the decorative broadcast stripe motif (aria-hidden).",
      },
      {
        sel: 'section[aria-labelledby="sg-upcoming"]',
        text: "Panel: tinted ground, tab flush on the corner, white inner box. FixtureRow: result vs upcoming.",
      },
      { sel: 'section[aria-labelledby="sg-stories"] [data-testid="article-card"]', text: "ArticleCard “row” variant." },
    ],
  },
  {
    name: "11-component-ticker",
    title: "ScoreTicker states",
    section: "ticker",
    notes: [
      { sel: '[data-section="ticker"] section[aria-label="Scores"]', text: "Results round with NEXT fixture." },
      {
        sel: '[data-section="ticker"] section[aria-label="Scores"]:nth-of-type(2) [data-testid="score-ticker"]',
        text: "Round in progress: LIVE and NEXT chips; status always has a text label.",
      },
      { sel: '[data-section="ticker"] [role="status"]', text: "Loading skeleton." },
      { sel: '[data-section="ticker"] [data-testid="empty-state"]', text: "Empty state." },
    ],
  },
  {
    name: "12-component-lead-story",
    title: "LeadStory & hero art",
    section: "lead",
    notes: [
      {
        sel: '[data-section="lead"] [data-testid="lead-story"]',
        text: "Story about two clubs: their crests on broadcast stripes.",
      },
      {
        sel: '[data-section="lead"] [data-testid="lead-story"]:nth-child(2) > div:first-child',
        text: "Story with no club (opinion/analysis): falls back to the editorial illustration.",
      },
    ],
  },
  {
    name: "13-component-voices",
    title: "Portrait & VoicesStrip",
    section: "voices",
    notes: [
      {
        sel: '[data-section="voices"] [data-testid="portrait"]',
        text: "Illustrated portrait: deterministic from the journalist's avatar data, crisp at 36–96 px.",
      },
      {
        sel: '[data-section="voices"] [data-testid="voices-strip"] > div:first-child',
        text: "“Voices around the league” block.",
      },
      {
        sel: '[data-section="voices"] [data-testid="voices-strip"] li',
        text: "Journalist entry: portrait, name, role, AI badge, bio.",
      },
    ],
  },
  {
    name: "14-component-tokens",
    title: "Tokens (new: coral-deep, lavender, lavender-strong)",
    section: "tokens",
    notes: [
      {
        sel: '[data-section="tokens"] li:nth-child(7)',
        text: "coral-deep: coral for white text (4.4:1, large type only).",
      },
      { sel: '[data-section="tokens"] li:nth-child(11)', text: "lavender: ticker bar, report tags, MW chips." },
      { sel: '[data-section="tokens"] li:nth-child(12)', text: "lavender-strong: FT chip and time chips on lavender." },
    ],
  },
];

const FLOWS = [
  {
    name: "20-flow-result-to-story",
    title: "Flow: from a ticker result to the match, the report and its author",
    viewport: { width: 1280, height: 800 },
    steps: [
      {
        caption: "Home: pick a result in the matchweek ticker",
        run: async (p) => p.goto(`${base}/`, { waitUntil: "networkidle" }),
        mark: '[data-testid="score-ticker"] li a',
      },
      {
        caption: "Match centre opens; “Matches” is current",
        run: async (p) => {
          await p.locator('[data-testid="score-ticker"] li a').first().click();
          await p.waitForURL(/\/matches\//);
          await p.waitForLoadState("networkidle");
        },
        mark: "main header",
      },
      {
        caption: "Press play: the score bug follows the real replay",
        run: async (p) => {
          await p.evaluate((sel) => {
            const el = document.querySelector(sel);
            window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 110 });
          }, viewer);
          await p.getByRole("button", { name: "Play", exact: true }).click();
          await p.waitForTimeout(2500);
          await p.getByRole("button", { name: "Pause", exact: true }).click();
        },
        mark: '[data-testid="score-bug"]',
      },
      {
        caption: "Jump to a goal from the official events",
        run: async (p) => {
          await p.locator(`${viewer} ~ div button`).last().click();
          await p.waitForTimeout(300);
        },
        mark: `${viewer} ~ div button:last-child`,
      },
      {
        caption: "Open the AI match report",
        run: async (p) => {
          await p.locator('section[aria-labelledby="report"] h3 a').first().click();
          await p.waitForURL(/\/news\//);
          await p.waitForLoadState("networkidle");
        },
        mark: "main h1",
      },
      {
        caption: "Meet the AI journalist who wrote it",
        run: async (p) => {
          await p.locator("main a[href^='/journalists/']").first().click();
          await p.waitForURL(/\/journalists\//);
          await p.waitForLoadState("networkidle");
        },
        mark: "main h1",
      },
    ],
  },
  {
    name: "21-flow-mobile-nav",
    title: "Flow: mobile navigation",
    viewport: MOBILE,
    steps: [
      {
        caption: "Home on a phone",
        run: async (p) => p.goto(`${base}/`, { waitUntil: "networkidle" }),
        mark: "header button[aria-controls]",
      },
      {
        caption: "Menu opens (Enter/click); Escape closes",
        run: async (p) => p.getByRole("button", { name: "Menu" }).click(),
        mark: 'nav[aria-label="Site menu"]',
      },
      {
        caption: "Choose Table",
        run: async (p) => {
          await p.getByRole("navigation", { name: "Site menu" }).getByRole("link", { name: "Table" }).click();
          await p.waitForURL(/\/table/);
          await p.waitForLoadState("networkidle");
        },
        mark: "main h1",
      },
    ],
  },
  {
    name: "22-flow-replay-controls",
    title: "Flow: replay controls",
    viewport: { width: 1280, height: 800 },
    steps: [
      {
        caption: "Paused at kick-off",
        run: async (p) => {
          await p.goto(`${base}/matches/${matchId}`, { waitUntil: "networkidle" });
          await p.locator(viewer).scrollIntoViewIfNeeded();
          await p.evaluate(() => window.scrollBy(0, -60));
        },
        mark: `${viewer} button[aria-label="Play"]`,
      },
      {
        caption: "Speed button cycles 2× → 4× → 8× → 0.5× → 1×",
        run: async (p) => p.getByRole("button", { name: /Playback speed/ }).click(),
        mark: `${viewer} button[aria-label^="Playback speed"]`,
      },
      {
        caption: "Scrub with the slider (or ←/→ on the focused pitch)",
        run: async (p) => {
          await p.locator(`${viewer} [role="application"]`).focus();
          for (let i = 0; i < 12; i++) await p.keyboard.press("ArrowRight");
        },
        mark: `${viewer} input[type="range"]`,
      },
    ],
  },
];

const browser = await chromium.launch();

/** Draw numbered callouts around the first visible element for each note; returns resolved notes. */
async function drawNotes(page, notes) {
  return page.evaluate((notes) => {
    document.getElementById("annot-layer")?.remove();
    const layer = document.createElement("div");
    layer.id = "annot-layer";
    layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
    document.body.appendChild(layer);
    const found = [];
    notes.forEach((n, i) => {
      const el = [...document.querySelectorAll(n.sel)].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!el) {
        found.push({ ...n, n: i + 1, missing: true });
        return;
      }
      const r = el.getBoundingClientRect();
      const x = r.left + window.scrollX;
      const y = r.top + window.scrollY;
      const box = document.createElement("div");
      box.style.cssText = `position:absolute;left:${x - 4}px;top:${y - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:3px solid #FF654F;border-radius:10px;box-shadow:0 0 0 2px rgba(255,255,255,.9)`;
      const tag = document.createElement("div");
      tag.textContent = String(i + 1);
      tag.style.cssText = `position:absolute;left:${Math.max(2, x - 16)}px;top:${Math.max(2, y - 16)}px;min-width:30px;height:30px;padding:0 6px;border-radius:999px;background:#20203B;color:#fff;font:800 17px/30px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 3px #FFCB45`;
      layer.append(box, tag);
      found.push({ ...n, n: i + 1 });
    });
    return found;
  }, notes);
}

async function compose(file, title, shotPng, legend, opts = {}) {
  const img = `data:image/png;base64,${readFileSync(shotPng).toString("base64")}`;
  const items = legend
    .map(
      (l) =>
        `<li><span class="n">${l.n}</span><span>${l.text}${l.missing ? " <em>(not on this page state)</em>" : ""}</span></li>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,800&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#FDFAF7;color:#20203B;font:15px/1.45 Inter,system-ui,sans-serif}
.wrap{display:flex;gap:28px;padding:28px;align-items:flex-start;width:max-content}
.shot{border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(32,32,59,.15);background:#fff}
.shot img{display:block;width:${opts.width ?? "auto"}}
aside{width:420px;position:sticky;top:0}
h1{font:italic 800 34px/1 "Barlow Condensed",sans-serif;text-transform:uppercase;margin:0 0 6px}
.eyebrow{display:inline-block;background:#FFCB45;font:italic 800 14px/1 "Barlow Condensed";text-transform:uppercase;padding:5px 9px;margin-bottom:10px}
ol{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:12px}
li{display:flex;gap:10px;background:#fff;border:1px solid #E7E1F0;border-radius:10px;padding:10px 12px}
.n{flex:none;min-width:28px;height:28px;border-radius:999px;background:#20203B;color:#fff;font:800 15px/28px Inter;text-align:center;box-shadow:0 0 0 3px #FFCB45}
em{color:#66647A}
</style></head><body><div class="wrap"><div class="shot"><img src="${img}"></div>
<aside><span class="eyebrow">Auto Soccer · mockup alignment</span><h1>${title}</h1><ol>${items}</ol></aside></div></body></html>`;
  const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await p.setContent(html, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.locator(".wrap").screenshot({ path: file });
  await p.close();
}

async function storyboard(file, title, frames, cols) {
  const cells = frames
    .map(
      (f, i) =>
        `<figure><img src="data:image/png;base64,${readFileSync(f.png).toString("base64")}"><figcaption><span class="n">${i + 1}</span>${f.caption}</figcaption></figure>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,800&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#FDFAF7;color:#20203B;font:16px/1.4 Inter,system-ui,sans-serif}
.wrap{padding:28px;width:max-content}
h1{font:italic 800 36px/1 "Barlow Condensed",sans-serif;text-transform:uppercase;margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(${cols},auto);gap:22px}
figure{margin:0;background:#fff;border:1px solid #E7E1F0;border-radius:14px;overflow:hidden;box-shadow:0 6px 20px rgba(32,32,59,.1)}
img{display:block;width:${cols > 3 ? 300 : 560}px}
figcaption{display:flex;gap:10px;align-items:center;padding:12px 14px;font-weight:600}
.n{flex:none;width:30px;height:30px;border-radius:999px;background:#FF654F;color:#20203B;font:800 16px/30px Inter;text-align:center}
</style></head><body><div class="wrap"><h1>${title}</h1><div class="grid">${cells}</div></div></body></html>`;
  const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await p.setContent(html, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.locator(".wrap").screenshot({ path: file });
  await p.close();
}

const tmp = join(out, ".tmp");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const report = [];

for (const pg of PAGES) {
  if (only && !pg.name.includes(only)) continue;
  const ctx = await browser.newContext({
    viewport: pg.viewport,
    deviceScaleFactor: pg.viewport.width < 600 ? 2 : 1,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const path = typeof pg.path === "function" ? pg.path() : pg.path;
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const legend = await drawNotes(page, pg.notes);
  const shot = join(tmp, `${pg.name}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  await compose(join(out, `${pg.name}.png`), pg.title, shot, legend, {
    width: pg.viewport.width < 600 ? "390px" : undefined,
  });
  report.push(
    `${pg.name}: ${
      legend
        .filter((l) => l.missing)
        .map((l) => `missing #${l.n}`)
        .join(", ") || "ok"
    }`,
  );
  await ctx.close();
}

for (const c of COMPONENTS) {
  if (only && !c.name.includes(only)) continue;
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${base}/styleguide`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const legend = await drawNotes(page, c.notes);
  const shot = join(tmp, `${c.name}.png`);
  const sec = page.locator(`[data-section="${c.section}"]`);
  const box = await sec.boundingBox();
  await page.screenshot({
    path: shot,
    fullPage: true,
    clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 8), width: box.width + 48, height: box.height + 32 },
  });
  await compose(join(out, `${c.name}.png`), c.title, shot, legend);
  report.push(
    `${c.name}: ${
      legend
        .filter((l) => l.missing)
        .map((l) => `missing #${l.n}`)
        .join(", ") || "ok"
    }`,
  );
  await ctx.close();
}

for (const f of FLOWS) {
  if (only && !f.name.includes(only)) continue;
  const ctx = await browser.newContext({
    viewport: f.viewport,
    deviceScaleFactor: f.viewport.width < 600 ? 2 : 1,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const frames = [];
  for (const [i, s] of f.steps.entries()) {
    await s.run(page);
    await page.evaluate(() => document.fonts.ready);
    const [note] = await drawNotes(page, [{ sel: s.mark, text: s.caption }]);
    // remove the number badge for flows; the storyboard numbers the steps
    await page.evaluate(() => document.querySelector("#annot-layer > div:nth-child(2)")?.remove());
    const png = join(tmp, `${f.name}-${i + 1}.png`);
    await page.screenshot({ path: png });
    await page.evaluate(() => document.getElementById("annot-layer")?.remove());
    frames.push({ png, caption: s.caption });
    report.push(`${f.name} step ${i + 1}: ${note.missing ? "mark missing" : "ok"}`);
  }
  await storyboard(join(out, `${f.name}.png`), f.title, frames, f.viewport.width < 600 ? 3 : 3);
  await ctx.close();
}

rmSync(tmp, { recursive: true, force: true });
await browser.close();
console.log(report.join("\n"));
