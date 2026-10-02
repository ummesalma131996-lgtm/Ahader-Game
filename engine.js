/**
 * LudoEngine - pure game rules. Used by BOTH the browser and the Node server.
 * Token position model (relative to its own colour):
 *   -1 = yard | 0..50 = shared track (0 = colour's start) | 51..55 = home column | 56 = goal
 * Absolute track cell = (START[color] + pos) % 52
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LudoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COLORS = ['red', 'green', 'yellow', 'blue'];
  const START = { red: 0, green: 13, yellow: 26, blue: 39 };
  const SAFE = new Set([0, 13, 26, 39, 8, 21, 34, 47]); // 4 starts + 4 stars
  const TRACK_END = 50, GOAL = 56;

  const absCell = (c, p) => (p >= 0 && p <= TRACK_END ? (START[c] + p) % 52 : null);
  const isSafe = (c, p) => { const a = absCell(c, p); return a === null || SAFE.has(a); };

  function create(colors) {
    const tokens = {};
    colors.forEach(c => (tokens[c] = [-1, -1, -1, -1]));
    return { colors, tokens, turn: 0, dice: null, phase: 'roll', sixes: 0, winners: [], over: false };
  }
  const current = s => s.colors[s.turn];

  function legalMoves(s, dice = s.dice) {
    const c = current(s), out = [];
    s.tokens[c].forEach((p, i) => {
      if (p === -1) { if (dice === 6) out.push({ token: i, from: -1, to: 0 }); }
      else if (p < GOAL && p + dice <= GOAL) out.push({ token: i, from: p, to: p + dice });
    });
    return out;
  }

  function nextTurn(s) {
    s.sixes = 0; s.dice = null; s.phase = 'roll';
    for (let k = 1; k <= s.colors.length; k++) {
      const idx = (s.turn + k) % s.colors.length;
      if (!s.winners.includes(s.colors[idx])) { s.turn = idx; return; }
    }
  }

  /** Roll dice -> events. Auto-passes if no legal move; three 6s forfeits the turn. */
  function roll(s, rng = Math.random) {
    if (s.over || s.phase !== 'roll') return null;
    const v = 1 + Math.floor(rng() * 6);
    s.dice = v;
    const ev = [{ type: 'roll', color: current(s), value: v }];
    s.sixes = v === 6 ? s.sixes + 1 : 0;
    if (s.sixes === 3) { ev.push({ type: 'triple6' }); nextTurn(s); ev.push({ type: 'turn', color: current(s) }); return ev; }
    if (!legalMoves(s).length) {
      ev.push({ type: 'nomove' });
      if (v === 6) s.dice = null; else nextTurn(s);
      ev.push({ type: 'turn', color: current(s) });
    } else s.phase = 'move';
    return ev;
  }

  /** Move token i by current dice -> events (path = cells to animate step by step). */
  function move(s, i) {
    if (s.over || s.phase !== 'move') return null;
    const m = legalMoves(s).find(x => x.token === i);
    if (!m) return null;
    const c = current(s), ev = [];
    const path = []; for (let p = m.from + 1; p <= m.to; p++) path.push(p);
    if (m.from === -1) path.splice(0, path.length, 0);
    s.tokens[c][i] = m.to;
    ev.push({ type: 'move', color: c, token: i, from: m.from, to: m.to, path, safe: m.to > 0 && m.to <= TRACK_END && isSafe(c, m.to) });

    let bonus = s.dice === 6, captured = false;
    const a = absCell(c, m.to);
    if (a !== null && !SAFE.has(a)) {
      for (const oc of s.colors) if (oc !== c)
        s.tokens[oc].forEach((q, j) => {
          if (absCell(oc, q) === a) { s.tokens[oc][j] = -1; captured = true; ev.push({ type: 'capture', color: oc, token: j, by: c }); }
        });
    }
    if (captured) bonus = true;
    if (m.to === GOAL) { bonus = true; ev.push({ type: 'home', color: c, token: i }); }
    if (s.tokens[c].every(p => p === GOAL)) {
      s.winners.push(c); ev.push({ type: 'win', color: c, place: s.winners.length }); bonus = false;
      if (s.winners.length >= s.colors.length - 1) {
        s.over = true;
        const last = s.colors.find(x => !s.winners.includes(x)); if (last) s.winners.push(last);
        ev.push({ type: 'gameover', winners: s.winners }); return ev;
      }
    }
    if (bonus) { s.phase = 'roll'; s.dice = null; } else nextTurn(s);
    ev.push({ type: 'turn', color: current(s) });
    return ev;
  }

  return { COLORS, START, SAFE, GOAL, TRACK_END, absCell, isSafe, create, current, legalMoves, roll, move };
});
