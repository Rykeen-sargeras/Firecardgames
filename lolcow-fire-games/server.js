const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const Filter = require("bad-words");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// ===========================================
// CONFIG
// ===========================================
const ADMIN_PASS = process.env.ADMIN_PASS || "Firesluts21";
const WIN_POINTS = 10;
const COUNTDOWN_SECONDS = 15;
const RECONNECT_SECONDS = 60;
const ROUND_TIMER_SECONDS = 45; // Time to submit cards
const HAND_SIZE = 10;

// ===========================================
// LOAD CARDS
// ===========================================
let whiteCardsOriginal = [
  "A disappointing birthday party",
  "Grandma's secret recipe",
  "An awkward high five",
  "Poor life choices",
  "Puppies!",
  "A frozen burrito",
  "The meaning of life",
  "A really cool hat",
  "Passive-aggressive Post-it notes",
  "Unexpected nudity",
  "Being on fire",
  "Dad's emotional baggage",
  "A micropig wearing a tiny raincoat",
  "The violation of our most basic human rights",
  "A salty surprise",
  "Full frontal nudity",
  "Getting naked and watching Nickelodeon",
  "My relationship status",
  "Dying alone and full of regrets",
  "A lifetime of regret"
];

let blackCardsOriginal = [
  "What's Batman's guilty pleasure? ___",
  "What ruined the family reunion? ___",
  "In 2025, the hottest trend is ___",
  "The secret ingredient is ___",
  "What's worse than stubbing your toe? ___",
  "TSA guidelines now prohibit ___ on airplanes.",
  "What's the next Happy Meal toy? ___",
  "What ended my last relationship? ___",
  "I drink to forget ___",
  "What's my superpower? ___"
];

try {
  if (fs.existsSync("white_cards.txt")) {
    whiteCardsOriginal = fs.readFileSync("white_cards.txt", "utf8")
      .split("\n").map(l => l.trim()).filter(Boolean);
  }
  if (fs.existsSync("black_cards.txt")) {
    blackCardsOriginal = fs.readFileSync("black_cards.txt", "utf8")
      .split("\n").map(l => l.trim()).filter(Boolean);
  }
  console.log(`Loaded ${whiteCardsOriginal.length} white cards, ${blackCardsOriginal.length} black cards`);
} catch (e) {
  console.log("Using default cards");
}

