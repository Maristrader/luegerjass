/*
 * Lügerjass – Server
 * ------------------
 * Liefert die Spielseite aus und verwaltet die Tische (Räume) per WebSocket.
 * Alle Karten bleiben hier auf dem Server; jeder Spieler bekommt nur seine
 * eigene Hand geschickt (siehe LJ.viewFor in shared/engine.js).
 *
 * Starten:   npm install && npm start
 * Port:      Umgebungsvariable PORT (Standard 3000)
 */
'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const LJ = require('./shared/engine.js');

const PORT = process.env.PORT || 3000;
const LOBBY_DISCONNECT_GRACE_MS = 45 * 1000;      // Lobby: wer so lange weg ist, verliert seinen Platz
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;         // leerer Tisch wird nach 30 Minuten gelöscht
const HEARTBEAT_MS = 25 * 1000;
const MAX_ROOMS = 500;

// ------------------------------------------------------------------ HTTP
const app = express();
app.disable('x-powered-by');
app.get('/engine.js', (req, res) => res.sendFile(path.join(__dirname, 'shared', 'engine.js')));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
// Einladungslinks wie /tisch/ABCD landen auf der Startseite
app.get('/tisch/:code', (req, res) => res.redirect('/?tisch=' + encodeURIComponent(req.params.code)));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

// ------------------------------------------------------------------ Räume
/** code -> { room, sockets: Map<seat, ws>, timer, emptyTimer, leaveTimers: Map<token, timeout> } */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode() {
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    if (!rooms.has(code)) return code;
  }
  return null;
}
function genToken() { return crypto.randomBytes(18).toString('hex'); }
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function sendError(ws, text) { send(ws, { t: 'error', msg: text }); }

function broadcast(entry) {
  const now = Date.now();
  entry.room.players.forEach((p, seat) => {
    const ws = entry.sockets.get(seat);
    if (ws) send(ws, LJ.viewFor(entry.room, seat, now));
  });
  entry.room.events = [];
}

function scheduleTimer(entry) {
  clearTimeout(entry.timer);
  const d = LJ.nextDeadline(entry.room);
  if (d === null) return;
  entry.timer = setTimeout(() => {
    if (LJ.advance(entry.room, Date.now())) broadcast(entry);
    scheduleTimer(entry);
  }, Math.max(0, d - Date.now()) + 10);
}

function afterChange(entry) {
  broadcast(entry);
  scheduleTimer(entry);
  checkEmpty(entry);
}

function checkEmpty(entry) {
  const anyone = Array.from(entry.sockets.values()).some(ws => ws.readyState === 1);
  clearTimeout(entry.emptyTimer);
  if (anyone) return;
  entry.emptyTimer = setTimeout(() => destroyRoom(entry), EMPTY_ROOM_TTL_MS);
}

function destroyRoom(entry) {
  clearTimeout(entry.timer);
  clearTimeout(entry.emptyTimer);
  entry.leaveTimers.forEach(t => clearTimeout(t));
  entry.sockets.forEach(ws => { try { ws.close(); } catch (e) { /* egal */ } });
  rooms.delete(entry.room.code);
}

function attach(ws, entry, seat, token) {
  const old = entry.sockets.get(seat);
  if (old && old !== ws) { old.ctx = null; send(old, { t: 'replaced' }); try { old.close(); } catch (e) { /* egal */ } }
  entry.sockets.set(seat, ws);
  ws.ctx = { entry, seat, token };
  const lt = entry.leaveTimers.get(token);
  if (lt) { clearTimeout(lt); entry.leaveTimers.delete(token); }
  LJ.setConnected(entry.room, seat, true);
  send(ws, { t: 'joined', code: entry.room.code, seat, token });
}

