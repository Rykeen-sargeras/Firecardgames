// ============================================
// GAME-UNO.JS - UNO Game Logic
// ============================================

let unoHand = [];
let unoMyTurn = false;
let unoCurrentCard = null;
let unoPlayers = [];

socket.on('uno-state', (state) => {
  console.log('🎴 UNO State:', state);
  
  if (!state.started) return;
  
  unoHand = state.myHand || [];
  unoMyTurn = state.isMyTurn;
  unoCurrentCard = state.currentCard;
  unoPlayers = state.players;
  currentGameType = 'uno';
  
  show('gameUNO');
  
  // Players
  renderUnoPlayers(state.players, state.currentPlayerId);
  
  // Center card & deck
  renderUnoCenter(state.currentCard, state.deckCount, state.drawStack);
  
  // Hand
  renderUnoHand();
  
  // UNO button
  const unoBtn = document.getElementById('unoBtn');
  unoBtn.disabled = !unoMyTurn || unoHand.length > 2;
});

function renderUnoPlayers(players, currentId) {
  document.getElementById('unoPlayerList').innerHTML = players.map(p => {
    const isCurrent = p.id === currentId;
    const isMe = p.id === socket.id;
    
    return `
      <div class="uno-player ${isCurrent ? 'current' : ''} ${isMe ? 'is-me' : ''} ${p.disconnected ? 'disconnected' : ''}">
        <div class="uno-player-name">
          ${p.username}${isMe ? ' (You)' : ''}
          ${p.calledUno ? ' 🔥' : ''}
        </div>
        <div class="uno-player-cards">🎴 ${p.handCount}</div>
        ${isCurrent ? '<div class="turn-arrow">◀</div>' : ''}
        ${p.handCount === 1 && !p.calledUno && !isMe ? 
          `<button class="challenge-btn" onclick="challengeUno('${p.id}')">Challenge!</button>` : ''}
      </div>
    `;
  }).join('');
}

function renderUnoCenter(card, deckCount, drawStack) {
  // Current card
  const cardEl = document.getElementById('unoCurrentCard');
  if (card) {
    const color = card.activeColor || card.color;
    cardEl.className = `uno-card ${color}`;
    cardEl.innerHTML = getCardSymbol(card);
  }
  
  // Deck
  document.getElementById('unoDeckCount').textContent = deckCount;
  
  const deckEl = document.getElementById('unoDeck');
  deckEl.className = unoMyTurn ? 'uno-deck can-draw' : 'uno-deck';
  
  // Draw stack
  const stackEl = document.getElementById('drawStackInfo');
  if (drawStack > 0) {
    stackEl.textContent = `+${drawStack} cards stacked!`;
    stackEl.style.display = 'block';
  } else {
    stackEl.style.display = 'none';
  }
  
  // Turn indicator
  const turnEl = document.getElementById('unoTurnIndicator');
  turnEl.textContent = unoMyTurn ? '🎯 Your Turn!' : 'Waiting...';
  turnEl.className = unoMyTurn ? 'turn-indicator my-turn' : 'turn-indicator';
}

function renderUnoHand() {
  const handEl = document.getElementById('unoHandCards');
  
  handEl.innerHTML = unoHand.map((card, i) => {
    const color = card.activeColor || card.color;
    const canPlay = unoMyTurn && canPlayCard(card, unoCurrentCard);
    
    return `
      <div class="uno-card-small ${color} ${canPlay ? 'playable' : 'unplayable'}"
           onclick="${canPlay ? `playUnoCard(${i})` : 'cantPlay()'}">
        ${getCardSymbol(card)}
      </div>
    `;
  }).join('');
}

function getCardSymbol(card) {
  if (!card) return '?';
  switch (card.value) {
    case 'wild': return '🌈';
    case 'wild-draw4': return '+4';
    case 'draw2': return '+2';
    case 'skip': return '🚫';
    case 'reverse': return '🔄';
    default: return card.value;
  }
}

function canPlayCard(card, topCard) {
  if (!card || !topCard) return false;
  if (card.color === 'wild') return true;
  const activeColor = topCard.activeColor || topCard.color;
  if (card.color === activeColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function cantPlay() {
  showModal('❌ Cannot Play', unoMyTurn ? 
    'This card doesn\'t match. Draw a card or play a valid card.' :
    'It\'s not your turn!');
}

async function playUnoCard(index) {
  const card = unoHand[index];
  
  if (card.color === 'wild') {
    const color = await showModal('🌈 Choose Color', 'Pick a color:', {
      colorPicker: true
    });
    
    if (!color) return;
    socket.emit('uno-play', { cardIndex: index, chosenColor: color });
  } else {
    socket.emit('uno-play', { cardIndex: index });
  }
}

function drawUnoCard() {
  if (!unoMyTurn) {
    showModal('⏳ Wait', 'It\'s not your turn!');
    return;
  }
  socket.emit('uno-draw');
}

function callUno() {
  socket.emit('uno-call');
}

function challengeUno(playerId) {
  socket.emit('uno-challenge', playerId);
}

// UNO events
socket.on('uno-error', (msg) => {
  showModal('❌ Error', msg);
});

socket.on('uno-can-play-drawn', () => {
  showModal('✅ Playable!', 'You drew a playable card! Click it to play.');
});

socket.on('uno-called', (data) => {
  showOverlay(`🔥 ${data.username} called UNO!`);
});

socket.on('uno-penalty', (data) => {
  showOverlay(`⚠️ ${data.username}: ${data.reason}`);
});