// ===========================================
// UTILITIES
// ===========================================
const filter = new Filter();
filter.removeWords("hell", "damn", "god");

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateCode() {
  // No 0 or O to avoid confusion
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ===========================================
// ROOMS
// ===========================================
const rooms = {};

// Store player sessions for reconnection
const playerSessions = {}; // odumid -> { name, roomCode, odumid }

function createRoom(code) {
  rooms[code] = {
    code: code,
    players: {},
    started: false,
    countdownTimer: null,
    countdownValue: 0,
    whiteDeck: shuffle([...whiteCardsOriginal]),
    whiteDiscard: [],
    blackDeck: shuffle([...blackCardsOriginal]),
    blackDiscard: [],
    currentBlack: "",
    submissions: [],
    czarIndex: 0,
    roundNumber: 0,
    pendingPlayers: {},
    roundTimer: null,
    roundTimeLeft: 0,
    lastWinner: null,
    winningCards: [] // History of winning cards
  };
  console.log(`Room ${code} created`);
  return rooms[code];
}

function getRoom(code) {
  return rooms[code];
}

// ===========================================
// CARD DRAWING
// ===========================================
function drawWhiteCard(room, excludeCards = []) {
  if (room.whiteDeck.length === 0) {
    if (room.whiteDiscard.length === 0) {
      room.whiteDeck = shuffle([...whiteCardsOriginal]);
    } else {
      room.whiteDeck = shuffle([...room.whiteDiscard]);
      room.whiteDiscard = [];
    }
  }
  
  for (let i = room.whiteDeck.length - 1; i >= 0; i--) {
    if (!excludeCards.includes(room.whiteDeck[i])) {
      return room.whiteDeck.splice(i, 1)[0];
    }
  }
  return room.whiteDeck.pop();
}

function drawBlackCard(room) {
  if (room.blackDeck.length === 0) {
    if (room.blackDiscard.length === 0) {
      room.blackDeck = shuffle([...blackCardsOriginal]);
    } else {
      room.blackDeck = shuffle([...room.blackDiscard]);
      room.blackDiscard = [];
    }
  }
  return room.blackDeck.pop();
}

// ===========================================
// LOBBY
// ===========================================
function broadcastLobby(code) {
  const room = getRoom(code);
  if (!room) return;
  
  const playerList = [];
  for (const [id, p] of Object.entries(room.players)) {
    if (!p.name) continue;
    playerList.push({
      odumid: id,
      name: p.name,
      ready: p.ready === true,
      disconnected: p.disconnected === true,
      reconnectTime: p.reconnectTime || 0
    });
  }
  
  const activePlayers = playerList.filter(p => !p.disconnected);
  const readyPlayers = activePlayers.filter(p => p.ready);
  const notReadyPlayers = activePlayers.filter(p => !p.ready);
  
  let waitingFor = "";
  if (activePlayers.length < 3) {
    const need = 3 - activePlayers.length;
    waitingFor = `Need ${need} more player${need > 1 ? 's' : ''} (min 3)`;
  } else if (notReadyPlayers.length > 0) {
    waitingFor = `Waiting for: ${notReadyPlayers.map(p => p.name).join(", ")}`;
  } else if (room.countdownValue > 0) {
    waitingFor = `Starting in ${room.countdownValue}s...`;
  } else {
    waitingFor = "All ready!";
  }
  
  io.to(code).emit("lobby", {
    roomCode: code,
    players: playerList,
    activeCount: activePlayers.length,
    readyCount: readyPlayers.length,
    countdown: room.countdownValue,
    waitingFor: waitingFor,
    started: room.started
  });
}

// ===========================================
// COUNTDOWN
// ===========================================
function checkAndStartCountdown(code) {
  const room = getRoom(code);
  if (!room || room.started) return;
  
  const players = Object.values(room.players).filter(p => !p.disconnected && p.name);
  const allReady = players.length >= 3 && players.every(p => p.ready);
  
  if (allReady && !room.countdownTimer) {
    room.countdownValue = COUNTDOWN_SECONDS;
    room.countdownTimer = setInterval(() => {
      room.countdownValue--;
      io.to(code).emit("countdown", room.countdownValue);
      broadcastLobby(code);
      
      if (room.countdownValue <= 0) {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
        startGame(code);
      }
    }, 1000);
    broadcastLobby(code);
  } else if (!allReady && room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
    room.countdownValue = 0;
    io.to(code).emit("countdown-cancelled");
    broadcastLobby(code);
  }
}

// ===========================================
// RECONNECTION (Improved)
// ===========================================
function startReconnectTimer(code, odumid) {
  const room = getRoom(code);
  if (!room) return;
  
  const player = room.players[odumid];
  if (!player) return;
  
  player.disconnected = true;
  player.reconnectTime = RECONNECT_SECONDS;
  
  io.to(code).emit("player-dc", { name: player.name, time: RECONNECT_SECONDS });
  
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
    room.countdownValue = 0;
  }
  
  const timer = setInterval(() => {
    if (!room.players[odumid]) {
      clearInterval(timer);
      return;
    }
    
    player.reconnectTime--;
    
    if (player.reconnectTime <= 0 || !player.disconnected) {
      clearInterval(timer);
      if (player.disconnected) {
        // Clean up session
        for (const [sid, sess] of Object.entries(playerSessions)) {
          if (sess.odumid === odumid) delete playerSessions[sid];
        }
        
        delete room.players[odumid];
        io.to(code).emit("player-left", { name: player.name });
        
        if (Object.keys(room.players).length === 0) {
          delete rooms[code];
        } else {
          broadcastLobby(code);
          if (room.started) sendGameState(code);
        }
      }
    } else {
      broadcastLobby(code);
    }
  }, 1000);
  
  player.reconnectTimer = timer;
  broadcastLobby(code);
}

