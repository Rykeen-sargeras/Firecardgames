// ===========================================
// CARDS AGAINST THE LCU - Main Client
// ===========================================

const socket = io();

let myName = "";
let roomCode = "";
let gameState = {};
let previewCardData = null;
let longPressTimer = null;

// ===========================================
// CONNECTION
// ===========================================
socket.on("connect", () => {
  console.log("Connected:", socket.id);
  document.getElementById("status").textContent = "🟢 Connected";
  document.getElementById("status").className = "connected";
});

socket.on("disconnect", () => {
  console.log("Disconnected");
  document.getElementById("status").textContent = "🔴 Disconnected";
  document.getElementById("status").className = "disconnected";
});

// ===========================================
// CUSTOM MODAL SYSTEM (replaces alert/confirm/prompt)
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
    
    // Input field
    if (options.input) {
      input.style.display = "block";
      input.value = options.inputValue || "";
      input.placeholder = options.placeholder || "";
      setTimeout(() => input.focus(), 100);
    } else {
      input.style.display = "none";
    }
    
    // Cancel button
    if (options.showCancel) {
      cancelBtn.style.display = "block";
    } else {
      cancelBtn.style.display = "none";
    }
    
    confirmBtn.textContent = options.confirmText || "OK";
    cancelBtn.textContent = options.cancelText || "Cancel";
    
    modal.classList.add("active");
    
    const cleanup = () => {
      modal.classList.remove("active");
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
    };
    
    confirmBtn.onclick = () => {
      cleanup();
      resolve(options.input ? input.value : true);
    };
    
    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };
    
    if (options.input) {
      input.onkeydown = (e) => {
        if (e.key === "Enter") {
          cleanup();
          resolve(input.value);
        } else if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      };
    }
  });
}

// Helper functions to replace native dialogs
async function customAlert(message, title = "Notice") {
  await showModal({ title, message });
}

async function customConfirm(message, title = "Confirm") {
  const result = await showModal({ title, message, showCancel: true, confirmText: "Yes", cancelText: "No" });
  return result === true;
}

async function customPrompt(message, title = "Input", placeholder = "") {
  const result = await showModal({ title, message, input: true, placeholder, showCancel: true });
  return result;
}

// ===========================================
// SCREENS
// ===========================================
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function goHome() {
  showScreen("homeScreen");
}

// ===========================================
// CREATE / JOIN
// ===========================================
async function createGame() {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) {
    await customAlert("Please enter your name first!", "Oops");
    return;
  }
  myName = name;
  
  socket.emit("create-room", {}, (res) => {
    roomCode = res.code;
    socket.emit("join-room", { code: roomCode, name: myName, create: true }, handleJoin);
  });
}

async function joinPrompt() {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) {
    await customAlert("Please enter your name first!", "Oops");
    return;
  }
  myName = name;
  
  const code = await customPrompt("Enter the room code:", "Join Game", "ABC123");
  if (code && code.trim()) {
    roomCode = code.trim().toUpperCase();
    socket.emit("join-room", { code: roomCode, name: myName }, handleJoin);
  }
}

