/*
 * Lügerjass – Spiel-Engine
 * ------------------------
 * Enthält die kompletten Spielregeln. Die gleiche Datei läuft
 *  - im Node.js-Server (Mehrspieler, die Karten bleiben auf dem Server)
 *  - im Browser für den Übungsmodus gegen Bots.
 *
 * Die Engine ist reine Logik: keine Netzwerk-, Timer- oder Anzeige-Funktionen.
 * Wer sie benutzt (Server oder Browser), ruft die Aktionen auf und verteilt
 * danach die Ansichten (viewFor) an die Spieler.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LJ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- Karten
  const SUITS = ['eichel', 'rosen', 'schellen', 'schilten'];
  const SUIT_NAMES = { eichel: 'Eichel', rosen: 'Rosen', schellen: 'Schellen', schilten: 'Schilten' };
  const RANKS = ['6', '7', '8', '9', 'banner', 'under', 'ober', 'koenig', 'ass'];
  const RANK_NAMES = { '6': '6', '7': '7', '8': '8', '9': '9', banner: 'Banner', under: 'Under', ober: 'Ober', koenig: 'König', ass: 'Ass' };
  // [Einzahl, Mehrzahl] für Meldungen wie «legt zwei Könige»
  const RANK_WORDS = {
    '6': ['Sechser', 'Sechser'], '7': ['Siebner', 'Siebner'], '8': ['Achter', 'Achter'], '9': ['Neuner', 'Neuner'],
    banner: ['Banner', 'Banner'], under: ['Under', 'Under'], ober: ['Ober', 'Ober'], koenig: ['König', 'Könige'], ass: ['Ass', 'Asse'],
  };
  const COUNT_WORDS = ['', 'einen', 'zwei', 'drei', 'vier', 'fünf', 'sechs'];
  const CLAIMABLE = RANKS.slice(0, 8); // Ass darf NIE angesagt werden
  const ACE_INDEX = 8;
  const DECK_SIZE = 36;
  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 6;
  const MAX_PLAY = 4; // Karten pro Ablage

  // Erlaubte Avatare (Server und Browser teilen sich die Liste)
  const AVATARS = ['🦊', '🐻', '🐺', '🦁', '🐯', '🐸', '🐮', '🐔', '🦅', '🐙', '🦄', '🐲', '🐵', '🐼', '🐨', '🐷', '🦉', '🦈', '🐧', '🐰', '🦋', '🐢', '🐝', '🦜'];

  const DEFAULT_SETTINGS = {
    revealSeconds: 5,     // wie lange die aufgedeckten Karten gezeigt werden
    restartSeconds: 8,    // Wartezeit bis zur neuen Partie nach vier Assen
  };

  function suitOf(id) { return SUITS[Math.floor(id / 9)]; }
  function rankOf(id) { return RANKS[id % 9]; }
  function isAce(id) { return id % 9 === ACE_INDEX; }
  function cardName(id) { return SUIT_NAMES[suitOf(id)] + '-' + RANK_NAMES[rankOf(id)]; }
  function sortCards(a, b) {
    const ra = a % 9, rb = b % 9;
    if (ra !== rb) return ra - rb;
    return a - b;
  }
  function claimText(count, rank) {
    return COUNT_WORDS[count] + ' ' + RANK_WORDS[rank][count === 1 ? 0 : 1];
  }
  function countAces(hand) { return hand.filter(isAce).length; }

  // ----------------------------------------------------------------- Hilfe
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function clampSize(n) {
    n = parseInt(n, 10);
    if (!(n >= MIN_PLAYERS && n <= MAX_PLAYERS)) return MIN_PLAYERS;
    return n;
  }
  function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
  function fail(error) { return { ok: false, error: error }; }
  function pushLog(room, text, kind) {
    room.log.push({ text: text, kind: kind || 'info', n: ++room.logCounter });
    if (room.log.length > 40) room.log.splice(0, room.log.length - 40);
  }
  function emit(room, ev) { room.events.push(ev); }
  function pname(room, seat) { return room.players[seat] ? room.players[seat].name : 'Spieler ' + (seat + 1); }

  // ------------------------------------------------------------------ Raum
  function createRoom(opts) {
    opts = opts || {};
    return {
      code: opts.code || '',
      size: clampSize(opts.size),
      settings: Object.assign({}, DEFAULT_SETTINGS, opts.settings || {}),
      phase: 'lobby',       // lobby | turn | decide | reveal | over
      players: [],          // { name, avatar, token, hand: [], connected }
      hostSeat: 0,
      turn: null,           // Sitz des Spielers am Zug
      pile: [],             // alle Karten auf dem Stapel (verdeckt, Reihenfolge = Ablage)
      discard: [],          // aus dem Spiel genommene Vierlinge (offen, je 4 Karten eines Werts)
      roundRank: null,      // angesagter Wert der laufenden Ablagerunde
      lastPlay: null,       // { seat, cards, rank, count }
      decider: null,        // Sitz, der gerade über die letzte Ablage entscheidet
      result: null,         // { accused, challenger, revealed, lied, loser, revealUntil }
      over: null,           // { kind: 'win'|'fourAces', seat, aces, autoRestartAt }
      log: [],
      logCounter: 0,
      events: [],
      gamesPlayed: 0,
      rng: opts.rng || Math.random,
    };
  }

  function addPlayer(room, p) {
    if (room.phase !== 'lobby') return fail('Das Spiel läuft bereits.');
    if (room.players.length >= room.size) return fail('Der Tisch ist voll.');
    const name = String(p.name || '').trim().slice(0, 16) || ('Spieler ' + (room.players.length + 1));
    const avatar = AVATARS.indexOf(p.avatar) >= 0 ? p.avatar : AVATARS[room.players.length % AVATARS.length];
    const player = { name: name, avatar: avatar, token: p.token || null, hand: [], connected: true };
    room.players.push(player);
    pushLog(room, name + ' sitzt am Tisch.', 'info');
    emit(room, { t: 'joined', seat: room.players.length - 1 });
    return ok({ seat: room.players.length - 1 });
  }

  function removePlayer(room, seat) {
    if (room.phase !== 'lobby') return fail('Während einer Partie kann niemand den Tisch verlassen. Der Host kann die Partie abbrechen.');
    if (!room.players[seat]) return fail('Spieler nicht gefunden.');
    const name = room.players[seat].name;
    room.players.splice(seat, 1);
    if (room.hostSeat === seat) room.hostSeat = 0;
    else if (room.hostSeat > seat) room.hostSeat -= 1;
    pushLog(room, name + ' hat den Tisch verlassen.', 'info');
    emit(room, { t: 'left', name: name });
    return ok();
  }

  function setConnected(room, seat, connected) {
    const p = room.players[seat];
    if (!p) return fail('Spieler nicht gefunden.');
    if (p.connected === connected) return ok();
    p.connected = connected;
    pushLog(room, p.name + (connected ? ' ist wieder da.' : ' hat die Verbindung verloren.'), 'info');
    return ok();
  }

  function setSize(room, size) {
    if (room.phase !== 'lobby') return fail('Nur in der Lobby möglich.');
    size = parseInt(size, 10);
    if (!(size >= MIN_PLAYERS && size <= MAX_PLAYERS)) return fail('Es sind nur Tische mit 4, 5 oder 6 Spielern möglich.');
    if (room.players.length > size) return fail('Es sitzen schon mehr Spieler am Tisch.');
    room.size = size;
    return ok();
  }

  function setSettings(room, s) {
    if (room.phase !== 'lobby') return fail('Nur in der Lobby möglich.');
    const rs = parseInt(s && s.revealSeconds, 10);
    if (rs >= 1 && rs <= 15) room.settings.revealSeconds = rs;
    const ns = parseInt(s && s.restartSeconds, 10);
    if (ns >= 1 && ns <= 30) room.settings.restartSeconds = ns;
    return ok();
  }

  function canStart(room) {
    return room.phase === 'lobby' && room.players.length === room.size;
  }

  function startGame(room) {
    if (room.phase !== 'lobby') return fail('Das Spiel läuft bereits.');
    if (room.players.length < MIN_PLAYERS) return fail('Es braucht mindestens 4 Spieler.');
    if (room.players.length !== room.size) return fail('Der Tisch ist noch nicht voll (' + room.players.length + ' von ' + room.size + ').');
    deal(room, Date.now());
    return ok();
  }

  function newGame(room, now) {
    if (room.phase !== 'over') return fail('Die Partie läuft noch.');
    deal(room, now || Date.now());
    return ok();
  }

  function abortToLobby(room) {
    if (room.phase === 'lobby') return ok();
    room.players.forEach(function (p) { p.hand = []; });
    room.pile = []; room.discard = []; room.roundRank = null; room.lastPlay = null; room.decider = null;
    room.result = null; room.over = null; room.turn = null;
    room.phase = 'lobby';
    pushLog(room, 'Die Partie wurde abgebrochen – zurück in die Lobby.', 'info');
    emit(room, { t: 'aborted' });
    return ok();
  }

  // ------------------------------------------------------------ Austeilen
  function deal(room, now) {
    const n = room.players.length;
    const deck = shuffle(Array.from({ length: DECK_SIZE }, function (_, i) { return i; }), room.rng);
    room.players.forEach(function (p) { p.hand = []; });
    deck.forEach(function (card, i) { room.players[i % n].hand.push(card); });
    room.pile = []; room.discard = []; room.roundRank = null; room.lastPlay = null; room.decider = null; room.result = null; room.over = null;
    room.gamesPlayed += 1;
    room.turn = Math.floor(room.rng() * n);
    room.phase = 'turn';
    pushLog(room, 'Partie ' + room.gamesPlayed + ': Die Karten sind verteilt. ' + pname(room, room.turn) + ' beginnt.', 'info');
    emit(room, { t: 'deal', counts: room.players.map(function (p) { return p.hand.length; }), first: room.turn });
    // Vier Asse direkt nach dem Austeilen? Hat Vorrang.
    for (let s = 0; s < n; s++) {
      if (checkFourAces(room, s, now)) return;
    }
    // Vierlinge (vier gleiche Werte) werden automatisch aus dem Spiel genommen
    for (let s = 0; s < n; s++) checkQuartets(room, s);
    for (let s = 0; s < n; s++) {
      if (room.players[s].hand.length === 0) { declareWin(room, s); return; }
    }
  }

  function declareWin(room, seat) {
    room.over = { kind: 'win', seat: seat };
    room.phase = 'over'; room.turn = null; room.decider = null;
    pushLog(room, pname(room, seat) + ' hat alle Karten abgelegt und gewinnt!', 'win');
    emit(room, { t: 'win', seat: seat });
  }

  // Vier gleiche Karten (ausser Asse) auf einer Hand: werden offen aus dem Spiel genommen.
  function checkQuartets(room, seat) {
    const p = room.players[seat];
    if (!p) return false;
    let any = false;
    CLAIMABLE.forEach(function (r) {
      const cards = p.hand.filter(function (c) { return rankOf(c) === r; }).sort(sortCards);
      if (cards.length < 4) return;
      p.hand = p.hand.filter(function (c) { return cards.indexOf(c) < 0; });
      cards.forEach(function (c) { room.discard.push(c); });
      pushLog(room, pname(room, seat) + ' legt automatisch ' + claimText(4, r) + ' ab – sie sind aus dem Spiel.', 'quartet');
      emit(room, { t: 'quartet', seat: seat, rank: r, cards: cards.slice() });
      any = true;
    });
    return any;
  }

  // Prüft die Vier-Asse-Regel für einen Sitz. Hat Vorrang vor allem anderen.
  function checkFourAces(room, seat, now) {
    const p = room.players[seat];
    if (!p || countAces(p.hand) < 4) return false;
    room.over = {
      kind: 'fourAces', seat: seat,
      aces: p.hand.filter(isAce).slice().sort(sortCards),
      autoRestartAt: now + room.settings.restartSeconds * 1000,
    };
    room.phase = 'over';
    room.decider = null; room.result = null; room.turn = null;
    pushLog(room, p.name + ' hat alle vier Asse und verliert!', 'lose');
    emit(room, { t: 'fourAces', seat: seat });
    return true;
  }

  // --------------------------------------------------------------- Ablegen
  function play(room, seat, cards, rank, now) {
    if (room.phase !== 'turn') return fail('Jetzt kann nicht abgelegt werden.');
    if (seat !== room.turn) return fail('Du bist nicht am Zug.');
    if (!Array.isArray(cards) || cards.length < 1) return fail('Wähle mindestens eine Karte.');
    if (cards.length > MAX_PLAY) return fail('Höchstens ' + MAX_PLAY + ' Karten pro Ablage.');
    const ids = cards.map(function (c) { return parseInt(c, 10); });
    if (new Set(ids).size !== ids.length) return fail('Doppelte Karte.');
    const hand = room.players[seat].hand;
    for (const id of ids) {
      if (!(id >= 0 && id < DECK_SIZE) || hand.indexOf(id) < 0) return fail('Diese Karte hast du nicht.');
    }
    if (CLAIMABLE.indexOf(rank) < 0) return fail(rank === 'ass' ? 'Asse dürfen nie angesagt werden.' : 'Ungültige Ansage.');
    if (room.roundRank && rank !== room.roundRank) return fail('In dieser Runde muss ' + RANK_NAMES[room.roundRank] + ' angesagt werden.');

    room.players[seat].hand = hand.filter(function (c) { return ids.indexOf(c) < 0; });
    ids.forEach(function (c) { room.pile.push(c); });
    room.roundRank = rank;
    room.lastPlay = { seat: seat, cards: ids.slice(), rank: rank, count: ids.length };
    // Feste Reihenfolge: nur der direkt nächste Spieler entscheidet (glauben oder «Lügner!»)
    room.decider = (seat + 1) % room.players.length;
    room.turn = room.decider;
    room.phase = 'decide';
    pushLog(room, pname(room, seat) + ' legt ' + claimText(ids.length, rank) + (room.players[seat].hand.length === 0 ? ' – letzte Karte!' : '.'), 'play');
    emit(room, { t: 'play', seat: seat, count: ids.length, rank: rank, last: room.players[seat].hand.length === 0 });
    return ok();
  }

  function believe(room, seat) {
    if (room.phase !== 'decide') return fail('Gerade gibt es nichts zu entscheiden.');
    if (seat !== room.decider) return fail('Nur ' + pname(room, room.decider) + ' entscheidet jetzt.');
    const lp = room.lastPlay;
    room.decider = null;
    pushLog(room, pname(room, seat) + ' glaubt ' + pname(room, lp.seat) + '.', 'info');
    if (room.players[lp.seat].hand.length === 0) { declareWin(room, lp.seat); return ok(); }
    room.turn = seat;
    room.phase = 'turn';
    emit(room, { t: 'accepted', seat: lp.seat, next: seat });
    return ok();
  }

  function challenge(room, seat, now) {
    if (room.phase !== 'decide') return fail('Gerade kann niemand beschuldigt werden.');
    if (seat !== room.decider) return fail('Nur ' + pname(room, room.decider) + ' entscheidet jetzt.');
    const lp = room.lastPlay;
    const lied = lp.cards.some(function (c) { return rankOf(c) !== lp.rank; });
    const loser = lied ? lp.seat : seat;
    room.result = {
      accused: lp.seat, challenger: seat, revealed: lp.cards.slice(), rank: lp.rank, count: lp.count,
      lied: lied, loser: loser, pileCount: room.pile.length,
      revealUntil: now + room.settings.revealSeconds * 1000,
    };
    room.decider = null;
    room.turn = null;
    room.phase = 'reveal';
    pushLog(room, pname(room, seat) + ' glaubt ' + pname(room, lp.seat) + ' nicht!', 'challenge');
    pushLog(room, lied ? pname(room, lp.seat) + ' hat gelogen!' : pname(room, lp.seat) + ' hat die Wahrheit gesagt.', lied ? 'liar' : 'truth');
    pushLog(room, pname(room, loser) + ' muss den Stapel aufnehmen (' + room.pile.length + ' Karten).', 'pickup');
    emit(room, { t: 'reveal', accused: lp.seat, challenger: seat, revealed: lp.cards.slice(), rank: lp.rank, lied: lied, loser: loser });
    return ok();
  }

  // Ende der Aufdeck-Phase: Stapel geht an den Verlierer, neue Runde.
  function finishReveal(room, now) {
    const r = room.result;
    const loserP = room.players[r.loser];
    const count = room.pile.length;
    room.pile.forEach(function (c) { loserP.hand.push(c); });
    room.pile = [];
    room.roundRank = null;
    room.lastPlay = null;
    room.result = null;
    emit(room, { t: 'pickup', seat: r.loser, count: count });
    if (checkFourAces(room, r.loser, now)) return;
    if (!r.lied && room.players[r.accused].hand.length === 0) { declareWin(room, r.accused); return; }
    checkQuartets(room, r.loser);
    if (room.players[r.loser].hand.length === 0) { declareWin(room, r.loser); return; }
    // Lag der Rufer richtig, beginnt er die neue Runde. Lag er falsch, nimmt er den Stapel und der Spieler nach ihm beginnt.
    room.turn = r.lied ? r.challenger : (r.challenger + 1) % room.players.length;
    room.phase = 'turn';
    pushLog(room, 'Neue Runde – ' + pname(room, room.turn) + ' beginnt.', 'info');
    emit(room, { t: 'newRound', seat: room.turn });
  }

  // ----------------------------------------------------------------- Zeit
  // Gibt den nächsten Zeitpunkt zurück, an dem advance() aufgerufen werden muss.
  function nextDeadline(room) {
    if (room.phase === 'reveal') return room.result.revealUntil;
    if (room.phase === 'over' && room.over.kind === 'fourAces') return room.over.autoRestartAt;
    return null;
  }

  // Führt fällige Übergänge aus. Gibt true zurück, wenn sich etwas geändert hat.
  function advance(room, now) {
    let changed = false;
    for (let guard = 0; guard < 5; guard++) {
      const d = nextDeadline(room);
      if (d === null || now < d) break;
      if (room.phase === 'reveal') finishReveal(room, now);
      else if (room.phase === 'over') deal(room, now);
      changed = true;
    }
    return changed;
  }

  // -------------------------------------------------------------- Ansicht
  // Was ein bestimmter Sitz sehen darf. Fremde Handkarten werden NIE mitgeschickt.
  function viewFor(room, seat, now) {
    const me = room.players[seat];
    return {
      t: 'view',
      now: now || Date.now(),
      code: room.code,
      size: room.size,
      settings: { revealSeconds: room.settings.revealSeconds, restartSeconds: room.settings.restartSeconds },
      phase: room.phase,
      seat: seat,
      hostSeat: room.hostSeat,
      players: room.players.map(function (p, i) {
        return { seat: i, name: p.name, avatar: p.avatar, count: p.hand.length, connected: p.connected, isHost: i === room.hostSeat };
      }),
      hand: me ? me.hand.slice().sort(sortCards) : [],
      turn: room.turn,
      pileCount: room.pile.length,
      discard: room.discard.slice(),
      roundRank: room.roundRank,
      lastPlay: room.lastPlay ? { seat: room.lastPlay.seat, count: room.lastPlay.count, rank: room.lastPlay.rank } : null,
      decider: room.decider,
      result: room.result ? {
        accused: room.result.accused, challenger: room.result.challenger, revealed: room.result.revealed.slice(),
        rank: room.result.rank, count: room.result.count, lied: room.result.lied, loser: room.result.loser, pileCount: room.result.pileCount,
        revealUntil: room.result.revealUntil,
      } : null,
      over: room.over ? Object.assign({}, room.over) : null,
      gamesPlayed: room.gamesPlayed,
      log: room.log.slice(-14),
      events: room.events.slice(),
    };
  }

  // ------------------------------------------------------------------ Bot
  // Einfacher Bot für den Übungsmodus und die automatischen Tests.
  function botTurn(room, seat, rng) {
    rng = rng || room.rng;
    const hand = room.players[seat].hand.slice();
    const byRank = {};
    hand.forEach(function (c) { (byRank[rankOf(c)] = byRank[rankOf(c)] || []).push(c); });
    const aces = byRank.ass || [];

    function lieCards(n) {
      // Zum Lügen zuerst Asse loswerden, sonst Karten, von denen man nur eine hat
      const singles = hand.filter(function (c) { return !isAce(c) && byRank[rankOf(c)].length === 1; });
      const pool = (aces.length && rng() < 0.7) ? aces.concat(singles) : singles.concat(aces, hand);
      const out = [];
      for (const c of pool) { if (out.indexOf(c) < 0) out.push(c); if (out.length >= n) break; }
      return out;
    }

    if (room.roundRank) {
      const truthful = byRank[room.roundRank] || [];
      if (truthful.length && rng() < 0.9) {
        const cards = truthful.slice(0, MAX_PLAY);
        // ab und zu ein Ass dazuschmuggeln
        if (aces.length && cards.length < MAX_PLAY && rng() < 0.25) cards.push(aces[0]);
        return { cards: cards, rank: room.roundRank };
      }
      return { cards: lieCards(rng() < 0.3 ? 2 : 1), rank: room.roundRank };
    }
    // Neue Runde: den Wert ansagen, von dem man am meisten hat
    let best = null;
    CLAIMABLE.forEach(function (r) {
      const n = (byRank[r] || []).length;
      if (n > 0 && (!best || n > best.n || (n === best.n && rng() < 0.5))) best = { r: r, n: n };
    });
    if (best) {
      const cards = byRank[best.r].slice(0, MAX_PLAY);
      if (aces.length && cards.length < MAX_PLAY && rng() < 0.3) cards.push(aces[0]);
      return { cards: cards, rank: best.r };
    }
    // Nur noch Asse auf der Hand: lügen
    const open = CLAIMABLE.filter(function (r) { return !room.discard.some(function (c) { return rankOf(c) === r; }); });
    const pool = open.length ? open : CLAIMABLE;
    return { cards: lieCards(1), rank: pool[Math.floor(rng() * pool.length)] };
  }

  function botWantsChallenge(room, seat, rng) {
    rng = rng || room.rng;
    const lp = room.lastPlay;
    if (!lp) return false;
    const hand = room.players[seat].hand;
    const mine = hand.filter(function (c) { return rankOf(c) === lp.rank; }).length;
    const out = room.discard.filter(function (c) { return rankOf(c) === lp.rank; }).length;
    if (mine + out + lp.count > 4) return true; // mehr als vier gibt es nicht – sicher gelogen
    let p = 0.10 + 0.10 * (lp.count - 1);
    if (room.players[lp.seat].hand.length === 0) p += 0.5; // letzte Karte(n)
    if (room.pile.length > 10) p += 0.1;
    return rng() < p;
  }

  return {
    SUITS, SUIT_NAMES, RANKS, RANK_NAMES, RANK_WORDS, CLAIMABLE, DECK_SIZE, MIN_PLAYERS, MAX_PLAYERS, MAX_PLAY, DEFAULT_SETTINGS, AVATARS,
    suitOf, rankOf, isAce, cardName, sortCards, claimText, countAces, clampSize,
    createRoom, addPlayer, removePlayer, setConnected, setSize, setSettings, canStart, startGame, newGame, abortToLobby,
    play, believe, challenge, advance, nextDeadline, viewFor,
    botTurn, botWantsChallenge,
  };
});
