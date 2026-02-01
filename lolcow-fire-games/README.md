# 🔥 Cards Against The LCU

A Cards Against Humanity clone with a fire/ember theme.

## Features

- 🔥 Fire & red theme with ember particle effects
- 💬 Accordion chat (click header to open/close)
- ⏱️ 15-second countdown when all ready
- 🔄 60-second reconnect window
- 🚪 Join mid-game (enter next round)
- 🃏 No duplicate cards, everyone starts with 1 blank
- 📱 5x5 card grid for submissions

## File Structure

```
cards-against-lcu/
├── server.js
├── package.json
├── .gitignore
├── white_cards.txt      ← Your white cards (one per line)
├── black_cards.txt      ← Your black cards (use ___ for blanks)
└── public/
    ├── index.html
    ├── main.js
    ├── cardsback.png    ← Card back / logo
    ├── whitecard.png    ← White card background
    └── blkcard.png      ← Black card background
```

## Deploy to Render

1. Put files at ROOT of repo (not in subfolder)
2. On Render → New Web Service
3. Build: `npm install`
4. Start: `npm start`
5. Add env var: `ADMIN_PASS` = `Firesluts21`

## Admin

Click 🛠️, enter password to reset game or clear chat.
