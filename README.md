# Circle Game

This was a game my uncle taught me on a cruise ship. I was flummoxed at the fact he could win every time, but would never say how. I played lots of games, and found the patterns and shapes that make this game beautiful. I hope you can enjoy it, too! Just be aware, you will lose if you play against me. ;)

## Game Rules

- Players take turns removing one or more **contiguous** circles from a **single row**
- You can remove circles from rows 1-5
- **The player who takes the last circle loses** (this is a misère game!)
- The computer uses Grundy numbers (nim-sum) to play strategically

## How to Play Online

The game is available as a web version! Open `index.html` in your browser.

### Features
- 🎮 Play against the computer with 3 difficulty levels:
  - **Easy**: Computer makes random moves
  - **Medium**: Computer plays optimally 60% of the time
  - **Hard**: Computer always plays optimally
- 🎯 Choose turn order: You first, Computer first, or Random
- 🧮 Computer uses Grundy number calculations for perfect play
- 🎨 Beautiful interactive UI

## Enable GitHub Pages

To host this game online at `username.github.io/Circle_Game`:

1. Go to your repository on GitHub
2. Click **Settings** (gear icon)
3. Scroll to **Pages** section on the left sidebar
4. Under "Source", select the branch: **main**
5. Click **Save**
6. Wait a few minutes, then visit: `https://username.github.io/Circle_Game`

Your game will be live! Share the link and play online.

## Versions

### Web Version (Recommended)
- **File**: `index.html`, `game.js`
- **How to run**: Open `index.html` in any modern browser
- **Best for**: Playing online, sharing with others

### Python Version
- **File**: `main.py`
- **How to run**: `python main.py`
- **Best for**: Development, command-line play

## Game Strategy Hint

The only way to always win is to understand **patterns**. This game is based on pure mathematics (specifically, the nim-sum of segment lengths). If the nim-sum is 0, the current player is in a losing position!

Try the tutorial in-game to learn how to play.