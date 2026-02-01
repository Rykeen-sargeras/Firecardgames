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
const COUNTDOWN_SECONDS = 15; // Changed from 30 to 15
const RECONNECT_SECONDS = 60;
const BLANK_CARD = "__BLANK__";

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
  "Plain old boring vanilla sex",
  "My relationship status",
  "Dying alone and full of regrets"
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
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ===========================================
// ROOMS
// ===========================================
const rooms = {};

function createRoom(code, gameType) {
  rooms[code] = {
    code: code,
    gameType: gameType,
    players: {},
    started: false,
    
    // Countdown
    countdownTimer: null,
    countdownValue: 0,
    
    // CAH - NO DUPLICATES deck system
    whiteDeck: [],
    whiteDiscard: [],
    blackDeck: [],
    blackDiscard: [],
    usedBlanks: new Set(), // Track who used their blank
    currentBlack: "",
    submissions: [],
    czarIndex: 0,
    roundNumber: 0,
    
    // Pending players (joining mid-game)
    pendingPlayers: {},
    
    // UNO
    unoDeck: [],
    discardPile: [],
    currentCard: null,
    currentPlayerIndex: 0,
    direction: 1,
    drawStack: 0
  };
  
  // Initialize decks with NO duplicates
  rooms[code].whiteDeck = shuffle([...whiteCardsOriginal]);
  rooms[code].blackDeck = shuffle([...blackCardsOriginal]);
  
  console.log(`Room ${code} created for ${gameType}`);
  return rooms[code];
}

function getRoom(code) {
  return rooms[code];
}

// ===========================================
// CARD DRAWING - NO DUPLICATES
// ===========================================
function drawWhiteCard(room, excludeCards = []) {
  // If deck empty, reshuffle discard
  if (room.whiteDeck.length === 0) {
    if (room.whiteDiscard.length === 0) {
      // Completely out - shouldn't happen but reset
      room.whiteDeck = shuffle([...whiteCardsOriginal]);
    } else {
      room.whiteDeck = shuffle([...room.whiteDiscard]);
      room.whiteDiscard = [];
      console.log("White deck reshuffled from discard");
    }
  }
  
  // Draw card that's not in exclude list
  let card = null;
  let attempts = 0;
  while (attempts < room.whiteDeck.length) {
    const idx = room.whiteDeck.length - 1 - attempts;
    if (idx < 0) break;
    
    const candidate = room.whiteDeck[idx];
    if (!excludeCards.includes(candidate)) {
      card = room.whiteDeck.splice(idx, 1)[0];
      break;
    }
    attempts++;
  }
  
  // Fallback if all cards excluded somehow
  if (!card && room.whiteDeck.length > 0) {
    card = room.whiteDeck.pop();
  }
  
  return card;
}

function drawBlackCard(room) {
  if (room.blackDeck.length === 0) {
    if (room.blackDiscard.length === 0) {
      room.blackDeck = shuffle([...blackCardsOriginal]);
    } else {
      room.blackDeck = shuffle([...room.blackDiscard]);
      room.blackDiscard = [];
      console.log("Black deck reshuffled from discard");
    }
  }
  return room.blackDeck.pop();
}

function discardWhiteCard(room, card) {
  if (card && card !== BLANK_CARD) {
    room.whiteDiscard.push(card);
  }
}

function discardBlackCard(room, card) {
  if (card) {
    room.blackDiscard.push(card);
  }
}

