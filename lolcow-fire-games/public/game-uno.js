// ===========================================
// UNO GAME
// ===========================================

let unoState = {};

socket.on("uno-state", (data) => {
  console.log("UNO STATE:", data);
  unoState = data;
  showScreen("unoScreen");
  renderUNO();
});

socket.on("uno-error", (msg) => {
  showToast(msg);
});

socket.on("uno-called", (data) => {
  showToast(`🔥 ${data.name} called UNO!`);
});

socket.on("uno-penalty", (data) => {
  showToast(`⚠️ ${data.name}: ${data.reason}`);
});

function renderUNO() {
  const data = unoState;
  
  // Current card
  const cc = document.getElementById("unoCurrentCard");
  const card = data.currentCard;
  if (card) {
    const color = card.activeColor || card.color;
    cc.className = `uno-card ${color}`;
    cc.textContent = getUnoSymbol(card);
  }
  
  // Deck count
  document.getElementById("unoDeckCount").textContent = data.deckCount || 0;
  
  // Draw stack
  const stack = document.getElementById("drawStack");
  if (data.drawStack > 0) {
    stack.textContent = `+${data.drawStack} stacked!`;
    stack.classList.add("active");
  } else {
    stack.classList.remove("active");
  }
  
  // Turn indicator
  const turn = document.getElementById("unoTurn");
  turn.textContent = data.isMyTurn ? "🎯 Your Turn!" : "Waiting...";
  turn.className = data.isMyTurn ? "my-turn" : "";
  
  // Deck clickable
  const deck = document.getElementById("unoDeck");
  deck.className = data.isMyTurn ? "uno-deck can-draw" : "uno-deck";
  
  // Players
  const plist = document.getElementById("unoPlayers");
  plist.innerHTML = data.players.map(p => `
    <div class="uno-player ${p.isCurrentTurn ? 'current' : ''}">
      <div class="pname">${p.name}${p.calledUno ? ' 🔥' : ''}</div>
      <div class="pcards">🎴 ${p.cardCount}</div>
      ${p.cardCount === 1 && !p.calledUno ? 
        `<button class="challenge-btn" onclick="challengeUno('${p.odumid}')">Challenge!</button>` : ''}
    </div>
  `).join("");
  
  // Hand
  const hand = document.getElementById("unoHand");
  if (!data.myHand || data.myHand.length === 0) {
    hand.innerHTML = '<div style="padding:20px;color:#aa9988;">Loading...</div>';
    return;
  }
  
  hand.innerHTML = data.myHand.map((c, i) => {
    const col = c.activeColor || c.color;
    const canPlay = data.isMyTurn && canPlayCard(c, data.currentCard);
    return `
      <div class="uno-card-small ${col} ${canPlay ? 'playable' : 'unplayable'}" 
           onclick="${canPlay ? `playUno(${i})` : 'cantPlay()'}">
        ${getUnoSymbol(c)}
      </div>
    `;
  }).join("");
}

function getUnoSymbol(card) {
  if (!card) return "?";
  switch(card.value) {
    case "wild": return "🌈";
    case "draw4": return "+4";
    case "draw2": return "+2";
    case "skip": return "🚫";
    case "reverse": return "🔄";
    default: return card.value;
  }
}

function canPlayCard(card, top) {
  if (!card || !top) return false;
  if (card.color === "wild") return true;
  const topColor = top.activeColor || top.color;
  if (card.color === topColor) return true;
  if (card.value === top.value) return true;
  return false;
}

function playUno(index) {
  const card = unoState.myHand[index];
  
  if (card.color === "wild") {
    const color = prompt("Choose color: red, yellow, green, blue");
    if (["red","yellow","green","blue"].includes(color)) {
      socket.emit("uno-play", { cardIndex: index, color: color });
    }
  } else {
    socket.emit("uno-play", { cardIndex: index });
  }
}

function drawUno() {
  if (!unoState.isMyTurn) {
    showToast("Not your turn!");
    return;
  }
  socket.emit("uno-draw");
}

function callUno() {
  socket.emit("uno-call");
}

function challengeUno(targetId) {
  socket.emit("uno-challenge", targetId);
}

function cantPlay() {
  if (!unoState.isMyTurn) {
    showToast("Not your turn!");
  } else {
    showToast("Can't play that card - draw instead!");
  }
}
