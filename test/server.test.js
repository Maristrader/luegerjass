// Test des Servers über echte WebSocket-Verbindungen (4, 5 und 6 Spieler).
// Jeder Test-Client kennt nur seine eigene Ansicht – wie ein echter Spieler.
// Ausführen mit: node test/server.test.js
'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const LJ = require('../shared/engine.js');

const PORT = 3999;
const URL = 'ws://127.0.0.1:' + PORT + '/ws';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class Client {
  constructor(name) {
    this.name = name; this.view = null; this.joined = null; this.errors = []; this.msgs = [];
    this.ws = new WebSocket(URL);
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      if (m.t === 'view') this.view = m;
      else if (m.t === 'joined') this.joined = m;
      else if (m.t === 'error') this.errors.push(m.msg);
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async waitFor(pred, ms) {
    const until = Date.now() + (ms || 3000);
    while (Date.now() < until) { if (pred(this)) return true; await sleep(15); }
    throw new Error(this.name + ': Timeout beim Warten');
  }
  close() { this.ws.close(); }
}

function checkViewPrivacy(v) {
  v.players.forEach(p => { assert.strictEqual(p.hand, undefined); assert.strictEqual(p.token, undefined); });
  if (v.lastPlay) assert.strictEqual(v.lastPlay.cards, undefined, 'Karten der letzten Ablage dürfen nicht sichtbar sein');
  const s = JSON.stringify(v);
  assert.ok(!s.includes('"token"'));
}

async function fullGame(size) {
  const clients = [];
  for (let i = 0; i < size; i++) { clients.push(new Client('C' + i)); await clients[i].ready; }
  // Host erstellt den Tisch
  clients[0].send({ t: 'create', name: 'Host', avatar: '🦊', size, revealSeconds: 1, restartSeconds: 1 });
  await clients[0].waitFor(c => c.joined && c.view);
  const code = clients[0].joined.code;
  assert.strictEqual(code.length, 4);
  // Falscher Code
  clients[1].send({ t: 'join', code: 'ZZZZ', name: 'X', avatar: '🐻' });
  await clients[1].waitFor(c => c.errors.length > 0);
  // Alle anderen treten bei
  for (let i = 1; i < size; i++) {
    clients[i].send({ t: 'join', code, name: 'Spieler' + i, avatar: LJ.AVATARS[i] });
    await clients[i].waitFor(c => c.joined && c.view);
  }
  await clients[0].waitFor(c => c.view.players.length === size);
  // Ein weiterer kommt nicht mehr rein
  const extra = new Client('extra'); await extra.ready;
  extra.send({ t: 'join', code, name: 'Zuviel', avatar: '🐸' });
  await extra.waitFor(c => c.errors.length > 0);
  assert.ok(/voll/.test(extra.errors[0]), extra.errors[0]);
  extra.close();
  // Nicht-Host darf nicht starten
  clients[1].send({ t: 'start' });
  await clients[1].waitFor(c => c.errors.some(e => /Host/.test(e)));
  // Host startet
  clients[0].send({ t: 'start' });
  await Promise.all(clients.map(c => c.waitFor(x => x.view && x.view.phase !== 'lobby')));

  // Partie mit Bot-Logik auf Basis der eigenen Ansicht spielen
  let guard = 0, plays = 0, challenges = 0, restarts = 0;
  while (guard++ < 4000 && plays < 60) {
    const v = clients[0].view;
    clients.forEach(c => checkViewPrivacy(c.view));
    // Summe der Karten über alle Ansichten muss immer 36 sein
    const total = v.players.reduce((a, p) => a + p.count, 0) + v.pileCount;
    assert.strictEqual(total, 36, 'Kartensumme ' + total);
    if (v.phase === 'over') {
      if (v.over.kind === 'win') break;
      restarts++;
      await clients[0].waitFor(c => c.view.phase !== 'over' || c.view.gamesPlayed > v.gamesPlayed, 12000);
      continue;
    }
    if (v.phase === 'turn') {
      const c = clients[v.turn];
      const hand = c.view.hand;
      assert.strictEqual(hand.length, c.view.players[v.turn].count);
      // Bot: alle Karten des Rundenwerts, sonst eine Karte lügen
      let cards, rank;
      if (v.roundRank) {
        const t = hand.filter(x => LJ.rankOf(x) === v.roundRank);
        cards = t.length ? t.slice(0, 4) : [hand[0]]; rank = v.roundRank;
      } else {
        const by = {}; hand.forEach(x => { by[LJ.rankOf(x)] = (by[LJ.rankOf(x)] || []).concat([x]); });
        const best = LJ.CLAIMABLE.map(r => [r, by[r] || []]).sort((a, b) => b[1].length - a[1].length)[0];
        if (best[1].length) { cards = best[1].slice(0, 4); rank = best[0]; } else { cards = [hand[0]]; rank = 'koenig'; }
      }
      // Erst eine ungültige Ansage (Ass) – muss abgelehnt werden (nur bei den ersten Zügen geprüft)
      if (plays < 6) {
        const errBefore = c.errors.length;
        c.send({ t: 'play', cards: cards, rank: 'ass' });
        await c.waitFor(x => x.errors.length > errBefore);
      }
      const gp = c.view.gamesPlayed;
      c.send({ t: 'play', cards, rank });
      await clients[0].waitFor(x => x.view.phase !== 'turn' || x.view.turn !== v.turn || x.view.gamesPlayed !== gp);
      plays++;
      continue;
    }
    if (v.phase === 'decide') {
      const lp = v.lastPlay;
      const d = v.decider;
      assert.strictEqual(d, (lp.seat + 1) % size);
      // Weder der Ableger noch der übernächste Spieler dürfen entscheiden (nur bei den ersten Zügen geprüft)
      if (plays < 6) {
        const self = clients[lp.seat]; const eb = self.errors.length;
        self.send({ t: 'challenge' }); await self.waitFor(x => x.errors.length > eb);
        const other = clients[(lp.seat + 2) % size]; const eb2 = other.errors.length;
        other.send({ t: 'believe' }); await other.waitFor(x => x.errors.length > eb2);
      }
      if (plays % 2 === 0) {
        clients[d].send({ t: 'challenge' }); challenges++;
        await clients[0].waitFor(x => x.view.phase !== 'decide');
        assert.strictEqual(clients[0].view.phase === 'reveal' || clients[0].view.phase === 'over', true);
        if (clients[0].view.phase === 'reveal') {
          const r = clients[0].view.result;
          assert.strictEqual(r.revealed.length, lp.count);
          const lied = r.revealed.some(x => LJ.rankOf(x) !== lp.rank);
          assert.strictEqual(r.lied, lied);
          await clients[0].waitFor(x => x.view.phase !== 'reveal', 8000);
          if (clients[0].view.phase === 'turn') assert.strictEqual(clients[0].view.turn, d, 'Entscheider ist dran');
        }
      } else {
        clients[d].send({ t: 'believe' });
        await clients[0].waitFor(x => x.view.phase !== 'decide');
        if (clients[0].view.phase === 'turn') assert.strictEqual(clients[0].view.turn, d);
      }
      continue;
    }
    if (v.phase === 'reveal') { await clients[0].waitFor(x => x.view.phase !== 'reveal', 8000); continue; }
  }
  assert.ok(guard < 4000, 'Test hängt');
  const ended = clients[0].view.phase === 'over' && clients[0].view.over.kind === 'win';

  // Rejoin: Spieler 1 verbindet neu mit seinem Token und sieht wieder seine Hand
  const seat1 = clients[1].joined.seat, token1 = clients[1].joined.token, hand1 = clients[1].view.hand;
  clients[1].close();
  await clients[0].waitFor(c => c.view.players[seat1].connected === false);
  const re = new Client('re'); await re.ready;
  re.send({ t: 'rejoin', code, token: token1 });
  await re.waitFor(c => c.joined && c.view);
  assert.strictEqual(re.joined.seat, seat1);
  assert.deepStrictEqual(re.view.hand, hand1);
  await clients[0].waitFor(c => c.view.players[seat1].connected === true);
  // Falscher Token
  const bad = new Client('bad'); await bad.ready;
  bad.send({ t: 'rejoin', code, token: 'nix' });
  await bad.waitFor(c => c.msgs.some(m => m.t === 'rejoinFailed'));
  bad.close();

  // Neue Partie durch Host (falls die Partie zu Ende war)
  if (ended) {
    clients[0].send({ t: 'newGame' });
    await clients[0].waitFor(c => c.view.phase === 'turn' || (c.view.phase === 'over' && c.view.over.kind === 'fourAces'));
  }
  // Abbrechen -> Lobby, dann Kick eines Spielers
  clients[0].send({ t: 'abort' });
  await clients[0].waitFor(c => c.view.phase === 'lobby');
  clients[0].send({ t: 'kick', seat: size - 1 });
  await clients[0].waitFor(c => c.view.players.length === size - 1);
  await clients[size - 1].waitFor(c => c.msgs.some(m => m.t === 'kicked'));
  clients.forEach(c => c.close()); re.close();
  return { plays, challenges, restarts, ended };
}

(async () => {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { out += d; });
  try {
    await sleep(600);
    for (const size of [4, 5, 6]) {
      const r = await fullGame(size);
      console.log('Server-Partie mit ' + size + ' Spielern ok:', r);
    }
    assert.ok(!/Fehler/.test(out), 'Serverausgabe enthält Fehler:\n' + out);
    console.log('SERVER-TESTS BESTANDEN');
  } catch (e) {
    console.error(e);
    console.error('Serverausgabe:\n' + out);
    process.exitCode = 1;
  } finally {
    proc.kill();
  }
})();