// ===========================================
// LOBBY BROADCAST
// ===========================================
function broadcastLobby(code) {
  const room = getRoom(code);
  if (!room) return;
  
  const playerList = [];
  
  for (const [id, p] of Object.entries(room.players)) {
    // Skip if no name
    if (!p.name) continue;
    
    playerList.push({
      odumid: id,
      name: p.name || "Unknown",
      ready: p.ready === true,
      disconnected: p.disconnected === true,
      reconnectTime: p.reconnectTime || 0
    });
  }
  
  const activePlayers = playerList.filter(p => !p.disconnected);
  const readyPlayers = activePlayers.filter(p => p.ready);
  const notReadyPlayers = activePlayers.filter(p => !p.ready);
  const minPlayers = room.gameType === "cah" ? 3 : 2;
  
  let waitingFor = "";
  if (activePlayers.length < minPlayers) {
    const need = minPlayers - activePlayers.length;
    waitingFor = `Need ${need} more player${need > 1 ? 's' : ''} (min ${minPlayers})`;
  } else if (notReadyPlayers.length > 0) {
    const names = notReadyPlayers.map(p => p.name).join(", ");
    waitingFor = `Waiting for: ${names}`;
  } else if (room.countdownValue > 0) {
    waitingFor = `Starting in ${room.countdownValue}s...`;
  } else {
    waitingFor = "All ready!";
  }
  
  const data = {
    roomCode: code,
    gameType: room.gameType,
    players: playerList,
    activeCount: activePlayers.length,
    readyCount: readyPlayers.length,
    minPlayers: minPlayers,
    countdown: room.countdownValue,
    waitingFor: waitingFor,
    started: room.started
  };
  
  console.log(`LOBBY ${code}: ${readyPlayers.length}/${activePlayers.length} ready`);
  io.to(code).emit("lobby", data);
}

// ===========================================
// COUNTDOWN
// ===========================================
function checkAndStartCountdown(code) {
  const room = getRoom(code);
  if (!room || room.started) return;
  
  const players = Object.values(room.players).filter(p => !p.disconnected && p.name);
  const readyCount = players.filter(p => p.ready).length;
  const minPlayers = room.gameType === "cah" ? 3 : 2;
  
  const allReady = players.length >= minPlayers && readyCount === players.length;
  
  if (allReady && !room.countdownTimer) {
    room.countdownValue = COUNTDOWN_SECONDS;
    console.log(`Starting ${COUNTDOWN_SECONDS}s countdown in ${code}`);
    
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
    console.log(`Countdown cancelled in ${code}`);
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
    room.countdownValue = 0;
    io.to(code).emit("countdown-cancelled");
    broadcastLobby(code);
  }
}

// ===========================================
// RECONNECTION
// ===========================================
function startReconnectTimer(code, odumid) {
  const room = getRoom(code);
  if (!room) return;
  
  const player = room.players[odumid];
  if (!player) return;
  
  player.disconnected = true;
  player.reconnectTime = RECONNECT_SECONDS;
  
  console.log(`${player.name} disconnected - ${RECONNECT_SECONDS}s to reconnect`);
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
        console.log(`${player.name} reconnect timeout`);
        
        // Return cards to discard
        if (player.hand) {
          player.hand.forEach(card => {
            if (card !== BLANK_CARD) {
              discardWhiteCard(room, card);
            }
          });
        }
        
        delete room.players[odumid];
        io.to(code).emit("player-left", { name: player.name });
        
        if (Object.keys(room.players).length === 0) {
          delete rooms[code];
          console.log(`Room ${code} deleted - empty`);
        } else {
          broadcastLobby(code);
          checkAndStartCountdown(code);
          if (room.started) {
            sendCAHState(code);
          }
        }
      }
    } else {
      broadcastLobby(code);
    }
  }, 1000);
  
  player.reconnectTimer = timer;
  broadcastLobby(code);
}

function tryReconnect(socket, code, name) {
  const room = getRoom(code);
  if (!room) return false;
  
  for (const [odumid, player] of Object.entries(room.players)) {
    if (player.name && player.name.toLowerCase() === name.toLowerCase() && player.disconnected) {
      console.log(`${name} reconnecting to ${code}`);
      
      if (player.reconnectTimer) {
        clearInterval(player.reconnectTimer);
      }
      
      player.disconnected = false;
      player.reconnectTime = 0;
      player.socketId = socket.id;
      
      delete room.players[odumid];
      room.players[socket.id] = player;
      
      socket.join(code);
      socket.roomCode = code;
      socket.playerName = name;
      
      io.to(code).emit("player-reconnected", { name: name });
      broadcastLobby(code);
      
      if (room.started) {
        sendCAHState(code);
      }
      
      return true;
    }
  }
  return false;
}

