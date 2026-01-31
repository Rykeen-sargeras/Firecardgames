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

/* ============================================
   CONFIGURATION
============================================ */
const ADMIN_PASS = process.env.ADMIN_PASS || "Firesluts";
const WIN_POINTS = 10;
const COUNTDOWN_SECONDS = 30;        // 30 second countdown before game starts
const RECONNECT_TIMEOUT_MS = 60000;  // 60 seconds to reconnect
const KEEPALIVE_MS = 300000;

/* ============================================
   LOAD CARDS
============================================ */
let rawWhite = [
  "A disappointing birthday party",
  "Grandma's secret recipe", 
  "An awkward high five",
  "Poor life choices",
  "The meaning of life",
  "A frozen burrito",
  "Puppies!",
  "A really cool hat",
  "Darth Vader",
  "A romantic comedy"
];

let rawBlack = [
  "What's Batman's guilty pleasure? ___",
  "What's worse than stubbing your toe? ___",
  "In 2025, the hottest trend is ___",
  "The secret ingredient is ___",
  "What ruined the family reunion? ___"
];

try {
  if (fs.existsSync("white_cards.txt")) {
    rawWhite = fs.readFileSync("white_cards.txt", "utf8")
      .split("\n").map(l => l.trim()).filter(Boolean);
  }
  if (fs.existsSync("black_cards.txt")) {
    rawBlack = fs.readFileSync("black_cards.txt", "utf8")
      .split("\n").map(l => l.trim()).filter(Boolean);
  }
} catch (e) {
  console.log("⚠️ Card files missing, using defaults");
}

console.log(`📄 Loaded ${rawWhite.length} white cards, ${rawBlack.length} black cards`);

/* ============================================
   UTILITIES
============================================ */
const filter = new Filter();
filter.removeWords("hell", "damn", "god");

const shuffle = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/* ============================================
   GAME STATE
============================================ */
let rooms = {};
let disconnectedPlayers = {}; // Track disconnected players for reconnection

/* ============================================
   ROOM MANAGEMENT
============================================ */
function createRoom(roomCode, gameType) {
  console.log(`🏠 Creating room ${roomCode} for ${gameType}`);
  
  rooms[roomCode] = {
    gameType,
    players: {},
    started: false,
    
    // Lobby state
    countdownTimer: null,
    countdownSeconds: 0,
    
    // Shared
    currentMusic: null,
    skipVotes: new Set(),
    
    // CAH specific
    whiteDeck: shuffle([...rawWhite]),
    blackDeck: shuffle([...rawBlack]),
    submissions: [],
    currentBlack: "",
    czarIndex: 0,
    
    // UNO specific
    deck: [],
    discardPile: [],
    currentCard: null,
    currentPlayer: 0,
    direction: 1,
    drawStack: 0
  };
  
  return rooms[roomCode];
}

function getRoom(roomCode) {
  return rooms[roomCode] || null;
}

function deleteRoom(roomCode) {
  const room = getRoom(roomCode);
  if (room) {
    if (room.countdownTimer) {
      clearInterval(room.countdownTimer);
    }
    delete rooms[roomCode];
    console.log(`🗑️ Room ${roomCode} deleted`);
  }
}

/* ============================================
   CARD DRAWING
============================================ */
function drawWhite(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return "Test Card";
  
  if (room.whiteDeck.length === 0) {
    room.whiteDeck = shuffle([...rawWhite]);
  }
  
  const card = room.whiteDeck.pop();
  return Math.random() < 0.1 ? "__BLANK__" : card;
}

function drawBlack(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return "Test Black ___";
  
  if (room.blackDeck.length === 0) {
    room.blackDeck = shuffle([...rawBlack]);
  }
  
  return room.blackDeck.pop();
}

