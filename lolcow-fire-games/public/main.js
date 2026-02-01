// ===========================================
// CARDS AGAINST THE LCU - Main Client
// v4.0 - Enhanced UI & Engine
// ===========================================

const socket = io();

// State
let myName = "";
let roomCode = "";
let gameState = {};
let previewCardData = null;
let longPressTimer = null;
let isSubmitting = false;
let lastActionTime = 0;

// Session persistence
const SESSION_KEY = 'cah_session';
const DEBOUNCE_MS = 500;

// ===========================================
// SESSION PERSISTENCE
// ===========================================
function saveSession() {
  const session = {
    name: myName,
    roomCode: roomCode,
    sessionId: getSessionId(),
    timestamp: Date.now()
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      const session = JSON.parse(saved);
      if (Date.now() - session.timestamp < 3600000) {
        return session;
      }
    }
  } catch (e) {}
  return null;
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function getSessionId() {
  let sid = localStorage.getItem('cah_sid');
  if (!sid) {
    sid = Math.random().toString(36).substring(2, 10);
    localStorage.setItem('cah_sid', sid);
  }
  return sid;
}

// ===========================================
// DEBOUNCE
// ===========================================
function canPerformAction() {
  const now = Date.now();
  if (now - lastActionTime < DEBOUNCE_MS) return false;
  lastActionTime = now;
  return true;
}

// ===========================================
// CONNECTION
// ===========================================
socket.on("connect", () => {
  console.log("Connected:", socket.id);
  updateStatus(true);
  
  socket.emit("set-session", getSessionId());
  
  const session = loadSession();
  if (session && session.roomCode && session.name) {
    myName = session.name;
    roomCode = session.roomCode;
    document.getElementById("nameInput").value = myName;
    
    socket.emit("join-room", { 
      code: roomCode, 
      name: myName,
      sessionId: session.sessionId
    }, (res) => {
      if (res.ok) {
        document.getElementById("lobbyCode").textContent = roomCode;
        showToast("Reconnected!");
      } else {
        clearSession();
      }
    });
  }
});

socket.on("disconnect", () => {
  console.log("Disconnected");
  updateStatus(false);
});

function updateStatus(connected) {
  const el = document.getElementById("status");
  el.textContent = connected ? "🟢 Connected" : "🔴 Reconnecting...";
  el.className = connected ? "connected" : "disconnected";
}

// ===========================================
// CUSTOM MODAL SYSTEM
// ===========================================
function showModal(options) {
  return new Promise((resolve) => {
    const modal = document.getElementById("customModal");
    const title = document.getElementById("modalTitle");
    const message = document.getElementById("modalMessage");
    const input = document.getElementById("modalInput");
    const confirmBtn = document.getElementById("modalConfirm");
    const cancelBtn = document.getElementById("modalCancel");
    
    title.textContent = options.title || "Alert";
    message.textContent = options.message || "";
    
    if (options.input) {
      input.style.display = "block";
      input.value = options.inputValue || "";
      input.placeholder = options.placeholder || "";
      setTimeout(() => input.focus(), 100);
    } else {
      input.style.display = "none";
    }
    
    cancelBtn.style.display = options.showCancel ? "block" : "none";
    confirmBtn.textContent = options.confirmText || "OK";
    cancelBtn.textContent = options.cancelText || "Cancel";
    
    modal.classList.add("active");
    
    const cleanup = () => {
      modal.classList.remove("active");
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
    };
    
    confirmBtn.onclick = () => { cleanup(); resolve(options.input ? input.value : true); };
    cancelBtn.onclick = () => { cleanup(); resolve(null); };
    
    if (options.input) {
      input.onkeydown = (e) => {
        if (e.key === "Enter") { cleanup(); resolve(input.value); }
        if (e.key === "Escape") { cleanup(); resolve(null); }
      };
    }
  });
}

async function customAlert(message, title = "Notice") {
  await showModal({ title, message });
}

