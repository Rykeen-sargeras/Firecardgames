# 🔥 Lolcow Fire Game Lobby v3.0

Multi-game platform with **Cards Against The LCU** and **UNO**!

---

## 🚀 Quick Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

---

## ✨ What's New in v3.0

### Fixed Lobby System
- ✅ **Players display correctly** - Shows username, ready status, and who YOU are
- ✅ **30-second countdown** - When all players ready, 30s countdown before game starts
- ✅ **60-second reconnect window** - Disconnected players have 1 minute to rejoin
- ✅ **Live status updates** - Shows who you're waiting on by name
- ✅ **Ready toggle** - Click Ready to ready up, click again to unready
- ✅ **Script loading fixed** - main.js loads FIRST (defines socket)

### Key Features
- Room code system for private games
- Real-time multiplayer via Socket.IO
- Full Cards Against Humanity gameplay
- Full UNO with all special cards
- Chat system
- Admin panel (reset, music, etc.)
- Confetti celebrations!

## 📁 Files

```
/
├── server.js           # Backend with lobby, countdown, reconnect
├── package.json
├── white_cards.txt     # CAH cards (optional)
├── black_cards.txt     # CAH cards (optional)
└── public/
    ├── index.html      # All UI and CSS
    ├── main.js         # LOADS FIRST - socket, lobby, modals
    ├── game-cah.js     # Cards Against logic
    └── game-uno.js     # UNO logic
```

## 🚀 Setup

### Local:
```bash
npm install
npm start
```
Open http://localhost:3000

### Render.com:
1. Push to GitHub
2. New Web Service → Connect repo
3. Build: `npm install`
4. Start: `npm start`
5. Env var: `ADMIN_PASS=YourPassword`

## 🎮 How to Play

1. Enter username
2. Create new game or join with code
3. Wait for players (3+ for CAH, 2+ for UNO)
4. Everyone clicks **Ready Up**
5. 30-second countdown starts
6. Game begins!

### If You Disconnect
- You have **60 seconds** to reconnect
- Other players see your reconnect timer
- Rejoin with same username to restore your spot

## ⚙️ Configuration

In `server.js`:
- `COUNTDOWN_SECONDS = 30` - Pre-game countdown
- `RECONNECT_TIMEOUT_MS = 60000` - Reconnect window (60s)
- `WIN_POINTS = 10` - Points to win CAH
- `ADMIN_PASS` - Admin password (env var or "Firesluts")

## 🛠️ Admin Panel

Click 🛠️ button, enter password.

- **Reset Game** - Everyone back to lobby
- **Clear Chat** - Wipe messages
- **Music** - Play YouTube audio

---

Created by Rykeen | v3.0 Lobby Overhaul

---

## 📦 GitHub Setup

### First Time Setup

```bash
# 1. Create a new folder and copy files there
mkdir lolcow-fire-games
cd lolcow-fire-games

# 2. Initialize git
git init

# 3. Add all files
git add .

# 4. First commit
git commit -m "Initial commit - Lolcow Fire Games v3.0"

# 5. Create repo on GitHub (github.com/new), then:
git remote add origin https://github.com/YOUR_USERNAME/lolcow-fire-games.git
git branch -M main
git push -u origin main
```

### After Making Changes

```bash
git add .
git commit -m "Your change description"
git push
```

### ⚠️ Security Reminders

1. **NEVER** commit `.env` files
2. **NEVER** commit real passwords
3. Check `.gitignore` is working: `git status` should NOT show `.env`
4. Set `ADMIN_PASS` as environment variable on Render, not in code

See [SECURITY.md](SECURITY.md) for full details.
