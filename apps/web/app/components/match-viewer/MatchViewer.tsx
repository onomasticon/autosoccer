import type { OfficialEvent, Team } from "@autosoccer/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClock, onColor } from "../../lib/format";
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
  const srcRef = useRef<ReplaySource | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(initialSpeed);
  const tickRef = useRef(0);

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

  return (
    <section
      aria-label="Match replay"
      className="overflow-hidden rounded-xl bg-ink text-white shadow-[var(--shadow-card)]"
      data-testid="match-viewer"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3 font-display text-xl font-extrabold">
          <span className="inline-block size-3 rounded-full" style={{ background: colors.home }} aria-hidden />
          <span>{home.shortName}</span>
          <span className="tabular rounded bg-white px-2 text-ink" aria-hidden>
            {frame ? `${frame.score.home}–${frame.score.away}` : "–"}
          </span>
          <span>{away.shortName}</span>
          <span className="inline-block size-3 rounded-full" style={{ background: colors.away }} aria-hidden />
        </div>
        <span className="tabular text-sm font-semibold text-white/90" aria-live="off">
          {periodClock(frame)}
        </span>
      </div>
      <div
        ref={wrapRef}
        className="relative w-full bg-ink outline-none"
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
        className={`flex flex-wrap items-center gap-3 px-4 py-3 ${status !== "ready" ? "pointer-events-none opacity-50" : ""}`}
      >
        <button
          type="button"
          onClick={() => {
            if (src && tickRef.current >= src.finalTick) seek(0);
            setPlaying((p) => !p);
          }}
          className="inline-flex min-w-24 items-center justify-center gap-2 rounded-md bg-coral px-3 py-1.5 font-semibold text-ink"
          aria-pressed={playing}
          disabled={status !== "ready"}
        >
          <svg aria-hidden viewBox="0 0 12 12" width="12" height="12">
            {playing ? (
              <path d="M2 1 H5 V11 H2 Z M7 1 H10 V11 H7 Z" fill="currentColor" />
            ) : (
              <path d="M2 1 L11 6 L2 11 Z" fill="currentColor" />
            )}
          </svg>
          {playing ? "Pause" : "Play"}
        </button>
        <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-sm">
          <span className="sr-only">Match time</span>
          <input
            type="range"
            min={0}
            max={src?.finalTick ?? 1}
            step={src ? src.tickRate : 60}
            value={tick}
            onChange={(e) => seek(Number(e.target.value))}
            aria-valuetext={periodClock(frame)}
            className="range range-xs w-full [--range-bg:rgb(255_255_255/0.25)] [--range-thumb:var(--color-yellow)]"
            disabled={status !== "ready"}
          />
        </label>
        {!compact && (
          <label className="flex items-center gap-2 text-sm">
            Speed
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="rounded bg-white px-1.5 py-1 text-ink"
              disabled={status !== "ready"}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!compact && goals.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-white/10 px-4 py-2.5 text-sm">
          <span className="font-semibold text-white/80">Jump to goal:</span>
          {goals.map((g) => (
            <button
              key={g.tick}
              type="button"
              onClick={() => seek(g.tick - 4 * (src?.tickRate ?? 60))}
              className="rounded-full bg-white/10 px-2.5 py-0.5 font-semibold hover:bg-white/20"
            >
              {formatClock(g.period, g.clockSec)} · {g.side === "home" ? home.shortName : away.shortName} {g.score.home}
              –{g.score.away}
            </button>
          ))}
        </div>
      )}
      <p className="border-t border-white/10 px-4 py-2 text-xs text-white/75">
        Genuine top-down replay from the autosoccer-sim engine{src ? ` v${src.engineVersion}` : ""}: players are
        simulated as circles, exactly as the simulator models them.
      </p>
    </section>
  );
}
