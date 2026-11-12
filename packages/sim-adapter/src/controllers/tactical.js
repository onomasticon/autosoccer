// ─────────────────────────────────────────────────────────────────────────────
// Auto Soccer · parameterised tactical controller (autosoccer-sim SDK 1.3)
//
// One script, driven entirely by the PARAMS object the platform injects. The
// same params always produce the same source, so a tactical revision maps to
// exactly one controller (and one sourceHash in the replay).
//
// Without the ball: hold a shape of outfield slots (four in 5-a-side, six in
// 7-a-side; depth from own goal line, lateral offset), shifted toward the ball.
// The player who can reach a loose ball first goes for it (at its intercept
// point); a second player supports when the ball is in the pressing zone or in
// the opponents' half. When we have the ball (balanced or direct tempo), the most
// advanced outfield player runs in behind and the rest step up.
// With the ball: shoot inside shooting range with an open lane, or from close
// range regardless; otherwise pass to the best open teammate (weighted by
// directness); carry into space when unpressured, toward goal in the final
// third; under pressure with no pass, shield and turn away rather than hoof.
// Keeper catches in the box and releases short or long.
// ─────────────────────────────────────────────────────────────────────────────
const P = __PARAMS__;
let R = null;
// Pitch half-length / half-width, from the match info (50×32 m in 5-a-side, 60×38 m in 7-a-side).
let HL = 25;
let HW = 16;
let GOAL_HALF = 2;

const clampPitch = (p) => ({ x: Soccer.clamp(p.x, -(HL - 1.5), HL - 1.5), y: Soccer.clamp(p.y, -(HW - 1), HW - 1) });

function slotTarget(obs, number, attacking) {
  const s = P.slots[number];
  const dir = obs.attackingDirection;
  const ballUp = Soccer.forward(obs, obs.ball);
  const push =
    Soccer.clamp(ballUp * P.ballFollow, -4, 6) + (attacking ? P.attackPush * (s.depth > P.pushDepth ? 1 : 0.5) : 0);
  const shift = Soccer.clamp(obs.ball.y * P.ballShift, -6, 6);
  return clampPitch({ x: (-HL + s.depth + push) * dir, y: s.lateral + shift });
}

/** Run in behind: just beyond the deepest outfield opponent, on the ball's side, never offside-limited (no offside). */
function runTarget(obs, p) {
  const dir = obs.attackingDirection;
  const deepest = obs.opponents
    .filter((o) => o.role !== "GK")
    .reduce((m, o) => Math.max(m, Soccer.forward(obs, o)), -HL);
  const depth = Soccer.clamp(Math.max(deepest + 2, Soccer.forward(obs, obs.ball) + 4), -HL + 4, HL - 4);
  const y = Soccer.clamp(p.y * 0.5 + obs.ball.y * 0.2, -(HW - 3), HW - 3);
  return clampPitch({ x: depth * dir, y });
}

function bestPass(obs, carrier) {
  const b = obs.ball;
  let best = null;
  let bestScore = -Infinity;
  for (const q of obs.teammates) {
    if (q.id === carrier.id || q.role === "GK") continue;
    const d = Soccer.dist(b, q);
    if (d < 4 || d > P.maxPassDistance) continue;
    const gain = Soccer.forward(obs, q) - Soccer.forward(obs, carrier);
    if (gain < -P.backPassAllowance) continue;
    const lead = clampPitch({ x: q.x + obs.attackingDirection * P.leadDistance, y: q.y });
    const clearance = Soccer.laneClearance(b, lead, obs.opponents);
    if (clearance < P.passSafety) continue;
    // A receiver close to the opponents' goal is worth more (a pass that sets up a shot).
    const threat = Math.max(0, P.shootRange - Soccer.dist(q, Soccer.oppGoal(obs)));
    const score = gain * P.directness + Math.min(clearance, 4) * (1 - P.directness) * 2 + threat * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = { q, lead, d, gain };
    }
  }
  return best;
}