async function customConfirm(message, title = "Confirm") {
  return await showModal({ title, message, showCancel: true, confirmText: "Yes", cancelText: "No" }) === true;
}

async function customPrompt(message, title = "Input", placeholder = "") {
  return await showModal({ title, message, input: true, placeholder, showCancel: true });
}

// ===========================================
// SCREENS
// ===========================================
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function goHome() {
  clearSession();
  showScreen("homeScreen");
}

// ===========================================
// CREATE / JOIN
// ===========================================
async function createGame() {
  if (!canPerformAction()) return;
  
  const name = document.getElementById("nameInput").value.trim();
  if (!name) {
    await customAlert("Please enter your name first!", "Oops");
    return;
  }
  myName = name;
  
  socket.emit("create-room", {}, (res) => {
    roomCode = res.code;
    socket.emit("join-room", { 
      code: roomCode, 
      name: myName, 
      create: true,
      sessionId: getSessionId()
    }, handleJoin);
  });
}

async function joinPrompt() {
  if (!canPerformAction()) return;
  
  const name = document.getElementById("nameInput").value.trim();
  if (!name) {
    await customAlert("Please enter your name first!", "Oops");
    return;
  }
  myName = name;
  
  const code = await customPrompt("Enter the room code:", "Join Game", "ABC123");
  if (code && code.trim()) {
    roomCode = code.trim().toUpperCase();
    socket.emit("join-room", { 
      code: roomCode, 
      name: myName,
      sessionId: getSessionId()
    }, handleJoin);
  }
}

async function handleJoin(res) {
  if (res.ok) {
    document.getElementById("lobbyCode").textContent = roomCode;
    saveSession();
    showScreen("lobbyScreen");
    
    if (res.pending) showToast("You'll join next round!");
    else if (res.reconnected) showToast("Reconnected!");
  } else {
    await customAlert(res.error || "Failed to join", "Error");
  }
}

// ===========================================
// LOBBY
// ===========================================
socket.on("lobby", (data) => {
  if (data.started) return;
  
  showScreen("lobbyScreen");
  document.getElementById("lobbyCode").textContent = data.roomCode;
  roomCode = data.roomCode;
  saveSession();
  
  const list = document.getElementById("playerList");
  
  if (data.players.length === 0) {
    list.innerHTML = '<div class="status-msg">Waiting for players...</div>';
  } else {
    list.innerHTML = data.players.filter(p => p.name).map(p => {
      let classes = "player-row";
      if (p.odumid === socket.id) classes += " me";
      if (p.ready) classes += " ready";
      if (p.disconnected) classes += " dc";
      
      let status = p.disconnected ? `⏱️ ${p.reconnectTime}s` : (p.ready ? "✅" : "⏳");
      
      return `<div class="${classes}">
        <span style="font-weight:600">${escapeHtml(p.name)}${p.odumid === socket.id ? " (You)" : ""}</span>
        <span style="color:var(--text-dim)">${status}</span>
      </div>`;
    }).join("");
  }
  
  document.getElementById("waitingFor").textContent = data.waitingFor || "";
});

socket.on("countdown", (val) => {
  document.getElementById("countdownOverlay").classList.add("active");
  document.getElementById("countdownNum").textContent = val;
});

socket.on("countdown-cancelled", () => {
  document.getElementById("countdownOverlay").classList.remove("active");
  showToast("Countdown cancelled");
});

function toggleReady() {
  if (!canPerformAction()) return;
  socket.emit("ready");
}

// ===========================================
// PLAYER EVENTS
// ===========================================
socket.on("player-dc", (data) => showToast(`${data.name} disconnected`));
socket.on("player-reconnected", (data) => showToast(`${data.name} reconnected!`));
socket.on("player-left", (data) => showToast(`${data.name} left`));
socket.on("player-joined-game", (data) => showToast(`${data.name} joined!`));
socket.on("player-kicked", (data) => showToast(`${data.name} was kicked`));

