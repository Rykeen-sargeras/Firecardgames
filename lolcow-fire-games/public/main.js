// ============================================
// MAIN.JS - Socket, Lobby, Modal, Navigation
// Must load FIRST before game files
// ============================================

const socket = io();

// Global state
let currentRoomCode = "";
let currentGameType = "";
let myUsername = "";
let adminPw = "";
let isConnected = false;

// ============================================
// CONNECTION HANDLING
// ============================================
socket.on('connect', () => {
  console.log('✅ Connected:', socket.id);
  isConnected = true;
  updateConnectionStatus(true);
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected');
  isConnected = false;
  updateConnectionStatus(false);
});

socket.on('connect_error', (err) => {
  console.error('🔥 Connection error:', err);
  isConnected = false;
  updateConnectionStatus(false);
});

function updateConnectionStatus(connected) {
  const el = document.getElementById('connectionStatus');
  if (el) {
    el.textContent = connected ? '🟢 Connected' : '🔴 Disconnected';
    el.className = connected ? 'status-connected' : 'status-disconnected';
  }
}

// ============================================
// MODAL SYSTEM
// ============================================
function showModal(title, message, options = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('customModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const modalInput = document.getElementById('modalInput');
    const colorSelector = document.getElementById('colorSelector');
    const modalConfirm = document.getElementById('modalConfirm');
    const modalCancel = document.getElementById('modalCancel');
    
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    
    modalInput.style.display = 'none';
    colorSelector.style.display = 'none';
    
    if (options.input) {
      modalInput.style.display = 'block';
      modalInput.value = options.inputValue || '';
      modalInput.placeholder = options.inputPlaceholder || '';
      setTimeout(() => modalInput.focus(), 100);
    } else if (options.colorPicker) {
      colorSelector.style.display = 'grid';
      colorSelector.innerHTML = `
        <button class="color-btn red" data-color="red">RED</button>
        <button class="color-btn blue" data-color="blue">BLUE</button>
        <button class="color-btn green" data-color="green">GREEN</button>
        <button class="color-btn yellow" data-color="yellow">YELLOW</button>
      `;
    }
    
    modalCancel.style.display = options.showCancel ? 'inline-block' : 'none';
    modalConfirm.textContent = options.confirmText || 'OK';
    modalCancel.textContent = options.cancelText || 'Cancel';
    
    modal.style.display = 'flex';
    
    const cleanup = () => {
      modal.style.display = 'none';
      modalConfirm.onclick = null;
      modalCancel.onclick = null;
      colorSelector.onclick = null;
      document.removeEventListener('keydown', handleKey);
    };
    
    const handleKey = (e) => {
      if (e.key === 'Enter' && options.input) {
        cleanup();
        resolve(modalInput.value);
      } else if (e.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    };
    
    modalConfirm.onclick = () => {
      cleanup();
      resolve(options.input ? modalInput.value : true);
    };
    
    modalCancel.onclick = () => {
      cleanup();
      resolve(null);
    };
    
    if (options.colorPicker) {
      colorSelector.onclick = (e) => {
        if (e.target.classList.contains('color-btn')) {
          cleanup();
          resolve(e.target.dataset.color);
        }
      };
    }
    
    document.addEventListener('keydown', handleKey);
  });
}

// ============================================
// SCREEN NAVIGATION
// ============================================
function show(screenId) {
  console.log('📺 Showing:', screenId);
  document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
  const screen = document.getElementById(screenId);
  if (screen) screen.style.display = 'flex';
}

function goHome() {
  currentRoomCode = "";
  currentGameType = "";
  show('home');
}

// ============================================
// HOME SCREEN
// ============================================
function showGameSelection() {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) {
    showModal('⚠️ Error', 'Please enter a username!');
    return;
  }
  if (!isConnected) {
    showModal('⚠️ Error', 'Not connected to server. Please refresh.');
    return;
  }
  myUsername = name;
  show('gameSelection');
}

