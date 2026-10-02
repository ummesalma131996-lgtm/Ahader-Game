/* Ludo client: canvas board, animation, dice, menus, local/bot/online controllers. */
(() => {
const E = LudoEngine, B = LudoBot, sfx = new LudoSoundManager();
const $ = id => document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
const HEX = { red: '#e53935', green: '#43a047', yellow: '#fdd835', blue: '#1e88e5' };
const PALE = { red: '#ffcdd2', green: '#c8e6c9', yellow: '#fff9c4', blue: '#bbdefb' };

/* ---------- Board geometry (15x15 grid, cell units) ---------- */
const seq = (x, y, dx, dy, n) => Array.from({ length: n }, (_, i) => [x + dx * i, y + dy * i]);
// 52 shared cells, clockwise, starting at red's start cell (index 0)
const TRACK = [...seq(1,6,1,0,5), ...seq(6,5,0,-1,6), [7,0], [8,0], ...seq(8,1,0,1,5), ...seq(9,6,1,0,6), [14,7], [14,8],
  ...seq(13,8,-1,0,5), ...seq(8,9,0,1,6), [7,14], [6,14], ...seq(6,13,0,-1,5), ...seq(5,8,-1,0,6), [0,7], [0,6]];
const COL = { red: seq(1,7,1,0,5), green: seq(7,1,0,1,5), yellow: seq(13,7,-1,0,5), blue: seq(7,13,0,-1,5) };
const ORG = { red: [0,0], green: [9,0], yellow: [9,9], blue: [0,9] };
const SLOT = [[2,2], [4,2], [2,4], [4,4]];
const GDIR = { red: [-.7,0], green: [0,-.7], yellow: [.7,0], blue: [0,.7] };

/** Centre (cell units) of a token at relative position p. */
function pos(c, p, i) {
  if (p < 0) return [ORG[c][0] + SLOT[i][0], ORG[c][1] + SLOT[i][1]];
  if (p <= E.TRACK_END) { const t = TRACK[(E.START[c] + p) % 52]; return [t[0] + .5, t[1] + .5]; }
  if (p < E.GOAL) { const t = COL[c][p - 51]; return [t[0] + .5, t[1] + .5]; }
  const d = GDIR[c]; return [7.5 + d[0] + (i - 1.5) * .14 * Math.abs(d[1]), 7.5 + d[1] + (i - 1.5) * .14 * Math.abs(d[0])];
}

/* ---------- State ---------- */
let mode = null, state = null, view = null, P = {}, myColor = null, busy = false, gen = 0, lifted = null;
let socket = null, room = null, deadline = 0, queue = Promise.resolve(), lastDice = 1, botLevel = 'medium';
const clientId = localStorage.ludoId || (localStorage.ludoId = Math.random().toString(36).slice(2));
const cv = $('cv'), ctx = cv.getContext('2d'), dice = $('dice');
const show = id => { ['menu', 'lobby', 'game'].forEach(s => $(s).classList.toggle('hidden', s !== id)); if (id === 'game') resize(); };
const cap = s => s[0].toUpperCase() + s.slice(1);
const toast = t => { const e = $('toast'); e.textContent = t; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 1100); };

/* ---------- Drawing ---------- */
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function drawBoard() {
  ctx.fillStyle = '#fff'; rr(0, 0, 15, 15, .3); ctx.fill();
  for (const c of E.COLORS) {                       // yards
    const [ox, oy] = ORG[c]; ctx.fillStyle = HEX[c]; ctx.fillRect(ox, oy, 6, 6);
    ctx.fillStyle = '#fff'; rr(ox + 1, oy + 1, 4, 4, .5); ctx.fill();
    SLOT.forEach(s => { ctx.fillStyle = PALE[c]; ctx.beginPath(); ctx.arc(ox + s[0], oy + s[1], .55, 0, 7); ctx.fill(); ctx.strokeStyle = HEX[c]; ctx.lineWidth = .08; ctx.stroke(); });
  }
  ctx.lineWidth = .05; ctx.strokeStyle = '#9a9a9a';
  TRACK.forEach(([x, y], a) => {
    const owner = E.COLORS.find(c => E.START[c] === a);
    ctx.fillStyle = owner ? HEX[owner] : '#fff'; ctx.fillRect(x, y, 1, 1); ctx.strokeRect(x, y, 1, 1);
    if (E.SAFE.has(a) && !owner) star(x + .5, y + .5, .36, '#888');
  });
  for (const c of E.COLORS) COL[c].forEach(([x, y]) => { ctx.fillStyle = HEX[c]; ctx.fillRect(x, y, 1, 1); ctx.strokeRect(x, y, 1, 1); });
  const tri = { red: [[6,6],[6,9]], green: [[6,6],[9,6]], yellow: [[9,6],[9,9]], blue: [[6,9],[9,9]] };
  for (const c of E.COLORS) { ctx.fillStyle = HEX[c]; ctx.beginPath(); ctx.moveTo(...tri[c][0]); ctx.lineTo(...tri[c][1]); ctx.lineTo(7.5, 7.5); ctx.fill(); }
}
function star(cx, cy, r, col) {
  ctx.fillStyle = col; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * .45 : r; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
  ctx.closePath(); ctx.fill();
}
function drawToken(x, y, c, r, glow, lift) {
  if (lift) y -= .18;
  ctx.fillStyle = '#0004'; ctx.beginPath(); ctx.ellipse(x, y + .3, r * .9, r * .45, 0, 0, 7); ctx.fill();
  if (glow) { ctx.strokeStyle = '#fff'; ctx.lineWidth = .1; ctx.beginPath(); ctx.arc(x, y, r + .12 + Math.sin(Date.now() / 120) * .06, 0, 7); ctx.stroke(); }
  const g = ctx.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r);
  g.addColorStop(0, '#fff'); g.addColorStop(.35, HEX[c]); g.addColorStop(1, '#0006');
  ctx.fillStyle = HEX[c]; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = .08; ctx.stroke();
}
function draw() {
  const s = cv.width / 15; ctx.setTransform(s, 0, 0, s, 0, 0); ctx.clearRect(0, 0, 15, 15);
  drawBoard(); if (!view) return requestAnimationFrame(draw);
  const movable = new Set(), mine = canAct() && state.phase === 'move';
  if (mine) E.legalMoves(state).forEach(m => movable.add(m.token));
  const items = [], groups = {};
  for (const c of state.colors) view[c].forEach((p, i) => {
    const [x, y] = pos(c, p, i), k = p < 0 ? 'y' + c + i : x + ',' + y;
    (groups[k] = groups[k] || []).push({ c, i, x, y });
  });
  Object.values(groups).forEach(g => g.forEach((t, k) => { t.x += g.length > 1 ? (k - (g.length - 1) / 2) * .24 : 0; t.r = g.length > 1 ? .3 : .38; items.push(t); }));
  items.sort((a, b) => a.y - b.y);
  items.forEach(t => drawToken(t.x, t.y, t.c, t.r, mine && t.c === E.current(state) && movable.has(t.i), lifted && lifted.c === t.c && lifted.i === t.i));
  requestAnimationFrame(draw);
}
function resize() {
  const size = Math.max(200, Math.min(640, innerWidth - 16, innerHeight - 220)), d = devicePixelRatio || 1;
  cv.style.width = cv.style.height = size + 'px'; cv.width = cv.height = Math.round(size * d);
}
addEventListener('resize', resize);

