const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Servi file statici
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'display.html')));
app.get('/preview', (req, res) => res.sendFile(path.join(__dirname, 'preview.html')));

// Stato del gioco
let gameState = {
  teams: {},
  buzzerQueue: [],
  buzzerActive: false,
  buzzerLocked: false,
  buzzerStandalone: false,
  currentQuestion: null,
  roundAnswers: [],
  isPaused: false,
  
  // DUELLO
  duelloMode: {
    active: false,
    attaccante: null,
    difensore: null,
    categoria: null,
    scoreAttaccante: 0,
    scoreDifensore: 0,
    questionNumber: 0,
    waitingForAnswer: false
  },
  
  // ✅ NUOVO: Memory mode
  memoryMode: {
    active: false,
    currentManche: 0,
    totalManches: 3,
    cards: [],
    revealedCard: null,
    pairPosition: null,
    answers: {},
    mancheStartTime: 0,
    answerDeadline: 0,
    showAllTimeout: null,
    answerTimeout: null,
    usedPositions: [],
    currentRound: 0
  }
};

// Database mock
const db = {
  categories: ["storia", "geografia", "scienze", "cinema", "musica", "sport"],
  questions: []
};

// ════════════════════════════════════════════════════════════════
// 🧠 MEMORY GAME - HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════

const EMOJI_POOL = [
  '🍎', '🍌', '🍕', '🎮', '⚽', '🎸', '🚀', '🌟',
  '🐱', '🐶', '🦁', '🐼', '🎨', '📚', '🎭', '🎪',
  '🌈', '⭐', '🔥', '💎', '🎯', '🏆', '🎁', '🎂'
];

function generateMemoryCards(mancheNumber) {
  const pairsCount = mancheNumber === 1 ? 3 : mancheNumber === 2 ? 5 : 7;
  const totalCards = pairsCount * 2;
  
  // Seleziona emoji casuali
  const shuffled = [...EMOJI_POOL].sort(() => Math.random() - 0.5);
  const selectedEmojis = shuffled.slice(0, pairsCount);
  
  // Crea coppie
  const cards = [];
  selectedEmojis.forEach((emoji, idx) => {
    cards.push({ emoji: emoji, originalIndex: idx * 2 });
    cards.push({ emoji: emoji, originalIndex: idx * 2 + 1 });
  });
  
  // Mescola posizioni
  const shuffledCards = cards.sort(() => Math.random() - 0.5);
  
  // Aggiungi posizione finale
  return shuffledCards.map((card, position) => ({
    ...card,
    position: position
  }));
}

function selectRandomCardToReveal(cards, usedPositions = []) {
  const availableCards = cards.filter(c => !usedPositions.includes(c.position));
  if(availableCards.length === 0) return null;
  
  const randomCard = availableCards[Math.floor(Math.random() * availableCards.length)];
  
  // Trova la coppia
  const pairCard = cards.find(c => 
    c.emoji === randomCard.emoji && 
    c.position !== randomCard.position
  );
  
  return {
    revealed: randomCard,
    pair: pairCard
  };
}

function getMemoryGridSize(mancheNumber) {
  if(mancheNumber === 1) return '2x3';
  if(mancheNumber === 2) return '2x5';
  return '2x7';
}

// ════════════════════════════════════════════════════════════════
// 🧠 MEMORY GAME - FUNCTIONS
// ════════════════════════════════════════════════════════════════

function startMemoryManche(mancheNumber) {
  console.log(`🧠 Manche ${mancheNumber}/3`);
  
  gameState.memoryMode.currentManche = mancheNumber;
  gameState.memoryMode.cards = generateMemoryCards(mancheNumber);
  gameState.memoryMode.usedPositions = [];
  gameState.memoryMode.currentRound = 0;
  
  const totalCards = gameState.memoryMode.cards.length;
  const totalRounds = totalCards / 2;
  
  // Mostra schermata intro manche
  io.emit('memory_manche_intro', {
    manche: mancheNumber,
    totalManches: 3,
    pairsCount: totalCards / 2
  });
  
  // Dopo 3 secondi inizia prima round
  setTimeout(() => {
    startMemoryRound();
  }, 3000);
}

