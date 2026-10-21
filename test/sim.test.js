// Automatische Tests der Spiel-Engine: viele Bot-Partien + gezielte Regelprüfungen.
// Ausführen mit: node test/sim.test.js
'use strict';
const assert = require('assert');
const LJ = require('../shared/engine.js');

function seededRng(seed) {
  let s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function checkInvariants(room, where) {
  const all = [];
  room.players.forEach(p => all.push(...p.hand));
  all.push(...room.pile);
  assert.strictEqual(all.length, 36, where + ': 36 Karten erwartet, ' + all.length);
  assert.strictEqual(new Set(all).size, 36, where + ': doppelte Karten');
  assert.ok(['lobby', 'turn', 'decide', 'reveal', 'over'].includes(room.phase), where + ': Phase ' + room.phase);
  if (room.phase === 'decide') assert.strictEqual(room.decider, (room.lastPlay.seat + 1) % room.players.length, where + ': falscher Entscheider');
  if (room.lastPlay) assert.notStrictEqual(room.lastPlay.rank, 'ass', where + ': Ass angesagt');
  if (room.roundRank) assert.notStrictEqual(room.roundRank, 'ass', where + ': Ass als Rundenwert');
  if (room.phase === 'over' && room.over.kind === 'fourAces') {
    assert.strictEqual(LJ.countAces(room.players[room.over.seat].hand), 4, where + ': fourAces ohne vier Asse');
  }
  if (room.phase === 'over' && room.over.kind === 'win') {
    assert.strictEqual(room.players[room.over.seat].hand.length, 0, where + ': Gewinner hat noch Karten');
  }
  if (room.phase === 'turn') assert.ok(room.players[room.turn].hand.length > 0, where + ': Spieler ohne Karten am Zug');
  // Niemand ausser dem Gewinner darf 0 Karten haben, solange die Partie läuft
  if (room.phase !== 'over' && room.phase !== 'lobby') {
    room.players.forEach((p, i) => {
      if (p.hand.length === 0) {
        const inWindow = room.phase === 'decide' && room.lastPlay.seat === i;
        const inReveal = room.phase === 'reveal' && room.result.accused === i;
        assert.ok(inWindow || inReveal, where + ': Spieler ' + i + ' ohne Karten mitten im Spiel');
      }
    });
  }
  // Ansichten dürfen fremde Karten nie enthalten
  const v = LJ.viewFor(room, 0, 0);
  assert.strictEqual(v.decider, room.decider);
  assert.deepStrictEqual(v.hand.slice().sort((a, b) => a - b), room.players[0].hand.slice().sort((a, b) => a - b));
  const json = JSON.stringify(v);
  assert.ok(!json.includes('"token"'), 'Token in Ansicht');
  v.players.forEach(p => assert.strictEqual(p.hand, undefined, 'fremde Hand in Ansicht'));
  if (room.lastPlay) assert.strictEqual(v.lastPlay.cards, undefined, 'abgelegte Karten in Ansicht sichtbar');
}

function playBotGame(size, seed) {
  const rng = seededRng(seed);
  const room = LJ.createRoom({ code: 'TEST', size, rng, settings: { revealSeconds: 5, restartSeconds: 8 } });
  for (let i = 0; i < size; i++) assert.ok(LJ.addPlayer(room, { name: 'Bot' + (i + 1), avatar: '🤖', token: 't' + i }).ok);
  assert.ok(LJ.canStart(room));
  assert.ok(LJ.startGame(room).ok);
  let now = 1000;
  let steps = 0, fourAces = 0, wins = 0, challenges = 0, plays = 0;
  const maxSteps = 4000;
  while (steps++ < maxSteps) {
    checkInvariants(room, 'step ' + steps);
    room.events = [];
    if (room.phase === 'over') {
      if (room.over.kind === 'win') { wins++; break; }
      fourAces++;
      if (fourAces > 3) break; // genug Neustarts gesehen
      now = room.over.autoRestartAt;
      assert.ok(LJ.advance(room, now));
      continue;
    }
    if (room.phase === 'turn') {
      const seat = room.turn;
      const d = LJ.botTurn(room, seat, rng);
      const r = LJ.play(room, seat, d.cards, d.rank, now);
      assert.ok(r.ok, 'Bot-Zug abgelehnt: ' + r.error);
      plays++;
      continue;
    }
    if (room.phase === 'decide') {
      const d = room.decider;
      // Alle anderen dürfen nicht entscheiden
      for (let s = 0; s < size; s++) if (s !== d) { assert.strictEqual(LJ.believe(room, s).ok, false); assert.strictEqual(LJ.challenge(room, s, now).ok, false); }
      if (LJ.botWantsChallenge(room, d, rng)) { assert.ok(LJ.challenge(room, d, now).ok); challenges++; }
      else { assert.ok(LJ.believe(room, d).ok); assert.ok(room.phase === 'over' || (room.phase === 'turn' && room.turn === d)); }
      continue;
    }
    if (room.phase === 'reveal') { now = room.result.revealUntil; assert.ok(LJ.advance(room, now)); continue; }
  }
  assert.ok(steps < maxSteps, 'Partie endet nicht (size ' + size + ', seed ' + seed + ')');
  return { steps, fourAces, wins, challenges, plays };
}

// ---------------------------------------------------------------- 1) Massentest
let totals = { games: 0, fourAces: 0, wins: 0, challenges: 0, plays: 0 };
for (const size of [4, 5, 6]) {
  for (let seed = 1; seed <= 400; seed++) {
    const r = playBotGame(size, seed * 7919 + size);
    totals.games++; totals.fourAces += r.fourAces; totals.wins += r.wins; totals.challenges += r.challenges; totals.plays += r.plays;
  }
}
console.log('Bot-Partien:', totals);

// ---------------------------------------------------------------- 2) Regelprüfungen
{
  const rng = seededRng(42);
  const room = LJ.createRoom({ code: 'ABCD', size: 4, rng });
  assert.strictEqual(LJ.startGame(room).ok, false, 'Start ohne Spieler');
  for (let i = 0; i < 4; i++) LJ.addPlayer(room, { name: 'P' + i, avatar: 'x', token: 'tok' + i });
  assert.strictEqual(LJ.addPlayer(room, { name: 'zu viel' }).ok, false, 'Tisch voll');
  assert.strictEqual(LJ.setSize(room, 3).ok, false, 'Grösse unter 4 abgelehnt?');
  assert.strictEqual(room.size, 4);
  assert.ok(LJ.setSize(room, 6).ok);
  assert.strictEqual(LJ.startGame(room).ok, false, 'Start bei 4 von 6');
  assert.ok(LJ.setSize(room, 4).ok);
  assert.ok(LJ.startGame(room).ok);
  assert.strictEqual(LJ.addPlayer(room, { name: 'spät' }).ok, false, 'Beitritt während Partie');
  assert.strictEqual(LJ.removePlayer(room, 1).ok, false, 'Verlassen während Partie');
  if (room.phase === 'over') { LJ.advance(room, room.over.autoRestartAt); }
  assert.strictEqual(room.phase, 'turn');
  const seat = room.turn, hand = room.players[seat].hand;
  const now = 5000;
  // Ass darf nie angesagt werden
  assert.strictEqual(LJ.play(room, seat, [hand[0]], 'ass', now).ok, false);
  assert.strictEqual(LJ.play(room, seat, [hand[0]], 'as', now).ok, false);
  // Falscher Spieler
  assert.strictEqual(LJ.play(room, (seat + 1) % 4, [room.players[(seat + 1) % 4].hand[0]], 'koenig', now).ok, false);
  // Fremde Karte
  assert.strictEqual(LJ.play(room, seat, [room.players[(seat + 1) % 4].hand[0]], 'koenig', now).ok, false);
  // Zu viele Karten
  assert.strictEqual(LJ.play(room, seat, hand.slice(0, 5), 'koenig', now).ok, false);
  // Doppelte Karte
  assert.strictEqual(LJ.play(room, seat, [hand[0], hand[0]], 'koenig', now).ok, false);
  // Gültig: eine Karte, Ansage König (gelogen oder nicht)
  const played = hand[0];
  assert.ok(LJ.play(room, seat, [played], 'koenig', now).ok);
  assert.strictEqual(room.phase, 'decide');
  assert.strictEqual(room.decider, (seat + 1) % 4);
  assert.strictEqual(room.roundRank, 'koenig');
  assert.strictEqual(room.players[seat].hand.indexOf(played), -1);
  assert.strictEqual(room.pile.length, 1);
  // Eigene Ablage kann man nicht anzweifeln / glauben; auch nicht der übernächste Spieler
  assert.strictEqual(LJ.challenge(room, seat, now).ok, false);
  assert.strictEqual(LJ.believe(room, seat).ok, false);
  assert.strictEqual(LJ.believe(room, (seat + 2) % 4).ok, false);
  assert.strictEqual(LJ.challenge(room, (seat + 3) % 4, now).ok, false);
  // Der nächste glaubt -> er ist dran
  assert.ok(LJ.believe(room, (seat + 1) % 4).ok);
  assert.strictEqual(room.phase, 'turn');
  assert.strictEqual(room.turn, (seat + 1) % 4);
  // Innerhalb der Runde muss derselbe Wert angesagt werden
  const s2 = room.turn, h2 = room.players[s2].hand;
  assert.strictEqual(LJ.play(room, s2, [h2[0]], 'ober', now).ok, false);
  assert.ok(LJ.play(room, s2, [h2[0]], 'koenig', now).ok);
  // Lügner-Aufruf durch den direkt nächsten Spieler: Resultat korrekt?
  const lied = LJ.rankOf(h2[0]) !== 'koenig';
  const challenger = (s2 + 1) % 4;
  assert.strictEqual(LJ.challenge(room, (s2 + 2) % 4, now).ok, false, 'übernächster darf nicht');
  assert.ok(LJ.challenge(room, challenger, now).ok);
  assert.strictEqual(room.phase, 'reveal');
  assert.strictEqual(room.result.lied, lied);
  assert.strictEqual(room.result.loser, lied ? s2 : challenger);
  assert.strictEqual(room.pile.length, 2, 'Stapel bleibt bis zum Ende der Aufdeck-Phase');
  const before = room.players[room.result.loser].hand.length;
  LJ.advance(room, room.result.revealUntil);
  assert.strictEqual(room.pile.length, 0);
  if (room.phase !== 'over') {
    assert.strictEqual(room.players[lied ? s2 : challenger].hand.length, before + 2, 'ganzer Stapel aufgenommen');
    assert.strictEqual(room.roundRank, null);
    assert.strictEqual(room.turn, challenger, 'der Entscheider ist als Nächster dran');
  }
  checkInvariants(room, 'regeln');
  console.log('Regelprüfungen ok');
}

// ---------------------------------------------------------------- 3) Vier Asse beim Austeilen
{
  // RNG so bauen, dass nicht gemischt wird (j = i) -> Spieler 0 bekommt 0,4,8,...: Karten 8,17,26,35 = alle Asse? Nein.
  // Stattdessen: deterministisches Mischen mit rng=1-epsilon lässt die Reihenfolge, Sitz i erhält i%4: Asse 8,17,26,35 -> Sitze 0,1,2,3.
  // Also erzwingen wir die Hände direkt und prüfen checkFourAces über finishReveal-Weg:
  const room = LJ.createRoom({ code: 'AAAA', size: 4, rng: seededRng(7) });
  for (let i = 0; i < 4; i++) LJ.addPlayer(room, { name: 'P' + i, token: 't' + i });
  LJ.startGame(room);
  while (room.phase === 'over') LJ.advance(room, room.over.autoRestartAt);
  // Hände umbauen: Spieler 1 bekommt drei Asse, Spieler 0 legt das vierte Ass, Spieler 1 ruft Lügner (zu Recht) -> nimmt Stapel inkl. viertem Ass -> verliert
  const all = [];
  room.players.forEach(p => all.push(...p.hand));
  all.push(...room.pile);
  const aces = all.filter(LJ.isAce), rest = all.filter(c => !LJ.isAce(c));
  room.pile = [];
  room.players[0].hand = [aces[0]].concat(rest.slice(0, 8));
  room.players[1].hand = aces.slice(1).concat(rest.slice(8, 14));
  room.players[2].hand = rest.slice(14, 23);
  room.players[3].hand = rest.slice(23);
  room.turn = 0; room.phase = 'turn'; room.roundRank = null; room.lastPlay = null; room.window = null;
  checkInvariants(room, 'setup');
  assert.ok(LJ.play(room, 0, [aces[0]], 'koenig', 100).ok);
  assert.ok(LJ.challenge(room, 1, 100).ok);
  assert.strictEqual(room.result.lied, true);
  assert.strictEqual(room.result.loser, 0, 'Lügner nimmt auf');
  LJ.advance(room, room.result.revealUntil);
  assert.strictEqual(room.phase, 'turn');
  // Jetzt umgekehrt: Spieler 1 (drei Asse) ruft fälschlich Lügner und muss ein Ass aufnehmen -> vier Asse -> verloren
  room.turn = 0; room.roundRank = null; room.lastPlay = null;
  const king = room.players[0].hand.find(c => LJ.rankOf(c) === 'koenig');
  // Falls Spieler 0 keinen König hat, tauschen wir einen rein
  let kingCard = king;
  if (kingCard === undefined) {
    for (const s of [2, 3]) { const k = room.players[s].hand.find(c => LJ.rankOf(c) === 'koenig'); if (k !== undefined) { room.players[s].hand.splice(room.players[s].hand.indexOf(k), 1); room.players[s].hand.push(room.players[0].hand.pop()); room.players[0].hand.push(k); kingCard = k; break; } }
  }
  // Ass von Spieler 0 auf den Stapel (als Teil der Runde): zuerst legt Spieler 0 das Ass als «König», alle glauben; dann legt Spieler 2 einen echten König, Spieler 1 ruft Lügner -> zu Unrecht -> nimmt Stapel (mit Ass) -> vier Asse
  const ace0 = room.players[0].hand.find(LJ.isAce);
  assert.ok(ace0 !== undefined);
  assert.ok(LJ.play(room, 0, [ace0], 'koenig', 200).ok);
  assert.ok(LJ.believe(room, 1).ok);
  assert.strictEqual(room.turn, 1);
  // Spieler 1 legt irgendeine Nicht-Ass-Karte als König, alle glauben
  const c1 = room.players[1].hand.find(c => !LJ.isAce(c));
  assert.ok(LJ.play(room, 1, [c1], 'koenig', 300).ok);
  assert.ok(LJ.believe(room, 2).ok);
  assert.strictEqual(room.turn, 2);
  // Spieler 2 legt eine Nicht-Ass-Karte als König, Spieler 3 glaubt; Spieler 3 legt ebenfalls eine, Spieler 0 glaubt.
  const c2 = room.players[2].hand.find(c => !LJ.isAce(c));
  assert.ok(LJ.play(room, 2, [c2], 'koenig', 400).ok);
  assert.ok(LJ.believe(room, 3).ok);
  const c3 = room.players[3].hand.find(c => !LJ.isAce(c));
  assert.ok(LJ.play(room, 3, [c3], 'koenig', 500).ok);
  assert.ok(LJ.believe(room, 0).ok);
  assert.strictEqual(room.turn, 0);
  // Spieler 0 legt einen echten König (einen reinholen falls nötig), Spieler 1 (drei Asse) ruft zu Unrecht Lügner
  let k0 = room.players[0].hand.find(c => LJ.rankOf(c) === 'koenig');
  if (k0 === undefined) {
    for (const s of [2, 3]) { const k = room.players[s].hand.find(c => LJ.rankOf(c) === 'koenig'); if (k !== undefined) { room.players[s].hand.splice(room.players[s].hand.indexOf(k), 1); room.players[s].hand.push(room.players[0].hand.pop()); room.players[0].hand.push(k); k0 = k; break; } }
  }
  checkInvariants(room, 'vor echtem König');
  if (k0 !== undefined) {
    assert.ok(LJ.play(room, 0, [k0], 'koenig', 600).ok);
    assert.strictEqual(room.decider, 1);
    assert.ok(LJ.challenge(room, 1, 600).ok);
    assert.strictEqual(room.result.lied, false);
    assert.strictEqual(room.result.loser, 1);
    assert.strictEqual(room.result.pileCount, 5);
    LJ.advance(room, room.result.revealUntil);
    assert.strictEqual(room.phase, 'over');
    assert.strictEqual(room.over.kind, 'fourAces');
    assert.strictEqual(room.over.seat, 1);
    assert.strictEqual(LJ.countAces(room.players[1].hand), 4);
    checkInvariants(room, 'vier asse');
    // Automatischer Neustart
    LJ.advance(room, room.over.autoRestartAt);
    assert.ok(room.phase === 'turn' || room.phase === 'over');
    assert.strictEqual(room.gamesPlayed >= 2, true);
    checkInvariants(room, 'neustart');
    console.log('Vier-Asse-Regel ok');
  } else {
    console.log('Vier-Asse-Szenario übersprungen (Kartenlage), Massentest deckt die Regel ab');
  }
}

// ---------------------------------------------------------------- 4) Gewinn erst nach der Entscheidung des Nächsten
{
  const room = LJ.createRoom({ code: 'WINN', size: 4, rng: seededRng(99) });
  for (let i = 0; i < 4; i++) LJ.addPlayer(room, { name: 'P' + i, token: 't' + i });
  LJ.startGame(room);
  while (room.phase === 'over') LJ.advance(room, room.over.autoRestartAt);
  // Spieler 0 hat nur noch eine Karte (Rest wandert zu Spieler 3)
  const h0 = room.players[0].hand;
  const keep = h0.find(c => !LJ.isAce(c)) !== undefined ? h0.find(c => !LJ.isAce(c)) : h0[0];
  room.players[3].hand.push(...h0.filter(c => c !== keep));
  room.players[0].hand = [keep];
  room.turn = 0; room.phase = 'turn'; room.roundRank = null; room.lastPlay = null;
  const rank = LJ.isAce(keep) ? 'koenig' : LJ.rankOf(keep);
  assert.ok(LJ.play(room, 0, [keep], rank, 100).ok);
  assert.strictEqual(room.phase, 'decide', 'noch nicht gewonnen');
  assert.strictEqual(room.over, null);
  assert.strictEqual(room.decider, 1);
  assert.ok(LJ.believe(room, 1).ok); // der Nächste glaubt -> gewonnen (auch wenn es ein Ass war)
  assert.strictEqual(room.phase, 'over');
  assert.strictEqual(room.over.kind, 'win');
  assert.strictEqual(room.over.seat, 0);
  assert.strictEqual(LJ.newGame(room, 1000).ok, true);
  checkInvariants(room, 'nach newGame');
  console.log('Gewinn-Regel ok');
}

console.log('ALLE TESTS BESTANDEN');
