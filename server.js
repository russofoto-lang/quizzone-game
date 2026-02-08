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
  
  console.log(`✅ Caricate ${allQuestions.length} domande`);
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
  
  console.log(`📝 Domanda: "${questionData.domanda}" (${modalita})`);
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
    duration: 5,
    manche: gameState.memoryMode.currentManche,
    round: gameState.memoryMode.currentRound
  });
  
  gameState.memoryMode.showAllTimeout = setTimeout(() => {
    io.emit('memory_cover_all');
    
    setTimeout(() => {
      gameState.memoryMode.mancheStartTime = Date.now();
      gameState.memoryMode.answerDeadline = Date.now() + 15000;
      
      io.emit('memory_reveal_one', {
        position: selection.revealed.position,
        image: selection.revealed.emoji,
        grid: gridSize,
        duration: 15,
        manche: gameState.memoryMode.currentManche
      });
      
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
  
  if(fastestCorrect && gameState.teams[fastestCorrect]) {
    gameState.teams[fastestCorrect].score += 50;
    results.find(r => r.teamId === fastestCorrect).bonus = 50;
  }
  
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  io.emit('update_teams', realTeams);
  
  io.emit('memory_show_results', {
    correctPosition: correctPosition,
    correctImage: gameState.memoryMode.cards[correctPosition].emoji,
    results: results,
    points: 150
  });
  
  setTimeout(() => startMemoryRound(), 3000);
}

function endMemoryManche() {
  gameState.memoryMode.active = false;
  io.emit('memory_game_end');
  io.emit('cambia_vista', { view: 'classifica_gen' });
  console.log('🧠 Memory completato!');
}

// DUELLO
function startDuello() {
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  if(realTeams.length < 2) return;

  const attaccante = realTeams[Math.floor(Math.random() * realTeams.length)];

  gameState.duelloMode = {
    active: true,
    attaccante: { id: attaccante.id, name: attaccante.name },
    difensore: null,
    categoria: null,
    scoreAttaccante: 0,
    scoreDifensore: 0,
    questionNumber: 0,
    waitingForAnswer: false,
    currentBuzzer: null
  };

  io.to('admin').emit('duello_attaccante', { attaccante: { id: attaccante.id, name: attaccante.name }});
  io.emit('duello_extraction_animation', {
    teams: realTeams.map(t => t.name),
    winner: { id: attaccante.id, name: attaccante.name }
  });
}

function finalizeDuello() {
  const attaccanteWins = gameState.duelloMode.scoreAttaccante >= 2;
  const winner = attaccanteWins ? gameState.duelloMode.attaccante : gameState.duelloMode.difensore;
  const loser = attaccanteWins ? gameState.duelloMode.difensore : gameState.duelloMode.attaccante;

  if(attaccanteWins) {
    if(gameState.teams[gameState.duelloMode.attaccante.id]) {
      gameState.teams[gameState.duelloMode.attaccante.id].score += 250;
    }
    if(gameState.teams[gameState.duelloMode.difensore.id]) {
      gameState.teams[gameState.duelloMode.difensore.id].score = Math.max(0, 
        gameState.teams[gameState.duelloMode.difensore.id].score - 250);
    }
  } else {
    if(gameState.teams[gameState.duelloMode.difensore.id]) {
      gameState.teams[gameState.duelloMode.difensore.id].score += 100;
    }
  }

  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  io.emit('update_teams', realTeams);

  io.emit('duello_end', {
    winner: winner,
    loser: loser,
    attaccanteWins: attaccanteWins,
    finalScore: {
      attaccante: gameState.duelloMode.scoreAttaccante,
      difensore: gameState.duelloMode.scoreDifensore
    },
    pointsChange: attaccanteWins ? '+250/-250' : '+100 bonus'
  });

  gameState.duelloMode = {
    active: false,
    attaccante: null,
    difensore: null,
    categoria: null,
    scoreAttaccante: 0,
    scoreDifensore: 0,
    questionNumber: 0,
    waitingForAnswer: false,
    currentBuzzer: null
  };

  gameState.currentQuestion = null;
  gameState.roundAnswers = [];
  gameState.buzzerQueue = [];
  io.emit('reset_client_ui');
}

// SOCKET.IO
io.on('connection', (socket) => {
  console.log(`🔌 ${socket.id}`);

  socket.on('login', (teamName) => {
    const isPreview = teamName === '🔍PREVIEW';
    
    gameState.teams[socket.id] = {
      id: socket.id,
      name: teamName,
      score: 0,
      streak: 0,
      isPreview: isPreview
    };

    socket.emit('login_success', { id: socket.id, name: teamName });

    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams);
    io.to('admin').emit('update_teams', realTeams);
  });

  socket.on('invia_risposta', (risposta) => {
    const team = gameState.teams[socket.id];
    if (!team || team.isPreview || !gameState.currentQuestion) return;
    if (gameState.roundAnswers.find(a => a.teamId === socket.id)) return;

    const correctAnswer = gameState.currentQuestion.corretta;
    const isCorrect = String(risposta).toLowerCase().trim() === String(correctAnswer).toLowerCase().trim();
    const elapsedTime = (Date.now() - gameState.currentQuestion.startTime) / 1000;
    let points = 0;

    if (isCorrect) {
      const basePoints = gameState.currentQuestion.punti || 100;
      const speedBonus = Math.max(0, Math.round(50 - (elapsedTime * 2.5)));
      points = basePoints + speedBonus;
      team.score += points;
      team.streak = (team.streak || 0) + 1;
    } else {
      team.streak = 0;
    }

    gameState.roundAnswers.push({
      teamId: socket.id,
      teamName: team.name,
      risposta: risposta,
      corretta: isCorrect,
      tempo: elapsedTime.toFixed(2),
      punti: points
    });

    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams);
    io.to('admin').emit('update_teams', realTeams);
    io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
  });

  socket.on('admin_connect', () => {
    socket.join('admin');
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    socket.emit('init_data', { categories: db.categories, teams: realTeams });
  });

  socket.on('get_questions', (params) => {
    let questions = [];
    if (params.type === 'categoria') {
      questions = getQuestionsByCategory(params.key);
    } else {
      questions = db.questions.filter(q => q.categoria === params.type);
    }
    socket.emit('receive_questions', questions);
  });

  socket.on('send_question', (questionData) => {
    sendQuestion(questionData, questionData.modalita || 'multipla');
  });

  socket.on('start_buzzer', (data) => {
    gameState.buzzerActive = true;
    gameState.buzzerStandalone = true;
    gameState.buzzerLocked = false;
    gameState.buzzerQueue = [];
    gameState.currentQuestion = {
      domanda: data.domanda || '🎵 Premi il buzzer!',
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
    
    io.emit('stato_buzzer', { locked: false, attiva: true });
    console.log('🔔 Buzzer standalone attivato');
  });

  socket.on('invia_domanda', (questionData) => {
    sendQuestion(questionData, questionData.modalita || 'multipla');
    io.to('admin').emit('reset_round_monitor');
  });

  socket.on('regia_cmd', (view) => {
    io.emit('cambia_vista', { view: view });
  });

  socket.on('reset_displays', () => {
    gameState.currentQuestion = null;
    gameState.roundAnswers = [];
    gameState.buzzerActive = false;
    gameState.buzzerLocked = false;
    gameState.buzzerQueue = [];
    io.emit('reset_client_ui');
    io.to('admin').emit('reset_round_monitor');
  });

  socket.on('mostra_soluzione', (data) => {
    io.emit('mostra_soluzione_display', {
      soluzione: data.soluzione,
      domanda: gameState.currentQuestion ? gameState.currentQuestion.domanda : ''
    });
    console.log(`💡 Soluzione su display: ${data.soluzione}`);
  });

  socket.on('pause_game', () => {
    gameState.isPaused = true;
    io.emit('game_paused');
  });

  socket.on('resume_game', () => {
    gameState.isPaused = false;
    io.emit('game_resumed');
  });

  socket.on('reset_game', () => {
    Object.values(gameState.teams).forEach(team => {
      if (!team.isPreview) {
        team.score = 0;
        team.streak = 0;
      }
    });
    
    gameState.currentQuestion = null;
    gameState.roundAnswers = [];
    gameState.buzzerActive = false;
    gameState.buzzerLocked = false;
    gameState.buzzerQueue = [];
    
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams);
    io.emit('reset_client_ui');
    io.to('admin').emit('update_teams', realTeams);
    io.to('admin').emit('reset_round_monitor');
  });

  socket.on('show_winner', () => {
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    const sortedTeams = realTeams.sort((a, b) => b.score - a.score);
    if (sortedTeams.length > 0) {
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
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
      io.emit('update_teams', realTeams);
      io.to('admin').emit('update_teams', realTeams);
    }
  });

  socket.on('play_youtube_karaoke', (data) => {
    io.emit('play_youtube_karaoke', { videoId: data.videoId });
    console.log('🎤 Karaoke:', data.videoId);
  });

  socket.on('stop_karaoke', () => {
    io.emit('stop_karaoke');
  });

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

✅ Preview funzionante
✅ Soluzione SOLO su display
✅ Karaoke YouTube integrato
✅ Buzzer gioco musicale OK
✅ Duello ruba-punti completo
✅ Memory game (3 prove)

Pronto!
`));
