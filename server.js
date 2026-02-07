const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

// ✅ Carica domande dal file JSON e trasforma la struttura
let questionsData = { categories: [], questions: [] };
try {
  const questionsPath = path.join(__dirname, 'public', 'domande.json');
  const rawData = fs.readFileSync(questionsPath, 'utf8');
  const jsonData = JSON.parse(rawData);
  
  // Trasforma la struttura dal formato originale
  const pacchetto = jsonData.pacchetti["1"];
  const categories = Object.keys(pacchetto.categorie);
  const allQuestions = [];
  
  // Converti domande da ogni categoria
  categories.forEach(categoria => {
    const domande = pacchetto.categorie[categoria];
    domande.forEach(d => {
      allQuestions.push({
        id: d.id,
        domanda: d.domanda,
        risposte: d.risposte || [],
        corretta: d.risposte ? d.risposte[d.corretta] : d.corretta,  // Converti indice in stringa
        categoria: categoria,
        punti: d.punti,
        difficolta: d.difficolta
      });
    });
  });
  
  // Aggiungi bonus, stima, anagramma
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
  
  console.log(`✅ Caricate ${allQuestions.length} domande da domande.json`);
  console.log(`✅ Categorie: ${categories.join(', ')}`);
} catch (error) {
  console.error('⚠️ Errore nel caricamento di domande.json:', error.message);
  console.log('ℹ️ Utilizzo database vuoto di default');
}

// ✅FIX: Servi file statici dalla cartella public
app.use(express.static(path.join(__dirname, 'public')));