// ============================================
// ROOM CREATION & JOINING
// ============================================
function selectGame(gameType) {
  if (!isConnected) {
    showModal('⚠️ Error', 'Not connected to server.');
    return;
  }
  
  currentGameType = gameType;
  
  socket.emit('create-room', { gameType }, (response) => {
    console.log('📦 Room created:', response);
    currentRoomCode = response.roomCode;
    
    socket.emit('join-room', {
      roomCode: currentRoomCode,
      username: myUsername,
      gameType: currentGameType
    }, handleJoinResponse);
  });
}

async function showJoinRoom() {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) {
    showModal('⚠️ Error', 'Please enter a username first!');
    return;
  }
  if (!isConnected) {
    showModal('⚠️ Error', 'Not connected to server.');
    return;
  }
  
  const code = await showModal('🔑 Join Room', 'Enter room code:', {
    input: true,
    inputPlaceholder: 'ABC123',
    showCancel: true,
    confirmText: 'Join'
  });
  
  if (code && code.trim()) {
    myUsername = name;
    currentRoomCode = code.trim().toUpperCase();
    
    socket.emit('join-room', {
      roomCode: currentRoomCode,
      username: myUsername
    }, handleJoinResponse);
  }
}

function handleJoinResponse(response) {
  console.log('🚪 Join response:', response);
  
  if (response.success) {
    currentGameType = response.gameType;
    document.getElementById('roomCodeDisplay').textContent = currentRoomCode;
    updateLobbyTitle();
    show('lobby');
    resetReadyButton();
    
    if (response.reconnected) {
      showModal('✅ Reconnected', 'Welcome back! You have been reconnected to the game.');
    }
  } else {
    showModal('❌ Error', response.error || 'Failed to join room');
    currentRoomCode = "";
  }
}

function updateLobbyTitle() {
  const title = document.getElementById('lobbyGameTitle');
  if (currentGameType === 'cards-against') {
    title.textContent = '🃏 Cards Against The LCU';
  } else if (currentGameType === 'uno') {
    title.textContent = '🎴 UNO';
  }
}

// ============================================
// LOBBY HANDLING - THE KEY FIX
// ============================================
socket.on('lobby-update', (data) => {
  console.log('📡 LOBBY UPDATE:', data);
  
  currentRoomCode = data.roomCode;
  currentGameType = data.gameType;
  
  // If game started, don't show lobby
  if (data.started) return;
  
  show('lobby');
  document.getElementById('roomCodeDisplay').textContent = data.roomCode;
  updateLobbyTitle();
  
  // Render player list
  renderPlayerList(data.players);
  
  // Update status message
  updateLobbyStatus(data);
  
  // Update ready button
  const me = data.players.find(p => p.id === socket.id);
  if (me) {
    updateReadyButton(me.ready);
  }
  
  // Update countdown display
  updateCountdown(data.countdown, data.countdownActive);
});

function renderPlayerList(players) {
  const container = document.getElementById('playerList');
  
  if (players.length === 0) {
    container.innerHTML = `
      <div class="no-players">
        🔍 Waiting for players to join...
      </div>
    `;
    return;
  }
  
  container.innerHTML = players.map(p => {
    const isMe = p.id === socket.id;
    let statusText = '';
    let statusClass = '';
    
    if (p.disconnected) {
      statusText = `⏱️ Reconnecting (${p.reconnectTimeLeft}s)`;
      statusClass = 'disconnected';
    } else if (p.ready) {
      statusText = '✅ Ready';
      statusClass = 'ready';
    } else {
      statusText = '⏳ Not Ready';
      statusClass = 'waiting';
    }
    
    return `
      <div class="player-card ${statusClass} ${isMe ? 'is-me' : ''}">
        <div class="player-info">
          <span class="player-name">${p.username}${isMe ? ' (You)' : ''}${p.isHost ? ' 👑' : ''}</span>
        </div>
        <div class="player-status ${statusClass}">${statusText}</div>
      </div>
    `;
  }).join('');
}

