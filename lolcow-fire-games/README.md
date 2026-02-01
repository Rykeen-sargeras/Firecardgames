# 🔥 Lolcow Fire Games

Cards Against The LCU & UNO - Multiplayer Party Games

## Setup

### File Structure
```
lolcow-fire-games/
├── server.js
├── package.json
├── .gitignore
├── white_cards.txt      ← Your white cards (one per line)
├── black_cards.txt      ← Your black cards (one per line, use ___ for blanks)
└── public/
    ├── index.html
    ├── main.js
    ├── game-cah.js
    ├── game-uno.js
    ├── cardsback.png    ← Card back image
    ├── whitecard.png    ← White card background
    └── blkcard.png      ← Black card background
```

### Deploy to Render (Free Tier)

1. Push to GitHub
2. On Render.com → New Web Service
3. Connect repo
4. Settings:
   - **Root Directory:** (leave blank - files at root)
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Environment Variables:
   - `ADMIN_PASS` = `Firesluts21`

## Features

- 🎨 Dark gray/orange/amber fire theme
- 📋 5x5 card grid for submissions
- 💬 Accordion chat (click to open/close)
- ⏱️ 15-second countdown when all ready
- 🔄 60-second reconnect window
- 🚪 Join mid-game (enter next round)
- 🃏 No duplicate cards in hand
- ✏️ Everyone starts with 1 blank card

## Admin

Password: `Firesluts21` (or set ADMIN_PASS env var)
- Reset game
- Clear chat
