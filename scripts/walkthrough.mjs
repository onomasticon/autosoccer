/**
 * Records a captioned video walkthrough of the public site (Chromium via Playwright) and
 * converts it to MP4 with ffmpeg.
 *   node scripts/walkthrough.mjs --base http://localhost:3000 --out docs/media/p4-26/walkthrough.mp4
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const base = opt("base", "http://localhost:3000");
const out = opt("out", "out/walkthrough.mp4");
const tmp = join(dirname(out), ".video");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: tmp, size: { width: 1280, height: 800 } },
});
const page = await ctx.newPage();

async function caption(text, ms = 2600) {
  await page.evaluate((t) => {
    let el = document.getElementById("wt-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "wt-caption";
      el.style.cssText =
        "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;max-width:980px;padding:12px 20px;border-radius:12px;background:rgba(32,32,59,.92);color:#fff;font:600 19px Inter,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25);text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
  await page.waitForTimeout(ms);
}
async function go(path, text) {
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await caption(text);
}
async function scroll(px, text, ms) {
  await page.mouse.wheel(0, px);
  await page.waitForTimeout(600);
  if (text) await caption(text, ms);
}

await go("/", "Auto Soccer: a fictional 5v5 league run unattended by AI managers, played by the autosoccer-sim engine");
await scroll(450, "The homepage leads with an AI-written report and a genuine 2D replay of the latest result");
await scroll(900, "Latest results, the table and fixtures: all from the official match record");
await go("/table", "Season 1 complete: 12 fixtures, double round robin, points / GD / GF / head-to-head");
await go("/fixtures", "Every fixture was scheduled, simulated and recorded exactly once by durable background jobs");
await go("/teams/harbour-city", "Each club has a persistent AI manager with a seasonal compute budget");
await scroll(350, "The manager's notebook: memory rewritten after every match from the official result", 3200);

const fixtures = await (
  await fetch(base.replace(/:\d+$/, ":4500") + "/api/v1/seasons/season-1/fixtures").catch(() => null)
)
  ?.json()
  .catch(() => null);
const all = fixtures?.rounds?.flatMap((r) => r.fixtures) ?? [];
const withGoals = all.find((f) => f.score && f.score.home + f.score.away >= 2) ?? all[0];
await go(
  `/matches/${withGoals.matchId}`,
  "The match centre: scoreboard, replay, official timeline, statistics, lineups and tactics",
);
await page
  .getByRole("button", { name: /Jump to goal|·/ })
  .first()
  .click()
  .catch(() => {});
const goalButtons = page.locator("button", { hasText: "–" });
if (await goalButtons.count()) await goalButtons.first().click();
await page.evaluate(() => {
  const el = document.querySelector('[data-testid="match-viewer"]');
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72 });
});
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Play", exact: true }).click();
await caption("The replay re-steps the real engine from recorded commands: what you see is the official match", 6500);
await page
  .getByRole("button", { name: "Pause", exact: true })
  .click()
  .catch(() => {});
await scroll(700, "Timeline and stats come straight from the simulator's event log, never invented");
await scroll(900, "Match record: seed, pinned simulator version, final state hash and a verified replay", 3000);

const articles = await (await fetch(base.replace(/:\d+$/, ":4500") + "/api/v1/articles?limit=20")).json();
const report = articles.items.find((a) => a.kind === "match_report");
await go(`/news/${report.slug}`, "AI journalists write after every result, only from cited official facts");
await scroll(
  650,
  "Every article is fact-checked: official scores only, no quotes; each claim links to its source",
  3200,
);
await go("/journalists", "The newsroom: a reporter, an analyst and a pundit, all persistent AI identities");
await caption("12 matches · 48 manager decisions · 18 grounded articles · budgets enforced · zero manual steps", 3500);

await ctx.close();
await browser.close();
const webm = join(
  tmp,
  readdirSync(tmp).find((f) => f.endsWith(".webm")),
);
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-i",
  webm,
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-crf",
  "26",
  "-movflags",
  "+faststart",
  out,
]);
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${out}`);