/* ============================================
   LOBBY SYSTEM - THE KEY FIX
============================================ */
function broadcastLobby(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  
  const players = Object.values(room.players);
  const activePlayers = players.filter(p => !p.disconnected);
  const disconnectedList = players.filter(p => p.disconnected);
  
  const totalActive = activePlayers.length;
  const readyCount = activePlayers.filter(p => p.ready).length;
  const minPlayers = room.gameType === 'cards-against' ? 3 : 2;
  
  // Build detailed player list
  const playerList = players.map(p => ({
    id: p.visibleId || p.id,
    username: p.username,
    ready: p.ready || false,
    disconnected: p.disconnected || false,
    reconnectTimeLeft: p.reconnectTimeLeft || 0,
    isHost: p.isHost || false
  }));
  
  const lobbyData = {
    roomCode,
    gameType: room.gameType,
    players: playerList,
    totalPlayers: totalActive,
    readyCount,
    minPlayers,
    started: room.started,
    countdown: room.countdownSeconds,
    countdownActive: room.countdownTimer !== null
  };
  
  console.log(`📡 LOBBY [${roomCode}]: ${readyCount}/${totalActive} ready, countdown: ${room.countdownSeconds}s, started: ${room.started}`);
  
  io.to(roomCode).emit("lobby-update", lobbyData);
}

function checkStartConditions(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.started) return;
  
  const players = Object.values(room.players).filter(p => !p.disconnected);
  const totalPlayers = players.length;
  const readyCount = players.filter(p => p.ready).length;
  const minPlayers = room.gameType === 'cards-against' ? 3 : 2;
  
  const allReady = readyCount >= totalPlayers && totalPlayers >= minPlayers;
  
  console.log(`🔍 Check start [${roomCode}]: ${readyCount}/${totalPlayers} ready, min: ${minPlayers}, allReady: ${allReady}`);
  
  if (allReady && !room.countdownTimer) {
    // Start 30 second countdown
    startCountdown(roomCode);
  } else if (!allReady && room.countdownTimer) {
    // Cancel countdown if someone unreadied
    cancelCountdown(roomCode);
  }
}

function startCountdown(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.countdownTimer) return;
  
  console.log(`⏱️ Starting ${COUNTDOWN_SECONDS}s countdown in ${roomCode}`);
  
  room.countdownSeconds = COUNTDOWN_SECONDS;
  broadcastLobby(roomCode);
  
  room.countdownTimer = setInterval(() => {
    room.countdownSeconds--;
    
    // Broadcast countdown update
    io.to(roomCode).emit("countdown-tick", { seconds: room.countdownSeconds });
    
    if (room.countdownSeconds <= 0) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      
      // Actually start the game
      if (room.gameType === 'cards-against') {
        startCAHGame(roomCode);
      } else if (room.gameType === 'uno') {
        startUnoGame(roomCode);
      }
    }
  }, 1000);
}

function cancelCountdown(roomCode) {
  const room = getRoom(roomCode);
  if (!room || !room.countdownTimer) return;
  
  console.log(`❌ Countdown cancelled in ${roomCode}`);
  
  clearInterval(room.countdownTimer);
  room.countdownTimer = null;
  room.countdownSeconds = 0;
  
  io.to(roomCode).emit("countdown-cancelled");
  broadcastLobby(roomCode);
}

