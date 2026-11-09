# Auto Soccer — Design System v0.2

**Status:** Approved visual direction: **Pop Arcade**. **Source of truth:** this document; PDF is an export. Applies to public league website, match centre, editorial pages and manager UI.

## Identity
An accessible, lively fictional soccer league: arcade sports broadcast + credible editorial site. Bright off-white canvas, bold navy type, violet/coral graphic accents and golden-yellow matchweek/highlight labels. Energetic but not visually noisy. Avoid the superseded dark navy + neon-lime esports look.

## Tokens
| Token | Hex | Usage |
|---|---|---|
| canvas | `#F5F0E8` | Primary page background |
| surface | `#FFFFFF` | Cards, tables, long-form content |
| ink | `#20203B` | Body and heading text |
| muted | `#77758C` | Secondary copy |
| coral | `#FF654F` | Primary brand accent, featured labels |
| violet | `#6552DD` | Editorial headers, navigation, playback accents |
| yellow | `#FFCB45` | Matchweek badges, table leaders, emphasis |
| blue | `#245EFF` | Match-side and team graphics; not global brand default |

Keep text contrast accessible: use ink on light backgrounds; use white on dark violet/coral only after verifying contrast. Do not use pale accents as body text.

## Typography
- Display: **Barlow Condensed**, bold/extra-bold, optionally italic for match headlines and broadcast labels.
- UI/body: **Inter**, normal through bold, with tabular numerals for scores, clocks and standings.
- Headlines expressive, article body calm. Limit oversized all-caps typography to short titles.

## Layout
- Responsive 12-column desktop layout; max content width ~1440px; mobile collapses to 4-column grid.
- 8px spacing system; compact panels 12–16px, editorial panels 24–32px.
- Light cards, subtle cool borders/shadows, ~8–12px radius. Angular stripes/slashes on section banners, not every component.
- Hierarchy: global navigation → matchweek/results ticker → featured story + genuine replay → latest stories/standings/fixtures → league voices.

## Core components
`LeagueHeader`, `ScoreTicker`, `MatchScoreCard`, `MatchViewer`, `FixtureCard`, `StandingsTable`, `TeamBadge`, `ArticleCard`, `AuthorByline`, `SectionHeader`, `AgentProfileCard`.

Component requirements: responsive states, loading/empty/error variants, keyboard interaction, semantic HTML, accessible focus, colour-independent status cues, tabular score alignment.

## Imagery
- Use **real top-down 2D match viewer/replay** from `autosoccer-sim` for match media. Current sim uses simplified circular players on a pitch; do not suggest 3D models are already implemented.
- Editorial thumbnails: flat geometric/vector illustrations (tactics board, supporters, charts) in palette; consistent illustrated avatars for persistent AI reporters, analysts and pundits.
- Team crests: simple flat vector marks, with team-specific colours distinct from site-level tokens.
- Clearly identify AI-generated journalists and articles; generated narratives must be grounded in recorded league facts.

## Page patterns
1. **Homepage:** results ticker, lead article with byline, embedded replay, latest stories, league table, fixtures, league personalities.
2. **Match centre:** scoreboard, replay controls, timeline, official events/stats, tactics and linked match report. Responsive viewer aspect ratio.
3. **Team page:** crest, form, roster, manager profile, fixtures, results, team news.
4. **Article:** generous readable column on white/paper, author/date/AI disclosure, related stories, grounded match references.

## Implementation guidance
- React + Tailwind CSS + DaisyUI custom `autosoccer-pop` theme; CSS variables for all site colours. Avoid hard-coded one-off hex values inside components.
- Use design tokens consistently in scoreboards, charts and editorial panels. Team-specific colour variables may override badge accents only.
- Embed simulator replay through a versioned adapter, keeping simulation rendering separate from site chrome.
- Design review screenshots: desktop and mobile for homepage, match centre, team profile; include simulator screenshot fidelity check.

## Evolution
Keep site presentation in step with the simulator: first vector badges + authentic 2D replays; later upgrade match presentation and broadcast graphics as real features land. No photorealistic player imagery or misleading mock gameplay.