// ===========================================
// GAME
// ===========================================
socket.on("game-start", () => {
  document.getElementById("countdownOverlay").classList.remove("active");
  showScreen("gameScreen");
  saveSession();
});

socket.on("game-state", (data) => {
  gameState = data;
  showScreen("gameScreen");
  renderGame();
  isSubmitting = false;
});

socket.on("game-reset", () => {
  showScreen("lobbyScreen");
  showToast("Game reset");
  document.getElementById("winnerOverlay").classList.remove("active", "game-over");
});

socket.on("game-ended", (data) => {
  showScreen("lobbyScreen");
  showToast(data.reason || "Game ended");
});

socket.on("round-timer", (seconds) => {
  const timerEl = document.getElementById("timerDisplay");
  const timerContainer = document.getElementById("roundTimer");
  timerEl.textContent = seconds + "s";
  timerContainer.classList.toggle("urgent", seconds <= 10);
});

socket.on("round-winner", (data) => {
  showWinner(`🎉 ${data.name} wins!`, false);
});

socket.on("game-winner", (data) => {
  showWinner(`🏆 ${data.name} WINS! 🏆`, true);
  fireConfetti();
});

// ===========================================
// RENDER GAME
// ===========================================
function renderGame() {
  const data = gameState;
  
  document.getElementById("blackCard").textContent = data.blackCard || "...";
  document.getElementById("czarName").textContent = data.czarName || "...";
  document.getElementById("roundNum").textContent = data.roundNumber || 1;
  
  if (data.roundTimeLeft > 0) {
    document.getElementById("timerDisplay").textContent = data.roundTimeLeft + "s";
    document.getElementById("roundTimer").classList.toggle("urgent", data.roundTimeLeft <= 10);
  }
  
  const submitted = data.submissionCount || 0;
  const expected = data.expectedCount || 1;
  const pct = Math.round((submitted / expected) * 100);
  document.getElementById("progressText").textContent = `${submitted}/${expected} submitted`;
  document.getElementById("progressFill").style.width = pct + "%";
  
  document.getElementById("scoreboard").innerHTML = data.players.map(p => {
    let classes = "score-row";
    if (p.isCzar) classes += " czar";
    return `<div class="${classes}">
      <span>${escapeHtml(p.name)}${p.isCzar ? " 👑" : ""}</span>
      <span style="font-weight:600">${p.score}</span>
    </div>`;
  }).join("");
  
  renderSubmissions(data);
  renderHand(data);
}

function renderSubmissions(data) {
  const grid = document.getElementById("submissionGrid");
  const slots = [];
  
  data.submissions.forEach((s) => {
    const canPick = data.isCzar && data.allSubmitted;
    slots.push(`
      <div class="card-wrapper">
        <div class="white-card flipped ${canPick ? 'pickable' : ''}"
          data-odumid="${s.odumid}"
          onclick="${canPick ? `pickWinner('${s.odumid}')` : ''}"
          ontouchstart="touchStartSubmission(event, '${escapeAttr(s.card)}', ${canPick}, '${s.odumid}')"
          ontouchend="touchEndCard(event)">
          <div class="card-face card-back"></div>
          <div class="card-face card-front">${escapeHtml(s.card)}</div>
        </div>
      </div>
    `);
  });
  
  while (slots.length < 10) {
    slots.push('<div class="card-wrapper empty"><div class="white-card"><div class="card-face card-front" style="background:rgba(255,255,255,0.03);border:2px dashed var(--ash)"></div></div></div>');
  }
  
  grid.innerHTML = slots.join("");
}