async function handleJoin(res) {
  if (res.ok) {
    document.getElementById("lobbyCode").textContent = roomCode;
    showScreen("lobbyScreen");
    
    if (res.pending) {
      showToast("You'll join next round!");
    } else if (res.reconnected) {
      showToast("Reconnected!");
    }
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
  
  const list = document.getElementById("playerList");
  
  if (data.players.length === 0) {
    list.innerHTML = '<div class="status-msg">Waiting for players...</div>';
  } else {
    list.innerHTML = data.players.filter(p => p.name).map(p => {
      let classes = "player-row";
      if (p.odumid === socket.id) classes += " me";
      if (p.ready) classes += " ready";
      if (p.disconnected) classes += " dc";
      
      let status = p.disconnected ? `⏱️ ${p.reconnectTime}s` : (p.ready ? "✅ Ready" : "⏳");
      
      return `<div class="${classes}">
        <span class="player-name">${escapeHtml(p.name)}${p.odumid === socket.id ? " (You)" : ""}</span>
        <span class="player-status">${status}</span>
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
  socket.emit("ready");
}

// ===========================================
// PLAYER EVENTS
// ===========================================
socket.on("player-dc", (data) => showToast(`${data.name} disconnected`));
socket.on("player-reconnected", (data) => showToast(`${data.name} reconnected!`));
socket.on("player-left", (data) => showToast(`${data.name} left`));
socket.on("player-joined-game", (data) => showToast(`${data.name} joined!`));

// ===========================================
// GAME
// ===========================================
socket.on("game-start", () => {
  document.getElementById("countdownOverlay").classList.remove("active");
  showScreen("gameScreen");
});

socket.on("game-state", (data) => {
  gameState = data;
  showScreen("gameScreen");
  renderGame();
});

socket.on("game-reset", () => {
  showScreen("lobbyScreen");
  showToast("Game reset");
});

socket.on("game-ended", (data) => {
  showScreen("lobbyScreen");
  showToast(data.reason || "Game ended");
});

socket.on("round-winner", (data) => {
  showWinner(`🎉 ${data.name} wins! (${data.score} pts)`);
});

socket.on("game-winner", (data) => {
  showWinner(`🏆 ${data.name} WINS THE GAME! 🏆`);
  if (typeof confetti === "function") {
    confetti({ 
      particleCount: 200, 
      spread: 120, 
      colors: ['#e63022', '#ff5722', '#ff8a50', '#ffc107'],
      origin: { y: 0.6 }
    });
  }
});

// ===========================================
// RENDER GAME
// ===========================================
function renderGame() {
  const data = gameState;
  
  document.getElementById("blackCard").textContent = data.blackCard || "...";
  document.getElementById("czarName").textContent = data.czarName || "...";
  document.getElementById("roundNum").textContent = data.roundNumber || 1;
  
  // Scoreboard
  document.getElementById("scoreboard").innerHTML = data.players.map(p => {
    let classes = "score-row";
    if (p.isCzar) classes += " czar";
    return `<div class="${classes}">
      <span>${escapeHtml(p.name)}${p.isCzar ? " 👑" : ""}</span>
      <span>${p.score}</span>
    </div>`;
  }).join("");
  
  renderSubmissions(data);
  renderHand(data);
}

function renderSubmissions(data) {
  const grid = document.getElementById("submissionGrid");
  const slots = [];
  
  data.submissions.forEach(s => {
    const canPick = data.isCzar && data.allSubmitted;
    slots.push(`<div class="white-card ${canPick ? 'clickable' : ''}" 
      ${canPick ? `onclick="pickWinner('${s.odumid}')"` : ''}
      onmouseenter="hoverCard(this)"
      onmouseleave="unhoverCard(this)"
      ontouchstart="touchStartCard(event, '${escapeAttr(s.card)}', ${canPick}, '${s.odumid}')"
      ontouchend="touchEndCard(event)">
      ${escapeHtml(s.card)}
    </div>`);
  });
  
  // Fill to 10 slots (5x2)
  while (slots.length < 10) {
    slots.push('<div class="white-card empty"></div>');
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
  
  hand.innerHTML = data.myHand.map((cardData, i) => {
    const isRevealed = cardData.revealed;
    const card = cardData.card;
    
    if (!isRevealed) {
      // Blank card - tap to reveal
      return `<div class="white-card blank-card clickable" 
        onclick="revealCard(${cardData.index})"
        ontouchstart="touchStartBlank(event, ${cardData.index})"
        ontouchend="touchEndCard(event)">
        ?
      </div>`;
    } else {
      // Revealed card - can play
      return `<div class="white-card clickable" 
        onclick="playCard(${cardData.index}, '${escapeAttr(card)}')"
        onmouseenter="hoverCard(this)"
        onmouseleave="unhoverCard(this)"
        ontouchstart="touchStartCard(event, '${escapeAttr(card)}', true, null, ${cardData.index})"
        ontouchend="touchEndCard(event)">
        ${escapeHtml(card)}
      </div>`;
    }
  }).join("");
}

// ===========================================
// CARD INTERACTIONS
// ===========================================

// Reveal a blank card
function revealCard(index) {
  socket.emit("reveal-card", index);
}

// Play a card
async function playCard(index, card) {
  closePreview();
  socket.emit("submit", { card: card });
}

// Pick winner (czar only)
function pickWinner(odumid) {
  closePreview();
  socket.emit("pick", odumid);
}

// Desktop hover zoom
function hoverCard(el) {
  // Optional: could add tooltip or scale here
}

function unhoverCard(el) {
  // Reset hover state
}

// Touch/long-press for mobile preview
function touchStartCard(event, cardText, canAct, odumid, cardIndex) {
  event.preventDefault();
  
  previewCardData = { cardText, canAct, odumid, cardIndex };
  
  // Long press (500ms) to show preview
  longPressTimer = setTimeout(() => {
    showCardPreview(cardText, canAct, odumid, cardIndex);
  }, 500);
}

function touchStartBlank(event, index) {
  event.preventDefault();
  // Immediate reveal on tap
  revealCard(index);
}

function touchEndCard(event) {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  
  // Quick tap - perform action
  if (previewCardData && !document.getElementById("cardPreview").classList.contains("active")) {
    const { canAct, odumid, cardIndex, cardText } = previewCardData;
    if (canAct) {
      if (odumid) {
        pickWinner(odumid);
      } else if (cardIndex !== undefined && cardIndex !== null) {
        playCard(cardIndex, cardText);
      }
    }
  }
  
  previewCardData = null;
}

// Card preview modal
function showCardPreview(cardText, canAct, odumid, cardIndex) {
  const preview = document.getElementById("cardPreview");
  const content = document.getElementById("previewCardContent");
  const playBtn = document.getElementById("previewPlayBtn");
  
  content.textContent = cardText;
  
  if (canAct) {
    playBtn.style.display = "block";
    playBtn.onclick = () => {
      if (odumid) {
        pickWinner(odumid);
      } else if (cardIndex !== undefined) {
        playCard(cardIndex, cardText);
      }
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

// Close preview on background click
document.getElementById("cardPreview").addEventListener("click", (e) => {
  if (e.target.id === "cardPreview") {
    closePreview();
  }
});

// ===========================================
// CHAT
// ===========================================
function toggleChat() {
  document.getElementById("chatContainer").classList.toggle("open");
  
  // Scroll to bottom when opening
  if (document.getElementById("chatContainer").classList.contains("open")) {
    const messages = document.getElementById("chatMessages");
    messages.scrollTop = messages.scrollHeight;
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
  
  // Auto-scroll to bottom
  box.scrollTop = box.scrollHeight;
  
  // Flash header if closed
  if (!document.getElementById("chatContainer").classList.contains("open")) {
    const header = document.querySelector(".chat-header");
    header.style.boxShadow = "0 0 20px #ff5722";
    setTimeout(() => { header.style.boxShadow = ""; }, 500);
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
  const pw = await customPrompt("Enter admin password:", "Admin Login", "");
  if (pw) socket.emit("admin", { pw: pw, action: "login" });
}

socket.on("admin-ok", async () => {
  const action = await showModal({
    title: "🛠️ Admin Panel",
    message: "Select an action:",
    showCancel: true,
    confirmText: "Reset Game",
    cancelText: "Clear Chat"
  });
  
  if (action === true) {
    const pw = await customPrompt("Confirm password to reset:", "Reset Game");
    if (pw) socket.emit("admin", { pw, action: "reset" });
  } else if (action === null) {
    // Cancel was clicked - check if they want to clear chat
    const confirm = await customConfirm("Clear all chat messages?", "Clear Chat");
    if (confirm) {
      const pw = await customPrompt("Confirm password:", "Clear Chat");
      if (pw) socket.emit("admin", { pw, action: "wipe-chat" });
    }
  }
});

socket.on("admin-fail", () => {
  customAlert("Wrong password!", "Access Denied");
});

// ===========================================
// TOAST & OVERLAYS
// ===========================================
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("active");
  setTimeout(() => t.classList.remove("active"), 3000);
}

function showWinner(msg) {
  const overlay = document.getElementById("winnerOverlay");
  document.getElementById("winnerText").textContent = msg;
  overlay.classList.add("active");
  setTimeout(() => overlay.classList.remove("active"), 4000);
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
// INIT
// ===========================================
showScreen("homeScreen");

// Prevent zoom on double-tap (iOS)
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - (window.lastTouchEnd || 0) < 300) {
    e.preventDefault();
  }
  window.lastTouchEnd = now;
}, { passive: false });
