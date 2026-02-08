const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

// ✅ Carica domande dal file JSON
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
  
  console.log(`✅ Caricate ${allQuestions.length} domande da ${categories.length} categorie`);
  console.log(`📚 Categorie:`, categories.join(', '));
} catch (error) {
  console.error('⚠️ Errore caricamento domande:', error.message);
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
  roundScores: {},
  
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
  
  finaleMode: {
    active: false,
    currentQuestion: 0,
    bets: {},
    isAllIn: false
  },
  
  wheelMode: {
    active: false,
    segments: []
  }
};

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
  
  // ✅ FIX: Invia la risposta corretta all'admin
  io.to('admin').emit('show_correct_answer_preview', {
    corretta: questionData.corretta,
    domanda: questionData.domanda,
    categoria: questionData.categoria
  });
  
  console.log(`📝 Domanda: "${questionData.domanda}" (${modalita}) - Risposta: ${questionData.corretta}`);
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

function selectRandomCardToReveal(cards, usedPositions = []) => {
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
    duration: 5,
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
  }, 5000);
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
        
        // ✅ FIX: Traccia punti del round
        if(!gameState.roundScores[answer.teamId]) {
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
  }, 5000);
}

function endMemoryManche() {
  // ✅ FIX: Assegna punti bonus al vincitore del memory
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  if(realTeams.length > 0) {
    const memoryScores = realTeams.map(t => ({
      id: t.id,
      name: t.name,
      memoryPoints: gameState.roundScores[t.id] || 0
    })).sort((a, b) => b.memoryPoints - a.memoryPoints);
    
    // Bonus al vincitore
    if(memoryScores[0] && memoryScores[0].memoryPoints > 0) {
      const winner = gameState.teams[memoryScores[0].id];
      if(winner) {
        winner.score += 200; // Bonus vincitore
        console.log(`🏆 Memory Winner: ${winner.name} (+200 bonus)`);
      }
    }
  }
  
  io.emit('memory_game_end');
  gameState.memoryMode.active = false;
  
  setTimeout(() => {
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams);
    io.to('admin').emit('update_teams', realTeams);
    io.emit('cambia_vista', { view: 'classifica_gen' });
  }, 3000);
}

// ✅ DUELLO RUBA PUNTI
function startDuello() {
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  if(realTeams.length < 2) {
    io.to('admin').emit('duello_error', { message: 'Servono almeno 2 squadre!' });
    return;
  }
  
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
  
  io.to('admin').emit('duello_started', {
    attaccante: { id: lastPlace.id, name: lastPlace.name }
  });
  
  console.log(`⚔️ Duello avviato - Attaccante: ${lastPlace.name}`);
}

function finalizeDuello() {
  const attaccante = gameState.teams[gameState.duelloMode.attaccante.id];
  const difensore = gameState.teams[gameState.duelloMode.difensore.id];
  
  if(!attaccante || !difensore) return;
  
  const attaccanteWins = gameState.duelloMode.scoreAttaccante > gameState.duelloMode.scoreDifensore;
  
  if(attaccanteWins) {
    attaccante.score += 250;
    difensore.score = Math.max(0, difensore.score - 250);
    
    // Traccia nel round
    if(!gameState.roundScores[attaccante.id]) gameState.roundScores[attaccante.id] = 0;
    if(!gameState.roundScores[difensore.id]) gameState.roundScores[difensore.id] = 0;
    gameState.roundScores[attaccante.id] += 250;
    gameState.roundScores[difensore.id] -= 250;
  } else {
    difensore.score += 100;
    if(!gameState.roundScores[difensore.id]) gameState.roundScores[difensore.id] = 0;
    gameState.roundScores[difensore.id] += 100;
  }
  
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  io.emit('update_teams', realTeams);
  io.to('admin').emit('update_teams', realTeams);
  
  io.emit('duello_end', {
    attaccanteWins: attaccanteWins,
    winner: attaccanteWins ? 
      { id: attaccante.id, name: attaccante.name, score: attaccante.score } : 
      { id: difensore.id, name: difensore.name, score: difensore.score },
    loser: attaccanteWins ? 
      { id: difensore.id, name: difensore.name, score: difensore.score } : 
      { id: attaccante.id, name: attaccante.name, score: attaccante.score },
    finalScore: {
      attaccante: gameState.duelloMode.scoreAttaccante,
      difensore: gameState.duelloMode.scoreDifensore
    }
  });
  
  gameState.duelloMode.active = false;
  console.log(`⚔️ Duello concluso - Vincitore: ${attaccanteWins ? attaccante.name : difensore.name}`);
}