function keeper(obs, gk, out) {
  const b = obs.ball;
  const dir = obs.attackingDirection;
  if (b.heldBy === gk.id) {
    const field = obs.teammates.filter((p) => p.role !== "GK");
    const target =
      P.keeperRelease === "long"
        ? field.reduce((a, c) => (Soccer.forward(obs, c) > Soccer.forward(obs, a) ? c : a))
        : Soccer.nearest(field, gk);
    out.push({
      type: "releaseBall",
      player: gk.id,
      direction: { x: target.x - gk.x, y: target.y - gk.y },
      power: P.keeperRelease === "long" ? 0.85 : 0.45,
    });
    return;
  }
  const reach = R.catchReach - 0.1;
  if (!obs.restart && !b.heldBy && Soccer.dist(b, gk) < reach && gk.cooldowns.catch === 0 && Soccer.inOwnBox(obs, gk)) {
    out.push({ type: "catchBall", player: gk.id });
  }
  // A ball travelling toward our goal: meet it on its path if we can get there in time, inside the box.
  const speed = Math.hypot(b.vx, b.vy);
  const incoming = !obs.restart && !b.heldBy && speed > 5 && b.vx * -dir > 0 && Soccer.forward(obs, b) < -HL / 3;
  if (incoming) {
    const ip = Soccer.interceptPoint(gk, b, R, 1.2);
    if (ip && Soccer.inOwnBox(obs, ip)) {
      out.push({ type: "moveTo", player: gk.id, x: ip.x, y: ip.y, sprint: true });
      return;
    }
  }
  // Otherwise hold a line between the ball and the middle of the goal.
  const gx = -dir * (HL - 1.4);
  const lineY = Soccer.clamp(b.y * 0.25, -(GOAL_HALF - 0.3), GOAL_HALF - 0.3);
  out.push({ type: "moveTo", player: gk.id, x: gx, y: lineY });
}

function onBall(obs, p, out, notes) {
  const b = obs.ball;
  const dir = obs.attackingDirection;
  const goal = Soccer.oppGoal(obs);
  const goalDist = Soccer.dist(p, goal);
  const shot = Soccer.shotTarget(obs);
  const lane = Soccer.laneClearance(b, shot, obs.opponents);
  if ((goalDist < P.shootRange && lane > 0.3) || goalDist < P.shootRange * 0.6) {
    notes.push(`${p.id} shoots from ${goalDist.toFixed(1)} m`);
    out.push(...Soccer.approachAndKick(p, b, shot, 1, R, { sprint: P.sprint }));
    return "shoot";
  }
  const pressure = Soccer.pressure(p, obs.opponents);
  const pass = bestPass(obs, p);
  // A clearly better-placed teammate gets the ball even when we have room to carry;
  // patient sides keep it moving whenever a safe pass is on.
  if (pass && (pressure <= P.dribbleSpace || pass.gain > 6 || P.directness < 0.3)) {
    notes.push(`${p.id} → ${pass.q.id}`);
    out.push(...Soccer.approachAndKick(p, b, pass.lead, Soccer.kickPowerFor(pass.d, P.passArriveSpeed, R), R));
    return "pass";
  }
  if (pressure > P.dribbleSpace) {
    // Carry: straight up the pitch, bending toward goal once in the final third.
    const up = Soccer.forward(obs, p);
    const bend = up > HL / 3 ? 0.35 : 0;
    const target = clampPitch({ x: p.x + dir * 4, y: p.y * (0.85 - bend) });
    out.push({ type: "moveTo", player: p.id, x: target.x, y: target.y, dribble: true, sprint: false });
    return "carry";
  }
  if (Soccer.forward(obs, p) > -HL / 3 && P.dribbleSpace < 5) {
    // Under pressure with no pass: sides that dribble shield, turning away from the nearest opponent.
    const o = Soccer.nearest(obs.opponents, p);
    const away = Soccer.norm(p.x - o.x, p.y - o.y);
    const target = clampPitch({ x: p.x + (away.x + dir * 0.6) * 2.5, y: p.y + away.y * 2.5 });
    out.push({ type: "moveTo", player: p.id, x: target.x, y: target.y, dribble: true, sprint: false });
    return "shield";
  }
  const clear = { x: dir * HL, y: p.y > 0 ? HW * 0.75 : -HW * 0.75 };
  out.push(...Soccer.approachAndKick(p, b, clear, 0.8, R));
  return "clear";
}