function renderHand(data) {
  const hand = document.getElementById("handCards");
  
  if (data.isPending) {
    hand.innerHTML = '<div class="status-msg">⏳ You\'ll join next round!</div>';
    return;
  }
  
  if (data.isCzar) {
    hand.innerHTML = '<div class="status-msg">👑 You\'re the Card Czar! Pick the funniest card above.</div>';
    return;
  }
  
  if (data.submitted) {
    hand.innerHTML = '<div class="status-msg">✅ Card submitted! Waiting for others...</div>';
    return;
  }
  
  if (!data.myHand || data.myHand.length === 0) {
    hand.innerHTML = '<div class="status-msg">Loading hand...</div>';
    return;
  }
  
  hand.innerHTML = data.myHand.map((cardData) => {
    const isRevealed = cardData.revealed;
    const card = cardData.card;
    
    return `
      <div class="card-wrapper">
        <div class="white-card ${isRevealed ? 'flipped playable' : 'blank'}"
          data-index="${cardData.index}"
          onclick="handleCardClick(${cardData.index}, '${escapeAttr(card)}', ${isRevealed})"
          ontouchstart="touchStartHand(event, ${cardData.index}, '${escapeAttr(card)}', ${isRevealed})"
          ontouchend="touchEndCard(event)">
          <div class="card-face card-back">?</div>
          <div class="card-face card-front">${escapeHtml(card)}</div>
        </div>
      </div>
    `;
  }).join("");
}

// ===========================================
// CARD INTERACTIONS
// ===========================================
function handleCardClick(index, card, revealed) {
  if (!canPerformAction()) return;
  
  if (!revealed) {
    const cardEl = document.querySelector(`[data-index="${index}"]`);
    if (cardEl) {
      cardEl.classList.add("flipped");
      cardEl.classList.remove("blank");
      cardEl.classList.add("playable");
    }
    socket.emit("reveal-card", index);
  } else {
    playCard(index, card);
  }
}

function playCard(index, card) {
  if (isSubmitting || !canPerformAction()) return;
  isSubmitting = true;
  
  document.getElementById("handCards").innerHTML = '<div class="status-msg">✅ Submitting...</div>';
  socket.emit("submit", { card: card });
}

function pickWinner(odumid) {
  if (!canPerformAction()) return;
  closePreview();
  socket.emit("pick", odumid);
}

function touchStartHand(event, index, card, revealed) {
  event.preventDefault();
  previewCardData = { index, card, revealed, type: 'hand' };
  
  if (!revealed) {
    handleCardClick(index, card, revealed);
    return;
  }
  
  longPressTimer = setTimeout(() => {
    showCardPreview(card, true, null, index);
  }, 400);
}

function touchStartSubmission(event, card, canPick, odumid) {
  event.preventDefault();
  previewCardData = { card, canPick, odumid, type: 'submission' };
  
  longPressTimer = setTimeout(() => {
    showCardPreview(card, canPick, odumid, null);
  }, 400);
}

function touchEndCard(event) {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  
  if (previewCardData && !document.getElementById("cardPreview").classList.contains("active")) {
    const { type, index, card, revealed, canPick, odumid } = previewCardData;
    
    if (type === 'hand' && revealed) {
      playCard(index, card);
    } else if (type === 'submission' && canPick) {
      pickWinner(odumid);
    }
  }
  
  previewCardData = null;
}

function showCardPreview(cardText, canAct, odumid, cardIndex) {
  const preview = document.getElementById("cardPreview");
  const content = document.getElementById("previewCardContent");
  const playBtn = document.getElementById("previewPlayBtn");
  
  content.textContent = cardText;
  
  if (canAct) {
    playBtn.style.display = "block";
    playBtn.onclick = () => {
      if (odumid) pickWinner(odumid);
      else if (cardIndex !== undefined) playCard(cardIndex, cardText);
    };
  } else {
    playBtn.style.display = "none";
  }
  
  preview.classList.add("active");
}

function closePreview() {
  document.getElementById("cardPreview").classList.remove("active");
  previewCardData = null;
}

document.getElementById("cardPreview").addEventListener("click", (e) => {
  if (e.target.id === "cardPreview") closePreview();
});

// ===========================================
// REMATCH
// ===========================================
function requestRematch() {
  if (!canPerformAction()) return;
  socket.emit("rematch");
  document.getElementById("winnerOverlay").classList.remove("active", "game-over");
}

