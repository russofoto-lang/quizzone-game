const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Stato del gioco
let gameState = {
  teams: {},
  currentQuestion: null,
  currentMode: null, // 'classico', 'raffica', 'buzzer', 'bonus'
  answers: {},
  scores: {},
  questionStartTime: null,
  gameStarted: false,
  // Per modalità raffica
  rafficaState: null,
  // Per modalità buzzer
  buzzerPressed: null,
  buzzerLocked: false
};

io.on('connection', (socket) => {
  console.log('Nuovo client connesso:', socket.id);

  // Admin si connette
  socket.on('admin_connect', () => {
    socket.join('admin');
    socket.emit('game_state', gameState);
    console.log('Admin connesso');
  });

  // Squadra si registra
  socket.on('register_team', (teamName) => {
    gameState.teams[socket.id] = {
      id: socket.id,
      name: teamName,
      connectedAt: Date.now()
    };
    gameState.scores[socket.id] = 0;
    
    socket.emit('registration_success', { teamId: socket.id, teamName });
    io.to('admin').emit('team_joined', gameState.teams);
    io.emit('scores_update', gameState.scores);
    
    console.log(`Squadra registrata: ${teamName}`);
  });

  // ============ MODALITÀ CLASSICA ============
  socket.on('start_question', (question) => {
    gameState.currentQuestion = question;
    gameState.currentMode = 'classico';
    gameState.answers = {};
    gameState.questionStartTime = Date.now();
    gameState.buzzerPressed = null;
    gameState.buzzerLocked = false;
    
    io.emit('new_question', {
      id: question.id,
      domanda: question.domanda,
      risposte: question.risposte,
      startTime: gameState.questionStartTime,
      mode: 'classico',
      categoria: question.categoria
    });
    
    console.log('Nuova domanda classica:', question.domanda);
  });

  // ============ MODALITÀ RAFFICA ============
  socket.on('start_raffica', (rafficaData) => {
    gameState.currentMode = 'raffica';
    gameState.rafficaState = {
      nome: rafficaData.nome,
      domande: rafficaData.domande,
      currentIndex: 0,
      teamAnswers: {}, // {teamId: [{correct: true/false, time: ms}, ...]}
      puntiBase: rafficaData.puntiBase,
      bonusSerie: rafficaData.bonusSerie
    };

    // Avvia prima domanda
    startRafficaQuestion(0);
    
    console.log('Raffica avviata:', rafficaData.nome);
  });

  function startRafficaQuestion(index) {
    const domanda = gameState.rafficaState.domande[index];
    gameState.currentQuestion = domanda;
    gameState.answers = {};
    gameState.questionStartTime = Date.now();

    io.emit('raffica_question', {
      domanda: domanda.domanda,
      risposte: domanda.risposte,
      index: index,
      total: gameState.rafficaState.domande.length,
      startTime: gameState.questionStartTime
    });
  }

  socket.on('raffica_answer', (data) => {
    if (gameState.currentMode !== 'raffica') return;
    
    const answerTime = Date.now();
    const timeElapsed = (answerTime - gameState.questionStartTime) / 1000;
    const currentQuestion = gameState.currentQuestion;
    const isCorrect = data.answer === currentQuestion.corretta;

    if (!gameState.rafficaState.teamAnswers[socket.id]) {
      gameState.rafficaState.teamAnswers[socket.id] = [];
    }

    gameState.rafficaState.teamAnswers[socket.id].push({
      correct: isCorrect,
      time: timeElapsed
    });

    gameState.answers[socket.id] = {
      teamName: gameState.teams[socket.id]?.name,
      answer: data.answer,
      timeElapsed: timeElapsed.toFixed(2),
      isCorrect
    };

    io.to('admin').emit('answer_received', {
      teamId: socket.id,
      teamName: gameState.teams[socket.id]?.name,
      answer: data.answer,
      timeElapsed: timeElapsed.toFixed(2),
      isCorrect
    });

    socket.emit('answer_submitted');
  });

  socket.on('next_raffica_question', () => {
    const nextIndex = gameState.rafficaState.currentIndex + 1;
    
    if (nextIndex < gameState.rafficaState.domande.length) {
      gameState.rafficaState.currentIndex = nextIndex;
      startRafficaQuestion(nextIndex);
    } else {
      // Fine raffica, calcola punteggi
      endRaffica();
    }
  });

  function endRaffica() {
    const results = [];
    const teamAnswers = gameState.rafficaState.teamAnswers;

    Object.keys(teamAnswers).forEach(teamId => {
      const answers = teamAnswers[teamId];
      let correctCount = 0;
      let totalTime = 0;
      let serie = 0;
      let maxSerie = 0;

      answers.forEach(ans => {
        if (ans.correct) {
          correctCount++;
          serie++;
          maxSerie = Math.max(maxSerie, serie);
        } else {
          serie = 0;
        }
        totalTime += ans.time;
      });

      const avgTime = totalTime / answers.length;
      let points = correctCount * gameState.rafficaState.puntiBase;
      
      // Bonus per serie complete
      if (correctCount === 5) {
        points += gameState.rafficaState.bonusSerie;
      }

      // Bonus velocità media
      const speedBonus = Math.max(0, 25 - (avgTime * 2));
      points += Math.round(speedBonus);

      gameState.scores[teamId] += points;

      results.push({
        teamId,
        teamName: gameState.teams[teamId]?.name,
        correctCount,
        avgTime: avgTime.toFixed(2),
        points
      });
    });

    results.sort((a, b) => b.points - a.points);

    io.emit('raffica_results', {
      results,
      scores: gameState.scores
    });

    gameState.currentMode = null;
    gameState.rafficaState = null;
  }

  // ============ MODALITÀ BUZZER ============
  socket.on('start_buzzer', (question) => {
    gameState.currentQuestion = question;
    gameState.currentMode = 'buzzer';
    gameState.answers = {};
    gameState.questionStartTime = Date.now();
    gameState.buzzerPressed = null;
    gameState.buzzerLocked = false;
    
    io.emit('buzzer_question', {
      id: question.id,
      domanda: question.domanda,
      risposte: question.risposte,
      startTime: gameState.questionStartTime
    });
    
    console.log('Buzzer question:', question.domanda);
  });

  socket.on('buzzer_press', () => {
    if (gameState.currentMode !== 'buzzer' || gameState.buzzerLocked) return;
    
    if (!gameState.buzzerPressed) {
      gameState.buzzerPressed = {
        teamId: socket.id,
        teamName: gameState.teams[socket.id]?.name,
        time: Date.now() - gameState.questionStartTime
      };
      gameState.buzzerLocked = true;

      io.emit('buzzer_locked', gameState.buzzerPressed);
      io.to('admin').emit('buzzer_pressed', gameState.buzzerPressed);
      
      console.log(`Buzzer premuto da: ${gameState.buzzerPressed.teamName}`);
    }
  });

  socket.on('buzzer_answer', (data) => {
    if (gameState.currentMode !== 'buzzer') return;
    if (socket.id !== gameState.buzzerPressed?.teamId) return;

    const isCorrect = data.answer === gameState.currentQuestion.corretta;
    
    io.to('admin').emit('buzzer_answer_received', {
      teamId: socket.id,
      teamName: gameState.teams[socket.id]?.name,
      answer: data.answer,
      isCorrect
    });

    socket.emit('answer_submitted');
  });

  socket.on('buzzer_reveal', (data) => {
    const { teamId, isCorrect } = data;
    let points = 0;

    if (isCorrect) {
      points = gameState.currentQuestion.punti || 100;
      // Bonus per velocità buzzer
      const buzzerBonus = Math.max(0, 50 - (gameState.buzzerPressed.time / 100));
      points += Math.round(buzzerBonus);
      gameState.scores[teamId] += points;
    }

    io.emit('buzzer_results', {
      teamId,
      teamName: gameState.teams[teamId]?.name,
      isCorrect,
      points,
      correctAnswer: gameState.currentQuestion.corretta,
      scores: gameState.scores
    });

    gameState.currentMode = null;
    gameState.buzzerPressed = null;
    gameState.buzzerLocked = false;
  });

  // ============ MODALITÀ BONUS ============
  socket.on('start_bonus', (question) => {
    gameState.currentQuestion = question;
    gameState.currentMode = 'bonus';
    gameState.answers = {};
    gameState.questionStartTime = Date.now();
    
    io.emit('bonus_question', {
      id: question.id,
      domanda: question.domanda,
      risposte: question.risposte,
      startTime: gameState.questionStartTime,
      punti: question.punti,
      timerSecondi: question.timerSecondi || 10
    });
    
    console.log('Bonus question:', question.domanda);
  });

  // Squadra invia risposta (classico e bonus usano lo stesso)
  socket.on('submit_answer', (data) => {
    if (!gameState.currentQuestion) return;
    
    const answerTime = Date.now();
    const timeElapsed = (answerTime - gameState.questionStartTime) / 1000;
    
    gameState.answers[socket.id] = {
      teamName: gameState.teams[socket.id]?.name || 'Unknown',
      answer: data.answer,
      timeElapsed: timeElapsed.toFixed(2),
      timestamp: answerTime
    };
    
    io.to('admin').emit('answer_received', {
      teamId: socket.id,
      teamName: gameState.teams[socket.id]?.name,
      answer: data.answer,
      timeElapsed: timeElapsed.toFixed(2)
    });
    
    socket.emit('answer_submitted');
  });

  // Admin rivela la risposta corretta (per classico e bonus)
  socket.on('reveal_answer', (correctAnswerIndex) => {
    const question = gameState.currentQuestion;
    if (!question) return;
    
    const results = [];
    const isBonus = gameState.currentMode === 'bonus';
    
    Object.keys(gameState.answers).forEach(teamId => {
      const answer = gameState.answers[teamId];
      const isCorrect = answer.answer === correctAnswerIndex;
      
      let points = 0;
      if (isCorrect) {
        points = question.punti || 100;
        
        // Bonus velocità (diverso per domande bonus)
        if (isBonus) {
          const maxTime = question.timerSecondi || 10;
          const timeBonus = Math.max(0, (maxTime - answer.timeElapsed) * 10);
          points += Math.round(timeBonus);
        } else {
          const timeBonus = Math.max(0, 50 - (answer.timeElapsed * 2.5));
          points += Math.round(timeBonus);
        }
        
        gameState.scores[teamId] += points;
      }
      
      results.push({
        teamId,
        teamName: answer.teamName,
        answer: answer.answer,
        timeElapsed: answer.timeElapsed,
        isCorrect,
        points
      });
    });
    
    results.sort((a, b) => parseFloat(a.timeElapsed) - parseFloat(b.timeElapsed));
    
    io.emit('question_results', {
      correctAnswer: correctAnswerIndex,
      results,
      scores: gameState.scores,
      mode: gameState.currentMode
    });
    
    io.to('admin').emit('scores_update', gameState.scores);
    
    gameState.currentMode = null;
  });

  // Reset gioco
  socket.on('reset_game', () => {
    gameState = {
      teams: {},
      currentQuestion: null,
      currentMode: null,
      answers: {},
      scores: {},
      questionStartTime: null,
      gameStarted: false,
      rafficaState: null,
      buzzerPressed: null,
      buzzerLocked: false
    };
    
    io.emit('game_reset');
    console.log('Gioco resettato');
  });

  // Disconnessione
  socket.on('disconnect', () => {
    if (gameState.teams[socket.id]) {
      const teamName = gameState.teams[socket.id].name;
      delete gameState.teams[socket.id];
      delete gameState.scores[socket.id];
      
      io.to('admin').emit('team_left', { teamId: socket.id, teamName });
      console.log(`Squadra disconnessa: ${teamName}`);
    }
  });
});

// Serve static files
app.use(express.static('public'));
// Serve admin.html for /admin route
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html');
});

// Serve display.html for /display route
app.get('/display', (req, res) => {
  res.sendFile(__dirname + '/public/display.html');
});

http.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║           🎮  IL QUIZZONE - SERVER AVVIATO  🎮           ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

Server in ascolto sulla porta: ${PORT}

📱 Admin:      http://localhost:${PORT}/admin
🎯 Giocatori:  http://localhost:${PORT}/
📚 Guida:      http://localhost:${PORT}/guida.html

Modalità disponibili:
  ✅ Quiz Classico
  ⚡ Sfida a Raffica
  🔔 Buzzer Game
  💰 Domanda Bonus

Pronto per il gioco!
  `);
});