function updateLobbyStatus(data) {
  const statusEl = document.getElementById('lobbyStatus');
  
  const activePlayers = data.players.filter(p => !p.disconnected);
  const readyPlayers = activePlayers.filter(p => p.ready);
  const notReady = activePlayers.filter(p => !p.ready);
  
  let html = '';
  
  if (data.countdownActive && data.countdown > 0) {
    html = `<div class="countdown-active">🚀 Game starting in <span class="countdown-number">${data.countdown}</span> seconds!</div>`;
  } else if (activePlayers.length < data.minPlayers) {
    const needed = data.minPlayers - activePlayers.length;
    html = `<div class="status-waiting">Need <strong>${needed}</strong> more player${needed > 1 ? 's' : ''} (minimum ${data.minPlayers})</div>`;
  } else if (notReady.length > 0) {
    const names = notReady.map(p => p.username).join(', ');
    html = `<div class="status-waiting">Waiting for: <strong>${names}</strong></div>`;
  } else {
    html = `<div class="status-ready">All players ready! Starting soon...</div>`;
  }
  
  statusEl.innerHTML = html;
}

function updateCountdown(seconds, active) {
  const countdownEl = document.getElementById('countdownOverlay');
  
  if (active && seconds > 0) {
    countdownEl.style.display = 'flex';
    countdownEl.querySelector('.countdown-number').textContent = seconds;
  } else {
    countdownEl.style.display = 'none';
  }
}

socket.on('countdown-tick', (data) => {
  console.log('⏱️ Countdown:', data.seconds);
  updateCountdown(data.seconds, true);
  
  // Update status too
  const statusEl = document.getElementById('lobbyStatus');
  if (statusEl) {
    statusEl.innerHTML = `<div class="countdown-active">🚀 Game starting in <span class="countdown-number">${data.seconds}</span> seconds!</div>`;
  }
});

socket.on('countdown-cancelled', () => {
  console.log('❌ Countdown cancelled');
  updateCountdown(0, false);
});

// ============================================
// READY SYSTEM
// ============================================
function toggleReady() {
  if (!isConnected) {
    showModal('⚠️ Error', 'Not connected to server');
    return;
  }
  socket.emit('ready-up');
}

function updateReadyButton(isReady) {
  const btn = document.getElementById('readyBtn');
  if (isReady) {
    btn.textContent = '⏸️ Cancel Ready';
    btn.className = 'btn ready-active';
  } else {
    btn.textContent = '✅ Ready Up';
    btn.className = 'btn btn-ready';
  }
}

function resetReadyButton() {
  const btn = document.getElementById('readyBtn');
  btn.textContent = '✅ Ready Up';
  btn.className = 'btn btn-ready';
}

// ============================================
// DISCONNECT/RECONNECT HANDLING
// ============================================
socket.on('player-disconnected', (data) => {
  console.log(`🔌 ${data.username} disconnected, ${data.timeToReconnect}s to reconnect`);
  showToast(`${data.username} disconnected - ${data.timeToReconnect}s to reconnect`);
});

socket.on('reconnect-timer', (data) => {
  // Updates handled by lobby-update
});

socket.on('player-reconnected', (data) => {
  console.log(`🔄 ${data.username} reconnected`);
  showToast(`${data.username} reconnected!`);
});

socket.on('player-removed', (data) => {
  console.log(`👋 ${data.username} removed from game`);
  showToast(`${data.username} left the game`);
});

// ============================================
// GAME EVENTS
// ============================================
socket.on('game-started', (data) => {
  console.log('🎮 Game started:', data.gameType);
  updateCountdown(0, false);
  
  if (data.gameType === 'cards-against') {
    show('gameCAH');
  } else if (data.gameType === 'uno') {
    show('gameUNO');
  }
});

socket.on('game-ended', (data) => {
  console.log('🛑 Game ended:', data.reason);
  showModal('Game Ended', data.reason);
  resetReadyButton();
});

socket.on('game-reset', () => {
  console.log('🔄 Game reset');
  resetReadyButton();
  show('lobby');
});

socket.on('round-winner', (data) => {
  showOverlay(`🎉 ${data.username} wins! (${data.score} pts)`);
});

