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
  isPaused: false,
  customScreen: { text: "Messaggio personalizzato" }
};

app.use(express.static('public'));
app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(publicPath, 'display.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

function inviaAggiornamentoCodaAdmin() {
    if (gameState.buzzerQueue.length > 0) {
        io.to('admin').emit('buzzer_queue_full', { 
            queue: gameState.buzzerQueue,
            correctAnswer: gameState.currentQuestion ? (gameState.currentQuestion.corretta || "---") : "---"
        });
    }
}

io.on('connection', (socket) => {
  socket.on('admin_connect', () => {
    socket.join('admin');
    socket.emit('init_data', { 
        categories: fullDb.categorie ? Object.keys(fullDb.categorie) : [],
        teams: Object.values(gameState.teams) 
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
    gameState.questionStartTime = Date.now();
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];
    
    gameState.buzzerLocked = (d.modalita === 'buzzer'); 

    let datiPerClient = {
        id: d.id,
        domanda: d.domanda,
        modalita: d.modalita,
        categoria: d.categoria,
        startTime: gameState.questionStartTime
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
        io.emit('update_teams', Object.values(gameState.teams));
    }
  });

  // BUZZER STANDALONE - Apre buzzer SENZA domanda (per gioco musicale)
  socket.on('open_buzzer_standalone', () => {
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = false;
    gameState.questionStartTime = Date.now();
    
    io.emit('buzzer_standalone_mode', { active: true });
    io.emit('stato_buzzer', { locked: false, attiva: true });
    console.log('🎵 Buzzer aperto in modalità standalone (gioco musicale)');
  });

  socket.on('prenoto', () => {
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
        io.emit('update_teams', Object.values(gameState.teams));
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
        gameState.roundAnswers.push({ teamName: winner.name, risposta: "Risposta Vocale", corretta: true, tempo: winner.time || "---", punti: data.points });
        io.emit('update_teams', Object.values(gameState.teams));
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
    io.emit('buzzer_queue_update', { queue: [] });
    io.emit('stato_buzzer', { locked: false, attiva: true });
    io.to('admin').emit('buzzer_queue_full', { queue: [], correctAnswer: "---" });
    io.emit('reset_buzzer_display');
    console.log('🔄 Buzzer resettato per nuovo round');
  });

  // RESET DISPLAY COMPLETO
  socket.on('reset_displays', () => {
    gameState.currentQuestion = null;
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = true;
    
    io.emit('cambia_vista', { view: 'logo' });
    io.emit('reset_client_ui');
    io.to('admin').emit('reset_round_monitor');
    console.log('🔄 Display e telefoni resettati');
  });

  socket.on('pause_game', () => {
    gameState.isPaused = true;
    const sortedTeams = Object.values(gameState.teams).sort((a,b) => b.score - a.score);
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

  // CELEBRAZIONE VINCITORE
  socket.on('show_winner', () => {
    const sortedTeams = Object.values(gameState.teams).sort((a,b) => b.score - a.score);
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

  socket.on('toggle_buzzer_lock', (s) => { 
    gameState.buzzerLocked = s; 
    io.emit('stato_buzzer', { locked: s, attiva: true }); 
  });

  socket.on('invia_risposta', (risp) => {
      const team = gameState.teams[socket.id];
      if(!team || !gameState.currentQuestion) return;
      if(gameState.roundAnswers.find(x => x.teamId === socket.id)) return;

      const q = gameState.currentQuestion;
      let isCorrect = false;
      let corrStr = String(q.corretta);
      if(typeof q.corretta==='number' && q.risposte) corrStr = q.risposte[q.corretta];

      if(String(risp).trim().toLowerCase() === String(corrStr).trim().toLowerCase()) isCorrect = true;

      const tempoSecondi = (Date.now() - gameState.questionStartTime) / 1000;
      
      let punti = 0;
      if(isCorrect) {
          const puntiBase = q.punti || 100;
          // Bonus velocità lineare che decresce
          const bonusVelocita = Math.max(0, 50 - (tempoSecondi * 2.5));
          punti = puntiBase + Math.round(bonusVelocita);
          
          team.score += punti;
          io.emit('update_teams', Object.values(gameState.teams));
      }

      gameState.roundAnswers.push({
          teamId: socket.id, 
          teamName: team.name, 
          risposta: risp, 
          corretta: isCorrect,
          tempo: tempoSecondi.toFixed(2),
          punti: punti
      });
      
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

  socket.on('login', (n) => {
    let existingTeam = Object.values(gameState.teams).find(t => t.name === n);
    
    if(existingTeam) {
        if(existingTeam.removeTimer) {
            clearTimeout(existingTeam.removeTimer);
        }
        delete gameState.teams[existingTeam.id];
        gameState.teams[socket.id] = {
            id: socket.id, 
            name: n, 
            score: existingTeam.score,
            disconnected: false
        };
        console.log(`✅ Riconnessione: ${n} (punteggio: ${existingTeam.score})`);
    } else {
        gameState.teams[socket.id] = {id:socket.id, name:n, score:0, disconnected: false};
        console.log(`🆕 Nuova squadra: ${n}`);
    }
    
    socket.emit('login_success', {id:socket.id, name:n}); 
    io.emit('update_teams', Object.values(gameState.teams)); 
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
                io.emit('update_teams', Object.values(gameState.teams));
            }
        }, 900000); // 15 minuti
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

✅ Bonus velocità lineare attivo!
✅ Buzzer standalone per giochi musicali!
✅ Reset display completo!
✅ Celebrazione vincitore con confetti!
✅ Grace period 15 minuti!

Pronto per il gioco!
`));