/* ---------- Dice ---------- */
const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function face(v) { dice.innerHTML = Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[v].includes(i) ? 'on' : ''}"></i>`).join(''); lastDice = v; }
async function rollAnim(v) {
  sfx.playDiceRoll(); dice.classList.add('roll'); dice.classList.remove('ready');
  for (let i = 0; i < 9; i++) { face(1 + Math.floor(Math.random() * 6)); await sleep(80); }
  dice.classList.remove('roll'); face(v);
}

/* ---------- Event playback (animations + sounds) ---------- */
async function play(events) {
  for (const e of events) {
    if (e.type === 'roll') { dice.style.background = '#fff'; await rollAnim(e.value); await sleep(150); }
    else if (e.type === 'move') {
      lifted = { c: e.color, i: e.token };
      for (const p of e.path) { view[e.color][e.token] = p; sfx.playTokenMove(); await sleep(170); }
      lifted = null; if (e.safe) sfx.playSafeZone();
    }
    else if (e.type === 'capture') { sfx.playTokenCapture(); view[e.color][e.token] = -1; toast('💥 ' + cap(e.by) + ' captured ' + cap(e.color)); await sleep(450); }
    else if (e.type === 'home') { sfx.playHome(); toast('🏠 Token home!'); await sleep(500); }
    else if (e.type === 'nomove') { toast('No moves'); await sleep(500); }
    else if (e.type === 'triple6') { toast('Three 6s – turn lost!'); await sleep(700); }
    else if (e.type === 'win') toast('🏆 ' + cap(e.color) + ' finished #' + e.place);
    else if (e.type === 'gameover') { sfx.playWin(); await sleep(600); gameOver(e.winners); }
  }
  for (const c of state.colors) view[c] = state.tokens[c].slice();   // always end in sync with logic state
}
/** Run events, then refresh UI and trigger the next automatic action. */
async function run(events) { busy = true; gen++; await play(events); busy = false; ui(); next(); }

