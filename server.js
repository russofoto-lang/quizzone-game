const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const fs = require('fs');
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3001;
const publicPath = path.join(__dirname, 'public');
const jsonPath = path.join(publicPath, 'domande.json');

let fullDb = { categorie: {}, raffica: [], bonus: [], stima: [], anagramma: [] };
try {
  if (fs.existsSync(jsonPath)) {
    const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    // Gestione nuova struttura con "pacchetti"
    if(rawData.pacchetti && rawData.pacchetti["1"] && rawData.pacchetti["1"].categorie) {
      fullDb.categorie = rawData.pacchetti["1"].categorie;
      fullDb.bonus = rawData.pacchetti["1"].bonus || [];
      fullDb.stima = rawData.pacchetti["1"].stima || [];
      fullDb.anagramma = rawData.pacchetti["1"].anagramma || [];
      console.log('✅ Caricato pacchetto con categorie:', Object.keys(fullDb.categorie));
    } 
    else if(rawData.categorie) {
      fullDb = rawData;
    }
    else {
      fullDb.categorie = rawData;
    }
  } else {
    console.warn('⚠️ File domande.json non trovato');
  }
} catch (e) {
  console.error("❌ Errore caricamento JSON:", e.message);
}

let gameState = {
  teams: {},  
  currentQuestion: null,
  questionStartTime: 0,
  roundAnswers: [],
  buzzerQueue: [],  
  buzzerLocked: true,
  buzzerStandalone: false,
  ruotaWinner: null,
  isPaused: false,
  customScreen: { text: "Messaggio personalizzato" },
  finaleMode: {
    active: false,
    currentQuestion: 0,
    totalQuestions: 5,
    allInBets: {},
    hideLeaderboard: false,
    allInTimeout: null  // ✅ AGGIUNTO: Riferimento al timeout
  },
  duelloMode: {
    active: false,
    attaccante: null,
    difensore: null,
    categoria: null,
    currentQuestion: 0,
    scoreAttaccante: 0,
    scoreDifensore: 0,
    currentBuzzer: null,
    waitingAnswer: false
  }
};

