import { type OfficialEvent, playerHref, type Team } from "@autosoccer/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { formatClock, onColor, readableChip } from "../../lib/format";
import { ErrorState } from "../States";
import { celebrationRate, celebrationTicks, type GoalEvent, goalCrossed } from "./celebration";
import { aspect, drawFrame } from "./draw";
import { buildHighlights, clipReel, type HighlightsIndex, type Moment, reelNext } from "./highlights";
import { type Frame, loadReplay, type ReplaySource } from "./replay-adapter";
import { type Camera, easeCamera, FULL_VIEW, followCamera, kitColours, nearestPlayer, slotOf, toPitch } from "./view";

const SPEEDS = [0.5, 1, 2, 4, 8] as const;

export interface MatchViewerProps {
  replayUrl: string;
  home: Pick<Team, "name" | "shortName" | "colors">;
  away: Pick<Team, "name" | "shortName" | "colors">;
  /** Official events, used for timeline markers (goals). */
  events: OfficialEvent[];
  autoplay?: boolean;
  initialSpeed?: (typeof SPEEDS)[number];
  /** Compact embed (homepage): fewer controls. */
  compact?: boolean;
  /** Player id → name, for the scorer on the goal banner. */
  playerNames?: ReadonlyMap<string, string>;
  /** Starting lineups in slot order (the simulator's player 1, 2, …), to name a tapped player. */
  lineups?: {
    home: ReadonlyArray<{ id?: string; name: string; shirtNumber: number }>;
    away: ReadonlyArray<{ id?: string; name: string; shirtNumber: number }>;
  };
  /**
   * A featured player's clip (the homepage lead, or ?clip= on the match centre): their goals with
   * a few seconds of build-up, the player picked out on the pitch, and their career at the end.
   */
  focus?: ReplayFocus;
}

export interface ReplayFocus {
  /** Simulator id ("blue-3") of the player to pick out, if they started. */
  simId: string | null;
  playerId: string;
  name: string;
  /** Official goal ticks to play. */
  ticks: number[];
  /** Button label, e.g. "Watch Nyberg's three goals". */
  label: string;
  /** Start playing as soon as the replay loads (not with reduced motion). */
  autoplay?: boolean;
}

/** Zoom used by "Follow the ball". */
const FOLLOW_ZOOM = 2.5;

function periodClock(f: Frame | null) {
  if (!f) return "";
  if (f.period === "preMatch") return "Pre-match";
  if (f.period === "halftime") return "Half-time";
  if (f.period === "fullTime") return "Full time";
  return formatClock(f.period, f.clockSec);
}

