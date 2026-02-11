const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  transports: ['websocket', 'polling'], // Prefer WebSocket, fallback to polling
  pingInterval: 10000,     // Ping ogni 10s (default 25s) - rileva disconnessioni più veloce
  pingTimeout: 5000,       // Timeout 5s (default 20s) - rileva disconnessioni più veloce
  upgradeTimeout: 5000,    // Timeout upgrade da polling a websocket
  maxHttpBufferSize: 1e6,  // 1MB max payload
  perMessageDeflate: {     // Compressione messaggi
    threshold: 256         // Comprimi solo messaggi > 256 bytes
  }
});
const path = require('path');
const fs = require('fs');

// ? Carica domande dal file JSON
let questionsData = { categories: [], questions: [] };
try {
  const questionsPath = path.join(__dirname, 'public', 'domande.json');
  const rawData = fs.readFileSync(questionsPath, 'utf8');
  const jsonData = JSON.parse(rawData);
  
  const pacchetto = jsonData.pacchetti["1"];
  const categories = Object.keys(pacchetto.categorie);
  const allQuestions = [];
  
  categories.forEach(categoria => {
    const domande = pacchetto.categorie[categoria];
    domande.forEach(d => {
      allQuestions.push({
        id: d.id,
        domanda: d.domanda,
        risposte: d.risposte || [],
        corretta: d.risposte ? d.risposte[d.corretta] : d.corretta,
        categoria: categoria,
        punti: d.punti,
        difficolta: d.difficolta
      });
    });
  });
  
  if (pacchetto.bonus) {
    pacchetto.bonus.forEach(d => {
      allQuestions.push({
        id: d.id,
        domanda: d.domanda,
        risposte: d.risposte,
        corretta: d.risposte[d.corretta],
        categoria: "Bonus",
        punti: d.punti,
        difficolta: d.difficolta
      });
    });
  }
  
  if (pacchetto.stima) {
    pacchetto.stima.forEach(d => {
      allQuestions.push({
        id: d.id,
        domanda: d.domanda,
        risposte: [],
        corretta: d.corretta,
        categoria: "Stima",
        punti: d.punti,
        difficolta: d.difficolta
      });
    });
  }
  
  if (pacchetto.anagramma) {
    pacchetto.anagramma.forEach(d => {
      allQuestions.push({
        id: d.id,
        domanda: d.domanda,
        risposte: [],
        corretta: d.corretta,
        categoria: "Anagramma",
        punti: d.punti,
        difficolta: d.difficolta
      });
    });
  }
  
  questionsData = {
    categories: categories,
    questions: allQuestions
  };
  
  console.log(`? Caricate ${allQuestions.length} domande`);
} catch (error) {
  console.error('? Errore caricamento domande:', error.message);
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/preview', (req, res) => res.sendFile(path.join(__dirname, 'public', 'preview.html')));

// ============================================
// 🔄 SISTEMA DI RICONNESSIONE
// ============================================
// Quando un giocatore si disconnette, il suo team viene spostato qui
// invece di essere cancellato. Ha 5 minuti per riconnettersi.
const disconnectedTeams = new Map(); // teamName (lowercase) → { team, disconnectedAt, oldSocketId }
const RECONNECT_GRACE_PERIOD = 5 * 60 * 1000; // 5 minuti

// Pulizia periodica dei team disconnessi scaduti (ogni 60s)
setInterval(() => {
  const now = Date.now();
  for (const [name, data] of disconnectedTeams.entries()) {
    if (now - data.disconnectedAt > RECONNECT_GRACE_PERIOD) {
      disconnectedTeams.delete(name);
      console.log(`🗑️ Team "${data.team.name}" rimosso dopo grace period scaduto`);
    }
  }
}, 60000);

// Funzione per aggiornare tutti i riferimenti da un vecchio socketId a uno nuovo
function migrateSocketId(oldId, newId) {
  // Buzzer queue
  gameState.buzzerQueue.forEach(b => {
    if (b.id === oldId) b.id = newId;
  });

  // Round answers
  gameState.roundAnswers.forEach(a => {
    if (a.teamId === oldId) a.teamId = newId;
  });

  // Round details
  gameState.roundDetails.forEach(d => {
    if (d.teamId === oldId) d.teamId = newId;
  });

  // Round scores
  if (gameState.roundScores[oldId] !== undefined) {
    gameState.roundScores[newId] = gameState.roundScores[oldId];
    delete gameState.roundScores[oldId];
  }

  // Duello mode
  if (gameState.duelloMode.active) {
    if (gameState.duelloMode.attaccante && gameState.duelloMode.attaccante.id === oldId) {
      gameState.duelloMode.attaccante.id = newId;
    }
    if (gameState.duelloMode.difensore && gameState.duelloMode.difensore.id === oldId) {
      gameState.duelloMode.difensore.id = newId;
    }
    if (gameState.duelloMode.currentBuzzer && gameState.duelloMode.currentBuzzer.id === oldId) {
      gameState.duelloMode.currentBuzzer.id = newId;
    }
  }

  // Ruota della fortuna
  if (gameState.ruotaWinner && gameState.ruotaWinner.id === oldId) {
    gameState.ruotaWinner.id = newId;
  }
  if (gameState.ruotaChallenge && gameState.ruotaChallenge.teamId === oldId) {
    gameState.ruotaChallenge.teamId = newId;
  }

  // Current question (ruota)
  if (gameState.currentQuestion && gameState.currentQuestion.ruotaTeamId === oldId) {
    gameState.currentQuestion.ruotaTeamId = newId;
  }

  // Memory mode answers
  if (gameState.memoryMode.active && gameState.memoryMode.answers[oldId]) {
    gameState.memoryMode.answers[newId] = gameState.memoryMode.answers[oldId];
    gameState.memoryMode.answers[newId].teamId = newId;
    delete gameState.memoryMode.answers[oldId];
  }

  // Finale mode - allInBets
  if (gameState.finaleMode && gameState.finaleMode.allInBets && gameState.finaleMode.allInBets[oldId]) {
    gameState.finaleMode.allInBets[newId] = gameState.finaleMode.allInBets[oldId];
    gameState.finaleMode.allInBets[newId].teamId = newId;
    delete gameState.finaleMode.allInBets[oldId];
  }

  // Patto col destino
  if (gameState.pattoDestinoState.attivo) {
    const idx = gameState.pattoDestinoState.squadreSelezionate.indexOf(oldId);
    if (idx !== -1) {
      gameState.pattoDestinoState.squadreSelezionate[idx] = newId;
    }
    if (gameState.pattoDestinoState.scelte.has(oldId)) {
      gameState.pattoDestinoState.scelte.set(newId, gameState.pattoDestinoState.scelte.get(oldId));
      gameState.pattoDestinoState.scelte.delete(oldId);
    }
    gameState.pattoDestinoState.messaggiChat.forEach(m => {
      if (m.teamId === oldId) m.teamId = newId;
    });
  }

  console.log(`🔄 Migrati riferimenti: ${oldId} → ${newId}`);
}
// ============================================
// FINE SISTEMA DI RICONNESSIONE
// ============================================

let gameState = {
  teams: {},
  buzzerQueue: [],
  buzzerActive: false,
  buzzerLocked: false,
  buzzerStandalone: false,
  currentQuestion: null,
  roundAnswers: [],
  isPaused: false,
  roundScores: {}, // ? FIX: Aggiunto per tracciare i punteggi del round
  roundDetails: [], // 🆕 Dettagli completi delle risposte del round (squadra, risposta, tempo, punti)
  hideLeaderboard: false, // ✅ FIX 5: Per nascondere classifica durante finale
  ruotaWinner: null, // ✅ Per ruota della fortuna
  ruotaChoice: null, // ✅ Per ruota della fortuna
  ruotaChallenge: null, // ✅ Per ruota della fortuna
  
  duelloMode: {
    active: false,
    attaccante: null,
    difensore: null,
    categoria: null,
    scoreAttaccante: 0,
    scoreDifensore: 0,
    questionNumber: 0,
    waitingForAnswer: false,
    currentBuzzer: null
  },
  
  memoryMode: {
    active: false,
    currentManche: 0,
    totalManches: 1,
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
  },
  
  // ✅ FIX COMPLETO: SFIDA FINALE
  finaleMode: null,
  
  // 💀 IL PATTO COL DESTINO
  pattoDestinoState: {
    attivo: false,
    fase: null, // 'regole' | 'chat' | 'scelta' | 'reveal' | null
    squadreSelezionate: [], // Array di team IDs
    scelte: new Map(), // teamId → 'patto' | 'tradimento'
    messaggiChat: [], // { teamId, playerName, msg, timestamp }
    startTime: null,
    timer: null,
    contatoreUtilizzi: 0,
    maxUtilizzi: 2,
    revealStep: 0,
    revealTimer: null
  }
};

// ============================================
// 💾 SISTEMA DI AUTO-SAVE
// ============================================
// Aggiungi questo codice in server.js, subito dopo la definizione di gameState

// File dove salvare lo stato
const SAVE_FILE = path.join(__dirname, 'gamestate_backup.json');

// Funzione per salvare lo stato
function saveGameState() {
  try {
    // Includi anche i team disconnessi nel backup (potrebbero riconnettersi)
    const disconnectedTeamsList = [];
    for (const [name, data] of disconnectedTeams.entries()) {
      if (Date.now() - data.disconnectedAt < RECONNECT_GRACE_PERIOD) {
        disconnectedTeamsList.push({
          name: data.team.name,
          score: data.team.score,
          color: data.team.color,
          disconnectedAt: data.disconnectedAt
        });
      }
    }

    const dataToSave = {
      timestamp: new Date().toISOString(),
      teams: Object.values(gameState.teams)
        .filter(t => !t.isPreview)
        .map(t => ({
          id: t.id,
          name: t.name,
          score: t.score,
          color: t.color
        })),
      disconnectedTeams: disconnectedTeamsList,
      pattoUtilizzi: gameState.pattoDestinoState.contatoreUtilizzi,
      sessionStart: gameState.sessionStart || new Date().toISOString()
    };

    fs.writeFileSync(SAVE_FILE, JSON.stringify(dataToSave, null, 2));
    console.log('💾 Stato salvato:', dataToSave.teams.length, 'squadre attive +', disconnectedTeamsList.length, 'disconnesse');
  } catch (error) {
    console.error('❌ Errore salvataggio:', error);
  }
}

// Funzione per caricare lo stato
function loadGameState() {
  try {
    if (fs.existsSync(SAVE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
      console.log('📂 Trovato backup del', data.timestamp);
      console.log('   Squadre salvate:', data.teams.length);
      
      // Chiedi conferma via console (opzionale)
      // Per ora lo carica automaticamente se il file è recente (< 2 ore)
      const backupAge = Date.now() - new Date(data.timestamp).getTime();
      const twoHours = 2 * 60 * 60 * 1000;
      
      if (backupAge < twoHours) {
        console.log('✅ Backup recente, carico automaticamente...');
        return data;
      } else {
        console.log('⚠️  Backup vecchio (', Math.floor(backupAge / 1000 / 60), 'minuti), ignoro');
        return null;
      }
    }
    return null;
  } catch (error) {
    console.error('❌ Errore caricamento:', error);
    return null;
  }
}

// Salva ogni 30 secondi
setInterval(() => {
  if (Object.keys(gameState.teams).length > 0) {
    saveGameState();
  }
}, 30000);

// Salvataggio rapido dopo ogni cambio punteggio (debounced 2s)
let _saveScoreTimer = null;
function saveAfterScoreChange() {
  if (_saveScoreTimer) clearTimeout(_saveScoreTimer);
  _saveScoreTimer = setTimeout(() => {
    saveGameState();
    _saveScoreTimer = null;
  }, 2000); // 2 secondi di debounce - salva subito dopo i punteggi
}

// Carica all'avvio
const savedState = loadGameState();
if (savedState) {
  console.log('🔄 RIPRISTINO IN CORSO...');
  gameState.sessionStart = savedState.sessionStart;
  gameState.pattoDestinoState.contatoreUtilizzi = savedState.pattoUtilizzi || 0;

  // Ripristina TUTTI i team (attivi + disconnessi) come disconnectedTeams
  // Così quando si riconnettono, recuperano il punteggio
  const allTeams = [...(savedState.teams || [])];
  if (savedState.disconnectedTeams) {
    allTeams.push(...savedState.disconnectedTeams);
  }

  allTeams.forEach(t => {
    const key = t.name.toLowerCase().trim();
    if (!disconnectedTeams.has(key)) {
      disconnectedTeams.set(key, {
        team: { id: null, name: t.name, score: t.score, color: t.color, isPreview: false },
        disconnectedAt: Date.now(), // Reset timer al riavvio
        oldSocketId: t.id || null
      });
    }
  });

  console.log(`✅ Ripristinati ${allTeams.length} team in attesa di riconnessione.`);
  console.log('   Le squadre si riconnetteranno automaticamente con i loro punteggi.');
}

// Salva quando il server si chiude
process.on('SIGTERM', () => {
  console.log('🛑 Server in chiusura, salvo lo stato...');
  saveGameState();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Server interrotto, salvo lo stato...');
  saveGameState();
  process.exit(0);
});

// ============================================
// FINE SISTEMA AUTO-SAVE
// ============================================

const db = {
  categories: questionsData.categories || [],
  questions: questionsData.questions || []
};

// ============================================
// OTTIMIZZAZIONI PERFORMANCE
// ============================================

// Debounce per broadcast update_teams (evita invii multipli ravvicinati)
let _broadcastTeamsTimer = null;
function broadcastTeams() {
  if (_broadcastTeamsTimer) clearTimeout(_broadcastTeamsTimer);
  _broadcastTeamsTimer = setTimeout(() => {
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams);
    _broadcastTeamsTimer = null;
  }, 50); // 50ms debounce - raggruppa emissioni ravvicinate
  // Salva dopo ogni aggiornamento (debounced 2s)
  saveAfterScoreChange();
}

// Broadcast immediato (per quando serve risposta istantanea)
function broadcastTeamsNow() {
  if (_broadcastTeamsTimer) clearTimeout(_broadcastTeamsTimer);
  _broadcastTeamsTimer = null;
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  io.emit('update_teams', realTeams);
  // Salva dopo ogni aggiornamento (debounced 2s)
  saveAfterScoreChange();
}

// Rate limiter per buzzer (previene spam)
const buzzerCooldowns = new Map();
function canPressBuzzer(socketId) {
  const now = Date.now();
  const lastPress = buzzerCooldowns.get(socketId) || 0;
  if (now - lastPress < 300) return false; // 300ms cooldown
  buzzerCooldowns.set(socketId, now);
  return true;
}

// Pulizia periodica cooldowns buzzer (ogni 60s)
setInterval(() => {
  const now = Date.now();
  for (const [id, time] of buzzerCooldowns.entries()) {
    if (now - time > 60000) buzzerCooldowns.delete(id);
  }
}, 60000);

function getQuestionsByCategory(category) {
  return db.questions.filter(q => q.categoria === category);
}

function sendQuestion(questionData, modalita = 'multipla') {
  if (!questionData) return;
  
  // Applica moltiplicatore se è domanda finale e non è ALL IN (domande 2-5 = x2)
  let puntiEffettivi = questionData.punti || 100;
  if (questionData.isFinaleQuestion && questionData.finaleQuestion >= 2) {
    puntiEffettivi = (questionData.punti || 100) * 2;
    console.log(`🔥 DOMANDA FINALE ${questionData.finaleQuestion}/5 - PUNTI x2 = ${puntiEffettivi}`);
  }
  
  gameState.currentQuestion = {
    ...questionData,
    punti: puntiEffettivi,  // Salva i punti effettivi con moltiplicatore
    startTime: Date.now(),
    modalita: modalita
  };
  gameState.roundAnswers = [];
  gameState.buzzerQueue = [];
  
  if(modalita === 'buzzer') {
    gameState.buzzerActive = true;
    gameState.buzzerLocked = false;
  } else {
    gameState.buzzerLocked = true;
  }
  
  const payload = {
    domanda: questionData.domanda,
    risposte: questionData.risposte || [],
    modalita: modalita,
    categoria: questionData.categoria,
    startTime: Date.now(),
    serverTimestamp: Date.now(),
    finaleQuestion: questionData.finaleQuestion || null,
    totalFinaleQuestions: questionData.totalFinaleQuestions || null,
    isFinaleQuestion: questionData.isFinaleQuestion || null,
    punti: puntiEffettivi
  };
  
  gameState.currentQuestion.corretta = questionData.corretta;
  
  io.emit('nuova_domanda', payload);
  io.emit('stato_buzzer', {
    locked: gameState.buzzerLocked,
    attiva: (modalita === 'buzzer')
  });
  
  // ? FIX 5: Invia la risposta corretta all'admin in anticipo
  io.to('admin').emit('show_correct_answer_preview', {
    corretta: questionData.corretta,
    domanda: questionData.domanda,
    categoria: questionData.categoria
  });
  
  // ✅ LOG EVIDENZIATO DELLA RISPOSTA CORRETTA
  console.log('\n' + '='.repeat(80));
  console.log('🎯 NUOVA DOMANDA');
  console.log('='.repeat(80));
  console.log(`📚 Categoria: ${questionData.categoria}`);
  console.log(`🎮 Modalità: ${modalita}`);
  console.log(`❓ Domanda: "${questionData.domanda}"`);
  console.log(`✅ RISPOSTA CORRETTA: ${questionData.corretta}`);
  if (questionData.isFinaleQuestion) {
    console.log(`🔥 FINALE ${questionData.finaleQuestion}/5 - PUNTI: ${puntiEffettivi} (x2)`);
  }
  console.log('='.repeat(80) + '\n');
}

// MEMORY GAME
const EMOJI_POOL = [
  '🍎', '🍌', '🍕', '🎮', '⚽', '🎸', '🚀', '🌟',
  '🐱', '🐶', '🦁', '🐼', '🎨', '📚', '🎭', '🎪',
  '🌈', '⭐', '🔥', '💎', '🎯', '🏆', '🎁', '🎂'
];

function generateMemoryCards(roundNumber) {
  const pairsCount = roundNumber === 1 ? 3 : roundNumber === 2 ? 5 : 7;
  const shuffled = [...EMOJI_POOL].sort(() => Math.random() - 0.5);
  const selectedEmojis = shuffled.slice(0, pairsCount);
  
  const cards = [];
  selectedEmojis.forEach((emoji) => {
    cards.push({ emoji: emoji });
    cards.push({ emoji: emoji });
  });
  
  const shuffledCards = cards.sort(() => Math.random() - 0.5);
  return shuffledCards.map((card, position) => ({ ...card, position: position }));
}

function selectRandomCardToReveal(cards, usedPositions = []) {
  const availableCards = cards.filter(c => !usedPositions.includes(c.position));
  if(availableCards.length === 0) return null;
  
  const randomCard = availableCards[Math.floor(Math.random() * availableCards.length)];
  const pairCard = cards.find(c => c.emoji === randomCard.emoji && c.position !== randomCard.position);
  
  return { revealed: randomCard, pair: pairCard };
}

function getMemoryGridSize(roundNumber) {
  if(roundNumber === 1) return '2x3';
  if(roundNumber === 2) return '2x5';
  return '2x7';
}

function startMemoryManche(mancheNumber) {
  gameState.memoryMode.currentManche = mancheNumber;
  gameState.memoryMode.usedPositions = [];
  gameState.memoryMode.currentRound = 0;
  
  io.emit('memory_manche_intro', {
    manche: mancheNumber,
    totalManches: 1,
    pairsCount: 3
  });
  
  setTimeout(() => startMemoryRound(), 3000);
}

function startMemoryRound() {
  gameState.memoryMode.currentRound++;
  
  if(gameState.memoryMode.currentRound > 3) {
    endMemoryManche();
    return;
  }
  
  gameState.memoryMode.answers = {};
  gameState.memoryMode.cards = generateMemoryCards(gameState.memoryMode.currentRound);
  gameState.memoryMode.usedPositions = [];
  
  const selection = selectRandomCardToReveal(gameState.memoryMode.cards, gameState.memoryMode.usedPositions);
  if(!selection) {
    endMemoryManche();
    return;
  }
  
  gameState.memoryMode.revealedCard = selection.revealed;
  gameState.memoryMode.pairPosition = selection.pair.position;
  gameState.memoryMode.usedPositions.push(selection.revealed.position);
  gameState.memoryMode.usedPositions.push(selection.pair.position);
  
  const gridSize = getMemoryGridSize(gameState.memoryMode.currentRound);
  
  io.emit('memory_show_all', {
    cards: gameState.memoryMode.cards.map(c => c.emoji),
    grid: gridSize,
    duration: 6,
    manche: gameState.memoryMode.currentManche,
    round: gameState.memoryMode.currentRound
  });
  
  gameState.memoryMode.showAllTimeout = setTimeout(() => {
    io.emit('memory_cover_all');
    
    setTimeout(() => {
      io.emit('memory_reveal_one', {
        position: gameState.memoryMode.revealedCard.position,
        image: gameState.memoryMode.revealedCard.emoji,
        duration: 10
      });
      
      io.to('admin').emit('memory_players_input', {
        grid: gridSize,
        positions: gameState.memoryMode.cards.length,
        correctPosition: gameState.memoryMode.pairPosition
      });
      
      gameState.memoryMode.mancheStartTime = Date.now();
      gameState.memoryMode.answerDeadline = Date.now() + 10000;
      
      gameState.memoryMode.answerTimeout = setTimeout(() => {
        processMemoryAnswers();
      }, 10000);
      
    }, 2000);
  }, 8000);
}

function processMemoryAnswers() {
  if(gameState.memoryMode.answerTimeout) {
    clearTimeout(gameState.memoryMode.answerTimeout);
    gameState.memoryMode.answerTimeout = null;
  }
  
  const correctPosition = gameState.memoryMode.pairPosition;
  const results = [];
  
  Object.values(gameState.memoryMode.answers).forEach(answer => {
    const isCorrect = answer.position === correctPosition;
    
    if(isCorrect) {
      const team = gameState.teams[answer.teamId];
      if(team) {
        const points = 100;
        team.score += points;
        
        // ✅ FIX: Traccia punteggi round
        if (!gameState.roundScores[answer.teamId]) {
          gameState.roundScores[answer.teamId] = 0;
        }
        gameState.roundScores[answer.teamId] += points;
        
        results.push({
          teamName: answer.teamName,
          position: answer.position,
          time: answer.time.toFixed(2),
          correct: true,
          points: points
        });
      }
    } else {
      results.push({
        teamName: answer.teamName,
        position: answer.position,
        time: answer.time.toFixed(2),
        correct: false,
        points: 0
      });
    }
  });
  
  broadcastTeamsNow();

  io.emit('memory_show_results', {
    results: results,
    correctPosition: correctPosition,
    correctImage: gameState.memoryMode.revealedCard.emoji,
    points: 100
  });
  
  setTimeout(() => {
    startMemoryRound();
  }, 8000);
}

function endMemoryManche() {
  io.emit('memory_game_end');
  gameState.memoryMode.active = false;
  
  setTimeout(() => {
    io.emit('cambia_vista', { view: 'classifica_gen' });
  }, 3000);
}

function startDuello() {
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  if(realTeams.length < 2) return;
  
  const sorted = realTeams.sort((a, b) => a.score - b.score);
  const lastPlace = sorted[0];
  
  gameState.duelloMode.active = true;
  gameState.duelloMode.attaccante = { id: lastPlace.id, name: lastPlace.name };
  gameState.duelloMode.difensore = null;
  gameState.duelloMode.categoria = null;
  gameState.duelloMode.scoreAttaccante = 0;
  gameState.duelloMode.scoreDifensore = 0;
  gameState.duelloMode.questionNumber = 0;
  gameState.duelloMode.waitingForAnswer = false;
  gameState.duelloMode.currentBuzzer = null;
  
  // ✅ FIX: Invia l'attaccante all'admin
  io.to('admin').emit('duello_attaccante', {
    attaccante: { id: lastPlace.id, name: lastPlace.name }
  });
  
  // ✅ FIX: Animazione estrazione sul display
  io.emit('duello_extraction_animation', {
    teams: realTeams.map(t => t.name),
    winner: { id: lastPlace.id, name: lastPlace.name }
  });
  
  console.log('\n' + '🔥'.repeat(40));
  console.log(`🔥 DUELLO AVVIATO - Attaccante: ${lastPlace.name}`);
  console.log('🔥'.repeat(40) + '\n');
}

function finalizeDuello() {
  const attaccante = gameState.teams[gameState.duelloMode.attaccante.id];
  const difensore = gameState.teams[gameState.duelloMode.difensore.id];
  
  if(!attaccante || !difensore) return;
  
  const attaccanteWins = gameState.duelloMode.scoreAttaccante >= 2; // Vince chi arriva a 2 (su 3)
  
  // ✅ FIX: Assegnazione AUTOMATICA punti
  if(attaccanteWins) {
    attaccante.score += 250;
    difensore.score = Math.max(0, difensore.score - 250);
    console.log(`🔥 ${attaccante.name} VINCE: +250 punti`);
    console.log(`🔥 ${difensore.name} PERDE: -250 punti`);
  } else {
    difensore.score += 100;
    console.log(`🔥 ${difensore.name} VINCE: +100 punti`);
    console.log(`🔥 ${attaccante.name} PERDE: 0 punti`);
  }
  
  broadcastTeamsNow();

  io.emit('duello_end', {
    attaccanteWins: attaccanteWins,
    winner: attaccanteWins ? 
      { id: attaccante.id, name: attaccante.name, score: attaccante.score, points: 250 } : 
      { id: difensore.id, name: difensore.name, score: difensore.score, points: 100 },
    loser: attaccanteWins ? 
      { id: difensore.id, name: difensore.name, score: difensore.score, points: -250 } : 
      { id: attaccante.id, name: attaccante.name, score: attaccante.score, points: 0 },
    finalScore: {
      attaccante: gameState.duelloMode.scoreAttaccante,
      difensore: gameState.duelloMode.scoreDifensore
    }
  });
  
  console.log('\n' + '🏆'.repeat(40));
  console.log(`🏆 DUELLO TERMINATO`);
  console.log(`🏆 Attaccante: ${gameState.duelloMode.scoreAttaccante} - Difensore: ${gameState.duelloMode.scoreDifensore}`);
  console.log(`🏆 Vincitore: ${attaccanteWins ? attaccante.name : difensore.name}`);
  console.log('🏆'.repeat(40) + '\n');
  
  gameState.duelloMode.active = false;
}

// ✅ NUOVA FUNZIONE: Mostra risposta corretta per duello
function showDuelloCorrectAnswer(teamId, teamName, answer, isCorrect) {
  if (!gameState.currentQuestion) return;
  
  io.to('admin').emit('duello_correct_answer', {
    correctAnswer: gameState.currentQuestion.corretta,
    teamAnswer: answer,
    teamName: teamName,
    isCorrect: isCorrect,
    teamId: teamId
  });
  
  // Mostra anche sul display per tutti
  io.emit('duello_show_answer', {
    teamName: teamName,
    answer: answer,
    correctAnswer: gameState.currentQuestion.corretta,
    isCorrect: isCorrect
  });
  
  console.log(`🔥 DUELLO: ${teamName} risponde "${answer}" - ${isCorrect ? 'CORRETTO' : 'SBAGLIATO'} (Corretta: ${gameState.currentQuestion.corretta})`);
}

// ✅ NUOVE FUNZIONI PER SFIDA FINALE
function processAllInResults() {
  if(!gameState.finaleMode || !gameState.finaleMode.allInQuestion) {
    console.log('❌ Nessuna domanda ALL IN da processare');
    return;
  }
  
  const question = gameState.finaleMode.allInQuestion;
  const correctAnswer = question.corretta;
  
  console.log('\n' + '💰'.repeat(50));
  console.log('💰 ELABORAZIONE RISULTATI ALL IN');
  console.log('💰'.repeat(50));
  console.log(`📝 Domanda: "${question.domanda}"`);
  console.log(`✅ Risposta corretta: ${correctAnswer}`);
  
  const results = [];
  
  // Processa tutte le scommesse
  Object.values(gameState.finaleMode.allInBets || {}).forEach(bet => {
    const team = gameState.teams[bet.teamId];
    if(!team) {
      console.log(`❌ Squadra ${bet.teamId} non trovata`);
      return;
    }
    
    const isCorrect = bet.answer === correctAnswer;
    const pointsChange = isCorrect ? bet.bet : -bet.bet;
    
    // Aggiorna punteggio squadra
    team.score += pointsChange;
    
    results.push({
      teamId: bet.teamId,
      teamName: bet.teamName,
      bet: bet.bet,
      answer: bet.answer,
      correct: isCorrect,
      pointsChange: pointsChange,
      newScore: team.score
    });
    
    console.log(`💰 ${team.name}: scommesso ${bet.bet} su "${bet.answer}" -> ${isCorrect ? 'VINCE' : 'PERDE'} ${Math.abs(pointsChange)} punti`);
  });
  
  // Invia risultati completi al display
  io.emit('finale_allin_results', {
    question: question.domanda,
    correctAnswer: correctAnswer,
    results: results
  });
  
  // Invia risultato personale a ogni squadra
  results.forEach(result => {
    io.to(result.teamId).emit('finale_personal_result', {
      correct: result.correct,
      bet: result.bet,
      answer: result.answer,
      pointsChange: result.pointsChange,
      correctAnswer: correctAnswer,
      newScore: result.newScore
    });
  });
  
  // Aggiorna classifica generale
  broadcastTeamsNow();

  // Notifica admin
  io.to('admin').emit('allin_results_processed', {
    totalBets: results.length,
    correctCount: results.filter(r => r.correct).length
  });
  
  console.log('💰 ELABORAZIONE COMPLETATA');
  console.log(`📊 ${results.filter(r => r.correct).length}/${results.length} squadre corrette`);
  console.log('💰'.repeat(50) + '\n');
  
  return results;
}

// ✅ FUNZIONE CONDIVISA PER RIVELARE IL VINCITORE FINALE
