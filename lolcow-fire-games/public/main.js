// ===========================================
// CARDS AGAINST THE LCU - Desktop Client
// ===========================================

const socket = io();
const BLANK_CARD = "__BLANK__";

// State
let myName = "";
let roomCode = "";
let gameState = {};
let isSubmitting = false;
let lastActionTime = 0;
let adminPassword = null;

// FIX #3: Double-confirm state for card submission
let selectedCard = null;
let selectedCardIndex = null;
let confirmPending = false;

// Session persistence
const SESSION_KEY = 'cah_session';
const DEBOUNCE_MS = 300;

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
    const textarea = document.getElementById("modalTextarea");
    const confirmBtn = document.getElementById("modalConfirm");
    const cancelBtn = document.getElementById("modalCancel");
    
    title.textContent = options.title || "Alert";
    message.textContent = options.message || "";
    
    input.style.display = "none";
    textarea.style.display = "none";
    
    if (options.textarea) {
      textarea.style.display = "block";
      textarea.value = options.inputValue || "";
      textarea.placeholder = options.placeholder || "";
      setTimeout(() => textarea.focus(), 100);
    } else if (options.input) {
      input.style.display = "block";
      input.value = options.inputValue || "";
      input.placeholder = options.placeholder || "";
      setTimeout(() => input.focus(), 100);
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
    
    const getValue = () => {
      if (options.textarea) return textarea.value;
      if (options.input) return input.value;
      return true;
    };
    
    confirmBtn.onclick = () => { cleanup(); resolve(getValue()); };
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

async function customTextarea(message, title = "Write", placeholder = "") {
  return await showModal({ title, message, textarea: true, placeholder, showCancel: true, confirmText: "Submit" });
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
  resetCardSelection();
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
  resetCardSelection();
});

socket.on("full-reset", () => {
  clearSession();
  showScreen("homeScreen");
  showToast("Room closed by admin");
  document.getElementById("winnerOverlay").classList.remove("active", "game-over");
  resetCardSelection();
});

socket.on("game-ended", (data) => {
  showScreen("lobbyScreen");
  showToast(data.reason || "Game ended");
  resetCardSelection();
});

socket.on("round-timer", (data) => {
  const timerEl = document.getElementById("timerDisplay");
  const timerContainer = document.getElementById("roundTimer");
  
  const seconds = typeof data === 'object' ? data.time : data;
  const phase = typeof data === 'object' ? data.phase : 'submit';
  
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  
  timerContainer.classList.toggle("urgent", seconds <= 15);
  
  const timerLabel = document.getElementById("timerLabel");
  if (timerLabel) {
    timerLabel.textContent = phase === 'judge' ? '⚖️' : '⏱️';
  }
});

socket.on("judge-phase", () => {
  showToast("Time to judge!");
});

socket.on("round-winner", (data) => {
  showWinner(`🎉 ${data.name} wins!`, false);
  resetCardSelection();
});

socket.on("game-winner", (data) => {
  showWinner(`🏆 ${data.name} WINS! 🏆`, true);
  fireConfetti();
  resetCardSelection();
});

// ===========================================
// FIX #3: Reset card selection state
// ===========================================
function resetCardSelection() {
  selectedCard = null;
  selectedCardIndex = null;
  confirmPending = false;
  hideConfirmButton();
}

function hideConfirmButton() {
  const confirmArea = document.getElementById("confirmArea");
  if (confirmArea) {
    confirmArea.classList.remove("active");
  }
}

function showConfirmButton(cardText, isBlank) {
  const confirmArea = document.getElementById("confirmArea");
  const confirmText = document.getElementById("confirmCardText");
  
  if (confirmArea && confirmText) {
    confirmText.textContent = isBlank ? "✏️ BLANK CARD (Write your own)" : cardText;
    confirmArea.classList.add("active");
  }
}