/* ============================================
   RECONNECTION SYSTEM
============================================ */
function handleDisconnect(socket) {
  const roomCode = socket.roomCode;
  const room = getRoom(roomCode);
  if (!room) return;
  
  const player = room.players[socket.visibleId || socket.id];
  if (!player) return;
  
  console.log(`🔌 ${player.username} disconnected from ${roomCode}`);
  
  // Mark as disconnected, don't remove yet
  player.disconnected = true;
  player.disconnectedAt = Date.now();
  player.reconnectTimeLeft = RECONNECT_TIMEOUT_MS / 1000;
  
  // Store for reconnection
  disconnectedPlayers[`${roomCode}:${player.username.toLowerCase()}`] = {
    visibleId: player.visibleId || socket.id,
    roomCode,
    username: player.username,
    hand: player.hand,
    score: player.score,
    ready: player.ready,
    isCzar: player.isCzar,
    hasSubmitted: player.hasSubmitted,
    calledUno: player.calledUno
  };
  
  // Cancel countdown if active
  if (room.countdownTimer) {
    cancelCountdown(roomCode);
  }
  
  // Start reconnection countdown
  const reconnectKey = `${roomCode}:${player.username.toLowerCase()}`;
  
  // Broadcast disconnect notification
  io.to(roomCode).emit("player-disconnected", {
    username: player.username,
    timeToReconnect: RECONNECT_TIMEOUT_MS / 1000
  });
  
  // Update reconnect timer every second
  const reconnectInterval = setInterval(() => {
    if (!room.players[player.visibleId || socket.id]) {
      clearInterval(reconnectInterval);
      return;
    }
    
    player.reconnectTimeLeft--;
    
    if (player.reconnectTimeLeft <= 0) {
      clearInterval(reconnectInterval);
      
      // Actually remove player
      console.log(`⏰ ${player.username} reconnect timeout in ${roomCode}`);
      removePlayerPermanently(roomCode, player.visibleId || socket.id);
    } else {
      // Broadcast timer update
      io.to(roomCode).emit("reconnect-timer", {
        username: player.username,
        timeLeft: player.reconnectTimeLeft
      });
    }
  }, 1000);
  
  // Store interval reference for cleanup
  player.reconnectInterval = reconnectInterval;
  
  broadcastLobby(roomCode);
}

function attemptReconnect(socket, roomCode, username) {
  const reconnectKey = `${roomCode}:${username.toLowerCase()}`;
  const savedPlayer = disconnectedPlayers[reconnectKey];
  
  if (!savedPlayer) {
    return false;
  }
  
  const room = getRoom(roomCode);
  if (!room) {
    delete disconnectedPlayers[reconnectKey];
    return false;
  }
  
  const existingPlayer = Object.values(room.players).find(
    p => p.username.toLowerCase() === username.toLowerCase() && p.disconnected
  );
  
  if (!existingPlayer) {
    delete disconnectedPlayers[reconnectKey];
    return false;
  }
  
  console.log(`🔄 ${username} reconnecting to ${roomCode}`);
  
  // Clear reconnect timer
  if (existingPlayer.reconnectInterval) {
    clearInterval(existingPlayer.reconnectInterval);
  }
  
  // Update player with new socket
  existingPlayer.id = socket.id;
  existingPlayer.disconnected = false;
  existingPlayer.disconnectedAt = null;
  existingPlayer.reconnectTimeLeft = 0;
  
  // Move player entry to new socket id
  delete room.players[savedPlayer.visibleId];
  room.players[socket.id] = existingPlayer;
  existingPlayer.visibleId = socket.id;
  
  // Join socket room
  socket.join(roomCode);
  socket.roomCode = roomCode;
  socket.username = username;
  socket.visibleId = socket.id;
  
  // Clean up
  delete disconnectedPlayers[reconnectKey];
  
  // Notify room
  io.to(roomCode).emit("player-reconnected", { username });
  
  broadcastLobby(roomCode);
  
  // If game in progress, send game state
  if (room.started) {
    if (room.gameType === 'cards-against') {
      broadcastCAH(roomCode);
    } else if (room.gameType === 'uno') {
      broadcastUno(roomCode);
    }
  }
  
  return true;
}