// ✅ FIX: Route corrette puntando a public/
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/preview', (req, res) => res.sendFile(path.join(__dirname, 'public', 'preview.html')));

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
  
  // ✅ MEMORY MODE: 1 manche con 3 prove
  memoryMode: {
    active: false,
    currentManche: 0,
    totalManches: 1,  // ✅ Solo 1 manche
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

// Database - usa i dati caricati dal JSON
const db = {
  categories: questionsData.categories || ["storia", "geografia", "scienze", "cinema", "musica", "sport"],
  questions: questionsData.questions || []
};

// ════════════════════════════════════════════════════════════════
// 📝 FUNZIONI DOMANDE
// ════════════════════════════════════════════════════════════════

function getQuestionsByCategory(category) {
  return db.questions.filter(q => q.categoria === category);
}

function getRandomQuestion(category = null) {
  let availableQuestions = category 
    ? getQuestionsByCategory(category)
    : db.questions;
  
  if (availableQuestions.length === 0) {
    console.error('⚠️ Nessuna domanda disponibile!');
    return null;
  }
  
  const randomIndex = Math.floor(Math.random() * availableQuestions.length);
  return availableQuestions[randomIndex];
}

function sendQuestion(questionData, modalita = 'multipla') {
  if (!questionData) {
    console.error('⚠️ Impossibile inviare domanda: dati mancanti');
    return;
  }
  
  gameState.currentQuestion = {
    ...questionData,
    startTime: Date.now(),
    modalita: modalita
  };
  gameState.roundAnswers = [];
  gameState.buzzerQueue = [];
  gameState.buzzerLocked = false;
  
  const payload = {
    domanda: questionData.domanda,
    risposte: questionData.risposte || [],
    modalita: modalita,
    categoria: questionData.categoria,
    startTime: Date.now(),
    serverTimestamp: Date.now()
  };
  
  // Salva la risposta corretta solo nel server
  gameState.currentQuestion.corretta = questionData.corretta;
  
  io.emit('nuova_domanda', payload);
  console.log(`📝 Domanda inviata: "${questionData.domanda}" (${modalita})`);
}

// ════════════════════════════════════════════════════════════════
// 🧠 MEMORY GAME - HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════

const EMOJI_POOL = [
  '🍎', '🍌', '🍕', '🎮', '⚽', '🎸', '🚀', '🌟',
  '🐱', '🐶', '🦁', '🐼', '🎨', '📚', '🎭', '🎪',
  '🌈', '⭐', '🔥', '💎', '🎯', '🏆', '🎁', '🎂'
];

function generateMemoryCards(roundNumber) {
  // Prova 1: 3 coppie (6 carte), Prova 2: 5 coppie (10 carte), Prova 3: 7 coppie (14 carte)
  const pairsCount = roundNumber === 1 ? 3 : roundNumber === 2 ? 5 : 7;
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

function getMemoryGridSize(roundNumber) {
  // Prova 1: 2x3 (6 carte), Prova 2: 2x5 (10 carte), Prova 3: 2x7 (14 carte)
  if(roundNumber === 1) return '2x3';
  if(roundNumber === 2) return '2x5';
  return '2x7';
}

// ════════════════════════════════════════════════════════════════
// 🧠 MEMORY GAME - FUNCTIONS
// ════════════════════════════════════════════════════════════════

function startMemoryManche(mancheNumber) {
  console.log(`🧠 Inizio Memory Game - 3 prove`);
  
  gameState.memoryMode.currentManche = mancheNumber;
  gameState.memoryMode.usedPositions = [];
  gameState.memoryMode.currentRound = 0;
  
  // Mostra schermata intro
  io.emit('memory_manche_intro', {
    manche: mancheNumber,
    totalManches: 1,  // ✅ Solo 1 manche con 3 prove
    pairsCount: 3  // Prima prova
  });
  
  // Dopo 3 secondi inizia prima prova
  setTimeout(() => {
    startMemoryRound();
  }, 3000);
}

function startMemoryRound() {
  gameState.memoryMode.currentRound++;
  
  // ✅ Controlla se abbiamo fatto tutte e 3 le prove
  if(gameState.memoryMode.currentRound > 3) {
    endMemoryManche();
    return;
  }
  
  gameState.memoryMode.answers = {};
  
  // ✅ Genera nuove carte per questa prova
  gameState.memoryMode.cards = generateMemoryCards(gameState.memoryMode.currentRound);
  gameState.memoryMode.usedPositions = [];
  
  const selection = selectRandomCardToReveal(
    gameState.memoryMode.cards, 
    gameState.memoryMode.usedPositions
  );
  
  if(!selection) {
    // Non dovrebbe succedere, ma per sicurezza
    endMemoryManche();
    return;
  }
  
  gameState.memoryMode.revealedCard = selection.revealed;
  gameState.memoryMode.pairPosition = selection.pair.position;
  gameState.memoryMode.usedPositions.push(selection.revealed.position);
  gameState.memoryMode.usedPositions.push(selection.pair.position);
  
  const gridSize = getMemoryGridSize(gameState.memoryMode.currentRound);
  
  // ✅ Tempo di memorizzazione aumentato: 8 secondi per prove 1-2, 10 secondi per prova 3
  const showAllDuration = gameState.memoryMode.currentRound <= 2 ? 8 : 10;
  const showAllDurationMs = showAllDuration * 1000;
  
  console.log(`🧠 Prova ${gameState.memoryMode.currentRound}/3 - ${gameState.memoryMode.cards.length} carte - ${showAllDuration}s`);
  
  // FASE 1: Mostra tutte le carte
  io.emit('memory_show_all', {
    cards: gameState.memoryMode.cards.map(c => c.emoji),
    grid: gridSize,
    duration: showAllDuration,
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
  }, showAllDurationMs);
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
  
  console.log(`🧠 Prova ${gameState.memoryMode.currentRound}/3 completata - ${results.filter(r => r.correct).length}/${results.length} corretti`);
  
  // ✅ Prossima prova dopo 3 secondi (o fine gioco se erano 3 prove)
  setTimeout(() => {
    if(gameState.memoryMode.currentRound >= 3) {
      endMemoryManche();
    } else {
      startMemoryRound();
    }
  }, 3000);
}

function endMemoryManche() {
  console.log(`🧠 Fine Memory Game - 3 prove completate!`);
  
  // Fine gioco
  gameState.memoryMode.active = false;
  io.emit('memory_game_end');
  io.emit('cambia_vista', { view: 'classifica_gen' });
  console.log('🧠 Memory Game completato!');
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

  // ════════════════════════════════════════════════════════════════
  // 📝 GESTIONE DOMANDE
  // ════════════════════════════════════════════════════════════════

  // Admin richiede domande per tipo/categoria
  socket.on('get_questions', (data) => {
    const { type, key } = data;
    let filteredQuestions = [];
    
    if (type === 'categoria' && key) {
      // Filtra per categoria specifica
      filteredQuestions = db.questions.filter(q => q.categoria === key);
    } else if (type === 'stima') {
      filteredQuestions = db.questions.filter(q => q.categoria === 'Stima');
    } else if (type === 'anagramma') {
      filteredQuestions = db.questions.filter(q => q.categoria === 'Anagramma');
    } else if (type === 'bonus') {
      filteredQuestions = db.questions.filter(q => q.categoria === 'Bonus');
    }
    
    socket.emit('receive_questions', filteredQuestions);
    console.log(`📋 Inviate ${filteredQuestions.length} domande (${type}${key ? ': ' + key : ''})`);
  });

  // Admin invia domanda casuale per categoria
  socket.on('send_random_question', (data) => {
    const { categoria, modalita } = data;
    const question = getRandomQuestion(categoria);
    
    if (question) {
      sendQuestion(question, modalita || 'multipla');
    } else {
      socket.emit('error', { message: 'Nessuna domanda disponibile per questa categoria' });
    }
  });

  // Admin invia domanda specifica
  socket.on('send_question', (questionData) => {
    sendQuestion(questionData, questionData.modalita || 'multipla');
  });

  // Admin attiva buzzer standalone
  socket.on('start_buzzer', (data) => {
    gameState.buzzerActive = true;
    gameState.buzzerStandalone = true;
    gameState.currentQuestion = {
      domanda: data.domanda || 'Premi il buzzer!',
      startTime: Date.now(),
      modalita: 'buzzer'
    };
    
    io.emit('nuova_domanda', {
      domanda: gameState.currentQuestion.domanda,
      modalita: 'buzzer',
      risposte: [],
      startTime: Date.now(),
      serverTimestamp: Date.now()
    });
    
    console.log('🔔 Buzzer attivato');
  });

  // Admin invia domanda (comando principale)
  socket.on('invia_domanda', (questionData) => {
    const modalita = questionData.modalita || 'multipla';
    sendQuestion(questionData, modalita);
    
    // Notifica admin che la domanda è stata inviata
    io.to('admin').emit('reset_round_monitor');
  });

  // Admin cambia vista display (regia)
  socket.on('regia_cmd', (view) => {
    io.emit('cambia_vista', { view: view });
    console.log(`📺 Vista cambiata: ${view}`);
  });

  // Admin reset displays
  socket.on('reset_displays', () => {
    gameState.currentQuestion = null;
    gameState.roundAnswers = [];
    gameState.buzzerActive = false;
    gameState.buzzerLocked = false;
    gameState.buzzerQueue = [];
    
    io.emit('reset_client_ui');
    io.to('admin').emit('reset_round_monitor');
    console.log('🔄 Display resettati');
  });

  // Admin mostra risposta corretta
  socket.on('mostra_corretta', () => {
    if (gameState.currentQuestion) {
      io.emit('mostra_risposta_corretta', {
        corretta: gameState.currentQuestion.corretta,
        risposte: gameState.roundAnswers
      });
      console.log(`✅ Risposta corretta mostrata: ${gameState.currentQuestion.corretta}`);
    }
  });

  // Admin assegna punti manualmente
  socket.on('assign_points', (data) => {
    const { teamId, points } = data;
    const team = gameState.teams[teamId];
    
    if (team) {
      team.score += points;
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
      io.emit('update_teams', realTeams);
      io.to('admin').emit('update_teams', realTeams);
      console.log(`💰 ${team.name}: ${points > 0 ? '+' : ''}${points} punti (totale: ${team.score})`);
    }
  });

  // Admin modifica punteggio squadra
  socket.on('update_team_score', (data) => {
    const { teamId, newScore } = data;
    const team = gameState.teams[teamId];
    
    if (team) {
      team.score = newScore;
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
      io.emit('update_teams', realTeams);
      io.to('admin').emit('update_teams', realTeams);
      console.log(`📝 ${team.name}: punteggio modificato a ${newScore}`);
    }
  });

  // Admin blocca/sblocca buzzer
  socket.on('close_buzzer', () => {
    gameState.buzzerLocked = true;
    gameState.buzzerActive = false;
    console.log('🔒 Buzzer bloccato');
  });

  socket.on('open_buzzer', () => {
    gameState.buzzerLocked = false;
    gameState.buzzerActive = true;
    gameState.buzzerQueue = [];
    console.log('🔓 Buzzer aperto');
  });

  socket.on('reset_buzzer', () => {
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = false;
    gameState.buzzerActive = false;
    io.emit('reset_buzzer_ui');
    console.log('🔄 Buzzer resettato');
  });

  // Admin resetta UI
  socket.on('reset_ui', () => {
    gameState.currentQuestion = null;
    gameState.roundAnswers = [];
    gameState.buzzerActive = false;
    gameState.buzzerLocked = false;
    gameState.buzzerQueue = [];
    
    io.emit('reset_client_ui');
    console.log('🔄 UI resettata');
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

  socket.on('disconnect', () => {
    const team = gameState.teams[socket.id];
    if (team) {
      console.log(`❌ Disconnesso: ${team.name}`);
      delete gameState.teams[socket.id];
      
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
      io.emit('update_teams', realTeams);
      io.to('admin').emit('update_teams', realTeams);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`✅ Server in ascolto su porta ${PORT}`));