// ===========================================
// RENDER GAME
// ===========================================
function renderGame() {
  const data = gameState;
  
  document.getElementById("blackCard").textContent = data.blackCard || "...";
  document.getElementById("czarName").textContent = data.czarName || "...";
  document.getElementById("roundNum").textContent = data.roundNumber || 1;
  
  if (data.roundTimeLeft > 0) {
    const mins = Math.floor(data.roundTimeLeft / 60);
    const secs = data.roundTimeLeft % 60;
    document.getElementById("timerDisplay").textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    document.getElementById("roundTimer").classList.toggle("urgent", data.roundTimeLeft <= 15);
  }
  
  const submitted = data.submissionCount || 0;
  const expected = data.expectedCount || 1;
  const pct = Math.round((submitted / expected) * 100);
  document.getElementById("progressText").textContent = `${submitted}/${expected} submitted`;
  document.getElementById("progressFill").style.width = pct + "%";
  
  // FIX #4: Show waiting state banner
  const waitingBanner = document.getElementById("waitingBanner");
  if (waitingBanner) {
    if (data.isPending) {
      // FIX #7: Show pending player banner
      waitingBanner.textContent = data.pendingMessage || "Finishing current round — you will be added next round.";
      waitingBanner.classList.add("active", "pending");
    } else if (data.waitingForSubmissions && !data.isCzar && data.submitted) {
      waitingBanner.textContent = "⏳ Waiting for other players to submit cards...";
      waitingBanner.classList.add("active");
      waitingBanner.classList.remove("pending");
    } else if (data.allSubmitted && data.isCzar) {
      waitingBanner.textContent = "👑 Pick the funniest card!";
      waitingBanner.classList.add("active");
      waitingBanner.classList.remove("pending");
    } else if (data.allSubmitted && !data.isCzar) {
      waitingBanner.textContent = "⏳ Waiting for the Czar to pick a winner...";
      waitingBanner.classList.add("active");
      waitingBanner.classList.remove("pending");
    } else {
      waitingBanner.classList.remove("active", "pending");
    }
  }
  
  document.getElementById("scoreboard").innerHTML = data.players.map(p => {
    let classes = "score-row";
    if (p.isCzar) classes += " czar";
    return `<div class="${classes}">
      <span>${escapeHtml(p.name)}${p.isCzar ? " 👑" : ""}${p.submitted ? " ✓" : ""}</span>
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
        <div class="white-card submitted ${canPick ? 'pickable' : ''}"
          data-odumid="${s.odumid}"
          onclick="${canPick ? `pickWinner('${s.odumid}')` : ''}">
          <div class="card-text">${escapeHtml(s.card)}</div>
        </div>
      </div>
    `);
  });
  
  while (slots.length < 10) {
    slots.push('<div class="card-wrapper empty"><div class="white-card"><div class="card-text"></div></div></div>');
  }
  
  grid.innerHTML = slots.join("");
}

function renderHand(data) {
  const hand = document.getElementById("handCards");
  
  // FIX #7: Pending player message
  if (data.isPending) {
    hand.innerHTML = `<div class="status-msg pending-msg">⏳ ${data.pendingMessage || "You'll join next round!"}</div>`;
    hideConfirmButton();
    return;
  }
  
  if (data.isCzar) {
    hand.innerHTML = '<div class="status-msg">👑 You\'re the Card Czar! Pick the funniest card above.</div>';
    hideConfirmButton();
    return;
  }
  
  if (data.submitted) {
    hand.innerHTML = '<div class="status-msg">✅ Card submitted! Waiting for others...</div>';
    hideConfirmButton();
    return;
  }
  
  if (!data.myHand || data.myHand.length === 0) {
    hand.innerHTML = '<div class="status-msg">Loading hand...</div>';
    return;
  }
  
  // FIX #1: Cards are auto-revealed, so always show them face-up
  hand.innerHTML = data.myHand.map((cardData) => {
    const card = cardData.card;
    const isBlank = card === BLANK_CARD;
    const isSelected = selectedCardIndex === cardData.index;
    
    return `
      <div class="card-wrapper">
        <div class="white-card face-up playable ${isBlank ? 'blank-card' : ''} ${isSelected ? 'selected' : ''}"
          data-index="${cardData.index}"
          data-card="${escapeAttr(card)}"
          data-blank="${isBlank}"
          onclick="handleCardClick(${cardData.index}, '${escapeAttr(card)}', ${isBlank})">
          <div class="card-content">${isBlank ? '✏️ BLANK<br><small>Write your own</small>' : escapeHtml(card)}</div>
        </div>
      </div>
    `;
  }).join("");
}