function detach(ws) {
  const ctx = ws.ctx;
  if (!ctx) return;
  ws.ctx = null;
  const { entry, seat, token } = ctx;
  if (entry.sockets.get(seat) !== ws) return; // schon ersetzt
  entry.sockets.delete(seat);
  if (!rooms.has(entry.room.code)) return;
  LJ.setConnected(entry.room, seat, false);
  if (entry.room.phase === 'lobby') {
    // In der Lobby verfällt der Platz nach kurzer Zeit, damit kein Geistersitz den Start blockiert
    entry.leaveTimers.set(token, setTimeout(() => {
      entry.leaveTimers.delete(token);
      const s = entry.room.players.findIndex(p => p.token === token);
      if (s >= 0 && !entry.room.players[s].connected && entry.room.phase === 'lobby') {
        LJ.removePlayer(entry.room, s);
        reindexSockets(entry);
        afterChange(entry);
      }
    }, LOBBY_DISCONNECT_GRACE_MS));
  }
  afterChange(entry);
}

// Nach dem Entfernen eines Spielers rutschen die Sitznummern nach – Sockets neu zuordnen
function reindexSockets(entry) {
  const bySeat = new Map();
  entry.room.players.forEach((p, seat) => {
    for (const [, ws] of entry.sockets) {
      if (ws.ctx && ws.ctx.token === p.token) { ws.ctx.seat = seat; bySeat.set(seat, ws); }
    }
  });
  entry.sockets = bySeat;
}

function isHostLike(entry, seat) {
  const host = entry.room.players[entry.room.hostSeat];
  return seat === entry.room.hostSeat || !host || !host.connected;
}