function removePlayerPermanently(roomCode, visibleId) {
  const room = getRoom(roomCode);
  if (!room) return;
  
  const player = room.players[visibleId];
  if (!player) return;
  
  // Clear any intervals
  if (player.reconnectInterval) {
    clearInterval(player.reconnectInterval);
  }
  
  // Clean up disconnected players cache
  const reconnectKey = `${roomCode}:${player.username.toLowerCase()}`;
  delete disconnectedPlayers[reconnectKey];
  
  const wasCzar = player.isCzar;
  delete room.players[visibleId];
  room.skipVotes?.delete(visibleId);
  
  // Remove their submissions
  room.submissions = room.submissions.filter(s => s.playerId !== visibleId);
  
  const remaining = Object.values(room.players).filter(p => !p.disconnected).length;
  
  console.log(`👋 ${player.username} permanently removed from ${roomCode}, ${remaining} remaining`);
  
  // Notify room
  io.to(roomCode).emit("player-removed", { username: player.username });
  
  if (remaining === 0) {
    deleteRoom(roomCode);
    return;
  }
  
  // Handle game state
  if (room.started) {
    const minPlayers = room.gameType === 'cards-against' ? 3 : 2;
    
    if (remaining < minPlayers) {
      room.started = false;
      room.submissions = [];
      room.currentBlack = "";
      
      // Reset all players
      Object.values(room.players).forEach(p => {
        p.ready = false;
      });
      
      io.to(roomCode).emit("game-ended", { reason: "Not enough players" });
      broadcastLobby(roomCode);
    } else if (wasCzar && room.gameType === 'cards-against') {
      nextCAHRound(roomCode);
    } else if (room.gameType === 'uno') {
      // Adjust current player if needed
      const playerIds = Object.keys(room.players);
      if (room.currentPlayer >= playerIds.length) {
        room.currentPlayer = 0;
      }
      broadcastUno(roomCode);
    }
  } else {
    checkStartConditions(roomCode);
    broadcastLobby(roomCode);
  }
}

/* ============================================
   CARDS AGAINST HUMANITY
============================================ */
function startCAHGame(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.gameType !== 'cards-against') return;
  
  console.log(`🃏 Starting CAH game in ${roomCode}`);
  
  room.started = true;
  room.czarIndex = 0;
  room.submissions = [];
  
  const playerIds = Object.keys(room.players);
  playerIds.forEach((id, i) => {
    const p = room.players[id];
    p.isCzar = (i === 0);
    p.hasSubmitted = false;
    p.score = p.score || 0;
    
    // Deal hand
    if (!p.hand || p.hand.length < 10) {
      p.hand = [];
      for (let j = 0; j < 10; j++) {
        p.hand.push(drawWhite(roomCode));
      }
    }
  });
  
  room.currentBlack = drawBlack(roomCode);
  
  io.to(roomCode).emit("game-started", { gameType: 'cards-against' });
  broadcastCAH(roomCode);
}

function broadcastCAH(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.gameType !== 'cards-against') return;
  
  if (!room.started) {
    broadcastLobby(roomCode);
    return;
  }
  
  const players = Object.values(room.players).filter(p => !p.disconnected);
  const czar = players.find(p => p.isCzar);
  
  const baseState = {
    gameType: 'cards-against',
    started: true,
    blackCard: room.currentBlack,
    czarId: czar?.id,
    czarName: czar?.username || "...",
    submissions: room.submissions,
    allSubmitted: room.submissions.length >= players.filter(p => !p.isCzar).length,
    players: players.map(p => ({
      id: p.visibleId || p.id,
      username: p.username,
      score: p.score,
      isCzar: p.isCzar,
      hasSubmitted: p.hasSubmitted,
      disconnected: p.disconnected
    }))
  };
  
  // Send to each player with their hand
  players.forEach(p => {
    const sock = io.sockets.sockets.get(p.visibleId || p.id);
    if (sock) {
      sock.emit("cah-state", {
        ...baseState,
        myHand: p.hand || [],
        myId: p.visibleId || p.id,
        isCzar: p.isCzar,
        hasSubmitted: p.hasSubmitted
      });
    }
  });
}