/* ---------- Controllers ---------- */
const canAct = () => state && !busy && !state.over && (mode === 'online' ? E.current(state) === myColor : !P[E.current(state)].bot);

function rollClick() {
  if (!canAct() || state.phase !== 'roll') return;
  if (mode === 'online') socket.emit('game:roll'); else run(E.roll(state));
}
function doMove(i) {
  if (!canAct() || state.phase !== 'move') return;
  if (mode === 'online') socket.emit('game:move', { token: i });
  else { const ev = E.move(state, i); if (ev) run(ev); }
}
/** Auto-play bots and forced single moves. */
function next() {
  if (!state || state.over || busy) return;
  const g = gen, c = E.current(state), ok = () => g === gen && !busy;
  const single = state.phase === 'move' && E.legalMoves(state).length === 1;
  if (mode === 'online') { if (c === myColor && single) setTimeout(() => ok() && socket.emit('game:move', { token: E.legalMoves(state)[0].token }), 350); return; }
  if (P[c].bot) setTimeout(() => {
    if (!ok()) return;
    run(state.phase === 'roll' ? E.roll(state) : E.move(state, B.choose(state, P[c].level)));
  }, 650);
  else if (single) setTimeout(() => ok() && doMove(E.legalMoves(state)[0].token), 350);
}
cv.addEventListener('pointerdown', ev => {
  if (!canAct() || state.phase !== 'move') return;
  const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * 15, y = (ev.clientY - r.top) / r.height * 15, c = E.current(state);
  let best = null, bd = .9;
  E.legalMoves(state).forEach(m => { const [px, py] = pos(c, view[c][m.token], m.token), d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = m.token; } });
  if (best !== null) doMove(best);
});
dice.addEventListener('pointerdown', rollClick);

