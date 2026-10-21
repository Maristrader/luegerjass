# Lügerjass – online spielen mit Kollegen

Das Schweizer Bluff-Kartenspiel mit den 36 Deutschschweizer Jasskarten, für 4 bis 6 Spieler an einem gemeinsamen Tisch. Jeder spielt auf dem eigenen Handy oder Computer, sieht nur seine eigenen Karten, und alle sind live verbunden. Die Mitspieler brauchen **nur den Link und den Tisch-Code** – kein Konto, keine App.

## Was drin ist

| Datei / Ordner        | Zweck                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| `server.js`           | Der Server: liefert die Spielseite aus und verwaltet die Tische per WebSocket. Alle Karten bleiben hier – niemand kann fremde Karten sehen oder manipulieren. |
| `shared/engine.js`    | Die kompletten Spielregeln (läuft im Server und im Übungsmodus im Browser).             |
| `public/`             | Die Spielseite: `index.html`, `style.css`, `app.js`, `cards.js` (die gezeichneten Karten). |
| `test/`               | Automatische Tests: `node test/sim.test.js` (1200 Bot-Partien), `node test/server.test.js`. |
| `render.yaml`         | Fertige Konfiguration für den Gratis-Hoster Render.                                     |
| `Dockerfile`          | Für Hoster, die Docker-Images ausführen (Fly.io, Koyeb, eigener Server …).              |

## Spielregeln (wie eingebaut)

- 36 Karten: Eichel, Rosen, Schellen, Schilten – je 6, 7, 8, 9, Banner (10), Under, Ober, König, Ass. Alle gegen alle, 4 bis 6 Spieler, alle Karten werden möglichst gleichmässig verteilt.
- Wer am Zug ist, legt 1–4 Karten verdeckt ab und sagt einen Wert an («zwei Könige»). Lügen ist erlaubt. In einer laufenden Runde sagen alle denselben Wert an, nur die Anzahl darf anders sein.
- **Asse dürfen nie angesagt werden** – sie kann man nur als etwas anderes ausgeben.
- **Feste Reihenfolge:** Nur der direkt nächste Spieler entscheidet: **Glauben** (dann legt er selbst ab) oder **«Lügner!»**. Dann werden nur die zuletzt abgelegten Karten aufgedeckt. Der Verlierer nimmt **den ganzen Stapel** auf; danach beginnt der Spieler, der entschieden hat, eine neue Runde mit freier Ansage.
- **Vier Asse auf der Hand = sofort verloren** (nach dem Austeilen oder nach einer Aufnahme). Danach startet automatisch eine neue Partie mit denselben Spielern.
- Wer seine letzte Karte ablegt, hat erst gewonnen, wenn der nächste Spieler geglaubt (oder zu Unrecht «Lügner!» gerufen) hat.

## Lokal ausprobieren (auf dem eigenen Computer)

1. [Node.js](https://nodejs.org) installieren (Version 18 oder neuer).
2. Im Projektordner ein Terminal öffnen und ausführen:
   ```
   npm install
   npm start
   ```
3. `http://localhost:3000` im Browser öffnen. Andere Geräte im gleichen WLAN erreichen das Spiel über `http://<IP-deines-Computers>:3000`.

Zum Üben gibt es auf der Startseite «Üben gegen Bots» – das läuft komplett im Browser.

## Ins Internet stellen – gratis mit Render

Die Kollegen brauchen keinen Claude-Login, nur den Link. Der Server muss aber irgendwo laufen. Render bietet dafür einen Gratis-Tarif ohne Kreditkarte.

1. Ein Konto auf [github.com](https://github.com) anlegen (falls noch keins da ist) und ein neues Repository erstellen, z. B. `luegerjass`.
2. Den Inhalt dieses Ordners ins Repository hochladen (auf GitHub: «Add file > Upload files», alles ausser `node_modules` reinziehen – oder mit Git: `git init`, `git add .`, `git commit -m "Lügerjass"`, `git push`).
3. Auf [render.com](https://render.com) mit dem GitHub-Konto anmelden.
4. «New +» → «Blueprint» → das Repository `luegerjass` auswählen → «Apply». Render liest die `render.yaml` und richtet alles selbst ein (Build `npm install`, Start `npm start`, Tarif Free).
   Alternativ «New +» → «Web Service», Repository wählen, Runtime «Node», Build Command `npm install`, Start Command `npm start`, Instance Type «Free».
5. Nach 1–2 Minuten zeigt Render eine Adresse wie `https://luegerjass.onrender.com`. Diesen Link an die Kollegen schicken – fertig.

Gut zu wissen zum Gratis-Tarif:

- Nach 15 Minuten ohne Aktivität schläft der Server ein. Der erste Aufruf danach dauert dann rund eine Minute (die Seite lädt einfach etwas länger). Während ihr spielt, bleibt er wach.
- Es gibt 750 Gratis-Stunden pro Monat – für Spielabende mehr als genug.
- Mit einem bezahlten Tarif (ein paar Dollar im Monat) entfällt das Einschlafen.

Andere Hoster funktionieren genauso, solange sie Node.js laufen lassen (Railway, Fly.io, Koyeb, ein eigener Server …): `npm install`, `npm start`, Port aus der Umgebungsvariable `PORT`. Für Docker-Hoster liegt ein `Dockerfile` bei.

## So läuft ein Spielabend

1. Einer öffnet den Link, trägt Name und Avatar ein und klickt «Neues Spiel starten» (4, 5 oder 6 Spieler wählen). Er ist der Host.
2. Die anderen öffnen den Link, klicken «Tisch beitreten» und geben den 4-stelligen Tisch-Code ein. Noch einfacher: Der Host teilt den Einladungslink (`…/?tisch=CODE`), dann ist der Code schon eingetragen.
3. Sobald alle sitzen, startet der Host die Partie.
4. Wer die Seite neu lädt oder kurz die Verbindung verliert, kommt automatisch wieder an seinen Platz zurück (Tisch-Code und Platz werden im Browser gespeichert).
5. Der Host kann im Menü eine neue Partie starten, die Partie abbrechen (zurück in die Lobby) oder Spieler in der Lobby entfernen.

## Anpassen

- Aufdeck-Dauer und Wartezeit bis zur neuen Partie: `DEFAULT_SETTINGS` in `shared/engine.js` (`revealSeconds`, `restartSeconds`).
- Bot-Namen im Übungsmodus: `BOT_NAMES` in `public/app.js`. Avatare: `AVATARS` in `shared/engine.js`.
- Farben und Grössen: die Variablen am Anfang von `public/style.css`.
- Kartengrafik: `public/cards.js` (reine SVG-Zeichnung, keine Bilddateien).

## Tests

```
npm test
```

Spielt 1200 simulierte Bot-Partien mit 4, 5 und 6 Spielern durch (Kartenbestand, Ass-Verbot, Vier-Asse-Regel, Gewinnerkennung) und prüft den Server über echte WebSocket-Verbindungen inklusive Neuverbinden.