app.use(express.static('public'));
app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(publicPath, 'display.html')));
app.get('/preview', (req, res) => res.sendFile(path.join(publicPath, 'preview.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

// ✅ PATCH 7: Funzione helper per emit sicuri
function safeEmitToTeam(teamId, event, data) {
  if(!teamId || !gameState.teams[teamId]) {
    console.warn(`⚠️ Tentativo emit a team inesistente: ${teamId}`);
    return false;
  }
  
  const socket = io.sockets.sockets.get(teamId);
  if(!socket || !socket.connected) {
    console.warn(`⚠️ Socket disconnesso per team: ${gameState.teams[teamId]?.name}`);
    return false;
  }
  
  io.to(teamId).emit(event, data);
  return true;
}

function inviaAggiornamentoCodaAdmin() {
  if (gameState.buzzerQueue.length > 0) {
    io.to('admin').emit('buzzer_queue_full', {
      queue: gameState.buzzerQueue,
      correctAnswer: gameState.currentQuestion ? (gameState.currentQuestion.corretta || "—") : "—",
      standalone: gameState.buzzerStandalone || false
    });
  }
}

io.on('connection', (socket) => {
  socket.on('admin_connect', () => {
    socket.join('admin');
    socket.emit('init_data', {
      categories: fullDb.categorie ? Object.keys(fullDb.categorie) : [],
      teams: Object.values(gameState.teams).filter(t => !t.isPreview) // ✅ PATCH 6
    });
  });

  socket.on('get_questions', (p) => {
    let list = [];
    if (p.type === 'categoria') list = fullDb.categorie[p.key] || [];
    else if (p.type === 'bonus') list = fullDb.bonus || [];
    else if (p.type === 'stima') list = fullDb.stima || [];
    else if (p.type === 'anagramma') list = fullDb.anagramma || [];
    socket.emit('receive_questions', list);
  });

  socket.on('invia_domanda', (d) => {
    gameState.currentQuestion = JSON.parse(JSON.stringify(d));
    
    // ✅ PATCH 2: Timestamp preciso server
    const serverTime = Date.now();
    gameState.questionStartTime = serverTime;
    
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];

    if(d.modalita === 'buzzer') {
      gameState.buzzerStandalone = false;
      gameState.buzzerLocked = false;
    } else {
      gameState.buzzerLocked = true;
    }

    let datiPerClient = {
      id: d.id,
      domanda: d.domanda,
      modalita: d.modalita,
      categoria: d.categoria,
      startTime: serverTime,  // ✅ Sempre timestamp server
      serverTimestamp: serverTime  // ✅ Per calcolo offset client
    };

    if (d.modalita !== 'buzzer') {
      if (d.risposte) datiPerClient.risposte = d.risposte;
    }

    io.emit('cambia_vista', { view: 'gioco' });
    io.emit('nuova_domanda', datiPerClient);
    io.emit('stato_buzzer', { 
      locked: gameState.buzzerLocked, 
      attiva: (d.modalita === 'buzzer') 
    }); 
    io.to('admin').emit('reset_round_monitor');
  });

  socket.on('admin_punti_manuali', (data) => {
    if (gameState.teams[data.id]) {
      gameState.teams[data.id].score += parseInt(data.punti);
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview); // ✅ PATCH 6
      io.emit('update_teams', realTeams);
    }
  });

  socket.on('open_buzzer_standalone', () => {
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = false;
    gameState.buzzerStandalone = true;
    gameState.questionStartTime = Date.now();

    io.emit('cambia_vista', { view: 'gioco' });
    io.emit('buzzer_standalone_mode', { active: true });
    io.emit('stato_buzzer', { locked: false, attiva: true });
    io.emit('buzzer_queue_update', { queue: [] });

    console.log('🎵 Buzzer aperto in modalità standalone (gioco musicale)');
  });

  socket.on('prenoto', () => {
    // ✅ PATCH 1: Blocca preview
    if (gameState.teams[socket.id] && gameState.teams[socket.id].isPreview) {
      return;
    }

    if (!gameState.buzzerLocked && gameState.teams[socket.id]) {
      if (!gameState.buzzerQueue.find(p => p.id === socket.id)) {
        const reactionTime = ((Date.now() - gameState.questionStartTime) / 1000).toFixed(2);
        const position = gameState.buzzerQueue.length + 1;
        
        gameState.buzzerQueue.push({ 
          id: socket.id, 
          name: gameState.teams[socket.id].name,
          time: reactionTime,
          position: position
        });
        
        io.to(socket.id).emit('buzzer_position', { position: position, time: reactionTime });
        io.emit('buzzer_queue_update', { queue: gameState.buzzerQueue });
        inviaAggiornamentoCodaAdmin();
      }
    }
  });

  socket.on('buzzer_assign_points', (data) => {
    if(gameState.teams[data.teamId]) {
      gameState.teams[data.teamId].score += parseInt(data.points);
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview); // ✅ PATCH 6
      io.emit('update_teams', realTeams);
    }
  });

  socket.on('buzzer_wrong_next', () => {
    gameState.buzzerQueue.shift();
    if (gameState.buzzerQueue.length > 0) {
      inviaAggiornamentoCodaAdmin();
    } else {
      gameState.buzzerLocked = false;
      io.emit('stato_buzzer', { locked: false, attiva: true });
      io.emit('reset_buzzer_display');
      io.to('admin').emit('reset_buzzer_admin');
    }
  });

  socket.on('buzzer_correct_assign', (data) => {
    if(gameState.buzzerQueue.length > 0) {
      const winner = gameState.buzzerQueue[0];
      if(gameState.teams[winner.id]) gameState.teams[winner.id].score += parseInt(data.points);
      gameState.roundAnswers.push({ teamName: winner.name, risposta: "Risposta Vocale", corretta: true, tempo: winner.time || "—", punti: data.points });
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview); // ✅ PATCH 6
      io.emit('update_teams', realTeams);
      io.emit('mostra_soluzione', { soluzione: gameState.currentQuestion ? gameState.currentQuestion.corretta : "Corretto!", risultati: gameState.roundAnswers });
      gameState.buzzerQueue = [];
      io.to('admin').emit('reset_buzzer_admin');
    }
  });

  socket.on('buzzer_close', () => {
    gameState.buzzerLocked = true;
    io.emit('stato_buzzer', { locked: true, attiva: false });
  });

  socket.on('buzzer_reset', () => {
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = false;
    gameState.questionStartTime = Date.now();
    gameState.buzzerStandalone = false; // ✅ PATCH 4: Reset flag standalone
    
    io.emit('buzzer_queue_update', { queue: [] });
    io.emit('stato_buzzer', { locked: false, attiva: true });
    io.to('admin').emit('buzzer_queue_full', { queue: [], correctAnswer: "—" });
    io.emit('reset_buzzer_display');
    console.log('🔄 Buzzer resettato completamente');
  });

  socket.on('reset_displays', () => {
    gameState.currentQuestion = null;
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = true;
    gameState.buzzerStandalone = false;
    gameState.ruotaWinner = null;
    gameState.duelloMode = {
      active: false,
      attaccante: null,
      difensore: null,
      categoria: null,
      currentQuestion: 0,
      scoreAttaccante: 0,
      scoreDifensore: 0,
      currentBuzzer: null,
      waitingAnswer: false
    };

    io.emit('cambia_vista', { view: 'logo' });
    io.emit('reset_client_ui');
    io.to('admin').emit('reset_round_monitor');
    console.log('🔄 Display e telefoni resettati');
  });

  socket.on('pause_game', () => {
    gameState.isPaused = true;
    const sortedTeams = Object.values(gameState.teams).filter(t => !t.isPreview).sort((a,b) => b.score - a.score); // ✅ PATCH 6
    io.emit('game_paused', { teams: sortedTeams });
    io.emit('cambia_vista', { view: 'pausa', data: { teams: sortedTeams } });
    console.log('⏸️ Gioco in pausa');
  });

  socket.on('resume_game', () => {
    gameState.isPaused = false;
    io.emit('game_resumed');
    io.emit('cambia_vista', { view: 'logo' });
    console.log('▶️ Gioco ripreso');
  });

  socket.on('save_custom_screen', (data) => {
    gameState.customScreen.text = data.text || "Messaggio personalizzato";
    console.log('💾 Schermata custom salvata:', gameState.customScreen.text);
  });

  socket.on('show_custom_screen', () => {
    io.emit('cambia_vista', {
      view: 'custom',
      data: {
        text: gameState.customScreen.text,
        timestamp: Date.now()
      }
    });
    console.log('📺 Mostro schermata custom:', gameState.customScreen.text);
  });

  socket.on('show_winner', () => {
    const sortedTeams = Object.values(gameState.teams).filter(t => !t.isPreview).sort((a,b) => b.score - a.score); // ✅ PATCH 6
    const winner = sortedTeams[0] || null;

    if(winner) {
      console.log(`🎉 Mostro vincitore: ${winner.name} con ${winner.score} punti`);
      io.emit('cambia_vista', { 
        view: 'winner',
        data: { 
          winnerName: winner.name,
          winnerScore: winner.score,
          teams: sortedTeams
        }
      });
    }
  });

  // ============ SFIDA FINALE ============

  socket.on('show_finale_explanation', () => {
    io.emit('cambia_vista', { view: 'finale_explanation' });
    console.log('📋 Mostro spiegazione Sfida Finale');
  });

  socket.on('start_finale', () => {
    gameState.finaleMode.active = true;
    gameState.finaleMode.currentQuestion = 0;
    gameState.finaleMode.hideLeaderboard = true;
    gameState.finaleMode.allInBets = {};

    io.emit('finale_started', { 
      totalQuestions: gameState.finaleMode.totalQuestions 
    });
    console.log('🔥 Sfida Finale INIZIATA');
  });

  socket.on('invia_domanda_finale', (d) => {
    gameState.finaleMode.currentQuestion++;
    const isAllIn = gameState.finaleMode.currentQuestion === 1;

    gameState.currentQuestion = JSON.parse(JSON.stringify(d));
    gameState.questionStartTime = Date.now();
    gameState.roundAnswers = [];

    if(isAllIn) {
      gameState.finaleMode.allInBets = {};
      
      io.emit('cambia_vista', { view: 'allin_betting' });
      io.emit('show_allin_betting', {
        finaleQuestion: gameState.finaleMode.currentQuestion,
        totalFinaleQuestions: gameState.finaleMode.totalQuestions
      });
      
      console.log(`💰 ALL IN - Fase scommesse`);
      
      // ✅ PATCH 3: Timeout automatico 30 secondi
      if(gameState.finaleMode.allInTimeout) {
        clearTimeout(gameState.finaleMode.allInTimeout);
      }
      
      gameState.finaleMode.allInTimeout = setTimeout(() => {
        const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
        const betsCount = Object.keys(gameState.finaleMode.allInBets).length;
        
        if(betsCount < realTeams.length) {
          console.log(`⏰ Timeout ALL IN - Auto-scommessa 0 per squadre mancanti`);
          
          realTeams.forEach(team => {
            if(!gameState.finaleMode.allInBets[team.id]) {
              gameState.finaleMode.allInBets[team.id] = 0;
            }
          });
          
          const newStartTime = Date.now();
          gameState.questionStartTime = newStartTime;
          
          io.emit('show_allin_question', {
            domanda: gameState.currentQuestion.domanda,
            risposte: gameState.currentQuestion.risposte,
            categoria: gameState.currentQuestion.categoria,
            startTime: newStartTime,
            serverTimestamp: newStartTime // ✅ PATCH 2
          });
        }
      }, 30000);
      
    } else {
      let datiPerClient = {
        id: d.id,
        domanda: d.domanda,
        modalita: 'finale',
        categoria: d.categoria,
        startTime: gameState.questionStartTime,
        serverTimestamp: gameState.questionStartTime, // ✅ PATCH 2
        finaleQuestion: gameState.finaleMode.currentQuestion,
        totalFinaleQuestions: gameState.finaleMode.totalQuestions,
        risposte: d.risposte
      };

      io.emit('nuova_domanda', datiPerClient);
      console.log(`🔥 Domanda finale ${gameState.finaleMode.currentQuestion}/5`);
    }

    io.to('admin').emit('reset_round_monitor');
  });

  socket.on('show_allin_question', () => {
    if(!gameState.currentQuestion) return;

    const newStartTime = Date.now();
    gameState.questionStartTime = newStartTime;
    
    let datiPerClient = {
      id: gameState.currentQuestion.id,
      domanda: gameState.currentQuestion.domanda,
      modalita: 'allin_question',
      categoria: gameState.currentQuestion.categoria,
      startTime: newStartTime,
      serverTimestamp: newStartTime, // ✅ PATCH 2
      finaleQuestion: gameState.finaleMode.currentQuestion,
      totalFinaleQuestions: gameState.finaleMode.totalQuestions,
      risposte: gameState.currentQuestion.risposte
    };

    io.emit('nuova_domanda', datiPerClient);
    io.emit('cambia_vista', { view: 'gioco' });
    console.log(`💰 ALL IN - Domanda mostrata`);
  });

  socket.on('place_allin_bet', (data) => {
    if(gameState.teams[socket.id] && !gameState.teams[socket.id].isPreview) {
      gameState.finaleMode.allInBets[socket.id] = parseInt(data.amount);
      console.log(`💰 ${gameState.teams[socket.id].name} scommette ${data.amount}`);

      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
      const betsCount = Object.keys(gameState.finaleMode.allInBets).length;
      
      io.to('admin').emit('allin_bet_placed', {
        teamName: gameState.teams[socket.id].name,
        amount: data.amount,
        betsCount: betsCount,
        totalTeams: realTeams.length
      });
      
      console.log(`📊 Scommesse: ${betsCount}/${realTeams.length}`);
      
      if(betsCount >= realTeams.length && gameState.currentQuestion) {
        console.log('✅ Tutti hanno scommesso! Mostro domanda...');
        
        // ✅ Cancella timeout se tutti hanno scommesso
        if(gameState.finaleMode.allInTimeout) {
          clearTimeout(gameState.finaleMode.allInTimeout);
          gameState.finaleMode.allInTimeout = null;
        }
        
        setTimeout(() => {
          const newStartTime = Date.now();
          gameState.questionStartTime = newStartTime;
          
          io.emit('show_allin_question', {
            domanda: gameState.currentQuestion.domanda,
            risposte: gameState.currentQuestion.risposte,
            categoria: gameState.currentQuestion.categoria,
            startTime: newStartTime,
            serverTimestamp: newStartTime // ✅ PATCH 2
          });
        }, 1000);
      }
    }
  });

  socket.on('reveal_winner', () => {
    gameState.finaleMode.active = false;
    gameState.finaleMode.hideLeaderboard = false;

    const sortedTeams = Object.values(gameState.teams)
      .filter(t => !t.isPreview)
      .sort((a,b) => b.score - a.score);
    const winner = sortedTeams[0];

    io.emit('cambia_vista', { 
      view: 'winner',
      data: { 
        winnerName: winner.name,
        winnerScore: winner.score,
        teams: sortedTeams
      }
    });

    console.log(`🏆 VINCITORE RIVELATO: ${winner.name} con ${winner.score} punti!`);
  });

  socket.on('admin_force_show_allin', () => {
    if(gameState.currentQuestion) {
      const newStartTime = Date.now();
      gameState.questionStartTime = newStartTime;
      
      // ✅ Cancella timeout quando admin forza
      if(gameState.finaleMode.allInTimeout) {
        clearTimeout(gameState.finaleMode.allInTimeout);
        gameState.finaleMode.allInTimeout = null;
      }

      io.emit('show_allin_question', {
        domanda: gameState.currentQuestion.domanda,
        risposte: gameState.currentQuestion.risposte,
        categoria: gameState.currentQuestion.categoria,
        startTime: newStartTime,
        serverTimestamp: newStartTime // ✅ PATCH 2
      });
      
      console.log('👤 Admin ha forzato visualizzazione domanda ALL IN');
    }
  });

  socket.on('toggle_buzzer_lock', (s) => {
    gameState.buzzerLocked = s;
    io.emit('stato_buzzer', { locked: s, attiva: true });
  });

  socket.on('invia_risposta', (risp) => {
    const team = gameState.teams[socket.id];
    
    // ✅ PATCH 1: Blocca preview dalle risposte
    if(!team || team.isPreview || !gameState.currentQuestion) return;
    
    if(gameState.roundAnswers.find(x => x.teamId === socket.id)) return;

    const q = gameState.currentQuestion;
    let isCorrect = false;
    let corrStr = String(q.corretta);
    if(typeof q.corretta==='number' && q.risposte) corrStr = q.risposte[q.corretta];

    if(String(risp).trim().toLowerCase() === String(corrStr).trim().toLowerCase()) isCorrect = true;

    const tempoSecondi = (Date.now() - gameState.questionStartTime) / 1000;
    
    let punti = 0;
    if(isCorrect) {
      if(q.isRuotaChallenge) {
        punti = 250;
        team.score += punti;
      } else {
        const puntiBase = q.punti || 100;
        const bonusVelocita = Math.max(0, 50 - (tempoSecondi * 2.5));
        punti = puntiBase + Math.round(bonusVelocita);
        
        // ✅ PATCH 8: x2 solo per domande 2-5, non ALL IN
        if(gameState.finaleMode.active && gameState.finaleMode.currentQuestion > 1) {
          punti = punti * 2;
        }
        
        if(!team.streak) team.streak = 0;
        team.streak++;
        
        let streakBonus = 0;
        if(team.streak >= 2) streakBonus = 10;
        if(team.streak >= 3) streakBonus = 25;
        if(team.streak >= 4) streakBonus = 50;
        if(team.streak >= 5) streakBonus = 100;
        
        punti += streakBonus;
        team.score += punti;
      }
      
    } else {
      if(q.isRuotaChallenge) {
        punti = -100;
        team.score = Math.max(0, team.score - 100);
      }
      
      if(team.streak) team.streak = 0;
      
      // ✅ PATCH 8: ALL IN penalità solo per domanda 1
      if(gameState.finaleMode.active && gameState.finaleMode.currentQuestion === 1) {
        const bet = gameState.finaleMode.allInBets[socket.id] || 0;
        if(bet > 0) {
          team.score = Math.max(0, team.score - bet);
          punti = -bet;
        }
      }
    }
    
    // ✅ PATCH 8: ALL IN bonus solo per domanda 1
    if(isCorrect && gameState.finaleMode.active && gameState.finaleMode.currentQuestion === 1) {
      const bet = gameState.finaleMode.allInBets[socket.id] || 0;
      if(bet > 0) {
        team.score += bet * 2;
        punti += bet * 2;
      }
    }

    gameState.roundAnswers.push({
      teamId: socket.id, 
      teamName: team.name, 
      risposta: risp, 
      corretta: isCorrect,
      tempo: tempoSecondi.toFixed(2),
      punti: punti,
      streak: team.streak || 0
    });
    
    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview); // ✅ PATCH 6
    io.emit('update_teams', realTeams);
    io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
  });

  socket.on('regia_cmd', (cmd) => {
    io.emit('cambia_vista', { view: cmd, data: gameState.roundAnswers });
  });

  socket.on('reset_game', () => {
    gameState.teams = {};
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];
    io.emit('force_reload');
  });

  socket.on('mostra_soluzione', (data) => {
    io.emit('mostra_soluzione', {
      soluzione: data.soluzione,
      risultati: data.risultati || gameState.roundAnswers
    });
  });

  // YouTube Karaoke Events
  socket.on('play_youtube_karaoke', (data) => {
    console.log('🎤 Play karaoke YouTube:', data.videoId);
    io.emit('play_youtube_karaoke', { videoId: data.videoId });
  });

  socket.on('stop_karaoke', () => {
    console.log('⏹️ Stop karaoke');
    io.emit('stop_karaoke');
  });

  // Ruota della Fortuna Events
  socket.on('ruota_step', (data) => {
    if(data.step === 'explain') {
      console.log('🎰 Spiegazione Ruota');
      io.emit('ruota_explain');
    }

    if(data.step === 'spin') {
      console.log('🎰 Gira ruota');
      const teams = Object.values(gameState.teams).filter(t => !t.isPreview); // ✅ PATCH 6
      if(teams.length === 0) return;
      
      const winner = teams[Math.floor(Math.random() * teams.length)];
      gameState.ruotaWinner = winner;
      
      io.emit('ruota_spin', {
        teams: teams.map(t => t.name),
        winner: { id: winner.id, name: winner.name }
      });
      
      io.to('admin').emit('ruota_winner', { id: winner.id, name: winner.name });
      console.log('🎰 Estratto:', winner.name);
    }

    if(data.step === 'choice') {
      console.log('🎰 Mostra scelta a:', data.teamId);
      // ✅ PATCH 7: Emit sicuro
      safeEmitToTeam(data.teamId, 'ruota_choice', {
        options: [
          { type: 'safe', points: 50, label: '💰 50 PUNTI GRATIS' },
          { type: 'challenge', points: 250, label: '🎯 +250pt / -100pt (Domanda)' }
        ]
      });
    }

    if(data.step === 'challenge') {
      console.log('🎰 Lancia domanda sfida');
      gameState.currentQuestion = data.question;
      gameState.currentQuestion.isRuotaChallenge = true;
      gameState.questionStartTime = Date.now();
      
      const questionData = {
        id: data.question.id,
        domanda: data.question.domanda,
        risposte: data.question.risposte,
        modalita: 'quiz',
        startTime: gameState.questionStartTime,
        serverTimestamp: gameState.questionStartTime, // ✅ PATCH 2
        bonusPoints: 250
      };
      
      // ✅ PATCH 7: Emit sicuro
      safeEmitToTeam(gameState.ruotaWinner.id, 'nuova_domanda', questionData);
      
      Object.values(gameState.teams).forEach(team => {
        if(team.isPreview) {
          safeEmitToTeam(team.id, 'nuova_domanda', questionData);
        }
      });
      
      io.emit('display_question', questionData);
      io.emit('cambia_vista', { view: 'gioco' });
    }
  });

  socket.on('ruota_choice_made', (data) => {
    if(data.choice === 'safe') {
      gameState.teams[data.teamId].score += 50;
      const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview); // ✅ PATCH 6
      io.emit('update_teams', realTeams);
      io.emit('cambia_vista', { view: 'classifica_gen' });
      console.log('🎰', data.teamId, 'sceglie 50 punti sicuri');
    }
  });

  // ════════════════════════════════════════════════════════════════
  // 🔥 DUELLO RUBA-PUNTI
  // ════════════════════════════════════════════════════════════════

  socket.on('duello_start', () => {
    console.log('🔥 Inizio duello ruba-punti');

    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    if(realTeams.length < 2) {
      io.to('admin').emit('duello_error', { message: 'Servono almeno 2 squadre!' });
      return;
    }

    const attaccante = realTeams[Math.floor(Math.random() * realTeams.length)];

    gameState.duelloMode = {
      active: true,
      attaccante: { id: attaccante.id, name: attaccante.name, score: attaccante.score },
      difensore: null,
      categoria: null,
      currentQuestion: 0,
      scoreAttaccante: 0,
      scoreDifensore: 0,
      currentBuzzer: null,
      waitingAnswer: false
    };

    io.to('admin').emit('duello_attaccante', { 
      attaccante: { id: attaccante.id, name: attaccante.name } 
    });

    io.emit('duello_extraction_animation', {
      teams: realTeams.map(t => t.name),
      winner: { id: attaccante.id, name: attaccante.name }
    });

    console.log('🔥 Estratto attaccante:', attaccante.name);
  });

  socket.on('duello_show_opponent_choice', () => {
    if(!gameState.duelloMode.active || !gameState.duelloMode.attaccante) return;

    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    const sorted = realTeams.sort((a, b) => a.score - b.score);
    const lastTeam = sorted[0];

    const availableOpponents = realTeams.filter(t => 
      t.id !== gameState.duelloMode.attaccante.id && 
      t.id !== lastTeam.id
    );

    // ✅ PATCH 7: Emit sicuro
    safeEmitToTeam(gameState.duelloMode.attaccante.id, 'duello_choose_opponent', {
      opponents: availableOpponents.map(t => ({ id: t.id, name: t.name, score: t.score }))
    });

    console.log('🔥 Mostra scelta avversario a:', gameState.duelloMode.attaccante.name);
  });

  socket.on('duello_opponent_chosen', (data) => {
    if(!gameState.duelloMode.active) return;

    const difensore = gameState.teams[data.opponentId];
    if(!difensore) return;

    gameState.duelloMode.difensore = {
      id: difensore.id,
      name: difensore.name,
      score: difensore.score
    };

    io.to('admin').emit('duello_difensore_scelto', {
      difensore: { id: difensore.id, name: difensore.name }
    });

    console.log('🔥 Difensore scelto:', difensore.name);
  });

  socket.on('duello_show_category_choice', () => {
    if(!gameState.duelloMode.active || !gameState.duelloMode.attaccante) return;

    const categories = Object.keys(fullDb.categorie);

    // ✅ PATCH 7: Emit sicuro
    safeEmitToTeam(gameState.duelloMode.attaccante.id, 'duello_choose_category', {
      categories: categories
    });

    console.log('🔥 Mostra scelta categoria');
  });

  socket.on('duello_category_chosen', (data) => {
    if(!gameState.duelloMode.active) return;

    gameState.duelloMode.categoria = data.category;

    io.to('admin').emit('duello_categoria_scelta', {
      category: data.category
    });

    console.log('🔥 Categoria scelta:', data.category);
  });

  socket.on('duello_launch_question', (data) => {
    if(!gameState.duelloMode.active) return;

    gameState.duelloMode.currentQuestion++;
    gameState.currentQuestion = data.question;
    gameState.questionStartTime = Date.now();
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = false;
    gameState.duelloMode.currentBuzzer = null;
    gameState.duelloMode.waitingAnswer = false;

    const questionData = {
      id: data.question.id,
      domanda: data.question.domanda,
      modalita: 'duello_buzzer',
      categoria: gameState.duelloMode.categoria,
      startTime: gameState.questionStartTime,
      serverTimestamp: gameState.questionStartTime // ✅ PATCH 2
    };

    // ✅ PATCH 7: Emit sicuri
    safeEmitToTeam(gameState.duelloMode.attaccante.id, 'duello_question', questionData);
    safeEmitToTeam(gameState.duelloMode.difensore.id, 'duello_question', questionData);

    Object.values(gameState.teams).forEach(team => {
      if(team.isPreview) {
        safeEmitToTeam(team.id, 'duello_question', questionData);
      }
    });

    io.emit('duello_question_display', {
      question: questionData,
      attaccante: gameState.duelloMode.attaccante,
      difensore: gameState.duelloMode.difensore,
      scoreAttaccante: gameState.duelloMode.scoreAttaccante,
      scoreDifensore: gameState.duelloMode.scoreDifensore,
      questionNumber: gameState.duelloMode.currentQuestion
    });

    io.emit('cambia_vista', { view: 'duello' });

    console.log('🔥 Domanda duello', gameState.duelloMode.currentQuestion, '/', 3);
  });

  socket.on('duello_buzzer_press', (data) => {
    if(!gameState.duelloMode.active || gameState.duelloMode.waitingAnswer) return;

    const teamId = data.teamId;

    if(teamId !== gameState.duelloMode.attaccante.id && 
       teamId !== gameState.duelloMode.difensore.id) {
      return;
    }

    if(!gameState.duelloMode.currentBuzzer) {
      const team = gameState.teams[teamId];
      gameState.duelloMode.currentBuzzer = { id: teamId, name: team.name };
      gameState.duelloMode.waitingAnswer = true;
      gameState.buzzerLocked = true;
      
      const reactionTime = ((Date.now() - gameState.questionStartTime) / 1000).toFixed(2);
      
      io.emit('duello_buzzer_pressed', {
        teamId: teamId,
        teamName: team.name,
        time: reactionTime
      });
      
      io.to('admin').emit('duello_waiting_answer', {
        teamId: teamId,
        teamName: team.name,
        correctAnswer: gameState.currentQuestion.corretta
      });
      
      console.log('🔥 Buzzer premuto da:', team.name, 'in', reactionTime, 's');
    }
  });

  socket.on('duello_answer_result', (data) => {
    if(!gameState.duelloMode.active) return;

    const isCorrect = data.correct;
    const answeredBy = gameState.duelloMode.currentBuzzer;

    if(!answeredBy) return;

    if(isCorrect) {
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
      
      console.log('🔥 Punto a:', answeredBy.name, '| Score:', 
        gameState.duelloMode.scoreAttaccante, '-', gameState.duelloMode.scoreDifensore);
      
      if(gameState.duelloMode.scoreAttaccante >= 2 || gameState.duelloMode.scoreDifensore >= 2) {
        setTimeout(() => {
          finalizeDuello();
        }, 2000);
      } else {
        io.to('admin').emit('duello_next_question');
      }
      
    } else {
      const otherId = answeredBy.id === gameState.duelloMode.attaccante.id 
        ? gameState.duelloMode.difensore.id 
        : gameState.duelloMode.attaccante.id;
      
      const otherTeam = gameState.teams[otherId];
      
      io.emit('duello_wrong_answer', {
        wrongTeamId: answeredBy.id,
        wrongTeamName: answeredBy.name
      });
      
      gameState.duelloMode.currentBuzzer = { id: otherId, name: otherTeam.name };
      
      io.to('admin').emit('duello_other_can_answer', {
        teamId: otherId,
        teamName: otherTeam.name,
        correctAnswer: gameState.currentQuestion.corretta
      });
      
      console.log('🔥 Sbagliato da:', answeredBy.name, '| Può rispondere:', otherTeam.name);
    }
  });

  function finalizeDuello() {
    const attaccanteWins = gameState.duelloMode.scoreAttaccante >= 2;
    const winner = attaccanteWins ? gameState.duelloMode.attaccante : gameState.duelloMode.difensore;
    const loser = attaccanteWins ? gameState.duelloMode.difensore : gameState.duelloMode.attaccante;

    if(attaccanteWins) {
      gameState.teams[gameState.duelloMode.attaccante.id].score += 250;
      gameState.teams[gameState.duelloMode.difensore.id].score = Math.max(0, 
        gameState.teams[gameState.duelloMode.difensore.id].score - 250);
      
      console.log('🔥 ATTACCANTE VINCE! +250 a', winner.name, '| -250 a', loser.name);
    } else {
      gameState.teams[gameState.duelloMode.difensore.id].score += 100;
      console.log('🔥 DIFENSORE VINCE! +100 bonus a', winner.name);
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

    // ✅ PATCH 5: Reset completo stato gioco
    gameState.duelloMode = {
      active: false,
      attaccante: null,
      difensore: null,
      categoria: null,
      currentQuestion: 0,
      scoreAttaccante: 0,
      scoreDifensore: 0,
      currentBuzzer: null,
      waitingAnswer: false
    };

    gameState.buzzerLocked = true;
    gameState.currentQuestion = null;
    gameState.roundAnswers = [];  // ✅ AGGIUNTO
    gameState.buzzerQueue = [];   // ✅ AGGIUNTO
    
    io.emit('reset_client_ui');
  }

  socket.on('login', (n) => {
    let existingTeam = Object.values(gameState.teams).find(t => t.name === n);
    const isPreview = n === '🔍PREVIEW';

    if(existingTeam) {
      if(existingTeam.removeTimer) {
        clearTimeout(existingTeam.removeTimer);
      }
      
      const oldId = existingTeam.id;
      
      delete gameState.teams[oldId];
      gameState.teams[socket.id] = {
        id: socket.id, 
        name: n, 
        score: existingTeam.score,
        disconnected: false,
        isPreview: isPreview,
        streak: existingTeam.streak || 0
      };
      
      // ✅ PATCH 10: Aggiorna riferimenti in giochi attivi
      if(gameState.ruotaWinner && gameState.ruotaWinner.id === oldId) {
        gameState.ruotaWinner.id = socket.id;
        console.log(`🔄 Aggiornato ruotaWinner ID: ${n}`);
      }
      
      if(gameState.duelloMode.active) {
        if(gameState.duelloMode.attaccante && gameState.duelloMode.attaccante.id === oldId) {
          gameState.duelloMode.attaccante.id = socket.id;
          console.log(`🔄 Aggiornato duello attaccante ID: ${n}`);
        }
        if(gameState.duelloMode.difensore && gameState.duelloMode.difensore.id === oldId) {
          gameState.duelloMode.difensore.id = socket.id;
          console.log(`🔄 Aggiornato duello difensore ID: ${n}`);
        }
      }
      
      if(gameState.finaleMode.active && gameState.finaleMode.allInBets[oldId]) {
        gameState.finaleMode.allInBets[socket.id] = gameState.finaleMode.allInBets[oldId];
        delete gameState.finaleMode.allInBets[oldId];
        console.log(`🔄 Aggiornata scommessa ALL IN: ${n}`);
      }
      
      console.log(`✅ Riconnessione: ${n} (punteggio: ${existingTeam.score})`);
    } else {
      gameState.teams[socket.id] = {
        id: socket.id, 
        name: n, 
        score: 0, 
        disconnected: false,
        isPreview: isPreview,
        streak: 0
      };
      console.log(`🆕 Nuova squadra: ${n}${isPreview ? ' (PREVIEW ADMIN)' : ''}`);
    }

    socket.emit('login_success', {id: socket.id, name: n}); 

    const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview);
    io.emit('update_teams', realTeams); 
  });

  socket.on('disconnect', () => {
    if(gameState.teams[socket.id]) {
      const teamName = gameState.teams[socket.id].name;

      if(gameState.isPaused) {
        gameState.teams[socket.id].disconnected = true;
        console.log(`⏸️ ${teamName} disconnesso durante PAUSA - Mantenuto attivo`);
        return;
      }
      
      gameState.teams[socket.id].disconnected = true;
      console.log(`⚠️ Disconnesso: ${teamName} - Aspetto 15 minuti per riconnessione...`);
      
      gameState.teams[socket.id].removeTimer = setTimeout(() => {
        if(gameState.teams[socket.id] && gameState.teams[socket.id].disconnected) {
          console.log(`❌ Rimosso: ${teamName} (oltre 15 minuti)`);
          delete gameState.teams[socket.id];
          const realTeams = Object.values(gameState.teams).filter(t => !t.isPreview); // ✅ PATCH 6
          io.emit('update_teams', realTeams);
        }
      }, 900000);
    }
  });
});

http.listen(PORT, '0.0.0.0', () => console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║      🎮  SIPONTO FOREVER YOUNG - SERVER ONLINE  🎮       ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

Server in ascolto sulla porta: ${PORT}

📱 Admin:      http://localhost:${PORT}/admin
🎯 Giocatori:  http://localhost:${PORT}/
📺 Display:    http://localhost:${PORT}/display

✅ PATCH APPLICATE:
   ✅ Blocco Preview dalle risposte
   ✅ Sincronizzazione timer server-client
   ✅ Timeout automatico ALL IN (30 sec)
   ✅ Buzzer reset completo
   ✅ Reset duello completo
   ✅ Filtro preview dalla classifica
   ✅ Validazione emit sicuri
   ✅ Fix punti x2 in finale
   ✅ Fix memory leak timer
   ✅ Riconnessione sicura con aggiornamento ID

Pronto per il gioco!
`));
