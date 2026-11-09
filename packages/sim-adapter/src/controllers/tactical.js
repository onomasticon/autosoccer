// ─────────────────────────────────────────────────────────────────────────────
// Auto Soccer · parameterised tactical controller (autosoccer-sim SDK 1.2)
//
// One script, driven entirely by the PARAMS object the platform injects. The
// same params always produce the same source, so a tactical revision maps to
// exactly one controller (and one sourceHash in the replay).
//
// Without the ball: hold a shape of four outfield slots (depth from own goal
// line, lateral offset), shifted toward the ball; the nearest player engages,
// and a second presser joins when the ball is inside the pressing zone.
// With the ball: shoot inside shooting range with an open lane; otherwise pass
// to the best open teammate (weighted by directness); dribble into space when
// unpressured. Keeper catches in the box and releases short or long.
// ─────────────────────────────────────────────────────────────────────────────
const P = __PARAMS__;
let R = null;

const clampPitch = (p) => ({ x: Soccer.clamp(p.x, -23.5, 23.5), y: Soccer.clamp(p.y, -15, 15) });

function slotTarget(obs, number, attacking) {
  const s = P.slots[number];
  const dir = obs.attackingDirection;
  const ballUp = Soccer.forward(obs, obs.ball);
  const push = Soccer.clamp(ballUp * P.ballFollow, -4, 6) + (attacking ? P.attackPush * (s.depth > 14 ? 1 : 0.5) : 0);
  const shift = Soccer.clamp(obs.ball.y * P.ballShift, -6, 6);
  return clampPitch({ x: (-25 + s.depth + push) * dir, y: s.lateral + shift });
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
    const lead = { x: q.x + obs.attackingDirection * P.leadDistance, y: q.y };
    const clearance = Soccer.laneClearance(b, lead, obs.opponents);
    if (clearance < P.passSafety) continue;
    const score = gain * P.directness + Math.min(clearance, 4) * (1 - P.directness) * 2;
    if (score > bestScore) {
      bestScore = score;
      best = { q, lead, d };
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
  if (!obs.restart && !b.heldBy && Soccer.dist(b, gk) < 1.3 && gk.cooldowns.catch === 0 && Soccer.inOwnBox(obs, gk)) {
    out.push({ type: "catchBall", player: gk.id });
  }
  out.push({ type: "moveTo", player: gk.id, x: -dir * 23.6, y: Soccer.clamp(b.y * 0.25, -1.8, 1.8) });
}

function onBall(obs, p, out, notes) {
  const b = obs.ball;
  const goalDist = Soccer.dist(p, Soccer.oppGoal(obs));
  const shot = Soccer.shotTarget(obs);
  if (goalDist < P.shootRange && Soccer.laneClearance(b, shot, obs.opponents) > 0.6) {
    notes.push(`${p.id} shoots from ${goalDist.toFixed(1)} m`);
    out.push(...Soccer.approachAndKick(p, b, shot, 1, R, { sprint: P.sprint }));
    return "shoot";
  }
  const pressure = Soccer.pressure(p, obs.opponents);
  if (pressure > P.dribbleSpace) {
    const target = clampPitch({ x: p.x + obs.attackingDirection * 4, y: p.y * 0.85 });
    out.push({ type: "moveTo", player: p.id, x: target.x, y: target.y, dribble: true, sprint: false });
    return "carry";
  }
  const pass = bestPass(obs, p);
  if (pass) {
    notes.push(`${p.id} → ${pass.q.id}`);
    out.push(...Soccer.approachAndKick(p, b, pass.lead, Soccer.kickPowerFor(pass.d, P.passArriveSpeed, R), R));
    return "pass";
  }
  const clear = { x: obs.attackingDirection * 25, y: p.y > 0 ? 12 : -12 };
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
  version: "1.0.0",
  initialize(info) {
    R = info.rules;
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
    if (!obs.restart && !b.heldBy) {
      const byDist = field.slice().sort((p, q) => Soccer.dist(p, b) - Soccer.dist(q, b));
      engager = byDist[0];
      const inPressZone = Soccer.forward(obs, b) > P.pressLine;
      if (poss.side === "opp" && inPressZone && P.pressers > 1) presser = byDist[1];
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
        out.push({ type: "moveTo", player: p.id, x: b.x, y: b.y, sprint: P.sprint && d > 3 });
        continue;
      }
      if (presser && p.id === presser.id) {
        const own = Soccer.ownGoal(obs);
        const goalSide = { x: b.x + (own.x - b.x) * 0.08, y: b.y * 0.92 };
        out.push({ type: "moveTo", player: p.id, x: goalSide.x, y: goalSide.y, sprint: P.sprint });
        continue;
      }
      const s = slotTarget(obs, p.number, attacking);
      out.push({ type: "moveTo", player: p.id, x: s.x, y: s.y });
    }

    if (gk && gk.id !== taker) keeper(obs, gk, out);
    return { actions: out, debug: { mode, notes: notes.slice(0, 6) } };
  },
});
