// ============================================
// GAME-CAH.JS - Cards Against The LCU
// ============================================

let cahHand = [];
let cahIsCzar = false;
let cahSubmitted = false;
let cahPlayers = [];

socket.on('cah-state', (state) => {
  console.log('🃏 CAH State:', state);
  
  if (!state.started) return;
  
  cahHand = state.myHand || [];
  cahIsCzar = state.isCzar;
  cahSubmitted = state.hasSubmitted;
  cahPlayers = state.players;
  currentGameType = 'cards-against';
  
  show('gameCAH');
  
  // Czar name
  document.getElementById('czarName').textContent = state.czarName;
  
  // Scoreboard
  renderScoreboard(state.players);
  
  // Black card
  document.getElementById('blackCard').innerHTML = `
    <div class="card black-card">${state.blackCard || '...'}</div>
  `;
  
  // Submissions
  renderSubmissions(state.submissions, state.allSubmitted, state.czarId);
  
  // Hand
  renderHand();
});

function renderScoreboard(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  document.getElementById('scoreList').innerHTML = sorted.map((p, i) => `
    <div class="score-row ${p.isCzar ? 'is-czar' : ''} ${p.disconnected ? 'disconnected' : ''}">
      <span>${i + 1}. ${p.username}</span>
      <span>${p.score} ${p.isCzar ? '👑' : ''}</span>
    </div>
  `).join('');
}

function renderSubmissions(submissions, allSubmitted, czarId) {
  const table = document.getElementById('submissionsTable');
  
  if (submissions.length === 0) {
    table.innerHTML = '<div class="waiting-text">⏳ Waiting for submissions...</div>';
    return;
  }
  
  const canPick = cahIsCzar && allSubmitted;
  
  table.innerHTML = submissions.map(s => `
    <div class="card white-card ${canPick ? 'pickable' : ''}"
         ${canPick ? `onclick="pickWinner('${s.playerId}')"` : ''}>
      ${s.card}
      ${canPick ? '<div class="pick-label">Click to pick</div>' : ''}
    </div>
  `).join('');
}

function renderHand() {
  const handEl = document.getElementById('handCards');
  
  if (cahIsCzar) {
    handEl.innerHTML = `
      <div class="czar-message">
        👑 You are the Card Czar!<br>
        Wait for submissions, then pick the funniest.
      </div>
    `;
    return;
  }
  
  if (cahSubmitted) {
    handEl.innerHTML = `
      <div class="submitted-message">
        ✅ Card submitted! Waiting for others...
      </div>
    `;
    return;
  }
  
  handEl.innerHTML = cahHand.map((card, i) => `
    <div class="card white-card playable" onclick="playCard(${i})">
      ${card === '__BLANK__' ? '✏️ Write Your Own' : card}
    </div>
  `).join('');
}

async function playCard(index) {
  const card = cahHand[index];
  const display = card === '__BLANK__' ? 'Write your own card' : card;
  
  const confirmed = await showModal('🃏 Play Card?', display, {
    showCancel: true,
    confirmText: 'Play',
    cancelText: 'Cancel'
  });
  
  if (!confirmed) return;
  
  if (card === '__BLANK__') {
    const custom = await showModal('✏️ Custom Card', 'Enter your text:', {
      input: true,
      inputPlaceholder: 'Your answer...',
      showCancel: true
    });
    
    if (custom && custom.trim()) {
      socket.emit('cah-submit', { card, customText: custom.trim() });
    }
  } else {
    socket.emit('cah-submit', { card });
  }
}

async function pickWinner(playerId) {
  const confirmed = await showModal('👑 Pick Winner?', 'Award point to this card?', {
    showCancel: true,
    confirmText: 'Pick Winner'
  });
  
  if (confirmed) {
    socket.emit('cah-pick', playerId);
  }
}