socket.on('game-winner', (data) => {
  showOverlay(`🏆 ${data.username} WINS THE GAME! 🏆`);
  
  if (typeof confetti !== 'undefined') {
    confetti({
      particleCount: 300,
      spread: 150,
      origin: { y: 0.5 },
      colors: ['#00fff7', '#ff8a00', '#bf00ff', '#FFD700']
    });
  }
});

// ============================================
// OVERLAYS & TOASTS
// ============================================
function showOverlay(text) {
  const overlay = document.getElementById('winnerOverlay');
  document.getElementById('overlayText').textContent = text;
  overlay.style.display = 'flex';
  
  setTimeout(() => {
    overlay.style.display = 'none';
  }, 3500);
}

function dismissOverlay() {
  document.getElementById('winnerOverlay').style.display = 'none';
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================
// CHAT
// ============================================
function sendChat(inputId) {
  const input = document.getElementById(inputId);
  if (input && input.value.trim()) {
    socket.emit('chat', input.value.trim());
    input.value = '';
  }
}

function sendMsg() { sendChat('chatInput'); }
function sendMsgUno() { sendChat('chatInputUno'); }

socket.on('chat', (data) => {
  ['chatBox', 'chatBoxUno'].forEach(id => {
    const box = document.getElementById(id);
    if (box) {
      const msg = document.createElement('div');
      msg.className = 'chat-message';
      msg.innerHTML = `<strong>${data.user}:</strong> ${data.text}`;
      box.appendChild(msg);
      box.scrollTop = box.scrollHeight;
    }
  });
});

socket.on('wipe-chat', () => {
  ['chatBox', 'chatBoxUno'].forEach(id => {
    const box = document.getElementById(id);
    if (box) box.innerHTML = '';
  });
});

function toggleChat() {
  const chat = document.querySelector('.chat-panel');
  if (chat) chat.classList.toggle('hidden');
}

// ============================================
// ADMIN
// ============================================
async function toggleAdmin() {
  if (!adminPw) {
    adminPw = await showModal('🔒 Admin', 'Enter password:', {
      input: true,
      showCancel: true
    });
    if (!adminPw) return;
    socket.emit('admin', { type: 'login', pw: adminPw });
  } else {
    document.getElementById('adminPanel').style.display = 'flex';
  }
}

function closeAdmin() {
  document.getElementById('adminPanel').style.display = 'none';
}

socket.on('admin-ok', () => {
  document.getElementById('adminPanel').style.display = 'flex';
});

socket.on('admin-fail', () => {
  showModal('❌ Error', 'Wrong password');
  adminPw = '';
});

async function adminReset() {
  if (await showModal('⚠️ Reset', 'Reset the game?', { showCancel: true })) {
    socket.emit('admin', { type: 'reset', pw: adminPw });
  }
}

async function adminWipeChat() {
  if (await showModal('🧹 Clear Chat', 'Clear all messages?', { showCancel: true })) {
    socket.emit('admin', { type: 'wipe-chat', pw: adminPw });
  }
}

async function adminMusic() {
  const url = await showModal('🎵 Music', 'YouTube URL:', {
    input: true,
    showCancel: true
  });
  if (url) {
    socket.emit('admin', { type: 'music-start', pw: adminPw, url });
  }
}

socket.on('music-start', (data) => {
  const match = data.url.match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (match) {
    const player = document.getElementById('ytPlayer');
    player.src = `https://www.youtube.com/embed/${match[1]}?autoplay=1`;
    player.style.display = 'block';
  }
});

socket.on('music-skip', () => {
  const player = document.getElementById('ytPlayer');
  player.src = '';
  player.style.display = 'none';
});

// ============================================
// KEYBOARD HANDLERS
// ============================================
document.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    if (e.target.id === 'nameInput') showGameSelection();
    if (e.target.id === 'chatInput') sendMsg();
    if (e.target.id === 'chatInputUno') sendMsgUno();
  }
});

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('🎮 Game Lobby Ready');
  show('home');
});
