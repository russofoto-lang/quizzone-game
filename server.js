const express = require(‘express’);
const app = express();
const http = require(‘http’).createServer(app);
const io = require(‘socket.io’)(http);
const path = require(‘path’);
const fs = require(‘fs’);

// ✅ Carica domande dal file JSON
let questionsData = { categories: [], questions: [] };
try {
const questionsPath = path.join(__dirname, ‘public’, ‘domande.json’);
const rawData = fs.readFileSync(questionsPath, ‘utf8’);
const jsonData = JSON.parse(rawData);

const pacchetto = jsonData.pacchetti[“1”];
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
categoria: “Bonus”,
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
categoria: “Stima”,
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
categoria: “Anagramma”,
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
console.error(‘⚠️ Errore caricamento domande:’, error.message);
}

app.use(express.static(path.join(__dirname, ‘public’)));

app.get(’/’, (req, res) => res.sendFile(path.join(__dirname, ‘public’, ‘index.html’)));
app.get(’/admin’, (req, res) => res.sendFile(path.join(__dirname, ‘public’, ‘admin.html’)));
app.get(’/display’, (req, res) => res.sendFile(path.join(__dirname, ‘public’, ‘display.html’)));
app.get(’/preview’, (req, res) => res.sendFile(path.join(__dirname, ‘public’, ‘preview.html’)));

let gameState = {
teams: {},
buzzerQueue: [],
buzzerActive: false,
buzzerLocked: false,
buzzerStandalone: false,
currentQuestion: null,
roundAnswers: [],
isPaused: false,
roundScores: {}, // ✅ FIX: Aggiunto per tracciare i punteggi del round

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

finaleMode: null
};

const db = {
categories: questionsData.categories || [],
questions: questionsData.questions || []
};

function getQuestionsByCategory(category) {
return db.questions.filter(q => q.categoria === category);
}