function tryReconnect(socket, code, name, sessionId) {
  const room = getRoom(code);
  if (!room) return false;
  
  // Check by session ID first (better reconnection)
  if (sessionId && playerSessions[sessionId]) {
    const sess = playerSessions[sessionId];
    if (sess.roomCode === code) {
      const player = room.players[sess.odumid];
      if (player && player.disconnected) {
        return doReconnect(socket, room, sess.odumid, player);
      }
    }
  }
  
  // Fallback to name matching
  for (const [odumid, player] of Object.entries(room.players)) {
    if (player.name && player.name.toLowerCase() === name.toLowerCase() && player.disconnected) {
      return doReconnect(socket, room, odumid, player);
    }
  }
  return false;
}

function doReconnect(socket, room, oldId, player) {
  if (player.reconnectTimer) clearInterval(player.reconnectTimer);
  
  player.disconnected = false;
  player.reconnectTime = 0;
  
  delete room.players[oldId];
  room.players[socket.id] = player;
  
  socket.join(room.code);
  socket.roomCode = room.code;
  socket.playerName = player.name;
  
  // Update session
  socket.sessionId = socket.sessionId || generateCode();
  playerSessions[socket.sessionId] = {
    name: player.name,
    roomCode: room.code,
    odumid: socket.id
  };
  
  io.to(room.code).emit("player-reconnected", { name: player.name });
  broadcastLobby(room.code);
  if (room.started) sendGameState(room.code);
  
  return true;
}

// ===========================================
// ROUND TIMER
// ===========================================
function startRoundTimer(code) {
  const room = getRoom(code);
  if (!room) return;
  
  if (room.roundTimer) clearInterval(room.roundTimer);
  
  room.roundTimeLeft = ROUND_TIMER_SECONDS;
  
  room.roundTimer = setInterval(() => {
    room.roundTimeLeft--;
    io.to(code).emit("round-timer", room.roundTimeLeft);
    
    if (room.roundTimeLeft <= 0) {
      clearInterval(room.roundTimer);
      room.roundTimer = null;
      
      // Auto-submit for players who haven't
      const nonCzar = Object.entries(room.players).filter(([id, p]) => 
        !p.isCzar && !p.submitted && !p.disconnected && p.name
      );
      
      nonCzar.forEach(([id, p]) => {
        // Pick a random revealed card or first card
        if (p.hand && p.hand.length > 0) {
          const card = p.hand[0];
          p.hand.splice(0, 1);
          
          const newCard = drawWhiteCard(room, p.hand);
          if (newCard) p.hand.push(newCard);
          
          p.submitted = true;
          room.submissions.push({ 
            odumid: id, 
            card: card, 
            name: p.name,
            autoSubmit: true 
          });
        }
      });
      
      room.submissions = shuffle(room.submissions);
      sendGameState(code);
    }
  }, 1000);
}

function stopRoundTimer(code) {
  const room = getRoom(code);
  if (room && room.roundTimer) {
    clearInterval(room.roundTimer);
    room.roundTimer = null;
    room.roundTimeLeft = 0;
  }
}

// ===========================================
// GAME
// ===========================================
const BLANK_CARD = "__BLANK__";

function startGame(code) {
  const room = getRoom(code);
  if (!room) return;
  
  room.started = true;
  room.whiteDeck = shuffle([...whiteCardsOriginal]);
  room.whiteDiscard = [];
  room.blackDeck = shuffle([...blackCardsOriginal]);
  room.blackDiscard = [];
  room.winningCards = [];
  
  const ids = Object.keys(room.players).filter(id => room.players[id].name && !room.players[id].disconnected);
  
  ids.forEach((id, i) => {
    const p = room.players[id];
    p.hand = [];
    p.revealedCards = [];
    
    // First card is always a BLANK card
    p.hand.push(BLANK_CARD);
    
    // Fill rest with regular cards
    const existing = [];
    for (let j = 1; j < HAND_SIZE; j++) {
      const card = drawWhiteCard(room, existing);
      if (card) {
        p.hand.push(card);
        existing.push(card);
      }
    }
    
    p.score = 0;
    p.submitted = false;
    p.isCzar = (i === 0);
  });
  
  room.czarIndex = 0;
  room.currentBlack = drawBlackCard(room);
  room.submissions = [];
  room.roundNumber = 1;
  
  io.to(code).emit("game-start");
  startRoundTimer(code);
  sendGameState(code);
}