function shortClock(f: Frame | null) {
  if (!f || f.period === "preMatch") return "KO";
  if (f.period === "halftime") return "HT";
  if (f.period === "fullTime") return "FT";
  return formatClock(f.period, f.clockSec);
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/**
 * Genuine 2D replay of an official match (autosoccer-sim replay v1), rendered client-side.
 * Keyboard: Space/K play-pause, ←/→ seek 5 s, Home/End jump to start/end.
 */
export function MatchViewer({
  replayUrl,
  home,
  away,
  events,
  autoplay = false,
  initialSpeed = 2,
  compact = false,
  playerNames,
  lineups,
  focus,
}: MatchViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const srcRef = useRef<ReplaySource | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(initialSpeed);
  const tickRef = useRef(0);
  // Highlights mode plays windows of this same replay around verified moments (highlights.ts).
  const [highlights, setHighlights] = useState<HighlightsIndex | null>(null);
  const [mode, setMode] = useState<"full" | "highlights" | "clip">("full");
  // The featured player's clip: windows around their goals, and an end card once it's played.
  const [clip, setClip] = useState<HighlightsIndex["reel"] | null>(null);
  const [clipEnded, setClipEnded] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Display aids: follow-the-ball framing and a picked-out player (both off by default).
  const [follow, setFollow] = useState(false);
  const followRef = useRef(follow);
  followRef.current = follow;
  const camRef = useRef<Camera>(FULL_VIEW);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Goal celebration: playback slows for a moment after each goal, with a banner over the pitch.
  const [celebrating, setCelebrating] = useState<GoalEvent | null>(null);
  const celebRef = useRef<{ goal: GoalEvent; until: number } | null>(null);
  const goals = useMemo(
    () => events.filter((e): e is GoalEvent => e.type === "goal").sort((a, b) => a.tick - b.tick),
    [events],
  );

  const chips = useMemo(
    () => ({ home: readableChip(home.colors.primary), away: readableChip(away.colors.primary) }),
    [home.colors.primary, away.colors.primary],
  );
  // Real shirt numbers by simulator id (blue-1 is the home side's first starter, and so on).
  const shirts = useMemo(
    () =>
      new Map(
        (["home", "away"] as const).flatMap((side) =>
          (lineups?.[side] ?? []).map(
            (p, i) => [`${side === "home" ? "blue" : "red"}-${i + 1}`, p.shirtNumber] as const,
          ),
        ),
      ),
    [lineups],
  );
  // Kits that clash on the pitch: the away side wears its secondary colour (display only).
  const kits = useMemo(() => kitColours(home.colors, away.colors), [home.colors, away.colors]);
  const colors = useMemo(
    () => ({ home: kits.home, away: kits.away, homeText: onColor(kits.home), awayText: onColor(kits.away) }),
    [kits],
  );

  const render = useCallback(
    (t: number, snap = false) => {
      const src = srcRef.current;
      const canvas = canvasRef.current;
      if (!src || !canvas) return;
      const f = src.frameAt(t);
      const target = followRef.current ? followCamera(src.pitch, f.ball, FOLLOW_ZOOM) : FULL_VIEW;
      camRef.current = snap ? target : easeCamera(camRef.current, target);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = w / aspect(src.pitch);
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFrame(
        ctx,
        f,
        {
          pitch: src.pitch,
          playerRadius: src.playerRadius,
          colors,
          camera: camRef.current,
          selected: selectedRef.current,
          shirts,
        },
        w,
        h,
      );
      setFrame(f);
    },
    [colors, shirts],
  );

  useEffect(() => {
    const ac = new AbortController();
    loadReplay(replayUrl, ac.signal)
      .then((src) => {
        srcRef.current = src;
        setStatus("ready");
        setPlaying(autoplay && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      })
      .catch((e: Error) => {
        if (ac.signal.aborted) return;
        setError(e.message);
        setStatus("error");
      });
    return () => ac.abort();
  }, [replayUrl, autoplay]);

  // The highlights index, once the replay (and its own event log) is loaded.
  useEffect(() => {
    const src = srcRef.current;
    if (status !== "ready" || !src) return;
    setHighlights(buildHighlights(events, { finalTick: src.finalTick, tickRate: src.tickRate, events: src.events }));
  }, [status, events]);

  // Cue the featured clip: pick the player out and stand on the first window (playing if asked).
  const focusKey = focus ? `${focus.playerId}:${focus.ticks.join(",")}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-cue only when the focus itself changes
  useEffect(() => {
    const src = srcRef.current;
    if (status !== "ready" || !src || !focus) return;
    const reel = clipReel(focus.ticks, { finalTick: src.finalTick, tickRate: src.tickRate });
    setClip(reel);
    if (!reel.length) return;
    setSelected(focus.simId);
    selectedRef.current = focus.simId;
    setMode("clip");
    modeRef.current = "clip";
    tickRef.current = reel[0]!.start;
    setTick(reel[0]!.start);
    render(reel[0]!.start, true);
    if (focus.autoplay && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
  }, [status, focusKey]);

  // Repaint when a display aid changes while paused.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow/selected are read through refs in render
  useEffect(() => {
    if (status === "ready") render(tickRef.current, true);
  }, [follow, selected, status, render]);

  // first paint + resize
  useEffect(() => {
    if (status !== "ready") return;
    render(tickRef.current);
    const ro = new ResizeObserver(() => {
      if (canvasRef.current) canvasRef.current.width = 0;
      render(tickRef.current);
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [status, render]);

  // playback loop
  useEffect(() => {
    if (!playing || status !== "ready") return;
    const src = srcRef.current!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const span = celebrationTicks(src.goalPauseTicks, src.tickRate);
    const loop = (now: number) => {
      const rate = celebRef.current ? celebrationRate(span) : src.tickRate * speed;
      acc += ((now - last) / 1000) * rate;
      last = now;
      const whole = Math.floor(acc);
      if (whole > 0) {
        acc -= whole;
        let next = Math.min(src.finalTick, tickRef.current + whole);
        let jumped = false;
        const reel = modeRef.current === "highlights" ? highlights?.reel : modeRef.current === "clip" ? clip : null;
        if (reel) {
          const r = reelNext(reel, next);
          if (r === null) {
            // End of the reel: stop at the last moment's window (the clip then offers the career).
            if (modeRef.current === "clip") setClipEnded(true);
            setPlaying(false);
            setMode("full");
            return;
          }
          if (r > next) {
            next = r;
            jumped = true;
            acc = 0;
          }
        }
        if (celebRef.current) {
          if (next >= celebRef.current.until) {
            celebRef.current = null;
            setCelebrating(null);
          }
        } else if (!jumped) {
          const g = goalCrossed(goals, tickRef.current, next);
          if (g) {
            next = g.tick; // stop on the goal itself, then play the celebration slowly
            acc = 0;
            celebRef.current = { goal: g, until: Math.min(src.finalTick, g.tick + span) };
            setCelebrating(g);
          }
        }
        tickRef.current = next;
        setTick(next);
        render(next, jumped);
        if (next >= src.finalTick) {
          celebRef.current = null;
          setCelebrating(null);
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, status, render, goals, highlights, clip]);

  const seek = (t: number) => {
    const src = srcRef.current;
    if (!src) return;
    const next = Math.max(0, Math.min(src.finalTick, Math.round(t)));
    celebRef.current = null;
    setCelebrating(null);
    tickRef.current = next;
    setTick(next);
    render(next, true);
  };

  const watchHighlights = () => {
    const first = highlights?.reel[0];
    if (!first) return;
    setClipEnded(false);
    setMode("highlights");
    seek(first.start);
    setPlaying(true);
  };
  const watchClip = () => {
    const first = clip?.[0];
    if (!first || !focus) return;
    setClipEnded(false);
    setSelected(focus.simId);
    setMode("clip");
    seek(first.start);
    setPlaying(true);
  };
  const watchFull = () => {
    setClipEnded(false);
    setMode("full");
    setPlaying(false);
  };
  const watchWholeMatch = () => {
    setClipEnded(false);
    setMode("full");
    seek(0);
    setPlaying(true);
  };

  // Tap or click a player to see who it is (and tap again, or elsewhere, to clear).
  const onPitchClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const src = srcRef.current;
    if (!src || !frame) return;
    const box = e.currentTarget.getBoundingClientRect();
    const h = box.width / aspect(src.pitch);
    const at = toPitch(src.pitch, box.width, h, camRef.current, e.clientX - box.left, e.clientY - box.top);
    const p = nearestPlayer(frame, at.x, at.y, Math.max(2, src.playerRadius * 4) / camRef.current.zoom);
    setSelected((cur) => (p && p.id !== cur ? p.id : null));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const src = srcRef.current;
    if (!src) return;
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      setPlaying((p) => !p);
    } else if (e.key === "ArrowRight" && e.target === e.currentTarget) seek(tickRef.current + 5 * src.tickRate);
    else if (e.key === "ArrowLeft" && e.target === e.currentTarget) seek(tickRef.current - 5 * src.tickRate);
    else if (e.key === "Home") seek(0);
    else if (e.key === "End") seek(src.finalTick);
  };

  const src = srcRef.current;
  const who = (simId: string | null) => {
    if (!simId) return null;
    const slot = slotOf(simId);
    const p = frame?.players.find((x) => x.id === simId);
    if (!slot || !p) return null;
    const named = lineups?.[slot.side][slot.index];
    const team = slot.side === "home" ? home : away;
    return { number: named?.shirtNumber ?? p.number, name: named?.name ?? null, team, side: slot.side };
  };
  const picked = who(selected);
  const onBall = who(frame?.carrier ?? null);
  const goalSide = celebrating ? (celebrating.side === "home" ? home : away) : null;
  const goalChip = celebrating ? chips[celebrating.side] : null;
  const scorer = celebrating?.scorerId ? playerNames?.get(celebrating.scorerId) : undefined;
  const label = frame
    ? `Match replay at ${periodClock(frame)}: ${home.name} ${frame.score.home}, ${away.name} ${frame.score.away}`
    : "Match replay";
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!;
  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };
  const ctrl =
    "inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-white hover:bg-white/10 disabled:opacity-50";

  return (
    <div>
      <section
        ref={rootRef}
        aria-label="Match replay"
        className="grad-frame overflow-hidden rounded-2xl p-1.5 text-white shadow-[0_12px_34px_rgb(101_82_221/0.3)] sm:p-2"
        data-testid="match-viewer"
      >
        <div
          ref={wrapRef}
          className="relative w-full overflow-hidden rounded-t-xl border-[6px] border-b-0 border-navy bg-navy outline-none sm:border-8 sm:border-b-0"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the pitch is a keyboard-operable player (role=application)
          tabIndex={0}
          onKeyDown={onKey}
          aria-label="Replay pitch. Space to play or pause, arrow keys to seek."
          role="application"
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={label}
            className="block h-auto w-full"
            style={{ aspectRatio: "55 / 37" }}
            onClick={onPitchClick}
          />
          {picked && (
            <div
              className="absolute right-2 top-10 rounded-lg bg-navy/90 sm:top-2 px-2.5 py-1 text-xs font-semibold text-white sm:text-sm"
              data-testid="picked-player"
            >
              <span className="tabular">#{picked.number}</span> {picked.name ?? "Player"} · {picked.team.shortName}
            </div>
          )}
          {onBall && !playing && !picked && (
            <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-navy/85 px-2 py-0.5 text-xs font-semibold text-white sm:text-sm">
              On the ball: <span className="tabular">#{onBall.number}</span> {onBall.name ?? ""} (
              {onBall.team.shortName})
            </div>
          )}
          {mode === "highlights" && (
            <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-yellow px-2 py-0.5 font-display text-xs font-extrabold uppercase italic text-navy sm:text-sm">
              Highlights · same replay
            </div>
          )}
          {mode === "clip" && focus && (
            <div
              className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-yellow px-2 py-0.5 font-display text-xs font-extrabold uppercase italic text-navy sm:text-sm"
              data-testid="clip-label"
            >
              {focus.name} · {focus.ticks.length} goal{focus.ticks.length === 1 ? "" : "s"}
            </div>
          )}
          {clipEnded && focus && !playing && (
            <div className="absolute inset-0 flex items-center justify-center bg-navy/75 p-3" data-testid="clip-end">
              <div className="flex max-w-sm flex-col items-center gap-2 text-center">
                <p className="font-display text-xl font-extrabold uppercase italic leading-none sm:text-3xl">
                  {focus.name}
                </p>
                <Link
                  to={playerHref({ id: focus.playerId, name: focus.name })}
                  className="inline-flex min-h-10 items-center rounded-lg bg-coral px-3 py-1.5 text-sm font-bold text-ink hover:brightness-95"
                >
                  See {possessive(surnameOf(focus.name))} career <span aria-hidden>&nbsp;→</span>
                </Link>
                <div className="flex flex-wrap justify-center gap-1 text-sm font-semibold">
                  <button
                    type="button"
                    onClick={watchClip}
                    className="min-h-10 rounded-lg px-2 py-1 underline underline-offset-4 hover:bg-white/10"
                  >
                    Replay the clip
                  </button>
                  <button
                    type="button"
                    onClick={watchWholeMatch}
                    className="min-h-10 rounded-lg px-2 py-1 underline underline-offset-4 hover:bg-white/10"
                  >
                    Watch the full match
                  </button>
                </div>
              </div>
            </div>
          )}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 flex items-stretch font-semi text-base font-extrabold uppercase italic leading-none shadow-lg sm:text-[1.6rem]"
            data-testid="score-bug"
          >
            <span
              className="parallelogram-start py-1.5 pl-3 pr-5"
              style={{ background: chips.home.bg, color: chips.home.fg }}
            >
              {home.shortName}
            </span>
            <span
              key={celebrating ? `goal-${celebrating.tick}` : "score"}
              className={`parallelogram tabular -ml-2 py-1.5 ${celebrating ? "score-pop bg-yellow text-navy" : "bg-navy text-white"}`}
            >
              {frame ? `${frame.score.home}–${frame.score.away}` : "–"}
            </span>
            <span className="parallelogram -ml-2 py-1.5" style={{ background: chips.away.bg, color: chips.away.fg }}>
              {away.shortName}
            </span>
            <span className="parallelogram tabular -ml-2 bg-navy py-1.5 text-sm text-white sm:text-lg">
              {shortClock(frame)}
            </span>
          </div>
          {celebrating && goalSide && goalChip && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              data-testid="goal-banner"
            >
              <div className="goal-banner flex flex-col items-center gap-1 drop-shadow-[0_6px_0_rgb(27_31_73/0.85)] sm:gap-2">
                <span
                  className="parallelogram px-6 py-1 font-display text-5xl font-extrabold uppercase italic leading-none sm:px-10 sm:text-8xl"
                  style={{ background: goalChip.bg, color: goalChip.fg }}
                >
                  {celebrating.ownGoal ? "Own goal!" : "Goal!"}
                </span>
                <span className="parallelogram bg-navy px-4 py-1 font-semi text-sm font-bold uppercase italic text-white sm:text-xl">
                  {[
                    scorer && `${scorer}${celebrating.ownGoal ? " (og)" : ""}`,
                    goalSide.shortName,
                    formatClock(celebrating.period, celebrating.clockSec),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </div>
          )}
          {status === "loading" && (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white"
            >
              Loading replay…
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-ink">
              <ErrorState title="Replay unavailable">{error}</ErrorState>
            </div>
          )}
        </div>
        <p className="sr-only" aria-live="polite">
          {celebrating && goalSide
            ? `${celebrating.ownGoal ? "Own goal" : "Goal"} for ${goalSide.name}${scorer ? `, ${scorer}` : ""}. ${home.name} ${celebrating.score.home}, ${away.name} ${celebrating.score.away}.`
            : ""}
        </p>
        <div
          className={`flex items-center gap-1 rounded-b-xl bg-navy px-2 py-1.5 sm:gap-3 sm:px-3 ${status !== "ready" ? "pointer-events-none opacity-60" : ""}`}
        >
          <button
            type="button"
            onClick={() => {
              if (src && tickRef.current >= src.finalTick) seek(0);
              setPlaying((p) => !p);
            }}
            className={ctrl}
            aria-label={playing ? "Pause" : "Play"}
            disabled={status !== "ready"}
          >
            <svg aria-hidden viewBox="0 0 12 12" width="22" height="22">
              {playing ? (
                <path d="M2 1 H5 V11 H2 Z M7 1 H10 V11 H7 Z" fill="currentColor" />
              ) : (
                <path d="M2 1 L11 6 L2 11 Z" fill="currentColor" />
              )}
            </svg>
          </button>
          <span className="tabular hidden shrink-0 text-sm text-white/90 sm:inline" aria-hidden>
            {src ? `${mmss(tick / src.tickRate)} / ${mmss(src.finalTick / src.tickRate)}` : "0:00 / 0:00"}
          </span>
          <label className="flex min-w-0 flex-1 items-center px-1">
            <span className="sr-only">Match time</span>
            <input
              type="range"
              min={0}
              max={src?.finalTick ?? 1}
              step={src ? src.tickRate : 60}
              value={tick}
              onChange={(e) => seek(Number(e.target.value))}
              aria-valuetext={periodClock(frame)}
              className="replay-range w-full"
              style={{ "--progress": `${src ? (tick / src.finalTick) * 100 : 0}%` } as React.CSSProperties}
              disabled={status !== "ready"}
            />
          </label>
          <button
            type="button"
            className={`${ctrl} w-12 font-display text-lg font-extrabold`}
            onClick={() => setSpeed(nextSpeed)}
            aria-label={`Playback speed ${speed}×. Change to ${nextSpeed}×`}
            disabled={status !== "ready"}
          >
            {speed}×
          </button>
          <button
            type="button"
            className={`${ctrl} ${follow ? "bg-white/15" : ""}`}
            onClick={() => setFollow((v) => !v)}
            aria-pressed={follow}
            aria-label="Follow the ball (zoom in)"
            title="Follow the ball"
            disabled={status !== "ready"}
          >
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="9" cy="9" r="6" />
              <path d="M13.5 13.5 L18 18 M9 6.5 V11.5 M6.5 9 H11.5" />
            </svg>
          </button>
          <button
            type="button"
            className={ctrl}
            onClick={toggleFullscreen}
            aria-label="Full screen"
            disabled={status !== "ready"}
          >
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path d="M2 7 V2 H7 M13 2 H18 V7 M18 13 V18 H13 M7 18 H2 V13" />
            </svg>
          </button>
        </div>
      </section>
      {focus && status === "ready" && clip && clip.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="clip-controls">
          {mode === "clip" && playing ? (
            <button
              type="button"
              onClick={watchFull}
              className="min-h-10 rounded-full bg-ink px-3 py-1 text-sm font-semibold text-white"
            >
              Back to the full replay
            </button>
          ) : (
            <button
              type="button"
              onClick={watchClip}
              className="min-h-10 rounded-full bg-coral px-3 py-1 text-sm font-bold text-ink"
            >
              <span aria-hidden>▶ </span>
              {focus.label}
            </button>
          )}
          <Link
            to={playerHref({ id: focus.playerId, name: focus.name })}
            className="text-sm font-semibold text-violet-deep underline-offset-4 hover:underline"
          >
            {possessive(focus.name)} career <span aria-hidden>→</span>
          </Link>
        </div>
      )}
      {!compact && status === "ready" && highlights && (
        <KeyMoments
          index={highlights}
          home={home}
          away={away}
          playerNames={playerNames}
          mode={mode}
          tick={tick}
          tickRate={src?.tickRate ?? 60}
          lineups={lineups}
          onSeek={(t) => {
            setMode("full");
            seek(t);
          }}
          onHighlights={watchHighlights}
          onFull={watchFull}
          onPick={setSelected}
          selected={selected}
        />
      )}
      <p className="mt-2 text-xs text-muted-text">
        Genuine top-down replay from the autosoccer-sim engine{src ? ` v${src.engineVersion}` : ""}
        {compact ? "." : ": players are simulated as circles, exactly as the simulator models them."}
      </p>
    </div>
  );
}

const surnameOf = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** The career page of the player in a simulator slot, when the lineup carries ids. */
function pickedCareer(lineups: NonNullable<MatchViewerProps["lineups"]>, simId: string): string | null {
  const slot = slotOf(simId);
  const p = slot ? lineups[slot.side][slot.index] : undefined;
  return p?.id ? playerHref({ id: p.id, name: p.name }) : null;
}

const momentLabel = (
  m: Moment,
  home: MatchViewerProps["home"],
  away: MatchViewerProps["away"],
  names?: ReadonlyMap<string, string>,
) => {
  const team = m.side === "home" ? home : away;
  if (m.kind === "goal" && m.goal) {
    const scorer = m.goal.scorerId ? names?.get(m.goal.scorerId) : undefined;
    return {
      kind: m.goal.ownGoal ? "Own goal" : "Goal",
      text: `${formatClock(m.goal.period, m.goal.clockSec)} · ${team.shortName} ${m.goal.score.home}–${m.goal.score.away}${scorer ? ` · ${scorer}${m.goal.ownGoal ? " (og)" : ""}` : ""}`,
    };
  }
  return { kind: "Keeper catch", text: `${team.shortName} keeper · ${Math.round(m.catch?.speed ?? 0)} m/s ball` };
};

/** Chapters, verified key moments, the highlights toggle and a keyboard way to pick out a player. */
function KeyMoments({
  index,
  home,
  away,
  playerNames,
  mode,
  tick,
  tickRate,
  lineups,
  onSeek,
  onHighlights,
  onFull,
  onPick,
  selected,
}: {
  index: HighlightsIndex;
  home: MatchViewerProps["home"];
  away: MatchViewerProps["away"];
  playerNames?: ReadonlyMap<string, string>;
  mode: "full" | "highlights" | "clip";
  tick: number;
  tickRate: number;
  lineups?: MatchViewerProps["lineups"];
  onSeek: (tick: number) => void;
  onHighlights: () => void;
  onFull: () => void;
  onPick: (simId: string | null) => void;
  selected: string | null;
}) {
  const active = index.moments.findIndex((m) => tick >= m.start && tick <= m.end);
  const pill = "rounded-full px-2.5 py-0.5 text-sm font-semibold";
  return (
    <div className="mt-3 space-y-3" data-testid="key-moments">
      <div className="flex flex-wrap items-center gap-2">
        {index.reel.length > 0 ? (
          mode === "highlights" ? (
            <button type="button" onClick={onFull} className={`${pill} bg-ink text-white`}>
              Back to the full replay
            </button>
          ) : (
            <button type="button" onClick={onHighlights} className={`${pill} bg-coral text-ink`}>
              ▶ Watch highlights ({index.moments.length})
            </button>
          )
        ) : (
          <span className="text-sm text-muted-text">
            No verified highlights: the record has no goals or fast keeper catches in this match.
          </span>
        )}
        <span className="text-xs text-muted-text">Highlights replay moments of this same recorded match.</span>
      </div>
      {index.moments.length > 0 && (
        <ol className="flex flex-wrap gap-2" aria-label="Key moments">
          {index.moments.map((m, i) => {
            const l = momentLabel(m, home, away, playerNames);
            return (
              <li key={`${m.kind}-${m.tick}`}>
                <button
                  type="button"
                  onClick={() => onSeek(m.start)}
                  aria-current={i === active ? "true" : undefined}
                  className={`${pill} ${m.kind === "goal" ? "bg-lavender text-violet-deep hover:bg-lavender-strong" : "border border-line bg-surface text-ink hover:bg-canvas"} ${i === active ? "ring-2 ring-violet" : ""}`}
                >
                  <span className="mr-1 text-[11px] font-bold uppercase tracking-wider">{l.kind}</span>
                  {l.text}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-muted-text">Chapters:</span>
        {index.chapters.map((c) => (
          <button
            key={`${c.label}-${c.tick}`}
            type="button"
            onClick={() => onSeek(c.tick)}
            className="rounded-md px-2 py-0.5 font-semibold text-violet-deep underline-offset-4 hover:underline"
          >
            {c.label}{" "}
            <span className="tabular text-muted-text">
              ({Math.floor(c.tick / tickRate / 60)}:{String(Math.floor((c.tick / tickRate) % 60)).padStart(2, "0")})
            </span>
          </button>
        ))}
      </div>
      {lineups && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-muted-text">Pick out a player:</span>
          <select
            value={selected ?? ""}
            onChange={(e) => onPick(e.target.value || null)}
            className="rounded-md border border-line bg-surface px-2 py-1"
          >
            <option value="">None</option>
            {(["home", "away"] as const).map((side) => (
              <optgroup key={side} label={(side === "home" ? home : away).name}>
                {lineups[side].map((p, i) => (
                  <option key={`${side}-${p.shirtNumber}`} value={`${side === "home" ? "blue" : "red"}-${i + 1}`}>
                    #{p.shirtNumber} {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {selected && pickedCareer(lineups, selected) && (
            <Link
              to={pickedCareer(lineups, selected)!}
              className="font-semibold text-violet-deep underline-offset-4 hover:underline"
            >
              Career <span aria-hidden>→</span>
            </Link>
          )}
        </label>
      )}
      {index.notes.map((n) => (
        <p key={n} className="text-xs text-muted-text">
          {n}
        </p>
      ))}
    </div>
  );
}