function nextCAHRound(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.gameType !== 'cards-against') return;
  
  room.submissions = [];
  room.currentBlack = drawBlack(roomCode);
  
  const playerIds = Object.keys(room.players).filter(id => !room.players[id].disconnected);
  
  if (playerIds.length < 3) {
    room.started = false;
    io.to(roomCode).emit("game-ended", { reason: "Not enough players" });
    broadcastLobby(roomCode);
    return;
  }
  
  room.czarIndex = (room.czarIndex + 1) % playerIds.length;
  
  playerIds.forEach((id, i) => {
    room.players[id].isCzar = (i === room.czarIndex);
    room.players[id].hasSubmitted = false;
  });
  
  broadcastCAH(roomCode);
}

/* ============================================
   UNO GAME
============================================ */
const UNO_COLORS = ['red', 'yellow', 'green', 'blue'];

function createUnoDeck() {
  const deck = [];
  
  UNO_COLORS.forEach(color => {
    deck.push({ color, value: '0' });
    for (let i = 0; i < 2; i++) {
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'].forEach(value => {
        deck.push({ color, value });
      });
    }
  });
  
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'wild' });
    deck.push({ color: 'wild', value: 'wild-draw4' });
  }
  
  return shuffle(deck);
}

function drawUnoCard(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return null;
  
  if (room.deck.length === 0) {
    const topCard = room.discardPile.pop();
    room.deck = shuffle([...room.discardPile]);
    room.discardPile = topCard ? [topCard] : [];
  }
  
  return room.deck.pop();
}

function canPlayUnoCard(card, topCard) {
  if (!card || !topCard) return false;
  if (card.color === 'wild') return true;
  const activeColor = topCard.activeColor || topCard.color;
  if (card.color === activeColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function startUnoGame(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.gameType !== 'uno') return;
  
  console.log(`🎴 Starting UNO game in ${roomCode}`);
  
  room.deck = createUnoDeck();
  room.discardPile = [];
  room.currentPlayer = 0;
  room.direction = 1;
  room.drawStack = 0;
  room.started = true;
  
  const playerIds = Object.keys(room.players).filter(id => !room.players[id].disconnected);
  playerIds.forEach(id => {
    room.players[id].hand = [];
    for (let i = 0; i < 7; i++) {
      room.players[id].hand.push(drawUnoCard(roomCode));
    }
    room.players[id].calledUno = false;
  });
  
  // Draw starting card (not wild or action)
  let startCard;
  do {
    startCard = drawUnoCard(roomCode);
  } while (startCard && (startCard.color === 'wild' || ['skip', 'reverse', 'draw2'].includes(startCard.value)));
  
  room.currentCard = startCard;
  if (startCard) room.discardPile.push(startCard);
  
  io.to(roomCode).emit("game-started", { gameType: 'uno' });
  broadcastUno(roomCode);
}

function broadcastUno(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.gameType !== 'uno') return;
  
  if (!room.started) {
    broadcastLobby(roomCode);
    return;
  }
  
  const playerIds = Object.keys(room.players).filter(id => !room.players[id].disconnected);
  const currentPlayerId = playerIds[room.currentPlayer] || playerIds[0];
  
  const players = Object.values(room.players).filter(p => !p.disconnected);
  
  const baseState = {
    gameType: 'uno',
    started: true,
    currentCard: room.currentCard,
    currentPlayerId,
    direction: room.direction,
    drawStack: room.drawStack,
    deckCount: room.deck.length,
    players: players.map(p => ({
      id: p.visibleId || p.id,
      username: p.username,
      handCount: p.hand ? p.hand.length : 0,
      calledUno: p.calledUno,
      disconnected: p.disconnected
    }))
  };
  
  players.forEach(p => {
    const sock = io.sockets.sockets.get(p.visibleId || p.id);
    if (sock) {
      sock.emit("uno-state", {
        ...baseState,
        myHand: p.hand || [],
        myId: p.visibleId || p.id,
        isMyTurn: (p.visibleId || p.id) === currentPlayerId
      });
    }
  });
}