function restart(obs, out, notes) {
  const t = Soccer.ourTaker(obs);
  if (!t) return null;
  const b = obs.ball;
  let target = null;
  if (
    (obs.restart.type === "freeKick" || obs.restart.type === "corner") &&
    Soccer.dist(b, Soccer.oppGoal(obs)) < P.shootRange
  ) {
    target = Soccer.shotTarget(obs);
  } else {
    const pass = bestPass(obs, t);
    target = pass
      ? pass.lead
      : Soccer.nearest(
          obs.teammates.filter((q) => q.id !== t.id && q.role !== "GK"),
          b,
        );
  }
  const d = Soccer.dist(b, target);
  const acts = Soccer.approachAndKick(t, b, target, Math.max(0.35, Soccer.kickPowerFor(d, P.passArriveSpeed, R)), R);
  for (const a of acts) if (a.type !== "kick" || obs.restart.ready) out.push(a);
  notes.push(`${obs.restart.type}: ${t.id}`);
  return t.id;
}

defineController({
  name: P.name,
  version: "2.0.0",
  initialize(info) {
    R = info.rules;
    HL = info.pitch.length / 2;
    HW = info.pitch.width / 2;
    GOAL_HALF = info.pitch.goalWidth / 2;
  },
  update(obs) {
    const out = [];
    const notes = [];
    const b = obs.ball;
    const gk = obs.teammates.find((p) => p.role === "GK");
    const field = obs.teammates.filter((p) => p.role !== "GK");
    const poss = Soccer.possession(obs);
    const attacking = poss.side === "own";
    let mode = attacking ? "attack" : poss.side === "opp" ? "defend" : "loose";

    const taker = obs.restart?.ours ? restart(obs, out, notes) : null;
    if (taker) mode = "restart";

    let engager = null;
    let presser = null;
    let runner = null;
    if (!obs.restart && !b.heldBy) {
      // Whoever reaches the ball first engages; a loose ball is met where it will be, not where it is.
      const reach = (p) => {
        const ip = Soccer.interceptPoint(p, b, R, 2);
        return ip ? ip.t : Soccer.timeToReach(p, b, R, true) + 1;
      };
      const byReach = field.slice().sort((p, q) => reach(p) - reach(q));
      engager = byReach[0];
      const ballUp = Soccer.forward(obs, b);
      const inPressZone = ballUp > P.pressLine;
      if (poss.side === "opp" && inPressZone && P.pressers > 1) presser = byReach[1];
      else if (poss.side === null && ballUp > 0) presser = byReach[1];
    }
    // Patient sides keep their shape; balanced and direct ones send a runner beyond the last defender.
    if (attacking && P.directness >= 0.5) {
      const carrier = poss.player;
      runner = field
        .filter((p) => !carrier || p.id !== carrier.id)
        .reduce((a, c) => (!a || Soccer.forward(obs, c) > Soccer.forward(obs, a) ? c : a), null);
    }

    for (const p of field) {
      if (p.id === taker) continue;
      if (engager && p.id === engager.id) {
        const d = Soccer.dist(p, b);
        if (poss.side === "opp" && d < R.tackleReach * 0.8 && p.cooldowns.tackle === 0 && p.stunned === 0) {
          out.push({ type: "tackle", player: p.id });
        } else if (d < 1.2 && poss.side !== "opp") {
          mode = onBall(obs, p, out, notes);
          continue;
        }
        const ip = poss.side === null ? Soccer.interceptPoint(p, b, R, 2) : null;
        const t = ip ? { x: ip.x, y: ip.y } : { x: b.x, y: b.y };
        out.push({ type: "moveTo", player: p.id, x: t.x, y: t.y, sprint: P.sprint && d > 3 });
        continue;
      }
      if (presser && p.id === presser.id) {
        const own = Soccer.ownGoal(obs);
        const goalSide = { x: b.x + (own.x - b.x) * 0.08, y: b.y * 0.92 };
        out.push({ type: "moveTo", player: p.id, x: goalSide.x, y: goalSide.y, sprint: P.sprint });
        continue;
      }
      if (runner && p.id === runner.id) {
        const r = runTarget(obs, p);
        out.push({ type: "moveTo", player: p.id, x: r.x, y: r.y, sprint: true });
        continue;
      }
      const s = slotTarget(obs, p.number, attacking);
      out.push({ type: "moveTo", player: p.id, x: s.x, y: s.y });
    }

    if (gk && gk.id !== taker) keeper(obs, gk, out);
    return { actions: out, debug: { mode, notes: notes.slice(0, 6) } };
  },
});
