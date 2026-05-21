# Circle Game

A Misère-Nim strategy game where the player who takes the **last circle loses**. Learn the patterns, master the modes, and climb the leaderboard.

## How to Play

- Select one or more **contiguous circles** from a single row
- Click **Submit Move** (or press Enter)
- The player forced to take the last circle **loses**

## Features

- **3 AI difficulties** — Easy, Medium, Hard
- **8 built-in maps** — Classic, Diamond, Short, Spread, Chaos, Bridges, Hexagonal, Gigantic
- **Custom map editor** — Design your own boards (unlocked at 5+ wins, doesn't count for leaderboard)
- **6 unlockable game modes** — Doubles, Dice, Armour, Portals, Sand, Cascade (combine them!)
- **Puzzle mode** — Solve Nim positions to find the winning move (unlocked at 5+ wins)
- **2 Players on one device** — All modes available
- **Online multiplayer** — Create/join games with a 3-digit code
- **Achievements** — 20+ achievements including hidden and hard mode challenges
- **Leaderboard themes** — Hold #1, #2, or #3 on any board to unlock exclusive colour schemes
- **Theme codes** — Customise your background with unlockable colour themes
- **Tutorial** — Interactive lessons for every game mode

## Running the Server

Visit **circle-game.win** to play online! You can host this locally through UV as well.

```
pip install uv
pip install aiohttp
```

Then run using:

```
uv sync
uv run main.py
```
Then visit it on your local network at:
http://localhost:5000

You cannot play with anyone outside of your local network this way.

## Project Structure

```
├── index.html              # Game UI (HTML + CSS)
├── game.js                 # Client-side game logic
├── server.py               # Python aiohttp server (WebSocket + REST API)
├── main.py                 # Entry point
├── themes.json             # Theme definitions
├── scoreboard.json         # Player data (gitignored)
├── scoreboard.template.json # Clean scoreboard template
└── pyproject.toml          # Python project config
```

## Secret Codes
Theme codes ask VIP for colour codes, or earn them through achievements

## Credits

- **Game Design** — VIP
- **Development** — VIP & Kiro
- **Art & UI** — VIP
- **Testing** — Jup1t3r, SJ, Lil MissZ, L0n3W01f, Alex, Matthew, Levi, Wade, Nick, Lilly, Lila, Joseph.