function ui() {
  if (!state) return;
  const c = E.current(state), p = P[c] || {};
  $('dot').style.background = $('dot').style.color = HEX[c];
  $('turnTxt').textContent = state.over ? 'Game over' : (mode === 'online' && c === myColor ? 'Your turn' : (p.name || cap(c)) + "'s turn");
  dice.style.background = PALE[c];
  const act = canAct();
  dice.classList.toggle('ready', act && state.phase === 'roll');
  $('hint').textContent = !act ? (state.over ? '' : 'Waiting…') : state.phase === 'roll' ? 'Tap the dice to roll' : 'Tap a glowing token';
}
function gameOver(w) {
  const o = document.createElement('div'); o.id = 'over';
  o.innerHTML = `<h1>🏆 ${cap(w[0])} wins!</h1><div class="plist card">${w.map((c, i) => `<div><b>#${i + 1}</b><span class="pip" style="background:${HEX[c]}"></span>${P[c]?.name || cap(c)}</div>`).join('')}</div><button>Back to menu</button>`;
  o.querySelector('button').onclick = () => { o.remove(); quit(); }; document.body.appendChild(o);
}
function startLocal(players) {
  mode = mode || 'local'; P = {}; players.forEach(p => P[p.color] = p);
  state = E.create(players.map(p => p.color)); view = {}; state.colors.forEach(c => view[c] = state.tokens[c].slice());
  show('game'); face(1); ui(); next();
}
function quit() { if (socket) { socket.disconnect(); socket = null; } state = view = null; mode = null; busy = false; gen++; show('menu'); }

/* ---------- Menu wiring ---------- */
$('pnp').onclick = () => {
  mode = 'local'; const n = +$('pnpN').value, cols = n === 2 ? ['red', 'yellow'] : n === 3 ? ['red', 'green', 'yellow'] : E.COLORS;
  startLocal(cols.map((c, i) => ({ color: c, name: 'Player ' + (i + 1), bot: false })));
};
$('bot').onclick = () => {
  mode = 'local'; const n = +$('botN').value, cols = n === 1 ? ['red', 'yellow'] : n === 2 ? ['red', 'green', 'yellow'] : E.COLORS;
  startLocal(cols.map((c, i) => i === 0 ? { color: c, name: 'You', bot: false } : { color: c, name: 'Bot ' + i, bot: true, level: $('botL').value }));
};
$('mute').onclick = () => { $('mute').textContent = sfx.toggleMute() ? '🔇' : '🔊'; };
$('quit').onclick = quit; $('lobBack').onclick = quit;

/* ---------- Online ---------- */
function connect() {
  if (typeof io === 'undefined') { $('menuErr').textContent = 'Server not reachable – run via npm start'; return false; }
  socket = io(); mode = 'online';
  socket.on('room:update', r => { room = r; lobby(); });
  socket.on('game:update', m => { queue = queue.then(() => onUpdate(m)); });
  return true;
}
const nm = () => ($('name').value.trim() || 'Player');
function entered(res) {
  if (!res.ok) { $('menuErr').textContent = res.error; socket.disconnect(); mode = null; return; }
  myColor = res.color; room = res.room; lobby(); if (!state) show('lobby');
}
$('create').onclick = () => { if (connect()) socket.emit('room:create', { name: nm(), clientId }, entered); };
$('join').onclick = () => { if (connect()) socket.emit('room:join', { code: $('code').value.trim(), name: nm(), clientId }, entered); };
$('addBot').onclick = () => socket.emit('room:addBot', { level: 'medium' });
$('start').onclick = () => socket.emit('game:start');
function lobby() {
  $('lobCode').textContent = room.code;
  $('lobPlayers').innerHTML = room.players.map(p => `<div><span class="pip" style="background:${HEX[p.color]}"></span>${p.name}${p.bot ? ' 🤖' : ''}${p.clientId === room.hostId ? ' ⭐' : ''}</div>`).join('');
  $('hostBtns').classList.toggle('hidden', room.hostId !== clientId);
}
async function onUpdate(m) {
  room = m.room; P = {}; room.players.forEach(p => P[p.color] = p);
  deadline = m.turnDeadline || 0;
  const first = !state || !view; state = m.state;
  if (first) { view = {}; state.colors.forEach(c => view[c] = state.tokens[c].slice()); show('game'); face(1); }
  if (m.events.some(e => e.type === 'start')) toast('Game started!');
  await run(m.events);
}
setInterval(() => { $('timer').textContent = mode === 'online' && deadline && state && !state.over ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) + 's' : ''; }, 500);

draw();
})();
