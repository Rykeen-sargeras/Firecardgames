// ===========================================
// CARDS AGAINST HUMANITY
// ===========================================

let cahState = {};

socket.on("cah-state", (data) => {
  console.log("CAH STATE:", data);
  cahState = data;
  
  if (data.isPending) {
    showScreen("cahScreen");
    renderCAHPending();
    return;
  }
  
  showScreen("cahScreen");
  renderCAH();
});

function renderCAH() {
  const data = cahState;
  
  // Black card
  document.getElementById("blackCard").textContent = data.blackCard || "...";
  
  // Czar
  document.getElementById("czarName").textContent = data.czarName || "...";
  
  // Round
  const roundEl = document.getElementById("roundNum");
  if (roundEl) roundEl.textContent = data.roundNumber || 1;
  
  // Scoreboard
  const sb = document.getElementById("cahScoreboard");
  sb.innerHTML = data.players.map(p => `
    <div class="score-row ${p.isCzar ? 'czar' : ''} ${p.submitted ? 'submitted' : ''}">
      <span>${p.name}${p.isCzar ? ' 👑' : ''}</span>
      <span>${p.score}</span>
    </div>
  `).join("");
  
  // 5x5 Submissions Grid
  renderSubmissionsGrid(data);
  
  // Hand
  renderHand(data);
}

function renderCAHPending() {
  const data = cahState;
  
  document.getElementById("blackCard").textContent = data.blackCard || "...";
  document.getElementById("czarName").textContent = data.czarName || "...";
  
  const sb = document.getElementById("cahScoreboard");
  sb.innerHTML = data.players.map(p => `
    <div class="score-row ${p.isCzar ? 'czar' : ''}">
      <span>${p.name}${p.isCzar ? ' 👑' : ''}</span>
      <span>${p.score}</span>
    </div>
  `).join("");
  
  renderSubmissionsGrid(data);
  
  document.getElementById("cahHand").innerHTML = `
    <div class="pending-msg">⏳ You'll join next round!</div>
  `;
}

function renderSubmissionsGrid(data) {
  const table = document.getElementById("cahTable");
  
  // Always show 5x5 grid (25 slots)
  const slots = [];
  
  // Fill with submissions
  data.submissions.forEach((s, i) => {
    if (data.allSubmitted && data.isCzar) {
      // Czar can pick - show cards face up and clickable
      slots.push(`
        <div class="white-card pickable" onclick="pickWinner('${s.odumid}')">
          ${s.card}
        </div>
      `);
    } else {
      // Show cards face up but not clickable (visible to all)
      slots.push(`
        <div class="white-card">
          ${s.card}
        </div>
      `);
    }
  });
  
  // Fill remaining slots with empty placeholders
  const expectedTotal = Math.max(data.expectedCount || 0, 5);
  const totalSlots = Math.max(slots.length, Math.min(25, Math.ceil(expectedTotal / 5) * 5));
  
  while (slots.length < totalSlots) {
    slots.push('<div class="white-card empty"></div>');
  }
  
  table.innerHTML = slots.join("");
  
  // Status below grid
  if (!data.allSubmitted && data.submissionCount !== undefined) {
    const remaining = data.expectedCount - data.submissionCount;
    if (remaining > 0) {
      table.innerHTML += `<div class="waiting-msg" style="grid-column: 1/-1;">Waiting for ${remaining} more submission${remaining > 1 ? 's' : ''}...</div>`;
    }
  }
}

function renderHand(data) {
  const hand = document.getElementById("cahHand");
  
  if (data.isCzar) {
    hand.innerHTML = '<div class="czar-msg">👑 You are the Card Czar! Wait for submissions, then pick the funniest.</div>';
    return;
  }
  
  if (data.submitted) {
    hand.innerHTML = '<div class="submitted-msg">✅ Card submitted! Waiting for others...</div>';
    return;
  }
  
  if (!data.myHand || data.myHand.length === 0) {
    hand.innerHTML = '<div class="waiting-msg">Loading hand...</div>';
    return;
  }
  
  hand.innerHTML = data.myHand.map((card, i) => `
    <div class="white-card playable" onclick="playCard(${i}, '${escapeAttr(card)}')">
      ${card === "__BLANK__" ? "✏️ BLANK" : card}
    </div>
  `).join("");
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function playCard(index, card) {
  if (card === "__BLANK__") {
    const custom = prompt("Write your own card:");
    if (custom && custom.trim()) {
      socket.emit("cah-submit", { card: "__BLANK__", custom: custom.trim() });
    }
  } else {
    if (confirm("Play this card?")) {
      socket.emit("cah-submit", { card: card });
    }
  }
}

function pickWinner(odumid) {
  if (confirm("Pick this card as the winner?")) {
    socket.emit("cah-pick", odumid);
  }
}
