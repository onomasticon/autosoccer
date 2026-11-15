# Replay readability: 7-a-side vs 11-a-side (issue #68)

What a spectator can follow in the 2D replay at each format, measured rather than judged by eye. The
league plays 7-a-side again from Season 5 (#72); this records why that's the easier format to watch,
and what the viewer now does to keep either readable.

## Method
- **Matches:** a local seeded league on sim `9c43677` with ball control and player ratings. That's 6 matches of 7-a-side (one round-robin pass, three rounds) and 4 of 11-a-side (two rounds), all with real club tactics and lineups, and offline managers.
- **Measuring:** `bun scripts/replay-measure.ts <replay.json.gz>…` decodes each replay with the site's own `ReplaySource`. It uses the renderer's sizing (`sprites()` in `match-viewer/view.ts`), so the numbers are what the page draws.
- **Canvas widths:** 334 px (a 390 px phone, inside the page gutters and frame) and 820 px (desktop match centre).
- **Crowding:** sampled once per simulated second at phone width, full view.
- **Timing:** measured on the dev machine (Apple silicon, Bun). A mid-range phone is several times slower, so read them as relative.

## Results

| | 7-a-side (60×38 m) | 11-a-side (74×48 m) |
| --- | --- | --- |
| Players on the pitch | 14 | 22 |
| Player diameter, phone / desktop | 12 / 16.3 px | 12 / 16.6 px |
| Shirt numbers drawn, phone / desktop | no / yes | no / yes |
| Player diameter with *Follow the ball* (×2.5), phone | 16.6 px, numbers on | 16.9 px, numbers on |
| Overlapping player pairs per second (phone) | 1.21 | 1.75 (+45%) |
| Share of time the ball sits over a non-carrying player (phone) | 13.7% | 21.3% |
| Goals per match (100-match study, #72 / #64) | 2.43 | 2.13 |
| Verified highlights per match (goals + fast keeper catches) | 3.7 | 1.75 |
| Highlights reel length per match | 31 s | 16 s |
| Replay file (gzip) | 575 KB | 740 KB |
| Decode (parse) | 27 ms | 51 ms |
| Random seek / sequential frame | 1.6 ms / 0.005 ms | 2.6 ms / 0.009 ms |

Structured observations from the screenshots (attached to the PR at desktop and phone width):
- **Same size, more clutter:** at full view, the two formats draw players at almost the same size. The renderer enlarges players on the bigger pitch, so the difference is crowding rather than size. 11-a-side midfields form clumps on a phone; with 7-a-side the shape (back line, midfield, striker) is still visible.
- **Ball:** with its new dark halo it stays visible in both formats, because it's drawn on top. In 11-a-side it's more often surrounded, so the carrier ring does most of the work.
- **Shirt numbers:** they need about 15 px of player on screen. On a phone that only happens with *Follow the ball*, in either format.
- **Pace:** 7-a-side gives roughly twice as many verified key moments per match, so highlights mode has more to show.

## Recommendation
- **Format:** keep 7-a-side as the league format (already done in #72). It reads better on phones, gives more moments to watch and costs less to load. This is evidence for that decision, not a reason to change format automatically.
- **Rendering:** the defaults in this PR apply to both formats:
  - a size floor of 12 px across;
  - a carrier ring;
  - a ball halo;
  - kit colours that avoid the pitch and each other;
  - an optional ×2.5 follow-ball zoom for phones;
  - tap or pick-a-player identification.
- **If 11-a-side returns:** turn on follow-ball by default at phone widths.
- **Perhaps later:** pre-decoding snapshots in a worker would cut the random-seek cost further, but at 2–3 ms a seek it isn't needed today.

## What highlights can and can't show
- Highlights come only from the record:
  - official goals, each confirmed against the replay's own goal event at the same tick;
  - the replay's recorded keeper `catch` events of fast balls (≥ 11 m/s), labelled *keeper catch*, not *save*, because the record doesn't say whether the ball was on target.
- The replay log has no shot or shot-on-target events, so a "big chance" or "save" highlight would be a guess, and none is shown.
- If the league wants saves and chances as highlights, the simulator needs to log shots with an on-target flag. That is filed as onomasticon/autosoccer-sim#22; the site shouldn't infer it.