// ------------------------------------------------------------- Nachrichten
const handlers = {
  ping(ws) { send(ws, { t: 'pong' }); },

  create(ws, m) {
    if (ws.ctx) detach(ws);
    if (rooms.size >= MAX_ROOMS) return sendError(ws, 'Der Server ist gerade voll. Bitte später nochmals versuchen.');
    const code = genCode();
    if (!code) return sendError(ws, 'Kein freier Tisch-Code – bitte nochmals versuchen.');
    const room = LJ.createRoom({ code, size: m.size, settings: { challengeSeconds: m.challengeSeconds } });
    LJ.setSettings(room, m);
    const entry = { room, sockets: new Map(), timer: null, emptyTimer: null, leaveTimers: new Map() };
    rooms.set(code, entry);
    const token = genToken();
    const r = LJ.addPlayer(room, { name: m.name, avatar: m.avatar, token });
    if (!r.ok) { rooms.delete(code); return sendError(ws, r.error); }
    room.hostSeat = 0;
    attach(ws, entry, r.seat, token);
    afterChange(entry);
  },

  join(ws, m) {
    if (ws.ctx) detach(ws);
    const code = String(m.code || '').trim().toUpperCase();
    const entry = rooms.get(code);
    if (!entry) return sendError(ws, 'Kein Tisch mit dem Code ' + (code || '–') + ' gefunden.');
    const token = genToken();
    const r = LJ.addPlayer(entry.room, { name: m.name, avatar: m.avatar, token });
    if (!r.ok) return sendError(ws, r.error);
    attach(ws, entry, r.seat, token);
    afterChange(entry);
  },

  rejoin(ws, m) {
    const code = String(m.code || '').trim().toUpperCase();
    const entry = rooms.get(code);
    if (!entry) return send(ws, { t: 'rejoinFailed', msg: 'Dieser Tisch existiert nicht mehr.' });
    const seat = entry.room.players.findIndex(p => p.token === m.token);
    if (seat < 0) return send(ws, { t: 'rejoinFailed', msg: 'Dein Platz an diesem Tisch ist nicht mehr gültig.' });
    if (ws.ctx) detach(ws);
    attach(ws, entry, seat, m.token);
    afterChange(entry);
  },

  leave(ws) {
    const ctx = ws.ctx;
    if (!ctx) return;
    const { entry, seat } = ctx;
    ws.ctx = null;
    entry.sockets.delete(seat);
    if (entry.room.phase === 'lobby' || entry.room.phase === 'over') {
      // Ausserhalb einer laufenden Partie wird der Platz sofort frei
      if (entry.room.phase === 'over') LJ.abortToLobby(entry.room);
      LJ.removePlayer(entry.room, seat);
      reindexSockets(entry);
    } else {
      LJ.setConnected(entry.room, seat, false);
    }
    send(ws, { t: 'left' });
    if (entry.room.players.length === 0) return destroyRoom(entry);
    afterChange(entry);
  },

  setSize(ws, m) {
    const ctx = ws.ctx; if (!ctx) return;
    if (!isHostLike(ctx.entry, ctx.seat)) return sendError(ws, 'Nur der Host kann die Tischgrösse ändern.');
    const r = LJ.setSize(ctx.entry.room, m.size);
    if (!r.ok) return sendError(ws, r.error);
    afterChange(ctx.entry);
  },

  setSettings(ws, m) {
    const ctx = ws.ctx; if (!ctx) return;
    if (!isHostLike(ctx.entry, ctx.seat)) return sendError(ws, 'Nur der Host kann die Einstellungen ändern.');
    const r = LJ.setSettings(ctx.entry.room, m);
    if (!r.ok) return sendError(ws, r.error);
    afterChange(ctx.entry);
  },

  kick(ws, m) {
    const ctx = ws.ctx; if (!ctx) return;
    const { entry } = ctx;
    if (!isHostLike(entry, ctx.seat)) return sendError(ws, 'Nur der Host kann Spieler entfernen.');
    const seat = parseInt(m.seat, 10);
    if (seat === ctx.seat) return sendError(ws, 'Du kannst dich nicht selbst entfernen.');
    const target = entry.sockets.get(seat);
    const r = LJ.removePlayer(entry.room, seat);
    if (!r.ok) return sendError(ws, r.error);
    if (target) { target.ctx = null; entry.sockets.delete(seat); send(target, { t: 'kicked' }); }
    reindexSockets(entry);
    afterChange(entry);
  },

  start(ws) {
    const ctx = ws.ctx; if (!ctx) return;
    if (!isHostLike(ctx.entry, ctx.seat)) return sendError(ws, 'Nur der Host kann die Partie starten.');
    const r = LJ.startGame(ctx.entry.room);
    if (!r.ok) return sendError(ws, r.error);
    afterChange(ctx.entry);
  },

  play(ws, m) {
    const ctx = ws.ctx; if (!ctx) return;
    const r = LJ.play(ctx.entry.room, ctx.seat, m.cards, m.rank, Date.now());
    if (!r.ok) return sendError(ws, r.error);
    afterChange(ctx.entry);
  },

  believe(ws) {
    const ctx = ws.ctx; if (!ctx) return;
    const r = LJ.believe(ctx.entry.room, ctx.seat);
    if (!r.ok) return sendError(ws, r.error);
    afterChange(ctx.entry);
  },

  challenge(ws) {
    const ctx = ws.ctx; if (!ctx) return;
    const r = LJ.challenge(ctx.entry.room, ctx.seat, Date.now());
    if (!r.ok) return sendError(ws, r.error);
    afterChange(ctx.entry);
  },

  newGame(ws) {
    const ctx = ws.ctx; if (!ctx) return;
    if (!isHostLike(ctx.entry, ctx.seat)) return sendError(ws, 'Nur der Host kann eine neue Partie starten.');
    const r = LJ.newGame(ctx.entry.room, Date.now());
    if (!r.ok) return sendError(ws, r.error);
    afterChange(ctx.entry);
  },

  abort(ws) {
    const ctx = ws.ctx; if (!ctx) return;
    if (!isHostLike(ctx.entry, ctx.seat)) return sendError(ws, 'Nur der Host kann die Partie abbrechen.');
    LJ.abortToLobby(ctx.entry.room);
    afterChange(ctx.entry);
  },
};

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.ctx = null;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const h = Object.prototype.hasOwnProperty.call(handlers, m.t) ? handlers[m.t] : null;
    if (!h) return sendError(ws, 'Unbekannte Nachricht.');
    try { h(ws, m); } catch (e) { console.error('Fehler bei', m.t, e); sendError(ws, 'Serverfehler.'); }
  });
  ws.on('close', () => detach(ws));
  ws.on('error', () => detach(ws));
});

// Verbindungen prüfen, tote Sockets schliessen
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { detach(ws); return ws.terminate(); }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* egal */ }
  });
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log('Lügerjass läuft auf Port ' + PORT);
});