// ===========================================
// CONFETTI (Fire Colors)
// ===========================================
function fireConfetti() {
  if (typeof confetti !== "function") return;
  
  const fireColors = ['#e63022', '#ff5722', '#ff8a50', '#ffc107', '#ff6b00'];
  
  confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors: fireColors });
  
  setTimeout(() => {
    confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 }, colors: fireColors });
    confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 }, colors: fireColors });
  }, 250);
  
  setTimeout(() => {
    confetti({ particleCount: 150, spread: 100, origin: { y: 0.7 }, colors: fireColors });
  }, 500);
}

// ===========================================
// CHAT
// ===========================================
function toggleChat() {
  const container = document.getElementById("chatContainer");
  container.classList.toggle("open");
  
  if (container.classList.contains("open")) {
    document.getElementById("chatMessages").scrollTop = document.getElementById("chatMessages").scrollHeight;
  }
}

function sendChat() {
  const input = document.getElementById("chatInput");
  if (input.value.trim()) {
    socket.emit("chat", input.value.trim());
    input.value = "";
  }
}

socket.on("chat", (data) => {
  const box = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = "chat-msg";
  div.innerHTML = `<b>${escapeHtml(data.name)}:</b> ${escapeHtml(data.msg)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  
  if (!document.getElementById("chatContainer").classList.contains("open")) {
    document.querySelector(".chat-header").style.boxShadow = "0 0 30px var(--fire-orange)";
    setTimeout(() => { document.querySelector(".chat-header").style.boxShadow = ""; }, 600);
  }
});

socket.on("chat-clear", () => {
  document.getElementById("chatMessages").innerHTML = "";
});

document.getElementById("chatInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendChat();
});

// ===========================================
// ADMIN
// ===========================================
async function openAdmin() {
  const pw = await customPrompt("Admin password:", "Admin");
  if (pw) socket.emit("admin", { pw, action: "login" });
}

socket.on("admin-ok", async () => {
  const action = await showModal({
    title: "🛠️ Admin",
    message: "Choose action:",
    showCancel: true,
    confirmText: "Reset Game",
    cancelText: "Clear Chat"
  });
  
  if (action === true) {
    const pw = await customPrompt("Confirm password:", "Reset");
    if (pw) socket.emit("admin", { pw, action: "reset" });
  } else {
    const confirm = await customConfirm("Clear chat?", "Clear");
    if (confirm) {
      const pw = await customPrompt("Confirm password:", "Clear");
      if (pw) socket.emit("admin", { pw, action: "wipe-chat" });
    }
  }
});

socket.on("admin-fail", () => customAlert("Wrong password!", "Denied"));

// ===========================================
// TOAST & OVERLAYS
// ===========================================
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("active");
  setTimeout(() => t.classList.remove("active"), 3000);
}

function showWinner(msg, isGameOver) {
  const overlay = document.getElementById("winnerOverlay");
  document.getElementById("winnerText").textContent = msg;
  
  overlay.classList.toggle("game-over", isGameOver);
  overlay.classList.add("active");
  
  if (!isGameOver) {
    setTimeout(() => overlay.classList.remove("active"), 3500);
  }
}

// ===========================================
// UTILITIES
// ===========================================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/</g, '&lt;');
}

// ===========================================
// KEYBOARD
// ===========================================
document.getElementById("nameInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") createGame();
});

// ===========================================
// PRELOAD IMAGES
// ===========================================
['whitecard.png', 'blkcard.png', 'cardsback.png'].forEach(src => {
  const img = new Image();
  img.src = src;
});

// ===========================================
// PREVENT DOUBLE TAP ZOOM
// ===========================================
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 300) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// ===========================================
// INIT
// ===========================================
showScreen("homeScreen");
const savedSession = loadSession();
if (savedSession?.name) document.getElementById("nameInput").value = savedSession.name;