// ===========================================
// CARD INTERACTIONS - FIX #3: Double Confirm
// ===========================================
async function handleCardClick(index, card, isBlank) {
  if (!canPerformAction()) return;
  if (isSubmitting) return;
  
  // If clicking the same card that's already selected, this is the second click - submit
  if (selectedCardIndex === index && confirmPending) {
    if (isBlank) {
      await playBlankCard(index, card);
    } else {
      await confirmAndPlayCard(index, card, null);
    }
    return;
  }
  
  // First click - select the card and show confirm button
  selectedCard = card;
  selectedCardIndex = index;
  confirmPending = true;
  
  // Highlight selected card
  document.querySelectorAll('.white-card.playable').forEach(el => {
    el.classList.remove('selected');
  });
  const cardEl = document.querySelector(`[data-index="${index}"]`);
  if (cardEl) {
    cardEl.classList.add('selected');
  }
  
  // Show confirm button
  showConfirmButton(card, isBlank);
}

async function playBlankCard(index, card) {
  const customText = await customTextarea(
    "Write your own answer for this card:",
    "✏️ Write Your Card",
    "Type something funny..."
  );
  
  if (customText && customText.trim()) {
    await confirmAndPlayCard(index, card, customText.trim());
  } else {
    resetCardSelection();
  }
}

async function confirmAndPlayCard(index, card, customText) {
  if (isSubmitting) return;
  isSubmitting = true;
  
  hideConfirmButton();
  document.getElementById("handCards").innerHTML = '<div class="status-msg">✅ Submitting...</div>';
  socket.emit("submit", { card: card, customText: customText });
  resetCardSelection();
}

// Called from confirm button
async function confirmSelectedCard() {
  if (!selectedCard || selectedCardIndex === null) return;
  
  const isBlank = selectedCard === BLANK_CARD;
  if (isBlank) {
    await playBlankCard(selectedCardIndex, selectedCard);
  } else {
    await confirmAndPlayCard(selectedCardIndex, selectedCard, null);
  }
}

function cancelCardSelection() {
  resetCardSelection();
  // Re-render to remove selection highlight
  if (gameState.myHand) {
    renderHand(gameState);
  }
}

function pickWinner(odumid) {
  if (!canPerformAction()) return;
  socket.emit("pick", odumid);
}

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
// ADMIN - Single password entry
// ===========================================
async function openAdmin() {
  if (!adminPassword) {
    const pw = await customPrompt("Enter admin password:", "Admin Login");
    if (!pw) return;
    adminPassword = pw;
  }
  
  socket.emit("admin", { pw: adminPassword, action: "login" });
}

socket.on("admin-ok", async () => {
  showAdminPanel();
});

socket.on("admin-fail", () => {
  adminPassword = null;
  customAlert("Wrong password!", "Access Denied");
});

async function showAdminPanel() {
  const result = await showModal({
    title: "🛠️ Admin Panel",
    message: "Select an action:",
    showCancel: true,
    confirmText: "Reset Game",
    cancelText: "Dismiss"
  });
  
  if (result === true) {
    socket.emit("admin", { pw: adminPassword, action: "reset" });
    showToast("Game reset!");
  }
}

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
// INIT
// ===========================================
showScreen("homeScreen");
const savedSession = loadSession();
if (savedSession?.name) document.getElementById("nameInput").value = savedSession.name;