function startMemoryRound() {
  gameState.memoryMode.currentRound++;
  gameState.memoryMode.answers = {};
  
  const selection = selectRandomCardToReveal(
    gameState.memoryMode.cards, 
    gameState.memoryMode.usedPositions
  );
  
  if(!selection) {
    // Manche finita
    endMemoryManche();
    return;
  }
  
  gameState.memoryMode.revealedCard = selection.revealed;
  gameState.memoryMode.pairPosition = selection.pair.position;
  gameState.memoryMode.usedPositions.push(selection.revealed.position);
  gameState.memoryMode.usedPositions.push(selection.pair.position);
  
  const gridSize = getMemoryGridSize(gameState.memoryMode.currentManche);
  
  // FASE 1: Mostra tutte le carte (5 secondi)
  io.emit('memory_show_all', {
    cards: gameState.memoryMode.cards.map(c => c.emoji),
    grid: gridSize,
    duration: 5,
    manche: gameState.memoryMode.currentManche,
    round: gameState.memoryMode.currentRound
  });
  
  gameState.memoryMode.showAllTimeout = setTimeout(() => {
    // FASE 2: Copri tutte le carte
    io.emit('memory_cover_all');
    
    setTimeout(() => {
      // FASE 3: Scopri una carta e chiedi la coppia
      gameState.memoryMode.mancheStartTime = Date.now();
      gameState.memoryMode.answerDeadline = Date.now() + 15000;
      
      io.emit('memory_reveal_one', {
        position: selection.revealed.position,
        image: selection.revealed.emoji,
        grid: gridSize,
        duration: 15,
        manche: gameState.memoryMode.currentManche
      });
      
      // TIMEOUT: Dopo 15 secondi mostra risultati
      gameState.memoryMode.answerTimeout = setTimeout(() => {
        processMemoryAnswers();
      }, 15000);
      
    }, 1000);
  }, 5000);
}

function processMemoryAnswers() {
  const correctPosition = gameState.memoryMode.pairPosition;
  const results = [];
  let fastestCorrect = null;
  let fastestTime = 999;
  
  // Valuta risposte
  Object.values(gameState.memoryMode.answers).forEach(answer => {
    const isCorrect = answer.position === correctPosition;
    
    if(isCorrect) {
      const team = gameState.teams[answer.teamId];
      if(team) {
        team.score += 150;
        
        if(answer.time < fastestTime) {
          fastestTime = answer.time;
          fastestCorrect = answer.teamId;
        }
      }
    }
    
    results.push({
      teamId: answer.teamId,
      teamName: answer.teamName,
      position: answer.position,
      correct: isCorrect,
      time: answer.time
    });
  });
  
  // Bonus al più veloce
  if(fastestCorrect && gameState.teams[fastestCorrect]) {
    gameState.teams[fastestCorrect].score += 50;
    const fastestResult = results.find(r => r.teamId === fastestCorrect);
    if(fastestResult) fastestResult.bonus = 50;
  }
  
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  io.emit('update_teams', realTeams);
  
  // Mostra risultati
  io.emit('memory_show_results', {
    correctPosition: correctPosition,
    correctImage: gameState.memoryMode.cards[correctPosition].emoji,
    results: results,
    points: 150
  });
  
  console.log(`🧠 Round completata - ${results.filter(r => r.correct).length}/${results.length} corretti`);
  
  // Prossima round dopo 3 secondi
  setTimeout(() => {
    const totalRounds = gameState.memoryMode.cards.length / 2;
    if(gameState.memoryMode.currentRound >= totalRounds) {
      endMemoryManche();
    } else {
      startMemoryRound();
    }
  }, 3000);
}

function endMemoryManche() {
  console.log(`🧠 Fine Manche ${gameState.memoryMode.currentManche}/3`);
  
  if(gameState.memoryMode.currentManche >= 3) {
    // Fine gioco
    gameState.memoryMode.active = false;
    io.emit('memory_game_end');
    io.emit('cambia_vista', { view: 'classifica_gen' });
    console.log('🧠 Memory Game completato!');
  } else {
    // Prossima manche
    setTimeout(() => {
      startMemoryManche(gameState.memoryMode.currentManche + 1);
    }, 3000);
  }
}

