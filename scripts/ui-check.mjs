/**
 * Browser checks for the public site (Chromium via Playwright):
 *  - desktop (1440×900) and mobile (390×844) full-page screenshots
 *  - axe-core WCAG 2.1 A/AA scan (including colour contrast) on every page
 *  - keyboard: first Tab reaches the skip link; mobile menu opens/closes with keyboard
 *
 *   node scripts/ui-check.mjs --base http://localhost:3000 --out docs/media/p1-20 /styleguide /
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(
  require.resolve("axe-core/axe.min.js", { paths: [join(process.cwd(), "apps/web")] }),
  "utf8",
);
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const base = opt("base", "http://localhost:3000");
const out = opt("out", "out/ui-check");
const pages = args.filter((a, i) => a.startsWith("/") && !args[i - 1]?.startsWith("--"));
mkdirSync(out, { recursive: true });

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const browser = await chromium.launch();
const report = [];
let failed = false;

for (const path of pages.length ? pages : ["/"]) {
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({
      viewport: size,
      deviceScaleFactor: vp === "mobile" ? 2 : 1,
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    const res = await page.goto(base + path, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (scrollWidth > size.width) errors.push(`horizontal overflow: page is ${scrollWidth}px wide at ${size.width}px`);
    const name = `${path === "/" ? "home" : path.slice(1).replaceAll("/", "_")}-${vp}`;
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });

    await page.addScriptTag({ content: axeSource });
    const axe = await page.evaluate(async () => {
      const r = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        sample: v.nodes[0]?.target?.join(" "),
      }));
    });

    // Keyboard: the first Tab lands on the skip link.
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
    let menu = "n/a";
    if (vp === "mobile") {
      const btn = page.getByRole("button", { name: "Menu" });
      await btn.focus();
      await page.keyboard.press("Enter");
      const opened = await btn.getAttribute("aria-expanded");
      const visible = await page.getByRole("navigation", { name: "Main mobile" }).isVisible();
      await page.screenshot({ path: join(out, `${name}-menu.png`) });
      await page.keyboard.press("Escape");
      const closed = await btn.getAttribute("aria-expanded");
      menu =
        opened === "true" && visible && closed === "false"
          ? "ok"
          : `FAIL (open=${opened}, visible=${visible}, closed=${closed})`;
    }
    const ok =
      res?.status() === 200 &&
      axe.length === 0 &&
      firstFocus === "Skip to content" &&
      (menu === "ok" || menu === "n/a") &&
      errors.length === 0;
    if (!ok) failed = true;
    report.push({
      page: path,
      viewport: vp,
      status: res?.status(),
      axeViolations: axe,
      firstTab: firstFocus,
      mobileMenu: menu,
      consoleErrors: errors,
    });
    console.log(
      `${ok ? "✓" : "✗"} ${path} [${vp}] HTTP ${res?.status()} · axe ${axe.length} violations · first Tab → "${firstFocus}" · menu ${menu}${errors.length ? ` · errors: ${errors.join("; ")}` : ""}`,
    );
    for (const v of axe) console.log(`    axe ${v.id} (${v.impact}) ×${v.nodes}: ${v.sample}`);
    await ctx.close();
  }
}
writeFileSync(join(out, "ui-check.json"), JSON.stringify(report, null, 2));
await browser.close();
process.exit(failed ? 1 : 0);