function sendQuestion(questionData, modalita = ‘multipla’) {
if (!questionData) return;

gameState.currentQuestion = {
…questionData,
startTime: Date.now(),
modalita: modalita
};
gameState.roundAnswers = [];
gameState.buzzerQueue = [];

if(modalita === ‘buzzer’) {
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

io.emit(‘nuova_domanda’, payload);
io.emit(‘stato_buzzer’, {
locked: gameState.buzzerLocked,
attiva: (modalita === ‘buzzer’)
});

// ✅ FIX 5: Invia la risposta corretta all’admin in anticipo
io.to(‘admin’).emit(‘show_correct_answer_preview’, {
corretta: questionData.corretta,
domanda: questionData.domanda,
categoria: questionData.categoria
});

// ✅ LOG EVIDENZIATO DELLA RISPOSTA CORRETTA
console.log(’\n’ + ‘═’.repeat(80));
console.log(‘🎯 NUOVA DOMANDA’);
console.log(‘═’.repeat(80));
console.log(`📚 Categoria: ${questionData.categoria}`);
console.log(`🎮 Modalità: ${modalita}`);
console.log(`❓ Domanda: "${questionData.domanda}"`);
console.log(`✅ RISPOSTA CORRETTA: ${questionData.corretta}`);
console.log(‘═’.repeat(80) + ‘\n’);
}

// MEMORY GAME
const EMOJI_POOL = [
‘🍎’, ‘🍌’, ‘🍕’, ‘🎮’, ‘⚽’, ‘🎸’, ‘🚀’, ‘🌟’,
‘🐱’, ‘🐶’, ‘🦁’, ‘🐼’, ‘🎨’, ‘📚’, ‘🎭’, ‘🎪’,
‘🌈’, ‘⭐’, ‘🔥’, ‘💎’, ‘🎯’, ‘🏆’, ‘🎁’, ‘🎂’
];

function generateMemoryCards(roundNumber) {
const pairsCount = roundNumber === 1 ? 3 : roundNumber === 2 ? 5 : 7;
const shuffled = […EMOJI_POOL].sort(() => Math.random() - 0.5);
const selectedEmojis = shuffled.slice(0, pairsCount);

const cards = [];
selectedEmojis.forEach((emoji) => {
cards.push({ emoji: emoji });
cards.push({ emoji: emoji });
});

const shuffledCards = cards.sort(() => Math.random() - 0.5);
return shuffledCards.map((card, position) => ({ …card, position: position }));
}

function selectRandomCardToReveal(cards, usedPositions = []) {
const availableCards = cards.filter(c => !usedPositions.includes(c.position));
if(availableCards.length === 0) return null;

const randomCard = availableCards[Math.floor(Math.random() * availableCards.length)];
const pairCard = cards.find(c => c.emoji === randomCard.emoji && c.position !== randomCard.position);

return { revealed: randomCard, pair: pairCard };
}

function getMemoryGridSize(roundNumber) {
if(roundNumber === 1) return ‘2x3’;
if(roundNumber === 2) return ‘2x5’;
return ‘2x7’;
}

function startMemoryManche(mancheNumber) {
gameState.memoryMode.currentManche = mancheNumber;
gameState.memoryMode.usedPositions = [];
gameState.memoryMode.currentRound = 0;

io.emit(‘memory_manche_intro’, {
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

io.emit(‘memory_show_all’, {
cards: gameState.memoryMode.cards.map(c => c.emoji),
grid: gridSize,
duration: 5,
manche: gameState.memoryMode.currentManche,
round: gameState.memoryMode.currentRound
});

gameState.memoryMode.showAllTimeout = setTimeout(() => {
io.emit(‘memory_cover_all’);

```
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
```

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

```
if(isCorrect) {
  const team = gameState.teams[answer.teamId];
  if(team) {
    const points = 100;
    team.score += points;
    
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
```

});

const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
io.emit(‘update_teams’, realTeams);
io.to(‘admin’).emit(‘update_teams’, realTeams);

io.emit(‘memory_show_results’, {
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
io.emit(‘memory_game_end’);
gameState.memoryMode.active = false;

setTimeout(() => {
io.emit(‘cambia_vista’, { view: ‘classifica_gen’ });
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

// ✅ FIX: Invia l’attaccante all’admin
io.to(‘admin’).emit(‘duello_attaccante’, {
attaccante: { id: lastPlace.id, name: lastPlace.name }
});

io.emit(‘cambia_vista’, { view: ‘duello_intro’ });
io.emit(‘duello_intro’, {
attaccante: { id: lastPlace.id, name: lastPlace.name }
});

console.log(’\n’ + ‘🔥’.repeat(40));
console.log(`🔥 DUELLO AVVIATO - Attaccante: ${lastPlace.name}`);
console.log(‘🔥’.repeat(40) + ‘\n’);
}

function finalizeDuello() {
const attaccante = gameState.teams[gameState.duelloMode.attaccante.id];
const difensore = gameState.teams[gameState.duelloMode.difensore.id];

if(!attaccante || !difensore) return;

const attaccanteWins = gameState.duelloMode.scoreAttaccante > gameState.duelloMode.scoreDifensore;

if(attaccanteWins) {
attaccante.score += 250;
difensore.score = Math.max(0, difensore.score - 250);
} else {
difensore.score += 100;
}

const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
io.emit(‘update_teams’, realTeams);
io.to(‘admin’).emit(‘update_teams’, realTeams);

io.emit(‘duello_end’, {
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
}

io.on(‘connection’, (socket) => {
console.log(`🔌 Connessione: ${socket.id}`);

socket.on(‘admin_connect’, () => {
socket.join(‘admin’);
const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
socket.emit(‘update_teams’, realTeams);
socket.emit(‘questions_data’, questionsData);
console.log(‘👨‍💻 Admin connesso’);
});

socket.on(‘login’, (name) => {
const isPreview = name.includes(‘PREVIEW’) || name.includes(‘🔍’);

```
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
```

});

socket.on(‘invia_domanda’, (d) => sendQuestion(d, d.modalita || ‘multipla’));

socket.on(‘risposta’, (data) => {
if (!gameState.currentQuestion || gameState.isPaused) return;

```
const team = gameState.teams[socket.id];
if (!team || team.isPreview) return;

if (gameState.roundAnswers.some(a => a.teamId === socket.id)) return;

const time = ((Date.now() - gameState.currentQuestion.startTime) / 1000).toFixed(2);
const isCorrect = (data.risposta === gameState.currentQuestion.corretta);

gameState.roundAnswers.push({
  teamId: socket.id,
  teamName: team.name,
  risposta: data.risposta,
  corretta: isCorrect,
  time: time
});

socket.emit('risposta_inviata', {
  corretta: isCorrect,
  time: time
});

const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
io.to('admin').emit('update_answers', {
  answers: gameState.roundAnswers,
  totalTeams: realTeams.length,
  correctAnswer: gameState.currentQuestion.corretta
});

console.log(`💬 ${team.name}: ${data.risposta} ${isCorrect ? '✅' : '❌'} (${time}s)`);
```

});

socket.on(‘regia_cmd’, (cmd) => {
// ✅ FIX 4: Gestisci il comando “podio” per mostrare classifica round
if (cmd === ‘classifica_round’ || cmd === ‘podio’) {
// Calcola e invia la classifica del round corrente
const roundResults = Object.entries(gameState.roundScores || {}).map(([teamId, points]) => {
const team = gameState.teams[teamId];
return {
id: teamId,
name: team ? team.name : ‘Unknown’,
roundPoints: points
};
}).sort((a, b) => b.roundPoints - a.roundPoints);

```
  io.emit('cambia_vista', { view: 'classifica_round' });
  io.emit('update_round_leaderboard', { results: roundResults });
  console.log('📊 Mostro podio round');
} else {
  io.emit('cambia_vista', { view: cmd });
  console.log('📺 Vista:', cmd);
}
```

});

socket.on(‘pause_game’, () => {
gameState.isPaused = true;
io.emit(‘game_paused’);
console.log(‘⏸️ Gioco in pausa’);
});

socket.on(‘resume_game’, () => {
gameState.isPaused = false;
io.emit(‘game_resumed’);
console.log(‘▶️ Gioco ripreso’);
});

socket.on(‘reset_displays’, () => {
io.emit(‘reset_client_ui’);
});

socket.on(‘reset_game’, () => {
gameState.teams = {};
gameState.buzzerQueue = [];
gameState.currentQuestion = null;
gameState.roundAnswers = [];
gameState.isPaused = false;
gameState.roundScores = {};
io.emit(‘force_reload’);
console.log(‘🔄 Reset totale’);
});

// ✅ FIX 1: Evento mostra_soluzione invia SOLO al display, NON ai cellulari
socket.on(‘mostra_soluzione’, (data) => {
io.to(‘display’).emit(‘mostra_soluzione’, data);
console.log(‘✅ Soluzione mostrata sul display:’, data.soluzione);
});

socket.on(‘show_winner’, () => {
const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
if (realTeams.length > 0) {
const sortedTeams = realTeams.sort((a, b) => b.score - a.score);
io.emit(‘show_winner_screen’, {
winner: sortedTeams[0],
podium: sortedTeams.slice(0, 3)
});
}
});

// ✅ FIX 2: Correggi assign_points per aggiungere/togliere punti manualmente
socket.on(‘assign_points’, (data) => {
const team = gameState.teams[data.teamId];
if (team) {
team.score += data.points;

```
  // Traccia anche nei punteggi del round
  if (!gameState.roundScores[data.teamId]) {
    gameState.roundScores[data.teamId] = 0;
  }
  gameState.roundScores[data.teamId] += data.points;
  
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  io.emit('update_teams', realTeams);
  io.to('admin').emit('update_teams', realTeams);
  
  console.log(`💰 ${team.name}: ${data.points > 0 ? '+' : ''}${data.points} punti (totale: ${team.score})`);
}
```

});

socket.on(‘play_youtube_karaoke’, (data) => {
io.emit(‘play_youtube_karaoke’, { videoId: data.videoId });
console.log(‘🎤 Karaoke:’, data.videoId);
});

socket.on(‘stop_karaoke’, () => {
io.emit(‘stop_karaoke’);
});

// ✅ FIX: GIOCO MUSICALE - Buzzer Standalone
socket.on(‘start_buzzer’, (data) => {
gameState.buzzerActive = true;
gameState.buzzerLocked = false;
gameState.buzzerStandalone = true;
gameState.buzzerQueue = [];
gameState.currentQuestion = {
domanda: data.domanda || ‘🎵 Premi quando sai la risposta!’,
corretta: data.corretta || ‘’,
startTime: Date.now(),
modalita: ‘buzzer_standalone’
};

```
io.emit('nuova_domanda', {
  domanda: data.domanda || '🎵 Premi quando sai la risposta!',
  risposte: [],
  modalita: 'buzzer',
  startTime: Date.now(),
  serverTimestamp: Date.now()
});

io.emit('stato_buzzer', { locked: false, attiva: true });

console.log('\n' + '♪'.repeat(80));
console.log('🎵 GIOCO MUSICALE ATTIVATO');
console.log('♪'.repeat(80) + '\n');
```

});

socket.on(‘buzzer_reset’, () => {
gameState.buzzerQueue = [];
gameState.buzzerLocked = false;
io.emit(‘buzzer_queue_update’, { queue: [] });
io.emit(‘stato_buzzer’, { locked: false, attiva: true });
io.to(‘admin’).emit(‘buzzer_queue_full’, { queue: [], correctAnswer: “—” });
});

socket.on(‘buzzer_close’, () => {
gameState.buzzerLocked = true;
gameState.buzzerActive = false;
io.emit(‘stato_buzzer’, { locked: true, attiva: false });
});

// ✅ FIX 3: Migliorato buzzer per gioco musicale e assegnazione punti
socket.on(‘prenoto’, () => {
if (gameState.buzzerLocked || !gameState.currentQuestion) return;

```
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
```

});

socket.on(‘memory_start’, () => {
gameState.memoryMode.active = true;
gameState.memoryMode.currentManche = 1;
startMemoryManche(1);
});

socket.on(‘memory_answer’, (data) => {
if(!gameState.memoryMode.active) return;
const team = gameState.teams[socket.id];
if(!team || team.isPreview || gameState.memoryMode.answers[socket.id]) return;

```
gameState.memoryMode.answers[socket.id] = {
  teamId: socket.id,
  teamName: team.name,
  position: parseInt(data.position),
  time: (Date.now() - gameState.memoryMode.mancheStartTime) / 1000
};
```

});

socket.on(‘memory_skip_round’, () => {
if(gameState.memoryMode.showAllTimeout) clearTimeout(gameState.memoryMode.showAllTimeout);
if(gameState.memoryMode.answerTimeout) clearTimeout(gameState.memoryMode.answerTimeout);
processMemoryAnswers();
});

socket.on(‘memory_stop’, () => {
if(gameState.memoryMode.showAllTimeout) clearTimeout(gameState.memoryMode.showAllTimeout);
if(gameState.memoryMode.answerTimeout) clearTimeout(gameState.memoryMode.answerTimeout);
gameState.memoryMode.active = false;
io.emit(‘reset_client_ui’);
io.emit(‘cambia_vista’, { view: ‘logo’ });
});

// ✅ FIX: RUOTA DELLA FORTUNA
socket.on(‘ruota_step’, (data) => {
const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);

```
switch(data.step) {
  case 'explain':
    io.emit('cambia_vista', { view: 'ruota_explain' });
    io.emit('ruota_explain', {
      message: '🎰 RUOTA DELLA FORTUNA\n\nUna squadra verrà estratta casualmente e potrà scegliere tra:\n• Raddoppiare i propri punti\n• Rubare 200 punti a un avversario'
    });
    console.log('🎰 Spiegazione Ruota della Fortuna');
    break;
    
  case 'spin':
    if(realTeams.length === 0) return;
    const winner = realTeams[Math.floor(Math.random() * realTeams.length)];
    
    io.emit('ruota_spin', { 
      teams: realTeams.map(t => ({ id: t.id, name: t.name })),
      winner: { id: winner.id, name: winner.name }
    });
    
    io.to('admin').emit('ruota_winner', { id: winner.id, name: winner.name });
    
    console.log('\n' + '🎰'.repeat(40));
    console.log(`🎰 RUOTA ESTRATTA: ${winner.name}`);
    console.log('🎰'.repeat(40) + '\n');
    break;
    
  case 'choice':
    const team = gameState.teams[data.teamId];
    if(!team) return;
    
    const opponents = realTeams.filter(t => t.id !== data.teamId);
    
    io.to(data.teamId).emit('ruota_choice', {
      message: 'Scegli la tua fortuna:',
      options: [
        { id: 'double', label: '🔥 Raddoppia i tuoi punti', value: team.score * 2 },
        { id: 'steal', label: '💰 Ruba 200 punti', opponents: opponents.map(t => ({ id: t.id, name: t.name, score: t.score })) }
      ]
    });
    
    console.log('🎰 Scelta inviata a:', team.name);
    break;
    
  case 'challenge':
    if(!data.question) return;
    sendQuestion(data.question, 'quiz');
    io.emit('cambia_vista', { view: 'gioco' });
    console.log('🎰 Domanda sfida lanciata');
    break;
}
```

});

socket.on(‘ruota_choice_made’, (data) => {
const team = gameState.teams[socket.id];
if(!team) return;

```
io.to('admin').emit('ruota_choice_result', {
  teamId: socket.id,
  teamName: team.name,
  choice: data.choice,
  targetTeam: data.targetTeam || null
});

// Applica la scelta
if(data.choice === 'double') {
  team.score = team.score * 2;
  io.emit('ruota_result', {
    teamName: team.name,
    action: 'double',
    newScore: team.score
  });
  console.log(`🎰 ${team.name} ha raddoppiato: ${team.score} punti`);
} else if(data.choice === 'steal' && data.targetTeam) {
  const target = gameState.teams[data.targetTeam];
  if(target) {
    target.score = Math.max(0, target.score - 200);
    team.score += 200;
    io.emit('ruota_result', {
      teamName: team.name,
      action: 'steal',
      targetName: target.name,
      stolenPoints: 200,
      newScore: team.score,
      targetNewScore: target.score
    });
    console.log(`🎰 ${team.name} ha rubato 200 punti a ${target.name}`);
  }
}

const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
io.emit('update_teams', realTeams);
io.to('admin').emit('update_teams', realTeams);
```

});

// ✅ FIX: SFIDA FINALE
socket.on(‘show_finale_explanation’, () => {
io.emit(‘cambia_vista’, { view: ‘finale_rules’ });
io.emit(‘finale_rules’, {
message: ‘🔥 SFIDA FINALE\n\n5 domande a raddoppio!\n\nDomanda 1: ALL IN obbligatorio\nDomande 2-5: Punti x2\n\nIl vincitore prende tutto! 👑’
});
console.log(’\n’ + ‘🔥’.repeat(40));
console.log(‘🔥 SPIEGAZIONE SFIDA FINALE’);
console.log(‘🔥’.repeat(40) + ‘\n’);
});

socket.on(‘start_finale’, () => {
gameState.finaleMode = {
active: true,
questionCount: 0,
allInBets: {},
multiplier: 1
};

```
io.emit('finale_started');
io.emit('cambia_vista', { view: 'finale_active' });

console.log('\n' + '👑'.repeat(40));
console.log('👑 SFIDA FINALE INIZIATA!');
console.log('👑'.repeat(40) + '\n');
```

});

socket.on(‘invia_domanda_finale’, (data) => {
if(!gameState.finaleMode) {
gameState.finaleMode = { active: true, questionCount: 0, allInBets: {}, multiplier: 1 };
}

```
gameState.finaleMode.questionCount++;
gameState.finaleMode.currentQuestion = data;

// Domanda 1 = ALL IN obbligatorio
if(gameState.finaleMode.questionCount === 1) {
  const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
  io.emit('finale_allin_betting', {
    question: data,
    teams: realTeams.map(t => ({ id: t.id, name: t.name, score: t.score }))
  });
  console.log('💰 ALL IN - Scommesse aperte');
} else {
  // Domande 2-5 = x2 punti
  gameState.finaleMode.multiplier = 2;
  sendQuestion(data, 'quiz');
  console.log(`🔥 Domanda Finale ${gameState.finaleMode.questionCount} (x${gameState.finaleMode.multiplier})`);
}
```

});

socket.on(‘finale_allin_bet’, (data) => {
const team = gameState.teams[socket.id];
if(!team || team.isPreview) return;

```
if(!gameState.finaleMode.allInBets) gameState.finaleMode.allInBets = {};

gameState.finaleMode.allInBets[socket.id] = {
  teamId: socket.id,
  teamName: team.name,
  bet: data.bet,
  answer: data.answer
};

const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
const betsCount = Object.keys(gameState.finaleMode.allInBets).length;

io.to('admin').emit('allin_bet_placed', {
  betsCount: betsCount,
  totalTeams: realTeams.length
});

console.log(`💰 ${team.name} ha puntato ${data.bet} su "${data.answer}"`);
```

});

socket.on(‘admin_force_show_allin’, () => {
if(!gameState.finaleMode || !gameState.finaleMode.currentQuestion) return;

```
const question = gameState.finaleMode.currentQuestion;
io.emit('finale_allin_reveal', {
  question: question.domanda,
  correctAnswer: question.corretta,
  bets: Object.values(gameState.finaleMode.allInBets || {})
});

// Processa le scommesse
Object.values(gameState.finaleMode.allInBets || {}).forEach(bet => {
  const team = gameState.teams[bet.teamId];
  if(!team) return;
  
  const isCorrect = bet.answer === question.corretta;
  if(isCorrect) {
    team.score += bet.bet;
    console.log(`✅ ${team.name}: +${bet.bet} (risposta corretta)`);
  } else {
    team.score = Math.max(0, team.score - bet.bet);
    console.log(`❌ ${team.name}: -${bet.bet} (risposta sbagliata)`);
  }
});

const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
io.emit('update_teams', realTeams);
io.to('admin').emit('update_teams', realTeams);
```

});

socket.on(‘reveal_winner’, () => {
const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
const sorted = realTeams.sort((a, b) => b.score - a.score);
const winner = sorted[0];

```
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

console.log('\n' + '👑'.repeat(40));
console.log(`👑 VINCITORE: ${winner.name} con ${winner.score} punti!`);
console.log('👑'.repeat(40) + '\n');
```

});

socket.on(‘duello_start’, () => startDuello());

socket.on(‘duello_show_opponent_choice’, () => {
if(!gameState.duelloMode.active) return;
const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
const sorted = realTeams.sort((a, b) => a.score - b.score);
const availableOpponents = realTeams.filter(t =>
t.id !== gameState.duelloMode.attaccante.id &&
t.id !== sorted[0].id
);
io.to(gameState.duelloMode.attaccante.id).emit(‘duello_choose_opponent’, {
opponents: availableOpponents.map(t => ({ id: t.id, name: t.name, score: t.score }))
});
});

socket.on(‘duello_opponent_chosen’, (data) => {
if(!gameState.duelloMode.active) return;
const difensore = gameState.teams[data.opponentId];
if(!difensore) return;
gameState.duelloMode.difensore = { id: difensore.id, name: difensore.name };
io.to(‘admin’).emit(‘duello_difensore_scelto’, { difensore: { id: difensore.id, name: difensore.name }});
});

socket.on(‘duello_show_category_choice’, () => {
if(!gameState.duelloMode.active) return;
io.to(gameState.duelloMode.attaccante.id).emit(‘duello_choose_category’, { categories: db.categories });
});

socket.on(‘duello_category_chosen’, (data) => {
if(!gameState.duelloMode.active) return;
gameState.duelloMode.categoria = data.category;
io.to(‘admin’).emit(‘duello_categoria_scelta’, { category: data.category });
});

socket.on(‘duello_launch_question’, (data) => {
if(!gameState.duelloMode.active) return;
gameState.duelloMode.questionNumber++;
gameState.currentQuestion = data.question;
gameState.currentQuestion.startTime = Date.now();
gameState.buzzerQueue = [];
gameState.buzzerLocked = false;
gameState.duelloMode.currentBuzzer = null;
gameState.duelloMode.waitingForAnswer = false;

```
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
```

});

socket.on(‘duello_buzzer_press’, (data) => {
if(!gameState.duelloMode.active || gameState.duelloMode.waitingForAnswer) return;
if(data.teamId !== gameState.duelloMode.attaccante.id &&
data.teamId !== gameState.duelloMode.difensore.id) return;

```
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
```

});

socket.on(‘duello_answer_result’, (data) => {
if(!gameState.duelloMode.active) return;
const answeredBy = gameState.duelloMode.currentBuzzer;
if(!answeredBy) return;

```
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
```

});

socket.on(‘disconnect’, () => {
const team = gameState.teams[socket.id];
if (team) {
delete gameState.teams[socket.id];
const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
io.emit(‘update_teams’, realTeams);
io.to(‘admin’).emit(‘update_teams’, realTeams);
}
});
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`
╔══════════════════════════════════════════════════════════╗
║      🎮  SIPONTO FOREVER YOUNG - SERVER FIXED  🎮        ║
╚══════════════════════════════════════════════════════════╝

Server porta: ${PORT}

✅ Soluzione SOLO su display (non sui cellulari)
✅ Pulsanti +/- punti classifica funzionanti
✅ Buzzer e gioco musicale con assegnazione punti
✅ Podio round funzionante
✅ Risposta corretta visibile in anticipo all’admin

Pronto!
`));
