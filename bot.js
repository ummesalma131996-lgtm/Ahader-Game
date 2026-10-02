/**
 * LudoBot.choose(state, level) -> token index.
 *  easy: random | medium: goal > capture > leave yard > furthest | hard: weighted heuristic w/ danger look-ahead
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'));
  else root.LudoBot = factory(root.LudoEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  /** Count opponent tokens within 1-6 cells behind absolute cell `cell`. */
  function threats(s, me, cell) {
    let n = 0;
    for (const oc of s.colors) if (oc !== me)
      for (const q of s.tokens[oc]) {
        const a = E.absCell(oc, q); if (a === null) continue;
        const d = (cell - a + 52) % 52;
        if (d >= 1 && d <= 6) n++;
      }
    return n;
  }
  const captures = (s, me, abs) => abs !== null && !E.SAFE.has(abs) &&
    s.colors.some(oc => oc !== me && s.tokens[oc].some(q => E.absCell(oc, q) === abs));

  function score(s, me, m) {
    let sc = 0;
    const toAbs = E.absCell(me, m.to), fromAbs = E.absCell(me, m.from);
    if (m.to === E.GOAL) sc += 100;
    if (m.from === -1) sc += 45;
    if (m.to > E.TRACK_END && m.to < E.GOAL) sc += 25;               // safe home column
    if (toAbs !== null && !E.SAFE.has(toAbs)) {
      if (captures(s, me, toAbs)) sc += 80;
      sc -= threats(s, me, toAbs) * 35;                              // landing in danger
    } else if (toAbs !== null) sc += 20;                             // star / start cell
    if (fromAbs !== null && !E.SAFE.has(fromAbs)) sc += threats(s, me, fromAbs) * 30; // escaping danger
    return sc + m.to * 0.4;                                          // progress
  }

  function choose(s, level = 'medium', rng = Math.random) {
    const me = E.current(s), moves = E.legalMoves(s);
    if (!moves.length) return null;
    if (level === 'easy') return moves[Math.floor(rng() * moves.length)].token;
    if (level === 'medium') {
      return (moves.find(m => m.to === E.GOAL) || moves.find(m => captures(s, me, E.absCell(me, m.to)))
        || moves.find(m => m.from === -1) || moves.reduce((a, b) => (b.from > a.from ? b : a))).token;
    }
    return moves.map(m => ({ m, sc: score(s, me, m) + rng() })).sort((a, b) => b.sc - a.sc)[0].m.token;
  }
  return { choose };
});