// ===========================================
// START GAME
// ===========================================
function startGame(code) {
  const room = getRoom(code);
  if (!room) return;
  
  room.started = true;
  room.roundNumber = 0;
  console.log(`Game started in ${code} - ${room.gameType}`);
  
  if (room.gameType === "cah") {
    startCAH(code);
  } else {
    startUNO(code);
  }
}

// ===========================================
// CAH - CARDS AGAINST HUMANITY
// ===========================================
function startCAH(code) {
  const room = getRoom(code);
  
  // Reset decks
  room.whiteDeck = shuffle([...whiteCardsOriginal]);
  room.whiteDiscard = [];
  room.blackDeck = shuffle([...blackCardsOriginal]);
  room.blackDiscard = [];
  room.usedBlanks.clear();
  
  // Deal hands - NO DUPLICATES + 1 BLANK each
  const ids = Object.keys(room.players).filter(id => !room.players[id].disconnected && room.players[id].name);
  
  ids.forEach((id, i) => {
    const p = room.players[id];
    p.hand = [];
    
    // Everyone starts with ONE blank card
    p.hand.push(BLANK_CARD);
    p.hasBlank = true;
    
    // Deal 9 more unique cards (10 total with blank)
    const existingCards = [...p.hand];
    for (let j = 0; j < 9; j++) {
      const card = drawWhiteCard(room, existingCards);
      if (card) {
        p.hand.push(card);
        existingCards.push(card);
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
  
  io.to(code).emit("game-start", { gameType: "cah" });
  sendCAHState(code);
}

function sendCAHState(code) {
  const room = getRoom(code);
  if (!room || room.gameType !== "cah") return;
  
  const players = Object.values(room.players).filter(p => !p.disconnected && p.name);
  const czar = players.find(p => p.isCzar);
  const nonCzar = players.filter(p => !p.isCzar);
  const allSubmitted = room.submissions.length >= nonCzar.length && nonCzar.length > 0;
  
  // Submissions are ALWAYS visible to everyone (shuffled)
  const visibleSubmissions = room.submissions.map(s => ({
    odumid: s.odumid,
    card: s.card,
    // Don't show who submitted until czar picks
    name: allSubmitted ? null : null
  }));
  
  for (const [id, p] of Object.entries(room.players)) {
    if (p.disconnected || !p.name) continue;
    
    const sock = io.sockets.sockets.get(id);
    if (sock) {
      sock.emit("cah-state", {
        blackCard: room.currentBlack,
        czarName: czar ? czar.name : "...",
        czarId: czar ? Object.keys(room.players).find(k => room.players[k] === czar) : null,
        isCzar: p.isCzar,
        myHand: p.hand || [],
        submitted: p.submitted,
        submissions: visibleSubmissions,
        allSubmitted: allSubmitted,
        submissionCount: room.submissions.length,
        expectedCount: nonCzar.length,
        players: players.map(x => ({
          name: x.name,
          score: x.score,
          isCzar: x.isCzar,
          submitted: x.submitted
        })),
        roundNumber: room.roundNumber
      });
    }
  }
  
  // Also update pending players
  for (const [id, p] of Object.entries(room.pendingPlayers || {})) {
    const sock = io.sockets.sockets.get(id);
    if (sock) {
      sock.emit("cah-state", {
        blackCard: room.currentBlack,
        czarName: czar ? czar.name : "...",
        isCzar: false,
        myHand: [],
        submitted: true, // They can't play this round
        submissions: visibleSubmissions,
        allSubmitted: allSubmitted,
        players: players.map(x => ({
          name: x.name,
          score: x.score,
          isCzar: x.isCzar,
          submitted: x.submitted
        })),
        isPending: true,
        pendingMessage: "You'll join next round!"
      });
    }
  }
}

function nextCAHRound(code) {
  const room = getRoom(code);
  if (!room) return;
  
  // Add pending players to the game
  for (const [id, pending] of Object.entries(room.pendingPlayers || {})) {
    room.players[id] = pending;
    
    // Deal them a hand
    pending.hand = [BLANK_CARD];
    pending.hasBlank = true;
    const existingCards = [...pending.hand];
    for (let j = 0; j < 9; j++) {
      const card = drawWhiteCard(room, existingCards);
      if (card) {
        pending.hand.push(card);
        existingCards.push(card);
      }
    }
    pending.score = 0;
    
    io.to(code).emit("player-joined-game", { name: pending.name });
  }
  room.pendingPlayers = {};
  
  // Discard current black card
  discardBlackCard(room, room.currentBlack);
  
  const ids = Object.keys(room.players).filter(id => !room.players[id].disconnected && room.players[id].name);
  if (ids.length < 3) {
    room.started = false;
    io.to(code).emit("game-ended", { reason: "Not enough players" });
    
    // Reset ready status
    Object.values(room.players).forEach(p => { p.ready = false; });
    broadcastLobby(code);
    return;
  }
  
  // Next czar
  room.czarIndex = (room.czarIndex + 1) % ids.length;
  
  ids.forEach((id, i) => {
    const p = room.players[id];
    p.isCzar = (i === room.czarIndex);
    p.submitted = false;
  });
  
  // Check if all blanks used - redistribute
  const playersWithBlanks = ids.filter(id => room.players[id].hasBlank);
  if (playersWithBlanks.length === 0) {
    console.log("All blanks used - redistributing");
    ids.forEach(id => {
      const p = room.players[id];
      if (!p.hand.includes(BLANK_CARD)) {
        p.hand.push(BLANK_CARD);
        p.hasBlank = true;
      }
    });
  }
  
  room.currentBlack = drawBlackCard(room);
  room.submissions = [];
  room.roundNumber++;
  
  sendCAHState(code);
}

// ===========================================
// UNO (keeping basic for now)
// ===========================================
function createUNODeck() {
  const colors = ["red", "yellow", "green", "blue"];
  const deck = [];
  
  colors.forEach(color => {
    deck.push({ color, value: "0" });
    for (let i = 0; i < 2; i++) {
      ["1","2","3","4","5","6","7","8","9","skip","reverse","draw2"].forEach(v => {
        deck.push({ color, value: v });
      });
    }
  });
  
  for (let i = 0; i < 4; i++) {
    deck.push({ color: "wild", value: "wild" });
    deck.push({ color: "wild", value: "draw4" });
  }
  
  return shuffle(deck);
}

function drawUNO(code) {
  const room = getRoom(code);
  if (room.unoDeck.length === 0) {
    const top = room.discardPile.pop();
    room.unoDeck = shuffle(room.discardPile);
    room.discardPile = [top];
  }
  return room.unoDeck.pop();
}

function startUNO(code) {
  const room = getRoom(code);
  
  room.unoDeck = createUNODeck();
  room.discardPile = [];
  room.currentPlayerIndex = 0;
  room.direction = 1;
  room.drawStack = 0;
  
  const ids = Object.keys(room.players).filter(id => !room.players[id].disconnected);
  ids.forEach(id => {
    const p = room.players[id];
    p.hand = [];
    for (let j = 0; j < 7; j++) {
      p.hand.push(drawUNO(code));
    }
    p.calledUno = false;
  });
  
  let startCard;
  do {
    startCard = drawUNO(code);
  } while (startCard.color === "wild" || ["skip","reverse","draw2"].includes(startCard.value));
  
  room.currentCard = startCard;
  room.discardPile.push(startCard);
  
  io.to(code).emit("game-start", { gameType: "uno" });
  sendUNOState(code);
}

function sendUNOState(code) {
  const room = getRoom(code);
  if (!room || room.gameType !== "uno") return;
  
  const ids = Object.keys(room.players).filter(id => !room.players[id].disconnected);
  const currentId = ids[room.currentPlayerIndex] || ids[0];
  
  for (const [id, p] of Object.entries(room.players)) {
    if (p.disconnected) continue;
    
    const sock = io.sockets.sockets.get(id);
    if (sock) {
      sock.emit("uno-state", {
        currentCard: room.currentCard,
        myHand: p.hand,
        isMyTurn: id === currentId,
        direction: room.direction,
        drawStack: room.drawStack,
        deckCount: room.unoDeck.length,
        players: ids.map(pid => ({
          name: room.players[pid].name,
          odumid: pid,
          cardCount: room.players[pid].hand.length,
          calledUno: room.players[pid].calledUno,
          isCurrentTurn: pid === currentId
        }))
      });
    }
  }
}

function nextUNOPlayer(code) {
  const room = getRoom(code);
  const ids = Object.keys(room.players).filter(id => !room.players[id].disconnected);
  room.currentPlayerIndex = (room.currentPlayerIndex + room.direction + ids.length) % ids.length;
}

function canPlayUNO(card, topCard) {
  if (card.color === "wild") return true;
  const topColor = topCard.activeColor || topCard.color;
  if (card.color === topColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

// ===========================================
// SOCKET HANDLING
// ===========================================
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
  
  socket.on("create-room", (data, cb) => {
    const code = generateCode();
    createRoom(code, data.gameType || "cah");
    cb({ code: code, gameType: data.gameType || "cah" });
  });
  
  socket.on("join-room", (data, cb) => {
    const code = (data.code || "").toUpperCase().trim();
    const name = (data.name || "").trim().substring(0, 15);
    
    if (!name) {
      return cb({ ok: false, error: "Name required" });
    }
    
    if (!code) {
      return cb({ ok: false, error: "Room code required" });
    }
    
    // Try reconnect
    if (tryReconnect(socket, code, name)) {
      return cb({ ok: true, reconnected: true, gameType: getRoom(code).gameType });
    }
    
    let room = getRoom(code);
    if (!room) {
      if (!data.gameType) {
        return cb({ ok: false, error: "Room not found" });
      }
      room = createRoom(code, data.gameType);
    }
    
    // Check name taken
    const nameTaken = Object.values(room.players).some(
      p => p.name && p.name.toLowerCase() === name.toLowerCase() && !p.disconnected
    );
    if (nameTaken) {
      return cb({ ok: false, error: "Name taken" });
    }
    
    // Also check pending players
    const namePending = Object.values(room.pendingPlayers || {}).some(
      p => p.name && p.name.toLowerCase() === name.toLowerCase()
    );
    if (namePending) {
      return cb({ ok: false, error: "Name taken" });
    }
    
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name;
    
    // If game already started, add to pending
    if (room.started) {
      room.pendingPlayers = room.pendingPlayers || {};
      room.pendingPlayers[socket.id] = {
        name: name,
        ready: true,
        disconnected: false,
        socketId: socket.id
      };
      
      console.log(`${name} joined ${code} mid-game (pending)`);
      cb({ ok: true, gameType: room.gameType, pending: true });
      
      // Send them current game state as spectator
      sendCAHState(code);
      return;
    }
    
    room.players[socket.id] = {
      name: name,
      ready: false,
      disconnected: false,
      socketId: socket.id
    };
    
    console.log(`${name} joined ${code}`);
    cb({ ok: true, gameType: room.gameType });
    broadcastLobby(code);
  });
  
  socket.on("ready", () => {
    const code = socket.roomCode;
    const room = getRoom(code);
    if (!room || room.started) return;
    
    const p = room.players[socket.id];
    if (!p || !p.name) return;
    
    p.ready = !p.ready;
    console.log(`${p.name} ${p.ready ? "ready" : "unready"}`);
    
    broadcastLobby(code);
    checkAndStartCountdown(code);
  });
  
  socket.on("cah-submit", (data) => {
    const code = socket.roomCode;
    const room = getRoom(code);
    if (!room || !room.started || room.gameType !== "cah") return;
    
    const p = room.players[socket.id];
    if (!p || p.isCzar || p.submitted || !p.name) return;
    
    let cardText = data.card;
    const isBlank = data.card === BLANK_CARD;
    
    if (isBlank && data.custom) {
      cardText = filter.clean(data.custom.substring(0, 100));
      p.hasBlank = false;
      room.usedBlanks.add(socket.id);
    }
    
    // Remove card from hand
    const idx = p.hand.indexOf(data.card);
    if (idx !== -1) {
      p.hand.splice(idx, 1);
    } else if (isBlank) {
      const blankIdx = p.hand.indexOf(BLANK_CARD);
      if (blankIdx !== -1) p.hand.splice(blankIdx, 1);
    } else {
      return; // Card not in hand
    }
    
    // Draw replacement (no duplicates)
    const newCard = drawWhiteCard(room, p.hand);
    if (newCard) {
      p.hand.push(newCard);
    }
    
    // Discard played card
    if (!isBlank) {
      discardWhiteCard(room, data.card);
    }
    
    p.submitted = true;
    room.submissions.push({ 
      odumid: socket.id, 
      card: cardText, 
      name: p.name 
    });
    
    // Shuffle submissions for fairness
    room.submissions = shuffle(room.submissions);
    
    console.log(`${p.name} submitted, ${room.submissions.length} total`);
    sendCAHState(code);
  });
  
  socket.on("cah-pick", (odumid) => {
    const code = socket.roomCode;
    const room = getRoom(code);
    if (!room || !room.started) return;
    
    const me = room.players[socket.id];
    if (!me || !me.isCzar) return;
    
    const winner = room.players[odumid];
    if (!winner) return;
    
    winner.score++;
    io.to(code).emit("round-winner", { 
      name: winner.name, 
      score: winner.score,
      odumid: odumid
    });
    
    if (winner.score >= WIN_POINTS) {
      io.to(code).emit("game-winner", { name: winner.name });
      setTimeout(() => {
        room.started = false;
        Object.values(room.players).forEach(p => { p.ready = false; });
        broadcastLobby(code);
      }, 5000);
    } else {
      setTimeout(() => nextCAHRound(code), 3000);
    }
  });
  
  // UNO events
  socket.on("uno-play", (data) => {
    const code = socket.roomCode;
    const room = getRoom(code);
    if (!room || !room.started || room.gameType !== "uno") return;
    
    const ids = Object.keys(room.players).filter(id => !room.players[id].disconnected);
    const currentId = ids[room.currentPlayerIndex];
    if (socket.id !== currentId) return;
    
    const p = room.players[socket.id];
    const card = p.hand[data.cardIndex];
    if (!card) return;
    
    if (!canPlayUNO(card, room.currentCard)) {
      return socket.emit("uno-error", "Can't play that card");
    }
    
    p.hand.splice(data.cardIndex, 1);
    
    if (card.color === "wild") {
      card.activeColor = data.color || "red";
    }
    
    room.currentCard = card;
    room.discardPile.push(card);
    
    if (card.value === "skip") {
      nextUNOPlayer(code);
    } else if (card.value === "reverse") {
      room.direction *= -1;
      if (ids.length === 2) nextUNOPlayer(code);
    } else if (card.value === "draw2") {
      room.drawStack += 2;
    } else if (card.value === "draw4") {
      room.drawStack += 4;
    }
    
    if (p.hand.length === 0) {
      io.to(code).emit("game-winner", { name: p.name });
      setTimeout(() => {
        room.started = false;
        Object.values(room.players).forEach(x => { x.ready = false; });
        broadcastLobby(code);
      }, 5000);
      return;
    }
    
    if (p.hand.length === 1 && !p.calledUno) {
      p.hand.push(drawUNO(code));
      p.hand.push(drawUNO(code));
      io.to(code).emit("uno-penalty", { name: p.name, reason: "Forgot UNO!" });
    }
    
    nextUNOPlayer(code);
    sendUNOState(code);
  });
  
  socket.on("uno-draw", () => {
    const code = socket.roomCode;
    const room = getRoom(code);
    if (!room || !room.started || room.gameType !== "uno") return;
    
    const ids = Object.keys(room.players).filter(id => !room.players[id].disconnected);
    const currentId = ids[room.currentPlayerIndex];
    if (socket.id !== currentId) return;
    
    const p = room.players[socket.id];
    
    if (room.drawStack > 0) {
      for (let i = 0; i < room.drawStack; i++) {
        p.hand.push(drawUNO(code));
      }
      room.drawStack = 0;
    } else {
      p.hand.push(drawUNO(code));
    }
    
    nextUNOPlayer(code);
    sendUNOState(code);
  });
  
  socket.on("uno-call", () => {
    const code = socket.roomCode;
    const room = getRoom(code);
    if (!room || !room.started) return;
    
    const p = room.players[socket.id];
    if (p) {
      p.calledUno = true;
      io.to(code).emit("uno-called", { name: p.name });
    }
  });
  
  socket.on("uno-challenge", (targetId) => {
    const code = socket.roomCode;
    const room = getRoom(code);
    if (!room || !room.started) return;
    
    const target = room.players[targetId];
    if (target && target.hand.length === 1 && !target.calledUno) {
      target.hand.push(drawUNO(code));
      target.hand.push(drawUNO(code));
      io.to(code).emit("uno-penalty", { name: target.name, reason: "Caught!" });
      sendUNOState(code);
    }
  });
  
  socket.on("chat", (msg) => {
    const code = socket.roomCode;
    const room = getRoom(code);
    if (!room) return;
    
    let name = "Unknown";
    if (room.players[socket.id] && room.players[socket.id].name) {
      name = room.players[socket.id].name;
    } else if (room.pendingPlayers && room.pendingPlayers[socket.id]) {
      name = room.pendingPlayers[socket.id].name;
    }
    
    io.to(code).emit("chat", {
      name: name,
      msg: filter.clean((msg || "").substring(0, 200))
    });
  });
  
  socket.on("admin", (data) => {
    if (data.pw !== ADMIN_PASS) {
      return socket.emit("admin-fail");
    }
    
    socket.emit("admin-ok");
    
    const code = socket.roomCode;
    const room = getRoom(code);
    if (!room) return;
    
    if (data.action === "reset") {
      room.started = false;
      if (room.countdownTimer) {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
      }
      room.countdownValue = 0;
      room.pendingPlayers = {};
      Object.values(room.players).forEach(p => {
        p.ready = false;
        p.hand = [];
        p.score = 0;
      });
      io.to(code).emit("game-reset");
      broadcastLobby(code);
    }
    
    if (data.action === "wipe-chat") {
      io.to(code).emit("chat-clear");
    }
  });
  
  socket.on("disconnect", () => {
    const code = socket.roomCode;
    const room = getRoom(code);
    if (!room) return;
    
    // Check if in pending
    if (room.pendingPlayers && room.pendingPlayers[socket.id]) {
      delete room.pendingPlayers[socket.id];
      return;
    }
    
    const p = room.players[socket.id];
    if (!p) return;
    
    startReconnectTimer(code, socket.id);
  });
});

// ===========================================
// START SERVER
// ===========================================
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

setInterval(() => {
  console.log("Keep-alive ping");
}, 280000);