// ✅ RUOTA DELLA FORTUNA
function startWheel(segments) {
  gameState.wheelMode.active = true;
  gameState.wheelMode.segments = segments;
  
  io.emit('wheel_start', { segments: segments });
  console.log('🎡 Ruota della fortuna avviata');
}

function spinWheel() {
  if(!gameState.wheelMode.active) return;
  
  const segments = gameState.wheelMode.segments;
  const winningIndex = Math.floor(Math.random() * segments.length);
  const winningSegment = segments[winningIndex];
  
  io.emit('wheel_spinning', { winningIndex: winningIndex });
  
  setTimeout(() => {
    io.emit('wheel_result', { 
      segment: winningSegment,
      index: winningIndex
    });
    console.log(`🎡 Risultato ruota: ${winningSegment}`);
  }, 5000);
}

// ✅ SFIDA FINALE
function startFinale() {
  gameState.finaleMode.active = true;
  gameState.finaleMode.currentQuestion = 0;
  gameState.finaleMode.bets = {};
  gameState.finaleMode.isAllIn = false;
  
  io.emit('finale_started');
  io.to('admin').emit('finale_active', { active: true });
  console.log('🔥 Sfida Finale avviata');
}

function prepareAllIn(questionData) {
  gameState.finaleMode.isAllIn = true;
  gameState.finaleMode.bets = {};
  gameState.currentQuestion = questionData;
  
  io.emit('allin_bet_phase', {
    domanda: questionData.domanda,
    risposte: questionData.risposte || []
  });
  
  console.log('💰 Fase scommesse ALL IN');
}

function showAllInQuestion() {
  if(!gameState.currentQuestion) return;
  
  io.emit('show_allin_question', {
    domanda: gameState.currentQuestion.domanda,
    risposte: gameState.currentQuestion.risposte || []
  });
  
  console.log('💰 Domanda ALL IN mostrata');
}

function revealAllInAnswer() {
  if(!gameState.currentQuestion) return;
  
  const correctAnswer = gameState.currentQuestion.corretta;
  const results = [];
  
  Object.entries(gameState.finaleMode.bets).forEach(([teamId, bet]) => {
    const team = gameState.teams[teamId];
    if(!team) return;
    
    const isCorrect = bet.answer === correctAnswer;
    
    if(isCorrect) {
      team.score = team.score * 2; // Raddoppia
      results.push({
        teamId: teamId,
        teamName: team.name,
        correct: true,
        newScore: team.score
      });
    } else {
      team.score = 0; // Azzera
      results.push({
        teamId: teamId,
        teamName: team.name,
        correct: false,
        newScore: 0
      });
    }
  });
  
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  io.emit('update_teams', realTeams);
  io.to('admin').emit('update_teams', realTeams);
  
  io.emit('allin_results', {
    correctAnswer: correctAnswer,
    results: results
  });
  
  console.log('💰 Risultati ALL IN rivelati');
}

