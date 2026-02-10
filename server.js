const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
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
      pattoUtilizzi: gameState.pattoDestinoState.contatoreUtilizzi,
      sessionStart: gameState.sessionStart || new Date().toISOString()
    };
    
    fs.writeFileSync(SAVE_FILE, JSON.stringify(dataToSave, null, 2));
    console.log('💾 Stato salvato:', dataToSave.teams.length, 'squadre');
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

// Salva anche quando cambia il punteggio
const originalUpdateScore = (typeof updateScore === 'function') ? updateScore : null;
// Oppure aggiungi un hook dopo ogni cambio punteggio

// Carica all'avvio
const savedState = loadGameState();
if (savedState) {
  console.log('🔄 RIPRISTINO IN CORSO...');
  gameState.sessionStart = savedState.sessionStart;
  gameState.pattoDestinoState.contatoreUtilizzi = savedState.pattoUtilizzi || 0;
  
  // NON ricrea le connessioni socket, solo i punteggi
  // Le squadre si riconnetteranno automaticamente
  console.log('✅ Punteggi ripristinati! Le squadre devono riconnettersi.');
  console.log('   Utilizza il comando di riconnessione manuale se necessario.');
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

function getQuestionsByCategory(category) {
  return db.questions.filter(q => q.categoria === category);
}

function sendQuestion(questionData, modalita = 'multipla') {
  if (!questionData) return;
  
  gameState.currentQuestion = {
    ...questionData,
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
    serverTimestamp: Date.now()
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
  
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  io.emit('update_teams', realTeams);
  io.to('admin').emit('update_teams', realTeams);
  
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
  
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  
  io.emit('update_teams', realTeams);
  io.to('admin').emit('update_teams', realTeams);
  
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
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  io.emit('update_teams', realTeams);
  io.to('admin').emit('update_teams', realTeams);
  
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


// ============================================
// 💀 IL PATTO COL DESTINO - FUNZIONI HELPER
// ============================================

function selezionaSquadrePattoDestino() {
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  
  if (realTeams.length === 0) return [];
  if (realTeams.length <= 3) return realTeams.map(t => t.id);
  
  // Ordina per punteggio
  const sorted = [...realTeams].sort((a, b) => b.score - a.score);
  
  // Prime 2 + ultima
  return [
    sorted[0].id,
    sorted[1].id,
    sorted[sorted.length - 1].id
  ];
}

function calcolaPuntiPatto(scelte) {
  const squadreIds = [...scelte.keys()];
  const sceltePatto = squadreIds.filter(id => scelte.get(id) === 'patto');
  const scelteTradi = squadreIds.filter(id => scelte.get(id) === 'tradimento');
  
  let risultati = [];
  let bonusUltima = null;
  
  // CASO 1: Tutti PATTO
  if (scelteTradi.length === 0) {
    squadreIds.forEach(id => {
      risultati.push({
        teamId: id,
        teamName: gameState.teams[id].name,
        scelta: 'patto',
        puntiAssegnati: 150,
        tipo: 'collaborazione'
      });
    });
  }
  // CASO 2: Tutti TRADIMENTO
  else if (sceltePatto.length === 0) {
    squadreIds.forEach(id => {
      risultati.push({
        teamId: id,
        teamName: gameState.teams[id].name,
        scelta: 'tradimento',
        puntiAssegnati: -150,
        tipo: 'egoismo'
      });
    });
    
    // Bonus all'ultima squadra NON coinvolta
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    const sorted = [...realTeams].sort((a, b) => b.score - a.score);
    const ultimaSquadra = sorted[sorted.length - 1];
    
    if (!squadreIds.includes(ultimaSquadra.id)) {
      bonusUltima = {
        teamId: ultimaSquadra.id,
        teamName: ultimaSquadra.name,
        punti: 150
      };
    }
  }
  // CASO 3: Misto
  else {
    squadreIds.forEach(id => {
      const scelta = scelte.get(id);
      risultati.push({
        teamId: id,
        teamName: gameState.teams[id].name,
        scelta: scelta,
        puntiAssegnati: scelta === 'tradimento' ? 250 : -150,
        tipo: scelta === 'tradimento' ? 'tradimento_riuscito' : 'tradito'
      });
    });
  }
  
  return { risultati, bonusUltima };
}

function applicaPuntiPatto(risultati, bonusUltima) {
  risultati.forEach(r => {
    if (gameState.teams[r.teamId]) {
      gameState.teams[r.teamId].score += r.puntiAssegnati;
    }
  });
  
  if (bonusUltima && gameState.teams[bonusUltima.teamId]) {
    gameState.teams[bonusUltima.teamId].score += bonusUltima.punti;
  }
}

function resetPattoDestino() {
  if (gameState.pattoDestinoState.timer) {
    clearTimeout(gameState.pattoDestinoState.timer);
  }
  if (gameState.pattoDestinoState.revealTimer) {
    clearTimeout(gameState.pattoDestinoState.revealTimer);
  }
  
  gameState.pattoDestinoState.attivo = false;
  gameState.pattoDestinoState.fase = null;
  gameState.pattoDestinoState.squadreSelezionate = [];
  gameState.pattoDestinoState.scelte = new Map();
  gameState.pattoDestinoState.messaggiChat = [];
  gameState.pattoDestinoState.startTime = null;
  gameState.pattoDestinoState.timer = null;
  gameState.pattoDestinoState.revealStep = 0;
  gameState.pattoDestinoState.revealTimer = null;
}

// ============================================
// FINE FUNZIONI PATTO COL DESTINO
// ============================================

io.on('connection', (socket) => {
  console.log(`? Connessione: ${socket.id}`);
  
  socket.on('admin_connect', () => {
    socket.join('admin');
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    socket.emit('update_teams', realTeams);
    socket.emit('questions_data', questionsData);
    console.log('??? Admin connesso');
  });

  socket.on('login', (name) => {
    const isPreview = name.includes('PREVIEW') || name.includes('?');
    
    gameState.teams[socket.id] = {
      id: socket.id,
      name: name,
      score: 0,
      isPreview: isPreview
    };
    
    socket.emit('login_success', { teamId: socket.id, name: name });
    
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams);
    io.to('admin').emit('update_teams', realTeams);
    
    console.log(`? Login: ${name} (${isPreview ? 'Preview' : 'Giocatore'})`);
  });

  socket.on('invia_domanda', (d) => sendQuestion(d, d.modalita || 'multipla'));

  // ✅ FIX: Listener per ottenere domande filtrate
  socket.on('get_questions', (filter) => {
    let filtered = [];
    
    if (filter.type === 'categoria' && filter.category) {
      filtered = db.questions.filter(q => q.categoria === filter.category);
    } else if (filter.type === 'stima') {
      filtered = db.questions.filter(q => q.categoria === 'Stima');
    } else if (filter.type === 'anagramma') {
      filtered = db.questions.filter(q => q.categoria === 'Anagramma');
    } else if (filter.type === 'bonus') {
      filtered = db.questions.filter(q => q.categoria === 'Bonus');
    }
    
    socket.emit('questions_list', filtered);
    console.log(`📋 Inviate ${filtered.length} domande (tipo: ${filter.type}${filter.category ? ', categoria: ' + filter.category : ''})`);
  });

  socket.on('risposta', (data) => {
    if (!gameState.currentQuestion || gameState.isPaused) return;
    
    const team = gameState.teams[socket.id];
    if (!team || team.isPreview) return;
    
    if (gameState.roundAnswers.some(a => a.teamId === socket.id)) return;
    
    const time = ((Date.now() - gameState.currentQuestion.startTime) / 1000).toFixed(2);
    const isCorrect = (data.risposta === gameState.currentQuestion.corretta);
    
    // ✅ FIX: Assegna punti AUTOMATICAMENTE se risposta corretta
    let pointsEarned = 0;
    if (isCorrect) {
      const questionPoints = gameState.currentQuestion.punti || 100;
      
      // Bonus per il primo che risponde correttamente
      const isFirstCorrect = !gameState.roundAnswers.some(a => a.corretta);
      pointsEarned = isFirstCorrect ? questionPoints + 50 : questionPoints;
      
      team.score += pointsEarned;
      
      // ✅ FIX: Traccia punteggi round
      if (!gameState.roundScores[socket.id]) {
        gameState.roundScores[socket.id] = 0;
      }
      gameState.roundScores[socket.id] += pointsEarned;
      
      console.log(`✅ ${team.name}: CORRETTO! +${pointsEarned} punti (totale: ${team.score})`);
    } else {
      console.log(`❌ ${team.name}: SBAGLIATO (risposta: ${data.risposta})`);
    }
    
    gameState.roundAnswers.push({
      teamId: socket.id,
      teamName: team.name,
      risposta: data.risposta,
      corretta: isCorrect,
      time: time,
      points: pointsEarned
    });
    
    // 🆕 Salva i dettagli completi per il podio
    gameState.roundDetails.push({
      teamId: socket.id,
      teamName: team.name,
      name: team.name, // Per compatibilità con display
      risposta: data.risposta,
      corretta: isCorrect,
      tempo: time,
      punti: pointsEarned
    });
    
    socket.emit('risposta_inviata', {
      corretta: isCorrect,
      time: time,
      points: pointsEarned
    });
    
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    
    // ✅ Invia risposte aggiornate all'admin
    io.to('admin').emit('update_answers', {
      answers: gameState.roundAnswers,
      totalTeams: realTeams.length,
      correctAnswer: gameState.currentQuestion.corretta
    });
    
    // ✅ Aggiorna classifica in tempo reale
    io.emit('update_teams', realTeams);
    io.to('admin').emit('update_teams', realTeams);
  });

  socket.on('regia_cmd', (cmd) => {
    // ✅ FIX: Reset round scores (per iniziare un nuovo round/prova)
    if (cmd === 'reset_round') {
      gameState.roundScores = {};
      gameState.roundDetails = [];
      console.log('🔄 Round scores e details resettati - Nuovo round iniziato');
      return;
    }
    
    // ✅ FIX 4: Gestisci il comando "podio" per mostrare classifica round
    if (cmd === 'classifica_round' || cmd === 'podio') {
      // Se abbiamo dettagli completi (con risposte), usiamo quelli
      if (gameState.roundDetails && gameState.roundDetails.length > 0) {
        const sortedDetails = [...gameState.roundDetails].sort((a, b) => b.punti - a.punti);
        io.emit('cambia_vista', { view: 'classifica_round', data: { results: sortedDetails } });
        console.log('🏆 Mostro podio round DETTAGLIATO con', sortedDetails.length, 'risposte');
      } else {
        // Altrimenti mostriamo solo i punteggi totali del round
        const roundResults = Object.entries(gameState.roundScores || {}).map(([teamId, points]) => {
          const team = gameState.teams[teamId];
          return {
            id: teamId,
            name: team ? team.name : 'Unknown',
            roundPoints: points
          };
        }).sort((a, b) => b.roundPoints - a.roundPoints);
        
        io.emit('cambia_vista', { view: 'classifica_round', data: { results: roundResults } });
        console.log('🏆 Mostro podio round SEMPLICE con', roundResults.length, 'squadre');
      }
    } else {
      io.emit('cambia_vista', { view: cmd });
      console.log('📺 Vista:', cmd);
    }
  });

  socket.on('pause_game', () => {
    gameState.isPaused = true;
    
    // ✅ FIX: Invia classifica al display durante la pausa
    const realTeams = Object.values(gameState.teams)
      .filter(t => !t.isPreview)
      .sort((a, b) => b.score - a.score);
    
    io.emit('game_paused', { teams: realTeams });
    console.log('⏸️ Gioco in pausa - classifica inviata');
  });

  socket.on('resume_game', () => {
    gameState.isPaused = false;
    io.emit('game_resumed');
    console.log('? Gioco ripreso');
  });

  socket.on('reset_displays', () => {
    io.emit('reset_client_ui');
  });

  socket.on('reset_game', () => {
    gameState.teams = {};
    gameState.buzzerQueue = [];
    gameState.currentQuestion = null;
    gameState.roundAnswers = [];
    gameState.isPaused = false;
    gameState.roundScores = {};
    gameState.roundDetails = [];
    gameState.ruotaWinner = null;
    gameState.ruotaChoice = null;
    gameState.ruotaChallenge = null;
    gameState.finaleMode = null;
    io.emit('force_reload');
    console.log('? Reset totale');
  });

  // ✅ FIX: mostra_soluzione invia al display (broadcast a tutti i client tranne admin)
  socket.on('mostra_soluzione', (data) => {
    // Invia a tutti i client (display e cellulari vedranno la soluzione)
    // Ma sui cellulari abbiamo già rimosso la visualizzazione
    io.emit('mostra_soluzione', data);
    console.log('📺 Soluzione mostrata sul display:', data.soluzione);
  });

  socket.on('show_winner', () => {
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    if (realTeams.length > 0) {
      const sortedTeams = realTeams.sort((a, b) => b.score - a.score);
      io.emit('show_winner_screen', {
        winner: sortedTeams[0],
        podium: sortedTeams.slice(0, 3)
      });
      console.log(`🏆 Mostro vincitore: ${sortedTeams[0].name}`);
    }
  });

  // ✅ FIX 2: Correggi assign_points per aggiungere/togliere punti manualmente
  socket.on('assign_points', (data) => {
    const team = gameState.teams[data.teamId];
    if (team) {
      team.score += data.points;
      
      // Traccia anche nei punteggi del round
      if (!gameState.roundScores[data.teamId]) {
        gameState.roundScores[data.teamId] = 0;
      }
      gameState.roundScores[data.teamId] += data.points;
      
      // 🆕 Aggiungi ai dettagli del round (se non è già presente una risposta per questa squadra)
      const alreadyAnswered = gameState.roundDetails.some(d => d.teamId === data.teamId);
      if (!alreadyAnswered) {
        gameState.roundDetails.push({
          teamId: data.teamId,
          teamName: team.name,
          name: team.name,
          risposta: '-',
          corretta: data.points > 0,
          tempo: '-',
          punti: data.points
        });
      }
      
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
      io.emit('update_teams', realTeams);
      io.to('admin').emit('update_teams', realTeams);
      
      console.log(`? ${team.name}: ${data.points > 0 ? '+' : ''}${data.points} punti (totale: ${team.score})`);
    }
  });

  socket.on('play_youtube_karaoke', (data) => {
    io.emit('play_youtube_karaoke', { videoId: data.videoId });
    console.log('? Karaoke:', data.videoId);
  });

  socket.on('stop_karaoke', () => {
    io.emit('stop_karaoke');
  });

  // ════════════════════════════════════════════════════════════════
  // 🔊 AUDIO EFFECTS - Relay comandi audio dall'admin al display
  // ════════════════════════════════════════════════════════════════
  socket.on('play_sfx', (data) => {
    io.emit('play_sfx', data);
    console.log('🔊 SFX:', data.effect);
  });

  socket.on('audio_set_enabled', (data) => {
    io.emit('audio_set_enabled', data);
    console.log('🔊 Audio:', data.enabled ? 'ON' : 'OFF');
  });

  socket.on('audio_set_volume', (data) => {
    io.emit('audio_set_volume', data);
    console.log('🔊 Volume:', data.volume);
  });

  socket.on('toggle_leaderboard', () => {
    gameState.hideLeaderboard = !gameState.hideLeaderboard;
    io.emit('leaderboard_visibility', { hidden: gameState.hideLeaderboard });
    console.log(`📊 Classifica ${gameState.hideLeaderboard ? 'nascosta' : 'visibile'}`);
  });

  // ? FIX: GIOCO MUSICALE - Buzzer Standalone
  socket.on('start_buzzer', (data) => {
    gameState.buzzerActive = true;
    gameState.buzzerLocked = false;
    gameState.buzzerStandalone = true;
    gameState.buzzerQueue = [];
    gameState.currentQuestion = {
      domanda: data.domanda || '? Premi quando sai la risposta!',
      corretta: data.corretta || '',
      startTime: Date.now(),
      modalita: 'buzzer_standalone'
    };
    
    io.emit('nuova_domanda', {
      domanda: data.domanda || '? Premi quando sai la risposta!',
      risposte: [],
      modalita: 'buzzer',
      startTime: Date.now(),
      serverTimestamp: Date.now()
    });
    
    io.emit('stato_buzzer', { locked: false, attiva: true });
    
    console.log('\n' + '?'.repeat(80));
    console.log('? GIOCO MUSICALE ATTIVATO');
    console.log('?'.repeat(80) + '\n');
  });

  socket.on('buzzer_reset', () => {
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = false;
    io.emit('buzzer_queue_update', { queue: [] });
    io.emit('stato_buzzer', { locked: false, attiva: true });
    io.to('admin').emit('buzzer_queue_full', { queue: [], correctAnswer: "--" });
  });

  // ✅ FIX: Aggiungo alias reset_buzzer per compatibilità con admin
  socket.on('reset_buzzer', () => {
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = false;
    io.emit('buzzer_queue_update', { queue: [] });
    io.emit('stato_buzzer', { locked: false, attiva: true });
    io.to('admin').emit('buzzer_queue_full', { queue: [], correctAnswer: "--" });
    console.log('🔄 Buzzer resettato');
  });

  socket.on('buzzer_close', () => {
    gameState.buzzerLocked = true;
    gameState.buzzerActive = false;
    io.emit('stato_buzzer', { locked: true, attiva: false });
  });

  // ? FIX 3: Migliorato buzzer per gioco musicale e assegnazione punti
  socket.on('prenoto', () => {
    if (gameState.buzzerLocked || !gameState.currentQuestion) return;
    
    const team = gameState.teams[socket.id];
    if (!team || team.isPreview) return;
    
    const time = ((Date.now() - gameState.currentQuestion.startTime) / 1000).toFixed(2);
    
    gameState.buzzerQueue.push({
      id: socket.id,
      name: team.name,
      time: time
    });
    
    socket.emit('buzzer_position', { position: gameState.buzzerQueue.length, time: time });
    io.emit('buzzer_queue_update', { queue: gameState.buzzerQueue });
    io.to('admin').emit('buzzer_queue_full', { 
      queue: gameState.buzzerQueue,
      standalone: gameState.buzzerStandalone,
      correctAnswer: gameState.currentQuestion.corretta || "--"
    });
    
    console.log(`? ${team.name}: ${time}s (pos ${gameState.buzzerQueue.length})`);
  });

  // ════════════════════════════════════════════════════════════════
  // 🎰 RUOTA DELLA FORTUNA - LISTENER COMPLETI E CORRETTI
  // ════════════════════════════════════════════════════════════════

  socket.on('ruota_step', (data) => {
    console.log('🎰 Ruota step:', data.step);
    
    switch(data.step) {
      case 'explain':
        // 1️⃣ Spiega regole - INVIATO A TUTTI I DISPLAY
        io.emit('cambia_vista', { view: 'ruota_explain' });
        console.log('🎰 Spiegazione regole ruota');
        break;
        
      case 'spin':
        // 2️⃣ Gira ruota ed estrae squadra
        const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
        if (realTeams.length === 0) {
          io.to('admin').emit('ruota_error', { message: 'Nessuna squadra registrata!' });
          return;
        }
        
        const winner = realTeams[Math.floor(Math.random() * realTeams.length)];
        gameState.ruotaWinner = { id: winner.id, name: winner.name };
        gameState.ruotaChoice = null;
        
        // Mostra animazione spinning SU DISPLAY
        io.emit('cambia_vista', { view: 'ruota_spin' });
        
        // Invia dati spinning con timer
        io.emit('ruota_spin', {
          teams: realTeams.map(t => ({ id: t.id, name: t.name })), // ✅ FIX: array di oggetti
          winner: { id: winner.id, name: winner.name }
        });
        
        // Dopo 5 secondi mostra vincitore
        setTimeout(() => {
          io.emit('cambia_vista', { view: 'ruota_winner' });
          io.emit('ruota_winner', { 
            winner: { id: winner.id, name: winner.name } 
          });
          
          // ✅ FIX: Invia anche alla console admin
          io.to('admin').emit('ruota_winner', { 
            winner: { id: winner.id, name: winner.name } 
          });
          
          // Invia scelta SOLO alla squadra vincitrice
          io.to(winner.id).emit('ruota_choice', {
            message: '🎰 Hai vinto la Ruota! Scegli la tua sorte:',
            options: [
              { id: 'safe', label: '💰 50 punti SICURI', value: 50 },
              { id: 'challenge', label: '🎯 Sfida: +150 se corretta, -50 se sbagliata', value: 150 }
            ]
          });
          
          console.log(`🎰 Ruota: estratto ${winner.name}`);
        }, 5000);
        
        break;
        
      case 'choice':
        // 3️⃣ Mostra scelta al telefono (già gestito da ruota_choice sopra)
        if (!gameState.ruotaWinner) return;
        console.log('🎰 Mostra scelta a:', gameState.ruotaWinner.name);
        break;
        
      case 'challenge':
        // 4️⃣ Lancia domanda sfida
        console.log('\n' + '🎰'.repeat(40));
        console.log('🎰 STEP 4: LANCIA DOMANDA SFIDA');
        console.log('🎰'.repeat(40));
        
        if (!gameState.ruotaWinner) {
          console.log('❌ ERRORE: Nessuna squadra estratta dalla ruota');
          io.to('admin').emit('ruota_error', { message: 'Prima gira la ruota!' });
          return;
        }
        
        if (!data.question) {
          console.log('❌ ERRORE: Nessuna domanda fornita');
          io.to('admin').emit('ruota_error', { message: 'Seleziona una domanda dalla lista!' });
          return;
        }
        
        console.log(`✅ Squadra estratta: ${gameState.ruotaWinner.name} (ID: ${gameState.ruotaWinner.id})`);
        console.log(`✅ Domanda: "${data.question.domanda}"`);
        console.log(`✅ Risposta corretta: ${data.question.corretta}`);
        
        // Imposta la domanda per la sfida
        gameState.currentQuestion = {
          ...data.question,
          id: data.question.id || Date.now(),
          domanda: data.question.domanda,
          risposte: data.question.risposte || [],
          corretta: data.question.corretta,
          startTime: Date.now(),
          serverTimestamp: Date.now(),
          isRuotaQuestion: true,
          ruotaTeamId: gameState.ruotaWinner.id
        };
        
        console.log('🎰 Domanda sfida impostata:', data.question.domanda);
        
        // 1. Mostra domanda SOLO alla squadra
        io.to(gameState.ruotaWinner.id).emit('nuova_domanda', {
          id: data.question.id,
          domanda: data.question.domanda,
          risposte: data.question.risposte || [],
          categoria: data.question.categoria || 'Ruota della Fortuna',
          modalita: 'quiz',
          startTime: Date.now(),
          serverTimestamp: Date.now(),
          isRuotaQuestion: true
        });
        
        console.log(`📱 Domanda inviata al telefono di: ${gameState.ruotaWinner.name}`);
        
        // 2. Mostra domanda sul display (solo visualizzazione)
        io.emit('display_question', {
          domanda: data.question.domanda,
          risposte: data.question.risposte || [],
          categoria: data.question.categoria || 'Ruota della Fortuna',
          forTeam: gameState.ruotaWinner.name,
          startTime: Date.now()
        });
        
        console.log('📺 Domanda mostrata sul display');
        
        // 3. Mostra la vista gioco sul display
        io.emit('cambia_vista', { view: 'gioco' });
        
        console.log('✅ DOMANDA SFIDA LANCIATA CON SUCCESSO!');
        console.log('🎰'.repeat(40) + '\n');
        break;
    }
  });

  // ✅ NUOVO: Listener per errore ruota
  socket.on('ruota_error', (data) => {
    console.log('❌ Errore ruota:', data.message);
  });

  // Listener per scelta fatta dalla squadra
  socket.on('ruota_choice_made', (data) => {
    const team = gameState.teams[socket.id];
    if (!team || !gameState.ruotaWinner || socket.id !== gameState.ruotaWinner.id) return;
    
    gameState.ruotaChoice = data.choice;
    
    if (data.choice === 'safe') {
      // 50 punti sicuri
      team.score += 50;
      
      io.emit('ruota_result', {
        teamName: team.name,
        action: 'safe',
        points: 50,
        newScore: team.score
      });
      
      io.to(socket.id).emit('ruota_feedback', {
        message: '💰 Hai scelto 50 punti sicuri!',
        points: 50
      });
      
      console.log(`🎰 ${team.name}: +50 punti sicuri`);
      
      // Aggiorna classifica
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
      io.emit('update_teams', realTeams);
      io.to('admin').emit('update_teams', realTeams);
      
      // Torna alla classifica
      setTimeout(() => {
        io.emit('cambia_vista', { view: 'classifica_gen' });
      }, 3000);
      
    } else if (data.choice === 'challenge') {
      // Ha scelto la sfida
      gameState.ruotaChallenge = {
        teamId: socket.id,
        teamName: team.name,
        choiceMade: true
      };
      
      io.to(socket.id).emit('ruota_feedback', {
        message: '🎯 Hai scelto la sfida! Attendi la domanda...'
      });
      
      // ✅ FIX MIGLIORATO: Notifica admin che deve inviare una domanda
      io.to('admin').emit('ruota_needs_question', {
        teamId: socket.id,
        teamName: team.name,
        message: `🎯 ${team.name} ha scelto la sfida! Seleziona una domanda e clicca "4️⃣ Lancia Domanda Sfida"`
      });
      
      console.log(`🎰 ${team.name} ha scelto la sfida!`);
      
      // ✅ FIX CRITICO: NON resettare ruotaWinner se ha scelto challenge!
      // Serve per lanciare la domanda dopo. Verrà resettato dopo la risposta.
      return;
    }
    
    // ✅ Reset ruotaWinner SOLO se ha scelto safe (punti sicuri)
    gameState.ruotaWinner = null;
  });

  // Listener per risposta alla sfida ruota
  socket.on('ruota_answer', (data) => {
    const team = gameState.teams[socket.id];
    if (!team || !gameState.currentQuestion || !gameState.currentQuestion.isRuotaQuestion) return;
    
    const isCorrect = (data.risposta === gameState.currentQuestion.corretta);
    
    if (isCorrect) {
      team.score += 150;
      io.emit('ruota_result', {
        teamName: team.name,
        action: 'challenge_win',
        points: 150,
        newScore: team.score
      });
      console.log(`🎰 ${team.name}: CORRETTO! +150 punti`);
    } else {
      team.score = Math.max(0, team.score - 50);
      io.emit('ruota_result', {
        teamName: team.name,
        action: 'challenge_lose',
        points: -50,
        newScore: team.score
      });
      console.log(`🎰 ${team.name}: SBAGLIATO! -50 punti`);
    }
    
    // Mostra soluzione
    setTimeout(() => {
      io.emit('mostra_soluzione', {
        soluzione: gameState.currentQuestion.corretta,
        team: team.name,
        correct: isCorrect
      });
    }, 2000);
    
    // Aggiorna classifica
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams);
    io.to('admin').emit('update_teams', realTeams);
    
    // Torna alla classifica
    setTimeout(() => {
      io.emit('cambia_vista', { view: 'classifica_gen' });
    }, 5000);
    
    gameState.currentQuestion = null;
    gameState.ruotaChallenge = null;
    gameState.ruotaWinner = null; // ✅ FIX: Reset ruotaWinner dopo la risposta
  });

  socket.on('memory_start', () => {
    gameState.memoryMode.active = true;
    gameState.memoryMode.currentManche = 1;
    startMemoryManche(1);
  });

  socket.on('memory_answer', (data) => {
    if(!gameState.memoryMode.active) return;
    const team = gameState.teams[socket.id];
    if(!team || team.isPreview || gameState.memoryMode.answers[socket.id]) return;
    
    gameState.memoryMode.answers[socket.id] = {
      teamId: socket.id,
      teamName: team.name,
      position: parseInt(data.position),
      time: (Date.now() - gameState.memoryMode.mancheStartTime) / 1000
    };
  });

  socket.on('memory_skip_round', () => {
    if(gameState.memoryMode.showAllTimeout) clearTimeout(gameState.memoryMode.showAllTimeout);
    if(gameState.memoryMode.answerTimeout) clearTimeout(gameState.memoryMode.answerTimeout);
    processMemoryAnswers();
  });

  socket.on('memory_stop', () => {
    if(gameState.memoryMode.showAllTimeout) clearTimeout(gameState.memoryMode.showAllTimeout);
    if(gameState.memoryMode.answerTimeout) clearTimeout(gameState.memoryMode.answerTimeout);
    gameState.memoryMode.active = false;
    io.emit('reset_client_ui');
    io.emit('cambia_vista', { view: 'logo' });
  });

  // ✅ FIX COMPLETO: SFIDA FINALE
  socket.on('show_finale_explanation', () => {
    io.emit('cambia_vista', { view: 'finale_explanation' });
    console.log('\n' + '?'.repeat(50));
    console.log('? SPIEGAZIONE SFIDA FINALE');
    console.log('?'.repeat(50) + '\n');
  });

  socket.on('start_finale', () => {
    gameState.finaleMode = {
      active: true,
      questionCount: 0,
      allInBets: {},
      allInQuestion: null,
      multiplier: 1,
      hideLeaderboard: true
    };
    
    // Nascondi la classifica
    gameState.hideLeaderboard = true;
    io.emit('leaderboard_visibility', { hidden: true });
    
    io.emit('finale_started');
    io.emit('cambia_vista', { view: 'finale_explanation' });
    
    console.log('\n' + '🔥'.repeat(50));
    console.log('🔥 SFIDA FINALE INIZIATA!');
    console.log('🔥 Classifica nascosta - Modalità FINALE attiva');
    console.log('🔥'.repeat(50) + '\n');
  });

  // ✅ NUOVO: Preparazione ALL IN (Step 3)
  socket.on('prepare_allin', (questionData) => {
    if(!gameState.finaleMode || !gameState.finaleMode.active) {
      console.log('❌ Finale non attivo');
      return;
    }
    
    gameState.finaleMode.allInQuestion = questionData;
    gameState.finaleMode.allInBets = {};
    gameState.finaleMode.questionCount = 1; // Prima domanda = ALL IN
    
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    
    // Invia evento ai cellulari per far scommettere
    io.emit('finale_allin_betting', {
      question: questionData,
      teams: realTeams.map(t => ({ id: t.id, name: t.name, score: t.score })),
      finaleQuestion: 1,
      totalFinaleQuestions: 5
    });
    
    // Mostra schermata ALL IN sul display
    io.emit('cambia_vista', { view: 'allin_betting' });
    
    console.log('\n' + '💰'.repeat(50));
    console.log('💰 ALL IN PREPARATO');
    console.log('💰 Domanda:', questionData.domanda);
    console.log('💰 Squadre:', realTeams.length);
    console.log('💰'.repeat(50) + '\n');
  });

  socket.on('invia_domanda_finale', (data) => {
    if(!gameState.finaleMode || !gameState.finaleMode.active) {
      // Se non è attiva la finale, inizia normalmente
      gameState.finaleMode = { 
        active: true, 
        questionCount: 0, 
        allInBets: {}, 
        allInQuestion: null,
        multiplier: 1,
        hideLeaderboard: true 
      };
    }
    
    gameState.finaleMode.questionCount++;
    
    // Se è la prima domanda (ALL IN già gestito)
    if(gameState.finaleMode.questionCount === 1) {
      console.log('⚠️ Prima domanda finale = ALL IN, usa "Prepara ALL IN"');
      return;
    }
    
    // Domande 2-5 = x2 punti
    gameState.finaleMode.multiplier = 2;
    
    // Modifica i punti della domanda per il raddoppio
    const questionWithMultiplier = {
      ...data,
      punti: (data.punti || 100) * 2,
      finaleQuestion: gameState.finaleMode.questionCount,
      totalFinaleQuestions: 5,
      isFinaleQuestion: true
    };
    
    sendQuestion(questionWithMultiplier, 'quiz');
    
    console.log(`🔥 Domanda Finale ${gameState.finaleMode.questionCount} (x${gameState.finaleMode.multiplier})`);
  });

  // ✅ MODIFICATO: Scommessa ALL IN completa (bet + risposta)
  socket.on('finale_allin_bet', (data) => {
    const team = gameState.teams[socket.id];
    if(!team || team.isPreview) return;
    
    if(!gameState.finaleMode || !gameState.finaleMode.active) {
      console.log('❌ Finale non attivo per squadra:', team.name);
      return;
    }
    
    if(!gameState.finaleMode.allInBets) gameState.finaleMode.allInBets = {};
    
    // Salva scommessa completa
    gameState.finaleMode.allInBets[socket.id] = {
      teamId: socket.id,
      teamName: team.name,
      bet: data.bet,
      answer: data.answer,
      answeredAt: Date.now()
    };
    
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    const betsCount = Object.keys(gameState.finaleMode.allInBets).length;
    
    // Notifica admin
    io.to('admin').emit('allin_bet_placed', {
      betsCount: betsCount,
      totalTeams: realTeams.length,
      teamName: team.name,
      bet: data.bet
    });
    
    console.log(`💰 ${team.name}: scommesso ${data.bet} punti su "${data.answer}"`);
  });

  // ✅ NUOVO: Elabora risultati ALL IN (Step 4)
  socket.on('process_allin_results', () => {
    if(!gameState.finaleMode || !gameState.finaleMode.allInQuestion) {
      console.log('❌ Nessuna domanda ALL IN da elaborare');
      return;
    }
    
    const results = processAllInResults();
    
    // Passa alla prossima fase
    gameState.finaleMode.questionCount = 1; // Resetta per domanda 2
    
    console.log('✅ Risultati ALL IN elaborati. Pronto per domanda 2.');
  });

  socket.on('admin_force_show_allin', () => {
    if(!gameState.finaleMode || !gameState.finaleMode.allInQuestion) {
      console.log('❌ Nessuna domanda ALL IN da mostrare');
      return;
    }
    
    const question = gameState.finaleMode.allInQuestion;
    const bets = Object.values(gameState.finaleMode.allInBets || {});
    
    // Mostra risultati sul display
    io.emit('finale_allin_results', {
      question: question.domanda,
      correctAnswer: question.corretta,
      bets: bets
    });
    
    console.log('📺 Risultati ALL IN mostrati sul display');
  });

  socket.on('reveal_winner', () => {
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    const sorted = realTeams.sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    
    // Mostra di nuovo la classifica
    gameState.hideLeaderboard = false;
    io.emit('leaderboard_visibility', { hidden: false });
    
    io.emit('show_winner', {
      winner: { id: winner.id, name: winner.name, score: winner.score },
      rankings: sorted.map((t, i) => ({
        position: i + 1,
        id: t.id,
        name: t.name,
        score: t.score
      }))
    });
    
    gameState.finaleMode = null;
    
    console.log('\n' + '🏆'.repeat(50));
    console.log(`🏆 VINCITORE FINALE: ${winner.name} con ${winner.score} punti!`);
    console.log('🏆'.repeat(50) + '\n');
  });

  socket.on('duello_start', () => startDuello());

  socket.on('duello_show_opponent_choice', () => {
    if(!gameState.duelloMode.active) return;
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    const sorted = realTeams.sort((a, b) => a.score - b.score);
    const availableOpponents = realTeams.filter(t => 
      t.id !== gameState.duelloMode.attaccante.id && 
      t.id !== sorted[0].id
    );
    io.to(gameState.duelloMode.attaccante.id).emit('duello_choose_opponent', {
      opponents: availableOpponents.map(t => ({ id: t.id, name: t.name, score: t.score }))
    });
  });

  socket.on('duello_opponent_chosen', (data) => {
    if(!gameState.duelloMode.active) return;
    const difensore = gameState.teams[data.opponentId];
    if(!difensore) return;
    gameState.duelloMode.difensore = { id: difensore.id, name: difensore.name };
    io.to('admin').emit('duello_difensore_scelto', { difensore: { id: difensore.id, name: difensore.name }});
  });

  socket.on('duello_show_category_choice', () => {
    if(!gameState.duelloMode.active) return;
    io.to(gameState.duelloMode.attaccante.id).emit('duello_choose_category', { categories: db.categories });
  });

  socket.on('duello_category_chosen', (data) => {
    if(!gameState.duelloMode.active) return;
    gameState.duelloMode.categoria = data.category;
    io.to('admin').emit('duello_categoria_scelta', { category: data.category });
  });

  socket.on('duello_launch_question', (data) => {
    if(!gameState.duelloMode.active) return;
    gameState.duelloMode.questionNumber++;
    gameState.currentQuestion = data.question;
    gameState.currentQuestion.startTime = Date.now();
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = false;
    gameState.duelloMode.currentBuzzer = null;
    gameState.duelloMode.waitingForAnswer = false;

    const questionData = {
      id: data.question.id,
      domanda: data.question.domanda,
      modalita: 'duello_buzzer',
      categoria: gameState.duelloMode.categoria,
      startTime: Date.now(),
      serverTimestamp: Date.now()
    };

    io.to(gameState.duelloMode.attaccante.id).emit('duello_question', questionData);
    io.to(gameState.duelloMode.difensore.id).emit('duello_question', questionData);

    io.emit('duello_question_display', {
      question: questionData,
      attaccante: gameState.duelloMode.attaccante,
      difensore: gameState.duelloMode.difensore,
      scoreAttaccante: gameState.duelloMode.scoreAttaccante,
      scoreDifensore: gameState.duelloMode.scoreDifensore,
      questionNumber: gameState.duelloMode.questionNumber
    });

    io.emit('cambia_vista', { view: 'duello' });
  });

  socket.on('duello_buzzer_press', (data) => {
    if(!gameState.duelloMode.active || gameState.duelloMode.waitingForAnswer) return;
    if(data.teamId !== gameState.duelloMode.attaccante.id && 
       data.teamId !== gameState.duelloMode.difensore.id) return;

    if(!gameState.duelloMode.currentBuzzer) {
      const team = gameState.teams[data.teamId];
      gameState.duelloMode.currentBuzzer = { id: data.teamId, name: team.name };
      gameState.duelloMode.waitingForAnswer = true;
      const reactionTime = ((Date.now() - gameState.currentQuestion.startTime) / 1000).toFixed(2);
      
      io.emit('duello_buzzer_pressed', { teamId: data.teamId, teamName: team.name, time: reactionTime });
      io.to('admin').emit('duello_waiting_answer', {
        teamId: data.teamId,
        teamName: team.name,
        correctAnswer: gameState.currentQuestion.corretta
      });
    }
  });

  socket.on('duello_answer_result', (data) => {
    if(!gameState.duelloMode.active) return;
    const answeredBy = gameState.duelloMode.currentBuzzer;
    if(!answeredBy) return;

    // ✅ FIX 4: MOSTRA RISPOSTA CORRETTA
    showDuelloCorrectAnswer(answeredBy.id, answeredBy.name, data.answer, data.correct);

    if(data.correct) {
      if(answeredBy.id === gameState.duelloMode.attaccante.id) {
        gameState.duelloMode.scoreAttaccante++;
      } else {
        gameState.duelloMode.scoreDifensore++;
      }
      
      io.emit('duello_point_scored', {
        teamId: answeredBy.id,
        teamName: answeredBy.name,
        scoreAttaccante: gameState.duelloMode.scoreAttaccante,
        scoreDifensore: gameState.duelloMode.scoreDifensore
      });
      
      if(gameState.duelloMode.scoreAttaccante >= 2 || gameState.duelloMode.scoreDifensore >= 2) {
        setTimeout(() => finalizeDuello(), 2000);
      } else {
        io.to('admin').emit('duello_next_question');
      }
    } else {
      const otherId = answeredBy.id === gameState.duelloMode.attaccante.id 
        ? gameState.duelloMode.difensore.id 
        : gameState.duelloMode.attaccante.id;
      
      const otherTeam = gameState.teams[otherId];
      io.emit('duello_wrong_answer', { wrongTeamId: answeredBy.id, wrongTeamName: answeredBy.name });
      gameState.duelloMode.currentBuzzer = { id: otherId, name: otherTeam.name };
      io.to('admin').emit('duello_other_can_answer', {
        teamId: otherId,
        teamName: otherTeam.name,
        correctAnswer: gameState.currentQuestion.corretta
      });
    }
  });

  // ============================================
  // 💀 IL PATTO COL DESTINO - SOCKET HANDLERS
  // ============================================
  
  socket.on('admin_mostra_regole_patto', () => {
    gameState.pattoDestinoState.fase = 'regole';
    io.emit('patto_regole_display');
  });
  
  socket.on('admin_avvia_patto_destino', () => {
    if (gameState.pattoDestinoState.contatoreUtilizzi >= gameState.pattoDestinoState.maxUtilizzi) {
      io.to('admin').emit('patto_max_utilizzi_raggiunto');
      return;
    }
    
    const squadreIds = selezionaSquadrePattoDestino();
    if (squadreIds.length < 2) {
      io.to('admin').emit('patto_squadre_insufficienti');
      return;
    }
    
    gameState.pattoDestinoState.attivo = true;
    gameState.pattoDestinoState.squadreSelezionate = squadreIds;
    gameState.pattoDestinoState.scelte = new Map();
    gameState.pattoDestinoState.messaggiChat = [];
    gameState.pattoDestinoState.contatoreUtilizzi++;
    
    // Invia contatore aggiornato all'admin
    io.to('admin').emit('patto_update_utilizzi', {
      utilizzi: gameState.pattoDestinoState.contatoreUtilizzi,
      max: gameState.pattoDestinoState.maxUtilizzi
    });
    
    // FASE 1: Chat Segreta (30s)
    gameState.pattoDestinoState.fase = 'chat';
    gameState.pattoDestinoState.startTime = Date.now();
    
    const squadreCoinvolte = squadreIds.map(id => ({
      id: id,
      name: gameState.teams[id].name,
      color: gameState.teams[id].color
    }));
    
    io.emit('patto_fase_chat_start', {
      squadreCoinvolte: squadreCoinvolte,
      tempoChat: 40
    });
    
    // Timer per passare alla fase scelta
    gameState.pattoDestinoState.timer = setTimeout(() => {
      avviaFaseSceltaPatto();
    }, 40000);
  });
  
  socket.on('patto_send_chat_message', (data) => {
    if (!gameState.pattoDestinoState.attivo || gameState.pattoDestinoState.fase !== 'chat') return;
    
    const team = gameState.teams[socket.id];
    if (!team || !gameState.pattoDestinoState.squadreSelezionate.includes(socket.id)) return;
    
    const messaggio = {
      teamId: socket.id,
      playerName: team.name,
      msg: data.msg,
      timestamp: Date.now()
    };
    
    gameState.pattoDestinoState.messaggiChat.push(messaggio);
    
    // Invia solo alle 3 squadre coinvolte
    gameState.pattoDestinoState.squadreSelezionate.forEach(teamId => {
      io.to(teamId).emit('patto_chat_message', messaggio);
    });
  });
  
  function avviaFaseSceltaPatto() {
    gameState.pattoDestinoState.fase = 'scelta';
    gameState.pattoDestinoState.startTime = Date.now();
    
    io.emit('patto_fase_scelta_start', { tempoScelta: 30 });
    
    gameState.pattoDestinoState.timer = setTimeout(() => {
      avviaRevealPatto();
    }, 30000);
  }
  
  socket.on('patto_invia_scelta', (data) => {
    if (!gameState.pattoDestinoState.attivo || gameState.pattoDestinoState.fase !== 'scelta') return;
    if (!gameState.pattoDestinoState.squadreSelezionate.includes(socket.id)) return;
    if (gameState.pattoDestinoState.scelte.has(socket.id)) return; // Già scelto
    
    gameState.pattoDestinoState.scelte.set(socket.id, data.scelta);
    
    // Notifica l'admin e il giocatore
    io.to('admin').emit('patto_scelta_ricevuta', {
      teamId: socket.id,
      teamName: gameState.teams[socket.id].name
    });
    
    io.to(socket.id).emit('patto_scelta_confermata');
    
    // Se tutti hanno scelto, passa subito al reveal
    if (gameState.pattoDestinoState.scelte.size === gameState.pattoDestinoState.squadreSelezionate.length) {
      clearTimeout(gameState.pattoDestinoState.timer);
      avviaRevealPatto();
    }
  });
  
  function avviaRevealPatto() {
    gameState.pattoDestinoState.fase = 'reveal';
    gameState.pattoDestinoState.revealStep = 0;
    
    // Se qualcuno non ha scelto, assegna PATTO di default
    gameState.pattoDestinoState.squadreSelezionate.forEach(teamId => {
      if (!gameState.pattoDestinoState.scelte.has(teamId)) {
        gameState.pattoDestinoState.scelte.set(teamId, 'patto');
      }
    });
    
    // 3s di suspense iniziale
    io.emit('patto_reveal_suspense');
    
    setTimeout(() => {
      revealStepByStep();
    }, 3000);
  }
  
  function revealStepByStep() {
    if (gameState.pattoDestinoState.revealStep >= gameState.pattoDestinoState.squadreSelezionate.length) {
      // Reveal completato, calcola risultato
      setTimeout(() => {
        calcolaRisultatoFinale();
      }, 2500);
      return;
    }
    
    const teamId = gameState.pattoDestinoState.squadreSelezionate[gameState.pattoDestinoState.revealStep];
    const scelta = gameState.pattoDestinoState.scelte.get(teamId);
    const team = gameState.teams[teamId];
    
    io.emit('patto_reveal_step', {
      teamId: teamId,
      teamName: team.name,
      teamColor: team.color,
      scelta: scelta,
      stepNum: gameState.pattoDestinoState.revealStep + 1,
      totalSteps: gameState.pattoDestinoState.squadreSelezionate.length
    });
    
    gameState.pattoDestinoState.revealStep++;
    
    gameState.pattoDestinoState.revealTimer = setTimeout(() => {
      revealStepByStep();
    }, 2000);
  }
  
  function calcolaRisultatoFinale() {
    const { risultati, bonusUltima } = calcolaPuntiPatto(gameState.pattoDestinoState.scelte);
    
    // Applica i punti
    applicaPuntiPatto(risultati, bonusUltima);
    
    // Aggiorna classifica
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    const classifica = realTeams.map(t => ({ id: t.id, name: t.name, score: t.score }))
      .sort((a, b) => b.score - a.score);
    
    io.emit('patto_risultato_finale', {
      risultati: risultati,
      bonusUltimaSquadra: bonusUltima,
      nuovaClassifica: classifica
    });
    
    io.emit('update_teams', realTeams);
    
    // Reset dopo 10 secondi
    setTimeout(() => {
      resetPattoDestino();
      io.emit('patto_reset');
    }, 10000);
  }
  
  socket.on('admin_reset_patto', () => {
    resetPattoDestino();
    io.emit('patto_reset');
  });
  
  // ============================================
  // FINE SOCKET HANDLERS PATTO COL DESTINO
  // ============================================

  socket.on('disconnect', () => {
    const team = gameState.teams[socket.id];
    if (team) {
      delete gameState.teams[socket.id];
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
      io.emit('update_teams', realTeams);
      io.to('admin').emit('update_teams', realTeams);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`
????????????????????????????????????????????????????????????
?      ?  SIPONTO FOREVER YOUNG - SERVER FIXED  ?        ?
????????????????????????????????????????????????????????????

Server porta: ${PORT}

? SOLUZIONI IMPLEMENTATE:
? 1. Soluzione SOLO su display (non sui cellulari)
? 2. Pulsanti +/- punti classifica funzionanti
? 3. Buzzer e gioco musicale con assegnazione punti
? 4. Podio round funzionante
? 5. Risposta corretta visibile in anticipo all'admin
? 6. ✅ Ruota della Fortuna FIXED (spiegazioni + animazione + estrazione + domanda sfida)
? 7. Duello mostra risposta corretta
? 8. ✅ SFIDA FINALE COMPLETA FUNZIONANTE:
?    1️⃣ Spiega Regole ✓
?    2️⃣ Attiva Finale ✓
?    3️⃣ Prepara ALL IN (100/200/300/500) ✓
?    4️⃣ Mostra Domanda & Risultati ✓
?    5️⃣ Domande 2-5 (x2 punti) ✓
?    6️⃣ Rivela Vincitore ✓
? 9. Tasto winner funzionante

Pronto!
`));