// Connessioni Socket.io
io.on('connection', (socket) => {
  console.log(`✅ Nuova connessione: ${socket.id}`);

  // Amministratore
  socket.on('admin_connect', () => {
    socket.join('admin');
    socket.emit('init_data', {
      teams: Object.values(gameState.teams),
      categories: db.categories,
      questions: db.questions
    });
    console.log(`👨‍💼 Admin connesso: ${socket.id}`);
  });

  // Login squadra
  socket.on('login', (teamName) => {
    const isPreview = teamName === '🔍PREVIEW';
    
    gameState.teams[socket.id] = {
      id: socket.id,
      name: teamName,
      score: 0,
      isPreview: isPreview,
      lastBuzzerTime: null,
      streak: 0
    };
    
    socket.emit('login_success', { name: teamName });
    
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams);
    io.to('admin').emit('update_teams', realTeams);
    
    console.log(`👥 Squadra "${teamName}" connessa`);
  });

  // Ricevi risposte domande
  socket.on('invia_risposta', (risposta) => {
    const team = gameState.teams[socket.id];
    if (!team || !gameState.currentQuestion) return;
    
    const elapsed = (Date.now() - gameState.currentQuestion.startTime) / 1000;
    const isCorrect = risposta === gameState.currentQuestion.corretta;
    
    // Calcolo punti
    let punti = 0;
    if (isCorrect) {
      if (elapsed <= 2) punti = 145;
      else if (elapsed <= 10) punti = 125;
      else if (elapsed <= 20) punti = 100;
    }
    
    const answerData = {
      teamId: socket.id,
      teamName: team.name,
      risposta: risposta,
      corretta: isCorrect,
      punti: punti,
      tempo: elapsed.toFixed(2)
    };
    
    gameState.roundAnswers.push(answerData);
    io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
    
    // Aggiorna punteggio
    if (isCorrect) {
      team.score += punti;
      team.streak++;
    } else {
      team.streak = 0;
    }
    
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams);
    io.to('admin').emit('update_teams', realTeams);
    
    console.log(`📝 ${team.name}: ${risposta} - ${punti}pt`);
  });

  // Buzzer
  socket.on('prenoto', () => {
    if (gameState.buzzerLocked || !gameState.buzzerActive) return;
    
    const team = gameState.teams[socket.id];
    if (!team) return;
    
    const now = Date.now();
    const time = ((now - gameState.currentQuestion.startTime) / 1000).toFixed(2);
    
    team.lastBuzzerTime = now;
    
    gameState.buzzerQueue.push({
      id: socket.id,
      name: team.name,
      time: time
    });
    
    socket.emit('buzzer_position', { 
      position: gameState.buzzerQueue.length, 
      time: time 
    });
    
    if (gameState.buzzerQueue.length >= 3) {
      io.emit('buzzer_queue_full', { 
        queue: gameState.buzzerQueue,
        standalone: gameState.buzzerStandalone
      });
    }
    
    console.log(`🔔 ${team.name} prenotato: ${time}s`);
  });

  // ════════════════════════════════════════════════════════════════
  // 🧠 MEMORY GAME - EVENT HANDLERS
  // ════════════════════════════════════════════════════════════════

  socket.on('memory_start', () => {
    console.log('🧠 Inizio Memory Game');
    
    gameState.memoryMode.active = true;
    gameState.memoryMode.currentManche = 1;
    gameState.memoryMode.cards = [];
    gameState.memoryMode.usedPositions = [];
    
    // Avvia prima manche
    startMemoryManche(1);
  });

  socket.on('memory_answer', (data) => {
    if(!gameState.memoryMode.active) return;
    
    const team = gameState.teams[socket.id];
    if(!team || team.isPreview) return;
    
    // Una sola risposta per team per round
    if(gameState.memoryMode.answers[socket.id]) return;
    
    const responseTime = (Date.now() - gameState.memoryMode.mancheStartTime) / 1000;
    
    gameState.memoryMode.answers[socket.id] = {
      teamId: socket.id,
      teamName: team.name,
      position: parseInt(data.position),
      time: responseTime
    };
    
    console.log(`🧠 ${team.name} risponde: posizione ${data.position} in ${responseTime}s`);
  });

  socket.on('memory_skip_round', () => {
    // Admin può saltare la round corrente
    if(gameState.memoryMode.showAllTimeout) {
      clearTimeout(gameState.memoryMode.showAllTimeout);
    }
    if(gameState.memoryMode.answerTimeout) {
      clearTimeout(gameState.memoryMode.answerTimeout);
    }
    processMemoryAnswers();
  });

  socket.on('memory_stop', () => {
    // Admin ferma il gioco
    if(gameState.memoryMode.showAllTimeout) {
      clearTimeout(gameState.memoryMode.showAllTimeout);
    }
    if(gameState.memoryMode.answerTimeout) {
      clearTimeout(gameState.memoryMode.answerTimeout);
    }
    
    gameState.memoryMode.active = false;
    io.emit('reset_client_ui');
    io.emit('cambia_vista', { view: 'logo' });
    console.log('🧠 Memory Game fermato');
  });

  // ... [RESTANTE CODICE ESISTENTE DEL SERVER] ...

});

// ... [FUNZIONI DEL SERVER ESISTENTI] ...

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`✅ Server in ascolto su porta ${PORT}`));
