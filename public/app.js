/*
 * Lügerjass – Spielseite (Browser)
 * Verbindet sich per WebSocket mit dem Server (Mehrspieler) oder spielt lokal gegen Bots.
 * Zeigt nur, was der Server für diesen Spieler freigibt: eigene Karten, fremde nur als Rückseiten.
 */
(function () {
  'use strict';

  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  const RANK_LABEL = { '6': '6', '7': '7', '8': '8', '9': '9', banner: 'Banner', under: 'Under', ober: 'Ober', koenig: 'König', ass: 'Ass' };
  const BOT_NAMES = ['Reto', 'Sandra', 'Beat', 'Nicole', 'Urs', 'Pia'];

  // ------------------------------------------------------------ Speicher
  const LS_SETTINGS = 'lj.settings', LS_SESSION = 'lj.session';
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch (e) { return {}; } }
  function save(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* privater Modus o.ä. */ } }
  function clearSession() { try { localStorage.removeItem(LS_SESSION); } catch (e) { /* egal */ } }
  const settings = Object.assign({ name: '', avatar: LJ.AVATARS[Math.floor(Math.random() * LJ.AVATARS.length)], anim: true }, load(LS_SETTINGS));
  function saveSettings() { save(LS_SETTINGS, settings); applySettings(); }
  function applySettings() {
    $('#start-name').textContent = settings.name || 'Namenlos';
    $('#start-avatar').textContent = settings.avatar;
    document.body.classList.toggle('noanim', !settings.anim);
  }

  // ------------------------------------------------------------ Zustand
  const S = {
    conn: null, mode: null, view: null, prevView: null,
    selected: new Set(), claimRank: null, clockOffset: 0,
    queue: Promise.resolve(), overlayTimer: null, connState: 'idle', logOpen: false,
  };

  // ------------------------------------------------------------ Verbindung (Server)
  function NetConnection(handler) {
    this.handler = handler; this.ws = null; this.closed = false; this.retry = 0; this.outbox = []; this.pingTimer = null; this.reconnectTimer = null;
  }
  NetConnection.prototype.url = function () {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  };
  NetConnection.prototype.connect = function () {
    const self = this;
    if (this.closed) return;
    S.connState = 'connecting';
    let ws;
    try { ws = new WebSocket(this.url()); } catch (e) { return this.scheduleReconnect(); }
    this.ws = ws;
    ws.onopen = function () {
      self.retry = 0; S.connState = 'open';
      let sentSomething = false;
      while (self.outbox.length) { ws.send(JSON.stringify(self.outbox.shift())); sentSomething = true; }
      const sess = load(LS_SESSION);
      if (!sentSomething && sess.code && sess.token) ws.send(JSON.stringify({ t: 'rejoin', code: sess.code, token: sess.token }));
      clearInterval(self.pingTimer);
      self.pingTimer = setInterval(function () { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping' })); }, 20000);
      renderConnection();
    };
    ws.onmessage = function (ev) {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      self.handler(m);
    };
    ws.onclose = function () {
      clearInterval(self.pingTimer);
      if (self.closed) return;
      S.connState = 'lost'; renderConnection();
      self.scheduleReconnect();
    };
    ws.onerror = function () { /* onclose folgt */ };
  };
  NetConnection.prototype.scheduleReconnect = function () {
    const self = this;
    if (this.closed) return;
    const wait = Math.min(10000, 800 * Math.pow(2, this.retry++));
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(function () { self.connect(); }, wait);
  };
  NetConnection.prototype.send = function (m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
    else { this.outbox.push(m); if (!this.ws || this.ws.readyState > 1) this.connect(); }
  };
  NetConnection.prototype.close = function () {
    this.closed = true; clearInterval(this.pingTimer); clearTimeout(this.reconnectTimer);
    if (this.ws) { try { this.ws.close(); } catch (e) { /* egal */ } }
  };

  // ------------------------------------------------------------ Lokaler Übungsmodus (Bots)
  const FAST = /[?&]fast=1/.test(location.search); // nur für automatische Tests
  function LocalConnection(handler, size) {
    this.handler = handler;
    this.room = LJ.createRoom({ code: 'ÜBEN', size: size, settings: FAST ? { revealSeconds: 1, restartSeconds: 2 } : { revealSeconds: 5, restartSeconds: 8 } });
    LJ.addPlayer(this.room, { name: settings.name || 'Du', avatar: settings.avatar, token: 'me' });
    for (let i = 1; i < size; i++) LJ.addPlayer(this.room, { name: BOT_NAMES[i - 1], avatar: LJ.AVATARS[(i * 5) % LJ.AVATARS.length], token: 'bot' + i });
    this.timer = null; this.botTimers = []; this.stopped = false;
  }
  LocalConnection.prototype.connect = function () {
    this.handler({ t: 'joined', code: 'ÜBEN', seat: 0, token: null });
    LJ.startGame(this.room);
    this.after();
  };
  LocalConnection.prototype.send = function (m) {
    if (this.stopped) return;
    const r = this.room; let res = { ok: true };
    switch (m.t) {
      case 'play': res = LJ.play(r, 0, m.cards, m.rank, Date.now()); break;
      case 'believe': res = LJ.believe(r, 0); break;
      case 'challenge': res = LJ.challenge(r, 0, Date.now()); break;
      case 'newGame': res = LJ.newGame(r, Date.now()); break;
      case 'abort': res = LJ.abortToLobby(r); if (res.ok) { this.stop(); leaveToStart('Übung beendet.'); return; } break;
      case 'leave': this.stop(); this.handler({ t: 'left' }); return;
      default: return;
    }
    if (!res.ok) { this.handler({ t: 'error', msg: res.error }); return; }
    this.after();
  };
  LocalConnection.prototype.deliver = function () {
    this.handler(LJ.viewFor(this.room, 0, Date.now()));
    this.room.events = [];
  };
  LocalConnection.prototype.after = function () {
    const self = this, r = this.room;
    this.deliver();
    clearTimeout(this.timer);
    const d = LJ.nextDeadline(r);
    if (d !== null) this.timer = setTimeout(function () { if (LJ.advance(r, Date.now())) self.after(); }, Math.max(0, d - Date.now()) + 10);
    this.botTimers.forEach(clearTimeout); this.botTimers = [];
    if (r.phase === 'turn' && r.turn !== 0) {
      const seat = r.turn;
      this.botTimers.push(setTimeout(function () {
        if (r.phase !== 'turn' || r.turn !== seat) return;
        const d = LJ.botTurn(r, seat);
        LJ.play(r, seat, d.cards, d.rank, Date.now());
        self.after();
      }, (1200 + Math.random() * 1500) * (FAST ? 0.1 : 1)));
    }
    if (r.phase === 'decide' && r.decider !== 0) {
      const lp = r.lastPlay, seat = r.decider;
      this.botTimers.push(setTimeout(function () {
        if (r.phase !== 'decide' || r.lastPlay !== lp) return;
        if (LJ.botWantsChallenge(r, seat)) LJ.challenge(r, seat, Date.now());
        else LJ.believe(r, seat);
        self.after();
      }, (1400 + Math.random() * 2200) * (FAST ? 0.1 : 1)));
    }
  };
  LocalConnection.prototype.stop = function () { this.stopped = true; clearTimeout(this.timer); this.botTimers.forEach(clearTimeout); };
  LocalConnection.prototype.close = LocalConnection.prototype.stop;

  // ------------------------------------------------------------ Nachrichten vom Server
  function onMessage(m) {
    switch (m.t) {
      case 'joined':
        if (S.mode === 'net') save(LS_SESSION, { code: m.code, token: m.token, seat: m.seat });
        break;
      case 'view': enqueueView(m); break;
      case 'error': toast(m.msg, 'error'); S.selected.clear(); render(); break;
      case 'pong': break;
      case 'kicked': clearSession(); leaveToStart('Der Host hat dich vom Tisch entfernt.'); break;
      case 'left': clearSession(); leaveToStart(); break;
      case 'replaced': leaveToStart('Du hast den Tisch in einem anderen Fenster geöffnet – dieses Fenster ist jetzt inaktiv.', true); break;
      case 'rejoinFailed': clearSession(); leaveToStart(m.msg); break;
      default: break;
    }
  }

  function enqueueView(v) {
    S.queue = S.queue.then(function () { return processView(v); }).catch(function (e) {
      console.error(e); S.view = v; try { render(); } catch (e2) { console.error(e2); }
    });
  }

  async function processView(v) {
    S.clockOffset = v.now - Date.now();
    const prev = S.view;
    const onTable = prev && prev.phase !== 'lobby' && v.phase !== 'lobby';
    if (settings.anim && onTable) {
      for (const ev of v.events) {
        if (ev.t === 'play' && ev.seat !== v.seat) await animatePlay(prev, ev.seat, ev.count);
        else if (ev.t === 'pickup') await animatePickup(prev, ev.seat, ev.count);
      }
    }
    S.prevView = prev; S.view = v;
    // Auswahl bereinigen
    S.selected.forEach(function (c) { if (v.hand.indexOf(c) < 0) S.selected.delete(c); });
    if (v.phase !== 'turn' || v.turn !== v.seat) S.selected.clear();
    if (v.roundRank) S.claimRank = v.roundRank;
    else if (prev && prev.roundRank) S.claimRank = null;
    render();
    for (const ev of v.events) {
      if (ev.t === 'deal') { if (settings.anim && v.phase !== 'lobby') await animateDeal(v); else $('#hand').classList.remove('dealing'); }
      else if (ev.t === 'accepted' && v.phase === 'turn') toast((ev.next === v.seat ? 'Du glaubst ' : nameOf(v, ev.next) + ' glaubt ') + nameOfObj(v, ev.seat) + ' – die Karten bleiben liegen.');
      else if (ev.t === 'newRound') toast('Neue Runde: ' + nameOf(v, ev.seat) + ' beginnt mit freier Ansage.');
      else if (ev.t === 'joined' && v.phase === 'lobby' && ev.seat !== v.seat) toast(nameOf(v, ev.seat) + ' ist dazugekommen.');
      else if (ev.t === 'left') toast(ev.name + ' hat den Tisch verlassen.');
      else if (ev.t === 'aborted') toast('Die Partie wurde abgebrochen.');
    }
  }

  function nameOf(v, seat) { const p = v.players[seat]; return p ? (seat === v.seat ? 'Du' : p.name) : 'Spieler'; }
  function nameOfObj(v, seat) { const p = v.players[seat]; return p ? (seat === v.seat ? 'dich' : p.name) : 'Spieler'; }
  function now() { return Date.now() + S.clockOffset; }

  // ------------------------------------------------------------ Bildschirme
  function showScreen(name) {
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + name); });
  }
  function screenIs(name) { return $('#screen-' + name).classList.contains('active'); }

  function render() {
    const v = S.view;
    if (!v) { showScreen('start'); hideOverlay(); return; }
    if (v.phase === 'lobby') { showScreen('lobby'); renderLobby(v); hideOverlay(); return; }
    showScreen('table');
    renderTable(v);
  }

  function renderConnection() {
    if (!S.view || S.mode !== 'net') return;
    if (S.connState === 'lost' || S.connState === 'connecting') {
      const el = $('#status-line');
      if (screenIs('table') && el) { el.textContent = 'Verbindung unterbrochen – verbinde neu…'; el.classList.add('urgent'); }
    } else if (S.view) render();
  }

  // ------------------------------------------------------------ Lobby
  function renderLobby(v) {
    const isHost = v.seat === v.hostSeat || (v.players[v.hostSeat] && !v.players[v.hostSeat].connected);
    $('#lobby-code').textContent = v.code;
    const list = $('#lobby-players');
    list.innerHTML = '';
    for (let i = 0; i < v.size; i++) {
      const p = v.players[i];
      const el = document.createElement('div');
      if (!p) { el.className = 'lp empty'; el.innerHTML = '<div class="av">·</div><div class="nm">Platz frei</div>'; }
      else {
        el.className = 'lp' + (i === v.seat ? ' me' : '');
        el.innerHTML = '<div class="av">' + esc(p.avatar) + '</div><div class="nm">' + esc(p.name) + (i === v.seat ? ' (du)' : '') + '</div>' +
          (p.isHost ? '<span class="tag">Host</span>' : '') + (!p.connected ? '<span class="off">offline</span>' : '') +
          (isHost && i !== v.seat ? '<button class="kick" title="Spieler entfernen" data-kick="' + i + '">✕</button>' : '');
      }
      list.appendChild(el);
    }
    $$('#seg-size button').forEach(function (b) { b.classList.toggle('on', parseInt(b.dataset.size, 10) === v.size); b.disabled = !isHost; });
    $('#lobby-settings').classList.toggle('locked', !isHost);
    const missing = v.size - v.players.length;
    const status = $('#lobby-status');
    if (missing > 0) status.textContent = 'Warten auf ' + missing + ' weitere' + (missing === 1 ? 'n Spieler' : ' Spieler') + ' … (' + v.players.length + ' von ' + v.size + ')';
    else status.textContent = isHost ? 'Alle sind da – du kannst starten.' : 'Alle sind da – der Host startet die Partie.';
    const btn = $('#btn-start');
    btn.disabled = !(isHost && missing === 0);
    btn.classList.toggle('hidden', !isHost);
  }

  // ------------------------------------------------------------ Spieltisch
  function renderTable(v) {
    const me = v.seat;
    $('#table-code').textContent = v.code === 'ÜBEN' ? 'Übung' : v.code;
    renderSeats(v);
    renderCenter(v);
    renderMe(v);
    renderHand(v);
    renderActions(v);
    renderLog(v);
    renderOverlay(v);
    const log = $('#log');
    log.classList.toggle('hidden', !S.logOpen);
  }

  function seatAngle(i, k) {
    // k Gegner gleichmässig von links (180°) über oben (270°) nach rechts (360°)
    if (k === 1) return 270;
    return 180 + i * (180 / (k - 1));
  }

  function renderSeats(v) {
    const container = $('#seats');
    const n = v.players.length, me = v.seat;
    const order = [];
    for (let i = 1; i < n; i++) order.push((me + i) % n);
    const existing = {};
    $$('#seats .seat').forEach(function (el) { existing[el.dataset.seat] = el; });
    container.innerHTML = '';
    order.forEach(function (seat, idx) {
      const p = v.players[seat];
      const a = seatAngle(idx, order.length) * Math.PI / 180;
      const el = document.createElement('div');
      el.className = 'seat' + (v.turn === seat && (v.phase === 'turn' || v.phase === 'decide') ? ' turn' : '') + (!p.connected ? ' offline' : '');
      el.dataset.seat = seat;
      const narrow = window.innerWidth < 760;
      el.style.left = (50 + Math.cos(a) * (narrow ? 40 : 44)) + '%';
      el.style.top = (50 + Math.sin(a) * (narrow ? 38 : 40)) + '%';
      let badge = '';
      if (v.phase === 'decide') {
        if (v.lastPlay && v.lastPlay.seat === seat) badge = '<span class="seat-badge last">legt ' + v.lastPlay.count + '</span>';
        else if (v.decider === seat) badge = '<span class="seat-badge host">entscheidet…</span>';
      } else if (v.phase === 'reveal' && v.result) {
        if (v.result.accused === seat) badge = '<span class="seat-badge ' + (v.result.lied ? 'liar' : 'believe') + '">' + (v.result.lied ? 'gelogen!' : 'ehrlich') + '</span>';
        else if (v.result.challenger === seat) badge = '<span class="seat-badge liar">Lügner!</span>';
      } else if (v.phase === 'turn' && v.lastPlay && v.lastPlay.seat === seat && v.pileCount > 0) {
        badge = '<span class="seat-badge last">legte ' + v.lastPlay.count + '</span>';
      }
      if (!p.connected) badge = '<span class="seat-badge off">offline</span>';
      const shown = Math.min(p.count, 7);
      let cards = '';
      for (let c = 0; c < shown; c++) {
        const spread = shown > 1 ? (c / (shown - 1) - 0.5) : 0;
        cards += '<div class="card back" style="left:' + (28 + spread * 48) + 'px; transform: rotate(' + (spread * 30) + 'deg); z-index:' + c + '">' + LJCards.backEmblem() + '</div>';
      }
      el.innerHTML = '<div class="seat-cards">' + cards + '</div>' +
        '<div class="seat-avatar">' + esc(p.avatar) + '<span class="seat-count">' + p.count + '</span>' + badge + '</div>' +
        '<div class="seat-name">' + esc(p.name) + (p.isHost ? ' ♛' : '') + '</div>';
      container.appendChild(el);
    });
  }

  function renderCenter(v) {
    const claim = $('#claim-box');
    const pile = $('#pile');
    const count = $('#pile-count');
    const reveal = $('#reveal');
    const msg = $('#center-msg');
    msg.className = 'center-msg';
    $('#center').classList.toggle('revealing', v.phase === 'reveal');
    if (v.phase === 'reveal' && v.result) {
      const r = v.result;
      claim.innerHTML = '<span class="claim-label">Angesagt: ' + LJ.claimText(r.count, r.rank) + '</span>';
      pile.innerHTML = '';
      count.classList.add('hidden');
      reveal.innerHTML = r.revealed.map(function (c, i) {
        const ok = LJ.rankOf(c) === r.rank;
        return '<div class="rc ' + (ok ? 'ok' : 'bad') + '" style="animation-delay:' + (i * 0.15) + 's"><div class="card">' + LJCards.face(c) + '</div><span class="mark">' + (ok ? '✓' : '✗') + '</span></div>';
      }).join('');
      msg.classList.add(r.lied ? 'liar' : 'truth');
      msg.textContent = (r.lied ? nameOf(v, r.accused) + (r.accused === v.seat ? ' hast gelogen!' : ' hat gelogen!') : nameOf(v, r.accused) + (r.accused === v.seat ? ' hast die Wahrheit gesagt.' : ' hat die Wahrheit gesagt.')) +
        ' ' + nameOf(v, r.loser) + (r.loser === v.seat ? ' musst ' : ' muss ') + r.pileCount + ' Karten aufnehmen.';
      return;
    }
    reveal.innerHTML = '';
    if (v.roundRank) {
      claim.innerHTML = '<span class="claim-label">Angesagt wird</span><span class="claim-value">' + RANK_LABEL[v.roundRank] + '</span>' +
        (v.lastPlay ? '<span class="claim-last">' + esc(nameOf(v, v.lastPlay.seat)) + ': ' + v.lastPlay.count + ' Karte' + (v.lastPlay.count > 1 ? 'n' : '') + '</span>' : '');
    } else {
      claim.innerHTML = '<span class="claim-label">Neue Runde</span><span class="claim-value">freie Ansage</span>';
    }
    if (v.pileCount === 0) { pile.innerHTML = '<div class="pile-slot"></div>'; count.classList.add('hidden'); }
    else {
      const shown = Math.min(v.pileCount, 6);
      let html = '';
      for (let i = 0; i < shown; i++) {
        const k = v.pileCount - shown + i;
        const rot = ((k * 37) % 23) - 11, dx = ((k * 13) % 7) - 3, dy = ((k * 7) % 5) - 2;
        html += '<div class="card back" style="transform: translate(' + dx + 'px,' + dy + 'px) rotate(' + rot + 'deg)">' + LJCards.backEmblem() + '</div>';
      }
      pile.innerHTML = html;
      count.textContent = v.pileCount + ' Karte' + (v.pileCount > 1 ? 'n' : '');
      count.classList.remove('hidden');
    }
    if (v.phase === 'decide' && v.lastPlay) {
      msg.textContent = nameOf(v, v.lastPlay.seat) + (v.lastPlay.seat === v.seat ? ' legst ' : ' legt ') + LJ.claimText(v.lastPlay.count, v.lastPlay.rank) + (v.players[v.lastPlay.seat].count === 0 ? ' – letzte Karte!' : '') +
        ' · ' + nameOf(v, v.decider) + (v.decider === v.seat ? ' entscheidest' : ' entscheidet');
    } else if (v.phase === 'turn') {
      msg.textContent = v.turn === v.seat ? 'Du bist am Zug' : nameOf(v, v.turn) + ' ist am Zug';
    } else msg.textContent = '';
  }

  function renderMe(v) {
    const p = v.players[v.seat];
    const info = $('#me-info');
    info.className = 'me-info' + ((v.phase === 'turn' || v.phase === 'decide') && v.turn === v.seat ? ' turn' : '');
    info.innerHTML = '<div class="av">' + esc(p.avatar) + '</div><span>' + esc(p.name) + '</span><span class="muted">· ' + p.count + ' Karte' + (p.count !== 1 ? 'n' : '') + '</span>';
    const st = $('#status-line');
    st.className = 'status-line';
    let text = '';
    if (v.phase === 'turn') {
      if (v.turn === v.seat) {
        text = v.roundRank ? 'Wähle 1–4 Karten und lege sie als «' + RANK_LABEL[v.roundRank] + '» ab.' : 'Wähle den Wert, den du ansagst, und 1–4 Karten.';
      } else text = 'Warten auf ' + nameOf(v, v.turn) + '…';
    } else if (v.phase === 'decide') {
      if (v.decider === v.seat) { text = 'Glaubst du ' + nameOf(v, v.lastPlay.seat) + '? Wenn ja, legst du danach selbst ab.'; st.classList.add('urgent'); }
      else text = 'Jetzt entscheidet ' + nameOf(v, v.decider) + ': glauben oder «Lügner!»?';
    } else if (v.phase === 'reveal') text = 'Die Karten werden geprüft…';
    else if (v.phase === 'over') text = 'Partie beendet.';
    st.textContent = text;
  }

  function renderHand(v) {
    const hand = $('#hand');
    const myTurn = v.phase === 'turn' && v.turn === v.seat;
    hand.classList.toggle('many', v.hand.length > 10 && v.hand.length <= 16);
    hand.classList.toggle('lots', v.hand.length > 16);
    hand.innerHTML = v.hand.map(function (c) {
      return '<div class="card face' + (S.selected.has(c) ? ' selected' : '') + (myTurn ? '' : ' disabled') + '" data-id="' + c + '">' + LJCards.face(c) + '</div>';
    }).join('');
  }

  function renderActions(v) {
    const box = $('#actions');
    const me = v.seat;
    let html = '';
    if (v.phase === 'turn' && v.turn === me) {
      if (v.roundRank) {
        html += '<div class="chips"><span class="chip lock">Ansage: ' + RANK_LABEL[v.roundRank] + '</span></div>';
      } else {
        html += '<div class="chips">' + LJ.CLAIMABLE.map(function (r) {
          return '<button class="chip' + (S.claimRank === r ? ' on' : '') + '" data-rank="' + r + '">' + RANK_LABEL[r] + '</button>';
        }).join('') + '</div>';
      }
      const n = S.selected.size;
      const rank = v.roundRank || S.claimRank;
      const ready = n >= 1 && n <= LJ.MAX_PLAY && !!rank;
      const label = ready ? 'KARTEN ABLEGEN – ' + LJ.claimText(n, rank) : 'KARTEN ABLEGEN';
      html += '<div class="actions-row"><button class="btn btn-gold btn-play" id="btn-play" ' + (ready ? '' : 'disabled') + '>' + label + '</button></div>';
      if (!rank) html += '<div class="hint">Zuerst den Wert wählen, den du ansagst (Asse kann man nie ansagen).</div>';
      else if (n === 0) html += '<div class="hint">Tippe auf deine Karten, um sie auszuwählen (1 bis 4).</div>';
      else if (n > LJ.MAX_PLAY) html += '<div class="hint">Höchstens 4 Karten pro Ablage.</div>';
    } else if (v.phase === 'decide' && v.decider === me) {
      html += '<div class="actions-row"><button class="btn btn-believe" id="btn-believe">GLAUBEN</button><button class="btn btn-liar" id="btn-liar">LÜGNER!</button></div>';
      html += '<div class="hint">' + nameOf(v, v.lastPlay.seat) + ' hat ' + LJ.claimText(v.lastPlay.count, v.lastPlay.rank) + ' angesagt. Im Stapel liegen ' + v.pileCount + ' Karten.</div>';
    } else if (v.phase === 'decide') {
      html += '<div class="hint">' + (v.lastPlay.seat === me ? 'Wenn ' + nameOf(v, v.decider) + ' dir glaubt, bleiben deine Karten liegen.' : 'Warten auf ' + nameOf(v, v.decider) + '…') + '</div>';
    }
    box.innerHTML = html;
  }

  function renderLog(v) {
    const list = $('#log-list');
    list.innerHTML = v.log.slice().reverse().map(function (l) { return '<div class="' + esc(l.kind) + '">' + esc(l.text) + '</div>'; }).join('');
  }

  // ------------------------------------------------------------ Overlay (Sieg / Niederlage)
  function renderOverlay(v) {
    const ov = $('#overlay');
    if (v.phase !== 'over' || !v.over) { hideOverlay(); return; }
    const card = $('#overlay-card');
    const isHost = S.mode === 'local' || v.seat === v.hostSeat || (v.players[v.hostSeat] && !v.players[v.hostSeat].connected);
    const key = v.over.kind + ':' + v.over.seat + ':' + v.gamesPlayed;
    if (ov.dataset.key === key && !ov.classList.contains('hidden')) { updateOverlayCountdown(v); return; }
    ov.dataset.key = key;
    ov.classList.remove('hidden');
    let html = '';
    if (v.over.kind === 'win') {
      if (v.over.seat === v.seat) {
        card.className = 'overlay-card win';
        html = '<h2>GEWONNEN!</h2><p>Du hast alle Karten abgelegt!</p>';
        startConfetti();
      } else {
        card.className = 'overlay-card info';
        html = '<h2>' + esc(v.players[v.over.seat].name) + ' gewinnt</h2><p>' + esc(v.players[v.over.seat].avatar) + ' hat alle Karten abgelegt. Nächstes Mal besser aufpassen!</p>';
        stopConfetti();
      }
      html += '<div class="overlay-buttons">' + (isHost ? '<button class="btn btn-gold btn-big" id="ov-newgame">Neue Partie</button>' : '<span class="countdown-text">Der Host kann eine neue Partie starten.</span>') +
        (S.mode === 'net' && isHost ? '<button class="btn btn-outline" id="ov-lobby">Zurück in die Lobby</button>' : '') + '</div>';
    } else {
      stopConfetti();
      const aces = (v.over.aces || [8, 17, 26, 35]).map(function (c) { return '<div class="card">' + LJCards.face(c) + '</div>'; }).join('');
      if (v.over.seat === v.seat) {
        card.className = 'overlay-card lose';
        html = '<h2>VERLOREN!</h2><p>Du hast alle vier Asse!</p><div class="overlay-aces">' + aces + '</div>';
      } else {
        card.className = 'overlay-card info';
        html = '<h2>' + esc(v.players[v.over.seat].name) + ' verliert!</h2><p>' + esc(v.players[v.over.seat].avatar) + ' hat alle vier Asse auf der Hand.</p><div class="overlay-aces">' + aces + '</div>';
      }
      html += '<p class="countdown-text" id="ov-restart"></p>';
    }
    card.innerHTML = html;
    updateOverlayCountdown(v);
  }
  function updateOverlayCountdown(v) {
    clearInterval(S.overlayTimer);
    const el = $('#ov-restart');
    if (!el || !v.over || v.over.kind !== 'fourAces') return;
    function tick() {
      const sec = Math.max(0, Math.ceil((v.over.autoRestartAt - now()) / 1000));
      el.textContent = 'Neue Partie mit denselben Spielern in ' + sec + ' s …';
      if (sec <= 0) clearInterval(S.overlayTimer);
    }
    tick();
    S.overlayTimer = setInterval(tick, 250);
  }
  function hideOverlay() {
    const ov = $('#overlay');
    if (!ov.classList.contains('hidden')) { ov.classList.add('hidden'); ov.dataset.key = ''; stopConfetti(); clearInterval(S.overlayTimer); }
  }

  // ------------------------------------------------------------ Konfetti
  let confettiRaf = null;
  function startConfetti() {
    const cv = $('#confetti'); const ctx = cv.getContext('2d');
    cv.width = cv.clientWidth; cv.height = cv.clientHeight;
    const colors = ['#e8c35a', '#d4af5a', '#e01b24', '#1f5aa6', '#f7d117', '#ffffff', '#3fa35a'];
    const parts = [];
    for (let i = 0; i < 180; i++) parts.push({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height, w: 6 + Math.random() * 8, h: 8 + Math.random() * 10, c: colors[i % colors.length], vy: 2 + Math.random() * 3, vx: (Math.random() - 0.5) * 2, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.2 });
    const start = performance.now();
    cancelAnimationFrame(confettiRaf);
    function frame(t) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (p.y > cv.height + 20) { p.y = -20; p.x = Math.random() * cv.width; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (t - start < 7000) confettiRaf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height);
    }
    confettiRaf = requestAnimationFrame(frame);
  }
  function stopConfetti() {
    cancelAnimationFrame(confettiRaf);
    const cv = $('#confetti'); if (cv.width) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  }

  // ------------------------------------------------------------ Animationen
  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }
  function seatEl(seat) { return $('#seats .seat[data-seat="' + seat + '"]'); }
  function cardWidth() { return parseFloat(getComputedStyle($('#pile')).width) || 70; }

  function fly(opts) {
    return new Promise(function (resolve) {
      const w = opts.width || cardWidth();
      const el = document.createElement('div');
      el.className = 'card flying ' + (opts.faceId !== undefined ? 'face' : 'back');
      el.style.width = w + 'px';
      el.style.left = (opts.from.x - w / 2) + 'px';
      el.style.top = (opts.from.y - w * 0.75) + 'px';
      el.innerHTML = opts.faceId !== undefined ? LJCards.face(opts.faceId) : LJCards.backEmblem();
      document.body.appendChild(el);
      const dx = opts.to.x - opts.from.x, dy = opts.to.y - opts.from.y;
      const anim = el.animate([
        { transform: 'translate(0,0) rotate(0deg) scale(' + (opts.fromScale || 1) + ')', opacity: 1 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (opts.rotate || 0) + 'deg) scale(' + (opts.toScale || 1) + ')', opacity: 1 },
      ], { duration: opts.duration || 500, delay: opts.delay || 0, easing: 'cubic-bezier(.3,.9,.3,1)', fill: 'forwards' });
      anim.onfinish = function () { el.remove(); resolve(); };
      anim.oncancel = function () { el.remove(); resolve(); };
    });
  }

  async function animatePlay(prev, seat, count) {
    const from = seatEl(seat), pile = $('#pile');
    if (!from || !pile) return;
    const a = centerOf(from), b = centerOf(pile);
    const ps = [];
    for (let i = 0; i < Math.min(count, 4); i++) ps.push(fly({ from: { x: a.x, y: a.y }, to: { x: b.x + i * 3, y: b.y + i * 2 }, delay: i * 90, duration: 520, rotate: (i - 1) * 9, fromScale: 0.4, toScale: 1 }));
    await Promise.all(ps);
  }

  async function animatePickup(prev, seat, count) {
    const pile = $('#pile');
    if (!pile) return;
    // Während der Aufdeck-Phase ist der Stapel ausgeblendet – dann von den aufgedeckten Karten aus starten
    const src = pile.getBoundingClientRect().width > 0 ? pile : ($('#reveal') || pile);
    const b = centerOf(src);
    let target;
    if (seat === prev.seat) { const h = $('#hand'); target = h ? centerOf(h) : b; }
    else { const s = seatEl(seat); if (!s) return; target = centerOf(s); }
    const n = Math.min(count, 8);
    const ps = [];
    for (let i = 0; i < n; i++) ps.push(fly({ from: { x: b.x, y: b.y }, to: { x: target.x, y: target.y }, delay: i * 45, duration: 550, rotate: (i % 2 ? 1 : -1) * 20, toScale: seat === prev.seat ? 1 : 0.4 }));
    $('#pile').innerHTML = '';
    $('#pile-count').classList.add('hidden');
    await Promise.all(ps);
  }

  async function animateDeal(v) {
    const hand = $('#hand'), pile = $('#pile');
    if (!hand || !pile) return;
    hand.classList.add('dealing');
    const from = centerOf(pile);
    const ps = [];
    const n = v.players.length;
    const total = v.players.reduce(function (a, p) { return a + p.count; }, 0);
    let k = 0;
    for (let i = 0; i < total; i++) {
      const seat = i % n;
      let target;
      if (seat === v.seat) target = centerOf(hand);
      else { const s = seatEl(seat); if (!s) continue; target = centerOf(s); }
      ps.push(fly({ from: { x: from.x, y: from.y }, to: { x: target.x + (seat === v.seat ? (i / n - v.hand.length / 2) * 14 : 0), y: target.y }, delay: k * 38, duration: 380, toScale: seat === v.seat ? 1 : 0.4, rotate: seat === v.seat ? 0 : 15 }));
      k++;
    }
    await Promise.all(ps);
    hand.classList.remove('dealing');
    hand.classList.add('dealt');
    setTimeout(function () { hand.classList.remove('dealt'); }, 900);
  }

  async function animateOwnPlay(ids) {
    const pile = $('#pile');
    if (!pile) return;
    const b = centerOf(pile);
    const ps = [];
    ids.forEach(function (id, i) {
      const el = $('#hand .card[data-id="' + id + '"]');
      if (!el) return;
      const a = centerOf(el);
      el.style.visibility = 'hidden';
      ps.push(fly({ from: { x: a.x, y: a.y }, to: { x: b.x + i * 3, y: b.y + i * 2 }, delay: i * 70, duration: 420, rotate: (i - 1) * 8, width: a.w }));
    });
    await Promise.all(ps);
  }

  // ------------------------------------------------------------ Toasts
  function toast(text, kind) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 2) box.removeChild(box.firstChild);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(function () { el.remove(); }, 400); }, kind === 'error' ? 4500 : 3000);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ------------------------------------------------------------ Aktionen
  function requireName(input) {
    const name = (input.value || '').trim();
    if (!name) { input.focus(); input.style.borderColor = '#e8404a'; toast('Bitte gib einen Namen ein.', 'error'); return null; }
    settings.name = name.slice(0, 16); saveSettings();
    return settings.name;
  }
  function startNet(firstMessage) {
    if (S.conn) S.conn.close();
    S.mode = 'net'; S.view = null; S.selected.clear();
    S.conn = new NetConnection(onMessage);
    S.conn.send(firstMessage);
    toast('Verbinde mit dem Server…');
  }
  function leaveToStart(msg, keepSession) {
    if (S.conn) { S.conn.close(); S.conn = null; }
    if (!keepSession) clearSession();
    S.mode = null; S.view = null; S.prevView = null; S.selected.clear(); S.claimRank = null;
    hideOverlay(); closeModals();
    showScreen('start');
    if (msg) toast(msg);
  }
  function sendAction(m) { if (S.conn) S.conn.send(m); }

  async function doPlay() {
    const v = S.view;
    if (!v || v.phase !== 'turn' || v.turn !== v.seat) return;
    const rank = v.roundRank || S.claimRank;
    const ids = Array.from(S.selected);
    if (!rank || ids.length < 1 || ids.length > LJ.MAX_PLAY) return;
    const btn = $('#btn-play'); if (btn) btn.disabled = true;
    if (settings.anim) await animateOwnPlay(ids);
    sendAction({ t: 'play', cards: ids, rank: rank });
  }

  // ------------------------------------------------------------ Modale
  function openModal(id) { $('#' + id).classList.remove('hidden'); }
  function closeModals() { $$('.modal').forEach(function (m) { m.classList.add('hidden'); }); }
  function renderPickers() {
    $$('[data-picker]').forEach(function (grid) {
      grid.innerHTML = LJ.AVATARS.map(function (a) { return '<button type="button" data-av="' + a + '" class="' + (a === settings.avatar ? 'on' : '') + '">' + a + '</button>'; }).join('');
    });
  }
  function segValue(id) { const b = $('#' + id + ' button.on'); return b ? parseInt(b.dataset.size, 10) : 4; }

  function wireUi() {
    // Startseite
    $('#btn-new').addEventListener('click', function () { $('#new-name').value = settings.name; renderPickers(); openModal('modal-new'); $('#new-name').focus(); });
    $('#btn-join').addEventListener('click', function () { $('#join-name').value = settings.name; renderPickers(); openModal('modal-join'); ($('#in-code').value ? $('#join-name') : $('#in-code')).focus(); });
    $('#btn-practice').addEventListener('click', function () { $('#practice-name').value = settings.name; openModal('modal-practice'); });
    $('#btn-rules').addEventListener('click', function () { openModal('modal-rules'); });
    $('#btn-rules-2').addEventListener('click', function () { openModal('modal-rules'); });
    $('#btn-settings').addEventListener('click', function () { $('#in-name').value = settings.name; $('#in-anim').checked = settings.anim; renderPickers(); openModal('modal-settings'); });
    $('#btn-settings-save').addEventListener('click', function () {
      settings.name = ($('#in-name').value || '').trim().slice(0, 16); settings.anim = $('#in-anim').checked; saveSettings(); closeModals();
    });
    $$('[data-close]').forEach(function (b) { b.addEventListener('click', closeModals); });
    $$('.modal').forEach(function (m) { m.addEventListener('click', function (e) { if (e.target === m) closeModals(); }); });
    document.addEventListener('click', function (e) {
      const av = e.target.closest('[data-av]');
      if (av) { settings.avatar = av.dataset.av; saveSettings(); renderPickers(); }
      const seg = e.target.closest('.segmented button');
      if (seg && seg.parentElement.id !== 'seg-size') { seg.parentElement.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); }); seg.classList.add('on'); }
    });
    $('#in-code').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
    $('#in-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#btn-join-go').click(); });
    $('#join-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#btn-join-go').click(); });
    $('#new-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#btn-new-go').click(); });

    $('#btn-new-go').addEventListener('click', function () {
      const name = requireName($('#new-name')); if (!name) return;
      closeModals();
      startNet({ t: 'create', name: name, avatar: settings.avatar, size: segValue('new-size') });
    });
    $('#btn-join-go').addEventListener('click', function () {
      const code = $('#in-code').value.trim().toUpperCase();
      if (code.length !== 4) { toast('Der Tisch-Code hat 4 Zeichen.', 'error'); $('#in-code').focus(); return; }
      const name = requireName($('#join-name')); if (!name) return;
      closeModals();
      startNet({ t: 'join', code: code, name: name, avatar: settings.avatar });
    });
    $('#btn-practice-go').addEventListener('click', function () {
      const name = requireName($('#practice-name')); if (!name) return;
      closeModals();
      if (S.conn) S.conn.close();
      S.mode = 'local'; S.view = null; S.selected.clear(); S.claimRank = null;
      S.conn = new LocalConnection(onMessage, segValue('practice-size'));
      S.conn.connect();
    });

    // Lobby
    $('#seg-size').addEventListener('click', function (e) { const b = e.target.closest('button'); if (b && !b.disabled) sendAction({ t: 'setSize', size: parseInt(b.dataset.size, 10) }); });
    $('#btn-start').addEventListener('click', function () { sendAction({ t: 'start' }); });
    $('#btn-leave-lobby').addEventListener('click', function () { sendAction({ t: 'leave' }); setTimeout(function () { if (S.mode) leaveToStart(); }, 600); });
    $('#lobby-players').addEventListener('click', function (e) { const k = e.target.closest('[data-kick]'); if (k) sendAction({ t: 'kick', seat: parseInt(k.dataset.kick, 10) }); });
    $('#btn-copy-code').addEventListener('click', function () { copyText(S.view ? S.view.code : '', 'Code kopiert.'); });
    $('#btn-share').addEventListener('click', function () {
      if (!S.view) return;
      const url = location.origin + location.pathname + '?tisch=' + S.view.code;
      if (navigator.share) navigator.share({ title: 'Lügerjass', text: 'Komm an meinen Lügerjass-Tisch! Code: ' + S.view.code, url: url }).catch(function () { /* abgebrochen */ });
      else copyText(url, 'Einladungslink kopiert.');
    });

    // Tisch
    $('#hand').addEventListener('click', function (e) {
      const c = e.target.closest('.card'); if (!c || c.classList.contains('disabled')) return;
      const id = parseInt(c.dataset.id, 10);
      if (S.selected.has(id)) S.selected.delete(id);
      else { if (S.selected.size >= LJ.MAX_PLAY) { toast('Höchstens 4 Karten pro Ablage.'); return; } S.selected.add(id); }
      c.classList.toggle('selected', S.selected.has(id));
      renderActions(S.view);
    });
    $('#actions').addEventListener('click', function (e) {
      const chip = e.target.closest('.chip[data-rank]');
      if (chip) { S.claimRank = chip.dataset.rank; renderActions(S.view); return; }
      if (e.target.closest('#btn-play')) { doPlay(); return; }
      if (e.target.closest('#btn-liar')) { sendAction({ t: 'challenge' }); $('#btn-liar').disabled = true; $('#btn-believe').disabled = true; return; }
      if (e.target.closest('#btn-believe')) { sendAction({ t: 'believe' }); $('#btn-liar').disabled = true; $('#btn-believe').disabled = true; return; }
    });
    $('#overlay').addEventListener('click', function (e) {
      if (e.target.closest('#ov-newgame')) sendAction({ t: 'newGame' });
      if (e.target.closest('#ov-lobby')) sendAction({ t: 'abort' });
    });
    $('#btn-log-toggle').addEventListener('click', function () { S.logOpen = !S.logOpen; $('#log').classList.toggle('hidden', !S.logOpen); });
    $('#btn-menu').addEventListener('click', function () {
      const v = S.view; if (!v) return;
      const isHost = S.mode === 'local' || v.seat === v.hostSeat || (v.players[v.hostSeat] && !v.players[v.hostSeat].connected);
      $('#btn-menu-newgame').classList.toggle('hidden', !(isHost && v.phase === 'over'));
      $('#btn-menu-abort').classList.toggle('hidden', !isHost);
      $('#btn-menu-abort').textContent = S.mode === 'local' ? 'Übung beenden' : 'Partie abbrechen – zurück in die Lobby';
      $('#menu-hint').textContent = isHost ? '' : 'Nur der Host kann die Partie abbrechen oder neu starten.';
      openModal('modal-menu');
    });
    $('#btn-menu-newgame').addEventListener('click', function () { closeModals(); sendAction({ t: 'newGame' }); });
    $('#btn-menu-abort').addEventListener('click', function () { closeModals(); sendAction({ t: 'abort' }); });
    $('#btn-menu-leave').addEventListener('click', function () {
      closeModals();
      if (S.mode === 'net' && S.view && S.view.phase !== 'lobby' && !confirm('Wirklich den Tisch verlassen? Dein Platz bleibt frei, falls du zurückkommst.')) return;
      sendAction({ t: 'leave' });
      setTimeout(function () { if (S.mode) leaveToStart(); }, 600);
    });
    window.addEventListener('resize', function () { if (S.view && S.view.phase !== 'lobby') renderSeats(S.view); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModals(); });
  }

  function copyText(text, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(msg); }, function () { prompt('Kopieren:', text); });
    else prompt('Kopieren:', text);
  }

  // ------------------------------------------------------------ Start
  function decorateStart() {
    const box = $('#start-cards');
    const spots = [[6, 14, -18, 17], [84, 10, 14, 4], [2, 68, 12, 26], [88, 70, -10, 31], [72, 84, 22, 13], [14, 86, -24, 35]];
    box.innerHTML = spots.map(function (s) {
      return '<div class="card face" style="left:' + s[0] + '%; top:' + s[1] + '%; transform: rotate(' + s[2] + 'deg)">' + LJCards.face(s[3]) + '</div>';
    }).join('');
  }

  function init() {
    applySettings();
    decorateStart();
    renderPickers();
    wireUi();
    if (window.LJ_PREVIEW) {
      // Vorschau ohne Server: nur Üben gegen Bots
      $('#btn-new').classList.add('hidden'); $('#btn-join').classList.add('hidden');
      $('#btn-practice').classList.remove('btn-outline'); $('#btn-practice').classList.add('btn-gold', 'btn-big');
      const note = document.createElement('p'); note.className = 'muted'; note.style.textAlign = 'center'; note.style.margin = '0';
      note.textContent = 'Vorschau: Mehrspieler-Tische gibt es erst auf dem eigenen Server (siehe Anleitung).';
      $('#start-foot').parentElement.insertBefore(note, $('#start-foot'));
    }
    const params = new URLSearchParams(location.search);
    const code = (params.get('tisch') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const sess = load(LS_SESSION);
    if (sess.code && sess.token && !code) {
      // Nach einem Neuladen: automatisch zurück an den Tisch
      S.mode = 'net'; S.conn = new NetConnection(onMessage); S.conn.connect();
      toast('Verbinde wieder mit Tisch ' + sess.code + '…');
    } else if (code) {
      history.replaceState(null, '', location.pathname);
      $('#in-code').value = code; $('#join-name').value = settings.name; renderPickers();
      openModal('modal-join');
      $('#join-name').focus();
    }
  }
  init();
  if (FAST) window.__ljDebug = { setView: function (v) { S.view = v; render(); }, getView: function () { return S.view; }, stop: function () { if (S.conn) S.conn.close(); } };
})();
