import type { OfficialEvent, Team } from "@autosoccer/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClock, onColor, readableChip } from "../../lib/format";
import { ErrorState } from "../States";
import { aspect, drawFrame } from "./draw";
import { type Frame, loadReplay, type ReplaySource } from "./replay-adapter";

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
}

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

  const chips = useMemo(
    () => ({ home: readableChip(home.colors.primary), away: readableChip(away.colors.primary) }),
    [home.colors.primary, away.colors.primary],
  );
  const colors = useMemo(
    () => ({
      home: home.colors.primary,
      away: away.colors.primary,
      homeText: onColor(home.colors.primary),
      awayText: onColor(away.colors.primary),
    }),
    [home.colors.primary, away.colors.primary],
  );

  const render = useCallback(
    (t: number) => {
      const src = srcRef.current;
      const canvas = canvasRef.current;
      if (!src || !canvas) return;
      const f = src.frameAt(t);
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
      drawFrame(ctx, f, { pitch: src.pitch, playerRadius: src.playerRadius, colors }, w, h);
      setFrame(f);
    },
    [colors],
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
    const loop = (now: number) => {
      acc += ((now - last) / 1000) * src.tickRate * speed;
      last = now;
      const whole = Math.floor(acc);
      if (whole > 0) {
        acc -= whole;
        const next = Math.min(src.finalTick, tickRef.current + whole);
        tickRef.current = next;
        setTick(next);
        render(next);
        if (next >= src.finalTick) {
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, status, render]);

  const seek = (t: number) => {
    const src = srcRef.current;
    if (!src) return;
    const next = Math.max(0, Math.min(src.finalTick, Math.round(t)));
    tickRef.current = next;
    setTick(next);
    render(next);
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
  const goals = events.filter((e): e is Extract<OfficialEvent, { type: "goal" }> => e.type === "goal");
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
          />
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
            <span className="parallelogram tabular -ml-2 bg-navy py-1.5 text-white">
              {frame ? `${frame.score.home}–${frame.score.away}` : "–"}
            </span>
            <span className="parallelogram -ml-2 py-1.5" style={{ background: chips.away.bg, color: chips.away.fg }}>
              {away.shortName}
            </span>
            <span className="parallelogram tabular -ml-2 bg-navy py-1.5 text-sm text-white sm:text-lg">
              {shortClock(frame)}
            </span>
          </div>
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
      {!compact && goals.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-muted-text">Jump to goal:</span>
          {goals.map((g) => (
            <button
              key={g.tick}
              type="button"
              onClick={() => seek(g.tick - 4 * (src?.tickRate ?? 60))}
              className="rounded-full bg-lavender px-2.5 py-0.5 font-semibold text-violet-deep hover:bg-lavender-strong"
            >
              {formatClock(g.period, g.clockSec)} · {g.side === "home" ? home.shortName : away.shortName} {g.score.home}
              –{g.score.away}
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-text">
        Genuine top-down replay from the autosoccer-sim engine{src ? ` v${src.engineVersion}` : ""}
        {compact ? "." : ": players are simulated as circles, exactly as the simulator models them."}
      </p>
    </div>
  );
}
