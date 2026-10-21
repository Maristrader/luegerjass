/*
 * Lügerjass – Kartengrafik
 * Deutschschweizer Jasskarten (Eichel, Rosen, Schellen, Schilten) als eigene Vektorzeichnung
 * im klassischen Stil: Pips, doppelköpfige Figuren mit Lanze, Banner mit gekreuzten Fahnen, Daus mit Schriftrolle.
 * LJCards.face(id) liefert das SVG einer Kartenvorderseite, LJCards.backEmblem() das Emblem der Rückseite.
 */
(function (root) {
  'use strict';
  const SUIT_OF = ['eichel', 'rosen', 'schellen', 'schilten'];
  const RANK_OF = ['6', '7', '8', '9', 'banner', 'under', 'ober', 'koenig', 'ass'];
  const INDEX = { '6': '6', '7': '7', '8': '8', '9': '9', banner: '10', under: 'UNDER', ober: 'OBER', koenig: 'KÖNIG', ass: 'A' };
  const NAMES = { eichel: 'Eichel', rosen: 'Rosen', schellen: 'Schellen', schilten: 'Schilten', '6': 'Sechs', '7': 'Sieben', '8': 'Acht', '9': 'Neun', banner: 'Banner', under: 'Under', ober: 'Ober', koenig: 'König', ass: 'Ass' };

  const C = { black: '#161616', red: '#e01b24', blue: '#1f5aa6', yellow: '#f7d117', green: '#2f8f3a', skin: '#f3d2ae', white: '#ffffff' };
  let uidCounter = 0;

  function pol(r, deg) { const a = deg * Math.PI / 180; return [+(r * Math.cos(a)).toFixed(2), +(r * Math.sin(a)).toFixed(2)]; }
  function hatchPattern(uid, angle, gap, color, width) {
    return '<pattern id="h' + uid + '" width="' + gap + '" height="' + gap + '" patternUnits="userSpaceOnUse" patternTransform="rotate(' + angle + ')">' +
      '<line x1="0" y1="0" x2="0" y2="' + gap + '" stroke="' + (color || C.black) + '" stroke-width="' + (width || 1) + '"/></pattern>';
  }

  // ------------------------------------------------------------ Symbole
  // Jedes Symbol wird in einem Quadrat von -50..50 gezeichnet (Mittelpunkt 0/0).
  // uid: eindeutiger Suffix für clipPath/pattern-IDs, v: Varianten-Nummer (für Schilten-Muster)
  const SHIELD = 'M-27,-36 H27 V8 C27,24 14,34 0,40 C-14,34 -27,24 -27,8 Z';
  const SHIELD_PATTERNS = [
    function () { let s = ''; for (let y = -30; y <= 20; y += 12) s += '<rect x="-27" y="' + y + '" width="54" height="6" fill="' + C.black + '"/>'; return s; },
    function () { return '<rect x="-27" y="-36" width="54" height="22" fill="' + C.black + '"/><circle cx="0" cy="18" r="6" fill="' + C.black + '"/>'; },
    function () { let s = ''; for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2 === 0) s += '<rect x="' + (-27 + i * 13.5) + '" y="' + (-36 + j * 12.7) + '" width="13.5" height="12.7" fill="' + C.black + '"/>'; return s; },
    function () { return '<rect x="-7" y="-36" width="14" height="76" fill="' + C.black + '"/><rect x="-27" y="-8" width="54" height="14" fill="' + C.black + '"/>'; },
    function () { let s = ''; for (let x = -16; x <= 16; x += 16) for (let y = -24; y <= 24; y += 16) s += '<circle cx="' + x + '" cy="' + y + '" r="4.2" fill="' + C.black + '"/>'; return s; },
    function () { return '<path d="M-27,-8 L0,-30 L27,-8 L27,6 L0,-16 L-27,6 Z" fill="' + C.black + '"/><path d="M-27,16 L0,-6 L27,16 L27,30 L0,8 L-27,30 Z" fill="' + C.black + '"/>'; },
    function () { let s = ''; for (let x = -24; x <= 18; x += 12) s += '<rect x="' + x + '" y="-36" width="6" height="76" fill="' + C.black + '"/>'; return s; },
    function () { return '<path d="M-27,-36 L-8,-36 L27,14 L27,38 Z" fill="' + C.black + '"/>'; },
    function () { let s = '<polygon points="'; for (let i = 0; i < 12; i++) { const p = pol(i % 2 ? 9 : 20, -90 + i * 30); s += p[0] + ',' + (p[1] + 2) + ' '; } return s + '" fill="' + C.black + '"/>'; },
    function (uid) { return '<rect x="-27" y="-36" width="54" height="76" fill="url(#h' + uid + ')"/>'; },
    function () { return '<circle cx="0" cy="0" r="14" fill="none" stroke="' + C.black + '" stroke-width="7"/><rect x="-27" y="24" width="54" height="16" fill="' + C.black + '"/>'; },
    function () { return '<path d="M-27,-36 H27 V-22 H-27 Z M-27,-8 H27 V6 H-27 Z M-27,20 H27 V34 H-27 Z" fill="' + C.black + '"/><rect x="-5" y="-36" width="10" height="76" fill="' + C.white + '"/>'; },
  ];

  const SYMBOL = {
    schellen: function (uid) {
      return '<defs>' + hatchPattern(uid, 45, 4, C.black, 0.9) + '</defs>' +
        '<circle cx="0" cy="-37" r="7" fill="none" stroke="' + C.black + '" stroke-width="8"/>' +
        '<circle cx="0" cy="-37" r="7" fill="none" stroke="' + C.red + '" stroke-width="4.5"/>' +
        '<circle cx="0" cy="6" r="34" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="2.5"/>' +
        '<path d="M12,-24 A34,34 0 0 1 14,36 A22,22 0 0 0 12,-24 Z" fill="url(#h' + uid + ')" opacity=".55"/>' +
        '<path d="M-28.8,-12 Q0,-4 28.8,-12 L33.5,0 Q0,8 -33.5,0 Z" fill="' + C.black + '"/>' +
        '<path d="M-31,-6 Q0,2 31,-6" stroke="' + C.red + '" stroke-width="3.2" fill="none"/>' +
        '<circle cx="9" cy="19" r="4" fill="' + C.black + '"/>' +
        '<path d="M-20,-20 C-22,-16 -22,-14 -21,-12" stroke="' + C.white + '" stroke-width="3" stroke-linecap="round" fill="none" opacity=".8"/>';
    },
    schilten: function (uid, v) {
      const pat = SHIELD_PATTERNS[(v || 0) % SHIELD_PATTERNS.length](uid);
      return '<defs><clipPath id="c' + uid + '"><path d="' + SHIELD + '"/></clipPath>' + hatchPattern(uid, 45, 5, C.black, 1.4) + '</defs>' +
        '<path d="' + SHIELD + '" fill="' + C.white + '"/>' +
        '<g clip-path="url(#c' + uid + ')">' + pat + '</g>' +
        '<path d="' + SHIELD + '" fill="none" stroke="' + C.black + '" stroke-width="2.8" stroke-linejoin="round"/>';
    },
    rosen: function () {
      let s = '';
      [-54, 18, 90, 162, 234].forEach(function (d) { const p = pol(31, d); const q = pol(12, d); s += '<path d="M' + (q[0] + 8 * Math.cos((d + 90) * Math.PI / 180)).toFixed(1) + ',' + (q[1] + 8 * Math.sin((d + 90) * Math.PI / 180)).toFixed(1) + ' L' + p[0] + ',' + p[1] + ' L' + (q[0] - 8 * Math.cos((d + 90) * Math.PI / 180)).toFixed(1) + ',' + (q[1] - 8 * Math.sin((d + 90) * Math.PI / 180)).toFixed(1) + ' Z" fill="' + C.green + '" stroke="' + C.black + '" stroke-width="1.8" stroke-linejoin="round"/>'; });
      [-90, -18, 54, 126, 198].forEach(function (d) { const p = pol(19, d); s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="17" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="2.2"/>'; });
      s += '<circle cx="0" cy="0" r="15" fill="' + C.red + '" stroke="' + C.black + '" stroke-width="2"/>';
      [-90, -18, 54, 126, 198].forEach(function (d) { const p = pol(8.5, d); s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="' + C.yellow + '"/>'; });
      s += '<circle cx="0" cy="0" r="4" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="1"/>';
      return s;
    },
    eichel: function (uid) {
      const cap = 'M-30,-4 C-30,-26 -16,-38 0,-38 C16,-38 30,-26 30,-4 Z';
      return '<defs><clipPath id="c' + uid + '"><path d="' + cap + '"/></clipPath>' + hatchPattern(uid, 45, 5, C.black, 1.2) + hatchPattern(uid + 'b', -45, 5, C.black, 1.2) + '</defs>' +
        '<path d="M1,-48 C5,-44 5,-40 1,-36" stroke="' + C.black + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
        '<path d="M-24,-6 H24 C24,14 18,32 0,44 C-18,32 -24,14 -24,-6 Z" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<path d="M8,-6 C14,10 12,26 2,40 C16,30 22,14 22,-6 Z" fill="url(#h' + uid + ')" opacity=".5"/>' +
        '<path d="' + cap + '" fill="' + C.green + '" stroke="' + C.black + '" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<g clip-path="url(#c' + uid + ')"><path d="' + cap + '" fill="url(#h' + uid + ')"/><path d="' + cap + '" fill="url(#h' + uid + 'b)"/></g>' +
        '<path d="M-30,-4 H30" stroke="' + C.black + '" stroke-width="2.5"/>';
    },
  };

  function symbol(suit, x, y, size, uid, v, rot) {
    const s = size / 100;
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')' + (rot ? ' rotate(' + rot + ')' : '') + '">' + SYMBOL[suit](uid, v) + '</g>';
  }

  // ------------------------------------------------------------ Karten
  const PIPS = {
    '6': [[64, 78], [136, 78], [64, 150], [136, 150], [64, 222], [136, 222]],
    '7': [[64, 76], [136, 76], [100, 150], [64, 150], [136, 150], [64, 224], [136, 224]],
    '8': [[62, 70], [138, 70], [62, 124], [138, 124], [62, 176], [138, 176], [62, 230], [138, 230]],
    '9': [[58, 74], [142, 74], [100, 98], [58, 150], [142, 150], [100, 150], [58, 226], [142, 226], [100, 202]],
  };

  function lance(uid, tip) {
    return '<path d="M26,274 L174,26" stroke="' + C.black + '" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M26,274 L174,26" stroke="' + C.yellow + '" stroke-width="1.8" stroke-linecap="round"/>' +
      (tip ? '<path d="M174,26 L160,30 L170,40 Z" fill="' + C.black + '"/>' : '');
  }

  // Eine Figur (aufrecht, oben links), wird später gespiegelt
  function figureBody(suit, rank, uid) {
    let s = '';
    // Rumpf: roter Rock mit blauem Mittelteil, gelbe Borten und Knöpfe
    s += '<path d="M46,116 L126,116 L140,210 L26,250 Z" fill="' + C.red + '" stroke="' + C.black + '" stroke-width="2.2" stroke-linejoin="round"/>';
    s += '<path d="M46,116 L126,116 L140,210 L26,250 Z" fill="url(#h' + uid + 'f)" opacity=".22"/>';
    s += '<path d="M30,240 L78,160" stroke="' + C.yellow + '" stroke-width="7"/><path d="M30,240 L78,160" stroke="' + C.black + '" stroke-width="1.4"/>';
    s += '<path d="M34,246 L82,166 M26,234 L74,154" stroke="' + C.black + '" stroke-width="1"/>';
    [[50, 150], [44, 186], [58, 210], [40, 222]].forEach(function (p) { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.4" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="1"/>'; });
    s += '<path d="M76,112 L100,112 L106,214 L70,220 Z" fill="' + C.blue + '" stroke="' + C.black + '" stroke-width="2" stroke-linejoin="round"/>';
    s += '<path d="M76,112 L100,112 L106,214 L70,220 Z" fill="url(#h' + uid + 'f)" opacity=".5"/>';
    [[88, 130], [89, 148], [90, 166], [91, 184], [92, 202]].forEach(function (p) { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="1"/>'; });
    s += '<path d="M46,116 L86,106 L126,116" fill="none" stroke="' + C.yellow + '" stroke-width="7"/>';
    s += '<path d="M46,116 L86,106 L126,116" fill="none" stroke="' + C.black + '" stroke-width="1.8"/>';
    // Linker Arm (gelb), hält das Symbol hoch
    s += '<path d="M54,120 C40,118 34,110 38,98" stroke="' + C.black + '" stroke-width="19" stroke-linecap="round" fill="none"/>';
    s += '<path d="M54,120 C40,118 34,110 38,98" stroke="' + C.yellow + '" stroke-width="14" stroke-linecap="round" fill="none"/>';
    s += '<path d="M44,116 C40,110 38,106 40,100" stroke="' + C.black + '" stroke-width="1.2" fill="none"/>';
    s += '<circle cx="40" cy="96" r="7" fill="' + C.skin + '" stroke="' + C.black + '" stroke-width="2"/>';
    // Hals und Kopf
    s += '<rect x="78" y="98" width="16" height="14" fill="' + C.skin + '" stroke="' + C.black + '" stroke-width="2"/>';
    s += '<circle cx="86" cy="82" r="20" fill="' + C.skin + '" stroke="' + C.black + '" stroke-width="2.2"/>';
    s += '<path d="M70,76 C70,60 102,60 102,76 C98,70 74,70 70,76 Z" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="1.8"/>'; // Haar
    s += '<circle cx="79" cy="82" r="1.9" fill="' + C.black + '"/><circle cx="92" cy="82" r="1.9" fill="' + C.black + '"/>';
    s += '<path d="M75,77 l7,-2 M89,75 l7,2" stroke="' + C.black + '" stroke-width="1.6" stroke-linecap="round"/>';
    s += '<path d="M86,80 l3,8 l-4,1" stroke="' + C.black + '" stroke-width="1.4" fill="none" stroke-linecap="round"/>';
    s += '<path d="M80,93 Q86,97 92,93" stroke="' + C.black + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
    if (rank === 'koenig') {
      s += '<path d="M68,90 C70,112 102,112 104,90 C98,104 74,104 68,90 Z" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="1.8"/>'; // Bart
      s += '<path d="M64,68 L68,42 L77,56 L86,36 L95,56 L104,42 L108,68 Z" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="2" stroke-linejoin="round"/>';
      s += '<rect x="64" y="62" width="44" height="8" fill="' + C.red + '" stroke="' + C.black + '" stroke-width="1.8"/>';
      s += '<circle cx="68" cy="44" r="3" fill="' + C.red + '" stroke="' + C.black + '" stroke-width="1"/><circle cx="86" cy="38" r="3" fill="' + C.blue + '" stroke="' + C.black + '" stroke-width="1"/><circle cx="104" cy="44" r="3" fill="' + C.red + '" stroke="' + C.black + '" stroke-width="1"/>';
    } else if (rank === 'ober') {
      s += '<path d="M62,66 C66,44 106,44 110,66 Z" fill="' + C.red + '" stroke="' + C.black + '" stroke-width="2"/>';
      s += '<path d="M62,66 C66,44 106,44 110,66 Z" fill="url(#h' + uid + 'f)" opacity=".45"/>';
      s += '<ellipse cx="86" cy="67" rx="28" ry="7" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="2"/>';
      s += '<path d="M104,52 C112,40 124,36 132,40 C122,44 114,50 108,60" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="1.6"/>';
    } else {
      s += '<path d="M64,68 C66,52 76,40 92,36 C106,32 118,40 122,50 C112,46 104,48 100,56 C96,62 100,66 108,68 Z" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="2" stroke-linejoin="round"/>';
      s += '<path d="M64,68 C66,52 76,40 92,36 C106,32 118,40 122,50 C112,46 104,48 100,56 C96,62 100,66 108,68 Z" fill="url(#h' + uid + 'f)" opacity=".35"/>';
      s += '<circle cx="122" cy="50" r="5" fill="' + C.red + '" stroke="' + C.black + '" stroke-width="1.6"/>';
      s += '<path d="M64,68 Q86,74 108,68" stroke="' + C.red + '" stroke-width="4"/>';
    }
    // Symbol in der linken Hand
    s += symbol(suit, 44, 68, 36, uid + 's', 3);
    return s;
  }

  function figure(suit, rank, uid) {
    const A = '0,0 190,0 10,300 0,300';
    const B = '190,0 200,0 200,300 10,300';
    return '<defs><clipPath id="a' + uid + '"><polygon points="' + A + '"/></clipPath><clipPath id="b' + uid + '"><polygon points="' + B + '"/></clipPath>' + hatchPattern(uid + 'f', 45, 5, C.black, 1) + '</defs>' +
      '<g clip-path="url(#a' + uid + ')">' + figureBody(suit, rank, uid + 'u') + '</g>' +
      '<g clip-path="url(#b' + uid + ')"><g transform="rotate(180 100 150)">' + figureBody(suit, rank, uid + 'd') + '</g></g>' +
      lance(uid, rank === 'under');
  }

  function banner(suit, uid) {
    return '<defs>' + hatchPattern(uid + 'f', 45, 5, C.black, 1) + '</defs>' +
      '<ellipse cx="100" cy="150" rx="64" ry="112" fill="none" stroke="' + C.black + '" stroke-width="1.8"/>' +
      '<path d="M140,86 C108,98 88,118 68,140 C48,164 50,192 54,222 L82,224 C72,196 80,170 98,150 C116,130 130,116 152,108 Z" fill="' + C.blue + '" stroke="' + C.black + '" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M140,86 C108,98 88,118 68,140 C48,164 50,192 54,222 L82,224 C72,196 80,170 98,150 C116,130 130,116 152,108 Z" fill="url(#h' + uid + 'f)" opacity=".4"/>' +
      '<path d="M60,86 C92,98 112,118 132,140 C152,164 150,192 146,222 L118,224 C128,196 120,170 102,150 C84,130 70,116 48,108 Z" fill="' + C.red + '" stroke="' + C.black + '" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M66,100 C94,112 112,130 128,152 C140,170 140,196 136,216" stroke="' + C.white + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<path d="M134,100 C106,112 88,130 72,152 C60,170 60,196 64,216" stroke="' + C.white + '" stroke-width="4" fill="none" stroke-linecap="round" opacity=".9"/>' +
      '<path d="M66,100 C94,112 112,130 128,152 C140,170 140,196 136,216 M134,100 C106,112 88,130 72,152 C60,170 60,196 64,216" stroke="' + C.black + '" stroke-width="1" fill="none" stroke-dasharray="3 3"/>' +
      lance(uid, true) +
      symbol(suit, 64, 62, 38, uid + 'p', 4) +
      symbol(suit, 136, 238, 38, uid + 'q', 6, 180);
  }

  function daus(suit, uid) {
    return symbol(suit, 100, 94, 96, uid + 'p', 2) +
      symbol(suit, 100, 206, 96, uid + 'q', 7, 180) +
      '<path d="M40,140 L160,140 L168,150 L160,160 L40,160 L48,150 Z" fill="' + C.yellow + '" stroke="' + C.black + '" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M40,140 L32,134 L32,154 L40,160 M160,140 L168,134 L168,154 L160,160" fill="' + C.red + '" stroke="' + C.black + '" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<text x="100" y="155" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="700" font-size="12" letter-spacing="2" fill="' + C.black + '">LÜGERJASS</text>';
  }

  function face(id) {
    const suit = SUIT_OF[Math.floor(id / 9)];
    const rank = RANK_OF[id % 9];
    const uid = 'k' + id + 'x' + (uidCounter++).toString(36);
    let body = '';
    if (PIPS[rank]) {
      const size = rank === '9' ? 40 : 46;
      PIPS[rank].forEach(function (p, i) { body += symbol(suit, p[0], p[1], size, uid + 'p' + i, id + i, p[1] > 150 ? 180 : 0); });
    } else if (rank === 'banner') body = banner(suit, uid);
    else if (rank === 'ass') body = daus(suit, uid);
    else body = figure(suit, rank, uid);
    const idx = INDEX[rank];
    const isWord = idx.length > 2;
    const corner = function (x, y, rot) {
      return '<text x="' + x + '" y="' + y + '" ' + (rot ? 'transform="rotate(180 ' + x + ' ' + y + ')" ' : '') +
        'text-anchor="start" font-family="Cinzel, Georgia, serif" font-weight="700" font-size="' + (isWord ? 13 : 24) + '" letter-spacing="' + (isWord ? 1 : 0) + '" fill="' + C.black + '">' + idx + '</text>';
    };
    return '<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + NAMES[suit] + ' ' + NAMES[rank] + '">' +
      '<rect x="3" y="3" width="194" height="294" rx="13" fill="' + C.white + '" stroke="' + C.black + '" stroke-width="2.6"/>' +
      body +
      corner(16, isWord ? 27 : 32, false) + corner(184, isWord ? 273 : 268, true) +
      '</svg>';
  }

  function backEmblem() {
    return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="40" fill="#143d27" stroke="#d4af5a" stroke-width="2.5"/>' +
      '<circle cx="50" cy="50" r="33" fill="none" stroke="#d4af5a" stroke-width="1" opacity=".7"/>' +
      '<text x="50" y="59" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="700" font-size="26" fill="#e8c35a">LJ</text>' +
      '</svg>';
  }

  root.LJCards = { face: face, backEmblem: backEmblem, NAMES: NAMES, INDEX: INDEX };
})(typeof self !== 'undefined' ? self : this);
