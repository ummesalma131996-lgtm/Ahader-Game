/**
 * Authoritative Ludo server (Express + Socket.io). Clients send intents only
 * ("roll", "move"); the shared engine validates, then the server broadcasts events + state.
 */
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const E = require('../shared/engine');
const Bot = require('../shared/bot');

const app = express();
app.use(express.static(path.join(__dirname, '../client')));
app.use('/shared', express.static(path.join(__dirname, '../shared')));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const TURN_MS = 20000;       // human turn timeout -> auto-play
const RECONNECT_MS = 30000;  // grace before a dropped player becomes a bot
const rooms = new Map();

const genCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c;
  do { c = Array.from({ length: 5 }, () => abc[Math.floor(Math.random() * abc.length)]).join(''); } while (rooms.has(c));
  return c;
};
const publicRoom = r => ({
  code: r.code, hostId: r.hostId, started: !!r.game,
  players: r.players.map(p => ({ color: p.color, name: p.name, bot: p.bot, connected: p.connected, clientId: p.clientId })),
});
const broadcast = (r, events = []) =>
  io.to(r.code).emit('game:update', { room: publicRoom(r), state: r.game, events, turnDeadline: r.deadline || null });

/** Decide what happens next: bot/disconnected acts soon; human gets a timeout. */
function schedule(r) {
  clearTimeout(r.timer); r.deadline = null;
  if (!r.game || r.game.over) return;
  const p = r.players.find(x => x.color === E.current(r.game));
  if (p.bot || !p.connected) {
    r.timer = setTimeout(() => act(r, p, true), 900 + (r.lastPathLen || 0) * 220); // wait for client animation
  } else {
    r.deadline = Date.now() + TURN_MS;
    r.timer = setTimeout(() => act(r, p, true), TURN_MS);
  }
}

function act(r, p, auto) {
  const g = r.game; if (!g || g.over) return;
  const ev = g.phase === 'roll' ? E.roll(g) : E.move(g, Bot.choose(g, p.bot ? p.level || 'medium' : 'medium'));
  finish(r, ev);
}
function finish(r, ev) {
  if (!ev) return;
  const mv = ev.find(e => e.type === 'move'); r.lastPathLen = mv ? mv.path.length : 0;
  broadcast(r, ev); schedule(r);
}

io.on('connection', socket => {
  let room = null, me = null;
  const attach = (r, p) => { room = r; me = p; p.connected = true; socket.join(r.code); };

  socket.on('room:create', ({ name, clientId }, cb) => {
    const r = { code: genCode(), hostId: clientId, players: [], game: null };
    rooms.set(r.code, r);
    const p = { clientId, name: name || 'Player', color: E.COLORS[0], bot: false };
    r.players.push(p); attach(r, p);
    cb?.({ ok: true, room: publicRoom(r), color: p.color });
  });

  socket.on('room:join', ({ code, name, clientId }, cb) => {
    const r = rooms.get((code || '').toUpperCase());
    if (!r) return cb?.({ ok: false, error: 'Room not found' });
    const ex = r.players.find(p => p.clientId === clientId);       // reconnect
    if (ex) { clearTimeout(ex.dc); ex.bot = false; attach(r, ex); }
    else {
      if (r.game) return cb?.({ ok: false, error: 'Game already started' });
      if (r.players.length >= 4) return cb?.({ ok: false, error: 'Room full' });
      const color = E.COLORS.find(c => !r.players.some(p => p.color === c));
      const p = { clientId, name: name || 'Player', color, bot: false }; r.players.push(p); attach(r, p);
    }
    cb?.({ ok: true, room: publicRoom(r), color: me.color });
    io.to(r.code).emit('room:update', publicRoom(r));
    if (r.game) { broadcast(r); schedule(r); }
  });

  socket.on('room:addBot', ({ level } = {}) => {
    if (!room || room.game || me.clientId !== room.hostId || room.players.length >= 4) return;
    const color = E.COLORS.find(c => !room.players.some(p => p.color === c));
    room.players.push({ clientId: 'bot-' + color, name: 'Bot ' + color, color, bot: true, connected: true, level: level || 'medium' });
    io.to(room.code).emit('room:update', publicRoom(room));
  });

  socket.on('game:start', () => {
    if (!room || room.game || me.clientId !== room.hostId || room.players.length < 2) return;
    room.game = E.create(E.COLORS.filter(c => room.players.some(p => p.color === c)));
    broadcast(room, [{ type: 'start' }]); schedule(room);
  });

  socket.on('game:roll', () => {
    if (room?.game && me.color === E.current(room.game)) finish(room, E.roll(room.game));
  });
  socket.on('game:move', ({ token }) => {
    if (room?.game && me.color === E.current(room.game)) finish(room, E.move(room.game, token)); // illegal -> null, ignored
  });
  socket.on('chat', msg => room && io.to(room.code).emit('chat', { from: me.name, msg: String(msg).slice(0, 120) }));

  socket.on('disconnect', () => {
    if (!room || !me) return;
    me.connected = false;
    if (!room.game) {                                   // lobby: free the seat
      room.players = room.players.filter(p => p !== me);
      if (!room.players.some(p => !p.bot)) return void rooms.delete(room.code);
      if (room.hostId === me.clientId) room.hostId = room.players.find(p => !p.bot).clientId;
      return io.to(room.code).emit('room:update', publicRoom(room));
    }
    me.dc = setTimeout(() => { me.bot = true; broadcast(room); }, RECONNECT_MS);
    broadcast(room); if (E.current(room.game) === me.color) schedule(room);
    setTimeout(() => {                                   // clean up abandoned rooms
      if (room.players.every(p => p.bot || !p.connected)) { clearTimeout(room.timer); rooms.delete(room.code); }
    }, RECONNECT_MS + 1000);
  });
});

server.listen(process.env.PORT || 3000, () => console.log('Ludo server on :' + (process.env.PORT || 3000)));
