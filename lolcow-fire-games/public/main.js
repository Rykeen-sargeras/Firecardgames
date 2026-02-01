// ===========================================
// CARDS AGAINST THE LCU - Main Client
// ===========================================

const socket = io();

let myName = "";
let roomCode = "";
let gameState = {};

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
function createGame() {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) {
    showToast("Enter your name first!");
    return;
  }
  myName = name;
  
  socket.emit("create-room", {}, (res) => {
    roomCode = res.code;
    socket.emit("join-room", { code: roomCode, name: myName, create: true }, handleJoin);
  });
}

function joinPrompt() {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) {
    showToast("Enter your name first!");
    return;
  }
  myName = name;
  
  const code = prompt("Enter room code:");
  if (code && code.trim()) {
    roomCode = code.trim().toUpperCase();
    socket.emit("join-room", { code: roomCode, name: myName }, handleJoin);
  }
}

function handleJoin(res) {
  if (res.ok) {
    document.getElementById("lobbyCode").textContent = roomCode;
    showScreen("lobbyScreen");
    
    if (res.pending) {
      showToast("You'll join next round!");
    } else if (res.reconnected) {
      showToast("Reconnected!");
    }
  } else {
    showToast(res.error || "Failed to join");
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
    list.innerHTML = '<div class="no-players">Waiting for players to join...</div>';
  } else {
    list.innerHTML = data.players.filter(p => p.name).map(p => {
      let classes = "player-row";
      if (p.odumid === socket.id) classes += " me";
      if (p.ready) classes += " ready";
      if (p.disconnected) classes += " dc";
      
      let status = p.disconnected ? `⏱️ ${p.reconnectTime}s` : (p.ready ? "✅ Ready" : "⏳ Waiting");
      
      return `
        <div class="${classes}">
          <span class="player-name">${p.name}${p.odumid === socket.id ? " (You)" : ""}</span>
          <span class="player-status">${status}</span>
        </div>
      `;
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
socket.on("player-dc", (data) => {
  showToast(`${data.name} disconnected - ${data.time}s to reconnect`);
});

socket.on("player-reconnected", (data) => {
  showToast(`${data.name} reconnected!`);
});

socket.on("player-left", (data) => {
  showToast(`${data.name} left`);
});

socket.on("player-joined-game", (data) => {
  showToast(`${data.name} joined!`);
});

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
  showWinner(`🎉 ${data.name} wins the round! (${data.score} pts)`);
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
  
  // Black card
  document.getElementById("blackCard").textContent = data.blackCard || "...";
  
  // Czar & round
  document.getElementById("czarName").textContent = data.czarName || "...";
  document.getElementById("roundNum").textContent = data.roundNumber || 1;
  
  // Scoreboard
  document.getElementById("scoreboard").innerHTML = data.players.map(p => {
    let classes = "score-row";
    if (p.isCzar) classes += " czar";
    if (p.submitted) classes += " submitted";
    return `
      <div class="${classes}">
        <span>${p.name}${p.isCzar ? " 👑" : ""}</span>
        <span>${p.score}</span>
      </div>
    `;
  }).join("");
  
  // Submissions grid (5x5)
  renderSubmissions(data);
  
  // Hand
  renderHand(data);
}

function renderSubmissions(data) {
  const grid = document.getElementById("submissionGrid");
  const slots = [];
  
  // Submissions
  data.submissions.forEach(s => {
    const canPick = data.isCzar && data.allSubmitted;
    slots.push(`
      <div class="white-card ${canPick ? 'clickable' : ''}" 
           ${canPick ? `onclick="pickWinner('${s.odumid}')"` : ''}>
        ${escapeHtml(s.card)}
      </div>
    `);
  });
  
  // Fill to minimum 5 slots
  const minSlots = Math.max(5, data.expectedCount || 0);
  while (slots.length < minSlots) {
    slots.push('<div class="white-card empty"></div>');
  }
  
  grid.innerHTML = slots.join("");
  
  // Status
  if (!data.allSubmitted && data.submissionCount !== undefined) {
    const remaining = data.expectedCount - data.submissionCount;
    if (remaining > 0 && !data.isCzar) {
      grid.innerHTML += `<div class="status-msg" style="grid-column:1/-1">Waiting for ${remaining} more submission${remaining > 1 ? 's' : ''}...</div>`;
    }
  }
}

function renderHand(data) {
  const hand = document.getElementById("handCards");
  
  if (data.isPending) {
    hand.innerHTML = '<div class="status-msg">⏳ You\'ll join next round!</div>';
    return;
  }
  
  if (data.isCzar) {
    hand.innerHTML = '<div class="status-msg">👑 You\'re the Card Czar! Wait for submissions, then pick the funniest.</div>';
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
  
  hand.innerHTML = data.myHand.map((card, i) => `
    <div class="white-card clickable" onclick="playCard(${i}, '${escapeAttr(card)}')">
      ${card === "__BLANK__" ? "✏️ BLANK CARD" : escapeHtml(card)}
    </div>
  `).join("");
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function playCard(index, card) {
  if (card === "__BLANK__") {
    const custom = prompt("Write your own card:");
    if (custom && custom.trim()) {
      socket.emit("submit", { card: "__BLANK__", custom: custom.trim() });
    }
  } else {
    socket.emit("submit", { card: card });
  }
}

function pickWinner(odumid) {
  socket.emit("pick", odumid);
}

// ===========================================
// CHAT - ACCORDION
// ===========================================
function toggleChat() {
  document.getElementById("chatContainer").classList.toggle("open");
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
  
  // Flash if closed
  if (!document.getElementById("chatContainer").classList.contains("open")) {
    const header = document.querySelector(".chat-header");
    header.style.boxShadow = "0 0 20px #ff5722";
    setTimeout(() => { header.style.boxShadow = ""; }, 500);
  }
});

socket.on("chat-clear", () => {
  document.getElementById("chatMessages").innerHTML = "";
});

// Enter key for chat
document.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    if (e.target.id === "nameInput") createGame();
    if (e.target.id === "chatInput") sendChat();
  }
});

// ===========================================
// ADMIN
// ===========================================
function openAdmin() {
  const pw = prompt("Admin password:");
  if (pw) socket.emit("admin", { pw: pw, action: "login" });
}

socket.on("admin-ok", () => {
  document.getElementById("adminPanel").classList.add("active");
});

socket.on("admin-fail", () => {
  showToast("Wrong password");
});

function closeAdmin() {
  document.getElementById("adminPanel").classList.remove("active");
}

function adminReset() {
  const pw = prompt("Confirm password:");
  if (pw) socket.emit("admin", { pw: pw, action: "reset" });
  closeAdmin();
}

function adminWipeChat() {
  const pw = prompt("Confirm password:");
  if (pw) socket.emit("admin", { pw: pw, action: "wipe-chat" });
  closeAdmin();
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

function showWinner(msg) {
  const overlay = document.getElementById("winnerOverlay");
  document.getElementById("winnerText").textContent = msg;
  overlay.classList.add("active");
  setTimeout(() => overlay.classList.remove("active"), 4000);
}

// ===========================================
// INIT
// ===========================================
showScreen("homeScreen");