function sendGameState(code) {
  const room = getRoom(code);
  if (!room) return;
  
  const players = Object.values(room.players).filter(p => p.name && !p.disconnected);
  const czar = players.find(p => p.isCzar);
  const nonCzar = players.filter(p => !p.isCzar);
  const allSubmitted = room.submissions.length >= nonCzar.length && nonCzar.length > 0;
  
  // Stop timer when all submitted
  if (allSubmitted && room.roundTimer) {
    stopRoundTimer(code);
  }
  
  for (const [id, p] of Object.entries(room.players)) {
    if (!p.name || p.disconnected) continue;
    
    const sock = io.sockets.sockets.get(id);
    if (sock) {
      const handWithStatus = p.hand.map((card, idx) => ({
        card: card,
        revealed: p.revealedCards ? p.revealedCards.includes(idx) : false,
        index: idx
      }));
      
      sock.emit("game-state", {
        blackCard: room.currentBlack,
        czarName: czar ? czar.name : "...",
        czarId: czar ? Object.keys(room.players).find(k => room.players[k] === czar) : null,
        isCzar: p.isCzar,
        myHand: handWithStatus,
        submitted: p.submitted,
        submissions: room.submissions.map(s => ({ odumid: s.odumid, card: s.card })),
        allSubmitted: allSubmitted,
        submissionCount: room.submissions.length,
        expectedCount: nonCzar.length,
        players: players.map(x => ({
          name: x.name,
          score: x.score,
          isCzar: x.isCzar,
          submitted: x.submitted
        })),
        roundNumber: room.roundNumber,
        roundTimeLeft: room.roundTimeLeft || 0,
        winningCards: room.winningCards || []
      });
    }
  }
  
  // Pending players
  for (const [id, p] of Object.entries(room.pendingPlayers || {})) {
    const sock = io.sockets.sockets.get(id);
    if (sock) {
      sock.emit("game-state", {
        blackCard: room.currentBlack,
        czarName: czar ? czar.name : "...",
        isCzar: false,
        myHand: [],
        submitted: true,
        submissions: room.submissions.map(s => ({ odumid: s.odumid, card: s.card })),
        allSubmitted: allSubmitted,
        players: players.map(x => ({ name: x.name, score: x.score, isCzar: x.isCzar, submitted: x.submitted })),
        isPending: true,
        roundTimeLeft: room.roundTimeLeft || 0
      });
    }
  }
}

function nextRound(code) {
  const room = getRoom(code);
  if (!room) return;
  
  // Add pending players
  for (const [id, pending] of Object.entries(room.pendingPlayers || {})) {
    room.players[id] = pending;
    pending.hand = [];
    pending.revealedCards = [];
    const existing = [];
    for (let j = 0; j < HAND_SIZE; j++) {
      const card = drawWhiteCard(room, existing);
      if (card) {
        pending.hand.push(card);
        existing.push(card);
      }
    }
    pending.score = 0;
    io.to(code).emit("player-joined-game", { name: pending.name });
  }
  room.pendingPlayers = {};
  
  room.blackDiscard.push(room.currentBlack);
  
  const ids = Object.keys(room.players).filter(id => room.players[id].name && !room.players[id].disconnected);
  
  if (ids.length < 3) {
    room.started = false;
    stopRoundTimer(code);
    io.to(code).emit("game-ended", { reason: "Not enough players" });
    Object.values(room.players).forEach(p => { p.ready = false; });
    broadcastLobby(code);
    return;
  }
  
  room.czarIndex = (room.czarIndex + 1) % ids.length;
  
  ids.forEach((id, i) => {
    const p = room.players[id];
    p.isCzar = (i === room.czarIndex);
    p.submitted = false;
    p.revealedCards = [];
  });
  
  room.currentBlack = drawBlackCard(room);
  room.submissions = [];
  room.roundNumber++;
  
  startRoundTimer(code);
  sendGameState(code);
}