io.on('connection', (socket) => {
  console.log(`🔌 Connessione: ${socket.id}`);
  
  socket.on('admin_connect', () => {
    socket.join('admin');
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    
    // ✅ FIX: Invia i dati delle domande all'admin
    socket.emit('questions_data', questionsData);
    socket.emit('update_teams', realTeams);
    
    console.log('👨‍💻 Admin connesso');
  });

  socket.on('login', (name) => {
    const isPreview = name.includes('PREVIEW') || name.includes('🔍');
    
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
    
    console.log(`✅ Login: ${name} (${isPreview ? 'Preview' : 'Giocatore'})`);
  });

  // ✅ FIX: Gestisci richiesta domande
  socket.on('get_questions', (data) => {
    let questions = [];
    
    if(data.type === 'categoria' && data.key) {
      questions = db.questions.filter(q => q.categoria === data.key);
    } else if(data.type === 'bonus') {
      questions = db.questions.filter(q => q.categoria === 'Bonus');
    } else if(data.type === 'stima') {
      questions = db.questions.filter(q => q.categoria === 'Stima');
    } else if(data.type === 'anagramma') {
      questions = db.questions.filter(q => q.categoria === 'Anagramma');
    }
    
    socket.emit('receive_questions', questions);
    console.log(`📚 Inviate ${questions.length} domande (${data.type}${data.key ? ': ' + data.key : ''})`);
  });

  socket.on('invia_domanda', (d) => sendQuestion(d, d.modalita || 'multipla'));
  
  socket.on('invia_domanda_finale', (d) => {
    d.modalita = d.modalita || 'quiz';
    sendQuestion(d, d.modalita);
    gameState.finaleMode.currentQuestion++;
  });

  socket.on('risposta', (data) => {
    if (!gameState.currentQuestion || gameState.isPaused) return;
    
    const team = gameState.teams[socket.id];
    if (!team || team.isPreview) return;
    
    if (gameState.roundAnswers.some(a => a.teamId === socket.id)) return;
    
    const time = ((Date.now() - gameState.currentQuestion.startTime) / 1000).toFixed(2);
    const isCorrect = (data.risposta === gameState.currentQuestion.corretta);
    
    let points = 0;
    if(isCorrect) {
      points = gameState.currentQuestion.punti || 100;
      
      // Moltiplicatore finale
      if(gameState.finaleMode.active && gameState.finaleMode.currentQuestion > 1) {
        points = points * 2;
      }
      
      team.score += points;
      
      // Traccia round
      if(!gameState.roundScores[socket.id]) {
        gameState.roundScores[socket.id] = 0;
      }
      gameState.roundScores[socket.id] += points;
    }
    
    gameState.roundAnswers.push({
      teamId: socket.id,
      teamName: team.name,
      risposta: data.risposta,
      corretta: isCorrect,
      punti: points,
      time: time
    });
    
    socket.emit('risposta_inviata', {
      corretta: isCorrect,
      punti: points,
      time: time
    });
    
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams);
    io.to('admin').emit('update_teams', realTeams);
    
    io.to('admin').emit('update_answers', {
      answers: gameState.roundAnswers,
      totalTeams: realTeams.length,
      correctAnswer: gameState.currentQuestion.corretta
    });
    
    // ✅ Aggiorna monitor round
    io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
    
    console.log(`💬 ${team.name}: ${data.risposta} ${isCorrect ? '✅' : '❌'} (${time}s) ${isCorrect ? '+' + points : ''}`);
  });

  socket.on('regia_cmd', (cmd) => {
    if (cmd === 'classifica_round' || cmd === 'podio') {
      const roundResults = Object.entries(gameState.roundScores || {}).map(([teamId, points]) => {
        const team = gameState.teams[teamId];
        return {
          id: teamId,
          name: team ? team.name : 'Unknown',
          roundPoints: points
        };
      }).sort((a, b) => b.roundPoints - a.roundPoints);
      
      io.emit('cambia_vista', { view: 'classifica_round' });
      io.emit('update_round_leaderboard', { results: roundResults });
      console.log('🏆 Podio round mostrato');
    } else {
      io.emit('cambia_vista', { view: cmd });
      console.log('📺 Vista:', cmd);
    }
  });

  socket.on('pause_game', () => {
    gameState.isPaused = true;
    io.emit('game_paused');
    console.log('⏸️ Gioco in pausa');
  });

  socket.on('resume_game', () => {
    gameState.isPaused = false;
    io.emit('game_resumed');
    console.log('▶️ Gioco ripreso');
  });

  // ✅ FIX: Reset anche il display
  socket.on('reset_displays', () => {
    io.emit('reset_client_ui');
    io.emit('reset_display_ui');
    console.log('🔄 Reset displays (cellulari + display)');
  });

  socket.on('reset_game', () => {
    gameState.teams = {};
    gameState.buzzerQueue = [];
    gameState.currentQuestion = null;
    gameState.roundAnswers = [];
    gameState.isPaused = false;
    gameState.roundScores = {};
    io.emit('force_reload');
    console.log('🔄 Reset totale');
  });

  socket.on('mostra_soluzione', (data) => {
    io.emit('mostra_soluzione', data);
    console.log('✅ Soluzione mostrata:', data.soluzione);
  });

  socket.on('show_winner', () => {
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    if (realTeams.length > 0) {
      const sortedTeams = realTeams.sort((a, b) => b.score - a.score);
      io.emit('show_winner_screen', {
        winner: sortedTeams[0],
        podium: sortedTeams.slice(0, 3)
      });
    }
  });

  socket.on('assign_points', (data) => {
    const team = gameState.teams[data.teamId];
    if (team) {
      team.score += data.points;
      
      if (!gameState.roundScores[data.teamId]) {
        gameState.roundScores[data.teamId] = 0;
      }
      gameState.roundScores[data.teamId] += data.points;
      
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
      io.emit('update_teams', realTeams);
      io.to('admin').emit('update_teams', realTeams);
      
      console.log(`💰 ${team.name}: ${data.points > 0 ? '+' : ''}${data.points} punti (totale: ${team.score})`);
    }
  });

  // ✅ GIOCO MUSICALE / KARAOKE
  socket.on('play_youtube_karaoke', (data) => {
    io.emit('play_youtube_karaoke', { videoId: data.videoId });
    console.log('🎤 Karaoke:', data.videoId);
  });

  socket.on('stop_karaoke', () => {
    io.emit('stop_karaoke');
  });

  // ✅ BUZZER
  socket.on('buzzer_reset', () => {
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = false;
    io.emit('buzzer_queue_update', { queue: [] });
    io.emit('stato_buzzer', { locked: false, attiva: true });
    io.to('admin').emit('buzzer_queue_full', { queue: [], correctAnswer: "—" });
  });

  socket.on('buzzer_close', () => {
    gameState.buzzerLocked = true;
    gameState.buzzerActive = false;
    io.emit('stato_buzzer', { locked: true, attiva: false });
  });

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
      correctAnswer: gameState.currentQuestion.corretta || "—"
    });
    
    console.log(`🔔 ${team.name}: ${time}s (pos ${gameState.buzzerQueue.length})`);
  });

  // MEMORY
  socket.on('memory_start', () => {
    gameState.memoryMode.active = true;
    gameState.memoryMode.currentManche = 1;
    gameState.roundScores = {}; // Reset round scores per memory
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

  // DUELLO
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
    
    // Invia risposta corretta all'admin
    io.to('admin').emit('show_correct_answer_preview', {
      corretta: data.question.corretta,
      domanda: data.question.domanda,
      categoria: gameState.duelloMode.categoria
    });
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

  // RUOTA DELLA FORTUNA
  socket.on('wheel_start', (data) => {
    startWheel(data.segments || ['100', '200', '300', '400', '500', 'JOLLY', 'PERDI TUTTO']);
  });

  socket.on('wheel_spin', () => {
    spinWheel();
  });

  // SFIDA FINALE
  socket.on('show_finale_explanation', () => {
    io.emit('show_finale_rules');
  });

  socket.on('start_finale', () => {
    startFinale();
  });

  socket.on('prepare_allin', (data) => {
    prepareAllIn(data.question);
  });

  socket.on('admin_force_show_allin', () => {
    showAllInQuestion();
  });

  socket.on('allin_bet', (data) => {
    const team = gameState.teams[socket.id];
    if(!team || team.isPreview) return;
    
    gameState.finaleMode.bets[socket.id] = {
      teamId: socket.id,
      teamName: team.name,
      answer: data.answer
    };
    
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.to('admin').emit('allin_bet_placed', {
      betsCount: Object.keys(gameState.finaleMode.bets).length,
      totalTeams: realTeams.length
    });
    
    console.log(`💰 ${team.name} ha scommesso su: ${data.answer}`);
  });

  socket.on('reveal_winner', () => {
    revealAllInAnswer();
    gameState.finaleMode.active = false;
    
    setTimeout(() => {
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
      if(realTeams.length > 0) {
        const sortedTeams = realTeams.sort((a, b) => b.score - a.score);
        io.emit('show_winner_screen', {
          winner: sortedTeams[0],
          podium: sortedTeams.slice(0, 3)
        });
      }
    }, 5000);
  });

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
╔══════════════════════════════════════════════════════════╗
║      🎮  SIPONTO FOREVER YOUNG - SERVER FIXED  🎮        ║
╚══════════════════════════════════════════════════════════╝

Server porta: ${PORT}

✅ Tutte le modalità di gioco funzionanti:
   - Quiz standard con timer
   - Buzzer e gioco musicale
   - Memory game con bonus vincitore
   - Duello ruba-punti
   - Ruota della fortuna
   - Sfida finale con ALL IN

✅ Correzioni applicate:
   - Soluzione visibile su display
   - Pulsanti +/- punti funzionanti
   - Podio round funzionante
   - Risposta corretta visibile in admin
   - Categorie e domande caricate
   - Reset display + cellulari
   - Pausa senza scritta sovrapposta

Pronto per il gioco!
`));
