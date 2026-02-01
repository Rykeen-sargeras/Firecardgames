// ===========================================
// MAIN.JS - Socket, Lobby, UI
// ===========================================

const socket = io();

let myName = "";
let roomCode = "";
let gameType = "";
let chatOpen = false;

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

// ===========================================
// HOME
// ===========================================
function goToGameSelect() {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) {
    showToast("Enter a name first!");
    return;
  }
  myName = name;
  showScreen("selectScreen");
}

function goHome() {
  showScreen("homeScreen");
}

// ===========================================
// CREATE / JOIN
// ===========================================
function createGame(type) {
  gameType = type;
  socket.emit("create-room", { gameType: type }, (res) => {
    roomCode = res.code;
    joinWithCode(roomCode, type);
  });
}

function showJoinPrompt() {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) {
    showToast("Enter a name first!");
    return;
  }
  myName = name;
  
  const code = prompt("Enter room code:");
  if (code && code.trim()) {
    joinWithCode(code.trim().toUpperCase(), null);
  }
}

function joinWithCode(code, type) {
  socket.emit("join-room", { code: code, name: myName, gameType: type }, (res) => {
    if (res.ok) {
      roomCode = code;
      gameType = res.gameType;
      document.getElementById("lobbyCode").textContent = code;
      document.getElementById("lobbyTitle").textContent = 
        gameType === "cah" ? "🃏 CARDS AGAINST" : "🎴 UNO";
      
      if (res.pending) {
        showToast("You'll join next round!");
      } else if (res.reconnected) {
        showToast("Reconnected!");
      }
      
      showScreen("lobbyScreen");
    } else {
      showToast(res.error || "Failed to join");
    }
  });
}

// ===========================================
// LOBBY
// ===========================================
socket.on("lobby", (data) => {
  console.log("LOBBY:", data);
  
  if (data.started) return;
  
  showScreen("lobbyScreen");
  document.getElementById("lobbyCode").textContent = data.roomCode;
  
  const list = document.getElementById("playerList");
  list.innerHTML = "";
  
  if (data.players.length === 0) {
    list.innerHTML = '<div class="no-players">Waiting for players...</div>';
  } else {
    data.players.forEach(p => {
      // Skip if no name
      if (!chatOpen || p.name === "Unknown") return;
      
      const div = document.createElement("div");
      div.className = "player-row";
      
      if (p.odumid === socket.id) div.classList.add("me");
      if (p.ready) div.classList.add("ready");
      if (p.disconnected) div.classList.add("dc");
      
      let status = "";
      if (p.disconnected) {
        status = `⏱️ ${p.reconnectTime}s`;
      } else if (p.ready) {
        status = "✅ Ready";
      } else {
        status = "⏳ Waiting";
      }
      
      div.innerHTML = `
        <span class="player-name">${p.name}${p.odumid === socket.id ? " (You)" : ""}</span>
        <span class="player-status">${status}</span>
      `;
      list.appendChild(div);
    });
  }
  
  document.getElementById("waitingFor").textContent = data.waitingFor;
});

socket.on("countdown", (val) => {
  document.getElementById("countdownOverlay").classList.add("active");
  document.getElementById("countdownNum").textContent = val;
});

socket.on("countdown-cancelled", () => {
  document.getElementById("countdownOverlay").classList.remove("active");
  showToast("Countdown cancelled");
});

// ===========================================
// READY
// ===========================================
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
  showToast(`${data.name} joined the game!`);
});

// ===========================================
// GAME EVENTS
// ===========================================
socket.on("game-start", (data) => {
  document.getElementById("countdownOverlay").classList.remove("active");
  gameType = data.gameType;
  
  if (data.gameType === "cah") {
    showScreen("cahScreen");
  } else {
    showScreen("unoScreen");
  }
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
  showOverlay(`🎉 ${data.name} wins! (${data.score} pts)`);
});

socket.on("game-winner", (data) => {
  showOverlay(`🏆 ${data.name} WINS! 🏆`);
  if (typeof confetti === "function") {
    confetti({ particleCount: 200, spread: 120, colors: ['#ff6b00', '#ffaa00', '#ffd700'] });
  }
});

// ===========================================
// CHAT - ACCORDION
// ===========================================
function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById("chatBody").classList.toggle("open", chatOpen);
  document.querySelector(".chat-toggle").classList.toggle("open", chatOpen);
}

function sendChat() {
  const input = document.getElementById("chatInput");
  if (input.value.trim()) {
    socket.emit("chat", input.value.trim());
    input.value = "";
  }
}

socket.on("chat", (data) => {
  const box = document.getElementById("chatBox");
  const div = document.createElement("div");
  div.className = "chat-msg";
  div.innerHTML = `<b>${data.name}:</b> ${data.msg}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  
  // Flash chat if closed
  if (!chatOpen) {
    document.querySelector(".chat-toggle").style.background = "rgba(255, 107, 0, 0.3)";
    setTimeout(() => {
      document.querySelector(".chat-toggle").style.background = "";
    }, 500);
  }
});

socket.on("chat-clear", () => {
  document.getElementById("chatBox").innerHTML = "";
});

// ===========================================
// ADMIN
// ===========================================
function openAdmin() {
  const pw = prompt("Admin password:");
  if (pw) {
    socket.emit("admin", { pw: pw, action: "login" });
  }
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
  const pw = prompt("Confirm admin password:");
  if (pw) socket.emit("admin", { pw: pw, action: "reset" });
}

function adminWipeChat() {
  const pw = prompt("Confirm admin password:");
  if (pw) socket.emit("admin", { pw: pw, action: "wipe-chat" });
}

// ===========================================
// TOAST / OVERLAY
// ===========================================
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("active");
  setTimeout(() => t.classList.remove("active"), 3000);
}

function showOverlay(msg) {
  const o = document.getElementById("overlay");
  document.getElementById("overlayText").textContent = msg;
  o.classList.add("active");
  setTimeout(() => o.classList.remove("active"), 3500);
}

// ===========================================
// ENTER KEY
// ===========================================
document.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    if (e.target.id === "nameInput") goToGameSelect();
    if (e.target.id === "chatInput") sendChat();
  }
});

// ===========================================
// INIT
// ===========================================
showScreen("homeScreen");