// ===========================================
// REMATCH (keeps players)
// ===========================================
function rematch(code) {
  const room = getRoom(code);
  if (!room) return;
  
  stopRoundTimer(code);
  
  room.started = false;
  room.whiteDeck = shuffle([...whiteCardsOriginal]);
  room.whiteDiscard = [];
  room.blackDeck = shuffle([...blackCardsOriginal]);
  room.blackDiscard = [];
  room.submissions = [];
  room.roundNumber = 0;
  room.winningCards = [];
  room.countdownValue = 0;
  
  Object.values(room.players).forEach(p => {
    p.ready = false;
    p.hand = [];
    p.score = 0;
    p.submitted = false;
    p.isCzar = false;
    p.revealedCards = [];
  });
  
  io.to(code).emit("game-reset");
  broadcastLobby(code);
}

// ===========================================
// FULL RESET (kicks everyone, destroys room)
// ===========================================
function fullReset(code) {
  const room = getRoom(code);
  if (!room) return;
  
  stopRoundTimer(code);
  
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
  
  // Kick everyone back to home
  io.to(code).emit("full-reset");
  
  // Clear all player sessions for this room
  for (const [sid, sess] of Object.entries(playerSessions)) {
    if (sess.roomCode === code) {
      delete playerSessions[sid];
    }
  }
  
  // Delete the room entirely
  delete rooms[code];
  
  console.log(`Room ${code} fully reset and destroyed`);
}