function nextUnoPlayer(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  
  const playerIds = Object.keys(room.players).filter(id => !room.players[id].disconnected);
  room.currentPlayer = (room.currentPlayer + room.direction + playerIds.length) % playerIds.length;
}

/* ============================================
   SOCKET EVENTS
============================================ */
io.on("connection", (socket) => {
  console.log("🔌 Connected:", socket.id);
  
  // Create new room
  socket.on("create-room", (data, callback) => {
    const roomCode = generateRoomCode();
    const gameType = data.gameType || 'cards-against';
    createRoom(roomCode, gameType);
    callback({ roomCode, gameType });
  });
  
  // Join room
  socket.on("join-room", (data, callback) => {
    let { roomCode, username, gameType } = data;
    
    if (!username || !username.trim()) {
      return callback?.({ success: false, error: "Username required" });
    }
    
    username = username.trim().substring(0, 15);
    roomCode = roomCode?.toUpperCase();
    
    // Check for reconnection first
    if (roomCode && attemptReconnect(socket, roomCode, username)) {
      return callback?.({ success: true, reconnected: true, roomCode, gameType: getRoom(roomCode)?.gameType });
    }
    
    // Create room if doesn't exist
    if (!rooms[roomCode]) {
      if (!gameType) {
        return callback?.({ success: false, error: "Room not found" });
      }
      createRoom(roomCode, gameType);
    }
    
    const room = getRoom(roomCode);
    
    // Check if game in progress
    if (room.started) {
      return callback?.({ success: false, error: "Game already in progress" });
    }
    
    // Check for duplicate username
    const existingPlayer = Object.values(room.players).find(
      p => p.username.toLowerCase() === username.toLowerCase() && !p.disconnected
    );
    if (existingPlayer) {
      return callback?.({ success: false, error: "Username already taken" });
    }
    
    // Leave previous room
    if (socket.roomCode && socket.roomCode !== roomCode) {
      socket.leave(socket.roomCode);
    }
    
    // Join room
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.username = username;
    socket.visibleId = socket.id;
    
    const isFirstPlayer = Object.keys(room.players).length === 0;
    
    // Add player
    room.players[socket.id] = {
      id: socket.id,
      visibleId: socket.id,
      username,
      ready: false,
      isHost: isFirstPlayer,
      disconnected: false,
      score: 0,
      hand: [],
      hasSubmitted: false,
      isCzar: false,
      calledUno: false
    };
    
    console.log(`👤 ${username} joined ${room.gameType} room ${roomCode} (${Object.keys(room.players).length} players)`);
    
    callback?.({ success: true, roomCode, gameType: room.gameType });
    
    broadcastLobby(roomCode);
  });
  
  // Ready up
  socket.on("ready-up", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.started) return;
    
    const player = room.players[socket.id];
    if (!player || player.disconnected) return;
    
    player.ready = !player.ready; // Toggle
    
    console.log(`${player.ready ? '✅' : '⏸️'} ${player.username} ${player.ready ? 'ready' : 'unready'} in ${socket.roomCode}`);
    
    checkStartConditions(socket.roomCode);
    broadcastLobby(socket.roomCode);
  });
  
  // CAH: Submit card
  socket.on("cah-submit", (data) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.gameType !== 'cards-against' || !room.started) return;
    
    const player = room.players[socket.id];
    if (!player || player.isCzar || player.hasSubmitted || player.disconnected) return;
    
    let { card, customText } = data;
    let text = card;
    
    if (card === "__BLANK__" && customText) {
      text = filter.clean(customText.slice(0, 140));
    }
    
    // Remove card from hand
    const idx = player.hand.indexOf(card);
    if (idx === -1 && card !== "__BLANK__") return;
    
    if (idx !== -1) {
      player.hand.splice(idx, 1);
    } else {
      const blankIdx = player.hand.indexOf("__BLANK__");
      if (blankIdx !== -1) player.hand.splice(blankIdx, 1);
    }
    
    // Draw new card
    player.hand.push(drawWhite(socket.roomCode));
    
    room.submissions.push({ card: text, playerId: socket.id });
    player.hasSubmitted = true;
    
    // Shuffle when all submitted
    const nonCzar = Object.values(room.players).filter(p => !p.isCzar && !p.disconnected).length;
    if (room.submissions.length >= nonCzar) {
      room.submissions = shuffle(room.submissions);
    }
    
    broadcastCAH(socket.roomCode);
  });
  
  // CAH: Pick winner
  socket.on("cah-pick", (playerId) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.gameType !== 'cards-against' || !room.started) return;
    
    const czar = room.players[socket.id];
    if (!czar || !czar.isCzar) return;
    
    const winner = room.players[playerId];
    if (!winner) return;
    
    winner.score++;
    
    io.to(socket.roomCode).emit("round-winner", { username: winner.username, score: winner.score });
    
    if (winner.score >= WIN_POINTS) {
      io.to(socket.roomCode).emit("game-winner", { username: winner.username });
      setTimeout(() => resetRoom(socket.roomCode), 10000);
      return;
    }
    
    setTimeout(() => nextCAHRound(socket.roomCode), 4000);
  });
  
  // UNO: Play card
  socket.on("uno-play", (data) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.gameType !== 'uno' || !room.started) return;
    
    const playerIds = Object.keys(room.players).filter(id => !room.players[id].disconnected);
    const currentPlayerId = playerIds[room.currentPlayer];
    
    if (socket.id !== currentPlayerId) {
      return socket.emit("uno-error", "Not your turn!");
    }
    
    const player = room.players[socket.id];
    const { cardIndex, chosenColor } = data;
    
    if (cardIndex < 0 || cardIndex >= player.hand.length) return;
    
    const card = player.hand[cardIndex];
    
    if (!canPlayUnoCard(card, room.currentCard)) {
      return socket.emit("uno-error", "Cannot play that card!");
    }
    
    if (room.drawStack > 0 && card.value !== 'draw2' && card.value !== 'wild-draw4') {
      return socket.emit("uno-error", "Must play a draw card or draw!");
    }
    
    player.hand.splice(cardIndex, 1);
    
    if (card.color === 'wild') {
      card.activeColor = chosenColor || 'red';
    }
    
    room.currentCard = card;
    room.discardPile.push(card);
    
    // Special cards
    if (card.value === 'skip') {
      nextUnoPlayer(socket.roomCode);
    } else if (card.value === 'reverse') {
      room.direction *= -1;
      if (playerIds.length === 2) nextUnoPlayer(socket.roomCode);
    } else if (card.value === 'draw2') {
      room.drawStack += 2;
    } else if (card.value === 'wild-draw4') {
      room.drawStack += 4;
    }
    
    // Check win
    if (player.hand.length === 0) {
      io.to(socket.roomCode).emit("game-winner", { username: player.username });
      setTimeout(() => resetRoom(socket.roomCode), 8000);
      return;
    }
    
    // Check UNO call
    if (player.hand.length === 1 && !player.calledUno) {
      for (let i = 0; i < 2; i++) {
        player.hand.push(drawUnoCard(socket.roomCode));
      }
      io.to(socket.roomCode).emit("uno-penalty", { username: player.username, reason: "Forgot to call UNO!" });
    }
    
    nextUnoPlayer(socket.roomCode);
    broadcastUno(socket.roomCode);
  });
  
  // UNO: Draw card
  socket.on("uno-draw", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.gameType !== 'uno' || !room.started) return;
    
    const playerIds = Object.keys(room.players).filter(id => !room.players[id].disconnected);
    const currentPlayerId = playerIds[room.currentPlayer];
    
    if (socket.id !== currentPlayerId) return;
    
    const player = room.players[socket.id];
    
    if (room.drawStack > 0) {
      for (let i = 0; i < room.drawStack; i++) {
        player.hand.push(drawUnoCard(socket.roomCode));
      }
      room.drawStack = 0;
      nextUnoPlayer(socket.roomCode);
    } else {
      const drawnCard = drawUnoCard(socket.roomCode);
      if (drawnCard) {
        player.hand.push(drawnCard);
        if (canPlayUnoCard(drawnCard, room.currentCard)) {
          socket.emit("uno-can-play-drawn");
        } else {
          nextUnoPlayer(socket.roomCode);
        }
      }
    }
    
    broadcastUno(socket.roomCode);
  });
  
  // UNO: Call UNO
  socket.on("uno-call", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.gameType !== 'uno') return;
    
    const player = room.players[socket.id];
    if (!player) return;
    
    player.calledUno = true;
    io.to(socket.roomCode).emit("uno-called", { username: player.username });
    broadcastUno(socket.roomCode);
  });
  
  // UNO: Challenge
  socket.on("uno-challenge", (targetId) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.gameType !== 'uno') return;
    
    const target = room.players[targetId];
    if (!target || target.hand.length !== 1 || target.calledUno) return;
    
    for (let i = 0; i < 2; i++) {
      target.hand.push(drawUnoCard(socket.roomCode));
    }
    
    io.to(socket.roomCode).emit("uno-penalty", { username: target.username, reason: "Caught not calling UNO!" });
    broadcastUno(socket.roomCode);
  });
  
  // Chat
  socket.on("chat", (msg) => {
    const room = getRoom(socket.roomCode);
    if (!room) return;
    
    const player = room.players[socket.id];
    if (!player) return;
    
    const clean = filter.clean(msg.slice(0, 200));
    io.to(socket.roomCode).emit("chat", { user: player.username, text: clean });
  });
  
  // Admin
  socket.on("admin", (data) => {
    const room = getRoom(socket.roomCode);
    if (!room || !data || data.pw !== ADMIN_PASS) {
      return socket.emit("admin-fail");
    }
    
    switch (data.type) {
      case "login":
        socket.emit("admin-ok");
        break;
      case "reset":
        resetRoom(socket.roomCode);
        break;
      case "music-start":
        room.currentMusic = data.url;
        room.skipVotes.clear();
        io.to(socket.roomCode).emit("music-start", { url: data.url });
        break;
      case "wipe-chat":
        io.to(socket.roomCode).emit("wipe-chat");
        break;
    }
  });
  
  // Disconnect
  socket.on("disconnect", () => {
    handleDisconnect(socket);
  });
});

function resetRoom(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  
  console.log(`🔄 Resetting room ${roomCode}`);
  
  // Cancel any countdown
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
  
  // Reset all players
  Object.values(room.players).forEach(p => {
    p.ready = false;
    p.score = 0;
    p.hand = [];
    p.hasSubmitted = false;
    p.isCzar = false;
    p.calledUno = false;
    
    // Clear any reconnect timers
    if (p.reconnectInterval) {
      clearInterval(p.reconnectInterval);
    }
  });
  
  // Remove disconnected players
  Object.keys(room.players).forEach(id => {
    if (room.players[id].disconnected) {
      delete room.players[id];
    }
  });
  
  room.started = false;
  room.countdownSeconds = 0;
  room.submissions = [];
  room.currentBlack = "";
  room.deck = [];
  room.discardPile = [];
  room.currentCard = null;
  
  io.to(roomCode).emit("game-reset");
  broadcastLobby(roomCode);
}

/* ============================================
   START SERVER
============================================ */
server.listen(PORT, () => {
  console.log(`🎮 Game server running on port ${PORT}`);
});

setInterval(() => {
  const roomCount = Object.keys(rooms).length;
  console.log(`⏱ Keep-alive | ${roomCount} rooms active`);
}, KEEPALIVE_MS);