// ===========================================
// SOCKET EVENTS
// ===========================================
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
  
  // Generate session ID for reconnection
  socket.sessionId = null;
  
  socket.on("set-session", (sessionId) => {
    socket.sessionId = sessionId;
  });
  
  socket.on("create-room", (data, cb) => {
    const code = generateCode();
    createRoom(code);
    cb({ code: code });
  });
  
  socket.on("join-room", (data, cb) => {
    const code = (data.code || "").toUpperCase().trim();
    const name = (data.name || "").trim().substring(0, 15);
    const sessionId = data.sessionId || socket.sessionId;
    
    if (!name) return cb({ ok: false, error: "Name required" });
    if (!code) return cb({ ok: false, error: "Code required" });
    
    if (tryReconnect(socket, code, name, sessionId)) {
      return cb({ ok: true, reconnected: true, sessionId: socket.sessionId });
    }
    
    let room = getRoom(code);
    if (!room) {
      if (!data.create) return cb({ ok: false, error: "Room not found" });
      room = createRoom(code);
    }
    
    const nameTaken = Object.values(room.players).some(p => p.name && p.name.toLowerCase() === name.toLowerCase() && !p.disconnected);
    if (nameTaken) return cb({ ok: false, error: "Name taken" });
    
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name;
    
    // Create session for reconnection
    socket.sessionId = socket.sessionId || generateCode();
    playerSessions[socket.sessionId] = {
      name: name,
      roomCode: code,
      odumid: socket.id
    };
    
    if (room.started) {
      room.pendingPlayers = room.pendingPlayers || {};
      room.pendingPlayers[socket.id] = { name: name, ready: true, disconnected: false };
      cb({ ok: true, pending: true, sessionId: socket.sessionId });
      sendGameState(code);
      return;
    }
    
    room.players[socket.id] = { name: name, ready: false, disconnected: false };
    cb({ ok: true, sessionId: socket.sessionId });
    broadcastLobby(code);
  });
  
  socket.on("ready", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.started) return;
    
    const p = room.players[socket.id];
    if (!p || !p.name) return;
    
    p.ready = !p.ready;
    broadcastLobby(socket.roomCode);
    checkAndStartCountdown(socket.roomCode);
  });
  
  socket.on("reveal-card", (index) => {
    const room = getRoom(socket.roomCode);
    if (!room || !room.started) return;
    
    const p = room.players[socket.id];
    if (!p || p.isCzar) return;
    
    if (!p.revealedCards) p.revealedCards = [];
    if (!p.revealedCards.includes(index) && index >= 0 && index < p.hand.length) {
      p.revealedCards.push(index);
      sendGameState(socket.roomCode);
    }
  });
  
  socket.on("submit", (data) => {
    const room = getRoom(socket.roomCode);
    if (!room || !room.started) return;
    
    const p = room.players[socket.id];
    if (!p || p.isCzar || p.submitted) return;
    
    let cardText = data.card;
    
    // Handle blank card with custom text
    if (data.card === BLANK_CARD && data.customText) {
      cardText = filter.clean(data.customText.substring(0, 100));
    }
    
    const idx = p.hand.indexOf(data.card);
    if (idx !== -1) {
      p.hand.splice(idx, 1);
      if (p.revealedCards) {
        p.revealedCards = p.revealedCards.filter(i => i !== idx).map(i => i > idx ? i - 1 : i);
      }
    } else {
      return;
    }
    
    const newCard = drawWhiteCard(room, p.hand);
    if (newCard) p.hand.push(newCard);
    
    // Don't discard blank cards
    if (data.card !== BLANK_CARD) {
      room.whiteDiscard.push(data.card);
    }
    
    p.submitted = true;
    room.submissions.push({ odumid: socket.id, card: cardText, name: p.name });
    room.submissions = shuffle(room.submissions);
    
    sendGameState(socket.roomCode);
  });
  
  socket.on("pick", (odumid) => {
    const room = getRoom(socket.roomCode);
    if (!room || !room.started) return;
    
    const me = room.players[socket.id];
    if (!me || !me.isCzar) return;
    
    const winner = room.players[odumid];
    if (!winner) return;
    
    const winningSubmission = room.submissions.find(s => s.odumid === odumid);
    
    winner.score++;
    room.lastWinner = { name: winner.name, odumid: odumid };
    
    // Track winning card
    if (winningSubmission) {
      room.winningCards.push({
        round: room.roundNumber,
        black: room.currentBlack,
        white: winningSubmission.card,
        winner: winner.name
      });
    }
    
    io.to(socket.roomCode).emit("round-winner", { 
      name: winner.name, 
      score: winner.score, 
      odumid: odumid,
      card: winningSubmission ? winningSubmission.card : ""
    });
    
    if (winner.score >= WIN_POINTS) {
      stopRoundTimer(socket.roomCode);
      io.to(socket.roomCode).emit("game-winner", { name: winner.name, score: winner.score });
    } else {
      setTimeout(() => nextRound(socket.roomCode), 3500);
    }
  });
  
  socket.on("rematch", () => {
    const room = getRoom(socket.roomCode);
    if (!room) return;
    rematch(socket.roomCode);
  });
  
  socket.on("chat", (msg) => {
    const room = getRoom(socket.roomCode);
    if (!room) return;
    
    let name = "Unknown";
    if (room.players[socket.id]?.name) name = room.players[socket.id].name;
    else if (room.pendingPlayers?.[socket.id]?.name) name = room.pendingPlayers[socket.id].name;
    
    io.to(socket.roomCode).emit("chat", { name: name, msg: filter.clean((msg || "").substring(0, 200)) });
  });
  
  socket.on("admin", (data) => {
    if (data.pw !== ADMIN_PASS) return socket.emit("admin-fail");
    socket.emit("admin-ok");
    
    const room = getRoom(socket.roomCode);
    if (!room) return;
    
    if (data.action === "reset") {
      fullReset(socket.roomCode);
    }
    if (data.action === "wipe-chat") {
      io.to(socket.roomCode).emit("chat-clear");
    }
    if (data.action === "kick" && data.target) {
      const target = room.players[data.target];
      if (target) {
        delete room.players[data.target];
        io.to(socket.roomCode).emit("player-kicked", { name: target.name });
        broadcastLobby(socket.roomCode);
        if (room.started) sendGameState(socket.roomCode);
      }
    }
  });
  
  socket.on("disconnect", () => {
    const room = getRoom(socket.roomCode);
    if (!room) return;
    
    if (room.pendingPlayers?.[socket.id]) {
      delete room.pendingPlayers[socket.id];
      return;
    }
    
    if (room.players[socket.id]) {
      startReconnectTimer(socket.roomCode, socket.id);
    }
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
setInterval(() => console.log("Keep-alive"), 280000);
