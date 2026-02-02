const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const fs = require('fs');
const io = require('socket.io')(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3001;
const publicPath = path.join(__dirname, 'public');
const jsonPath = path.join(publicPath, 'domande.json');

// --- DATABASE ---
let fullDb = { categorie: {}, raffica: [], bonus: [], stima: [], anagramma: [] };
try {
  if (fs.existsSync(jsonPath)) {
    fullDb = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log("✅ DB Caricato.");
  }
} catch (e) { console.error("❌ Errore JSON:", e.message); }

// --- STATO GIOCO ---
let gameState = {
  teams: {},           
  currentQuestion: null, 
  questionStartTime: 0,
  roundAnswers: [], 
  buzzerQueue: [],      
  buzzerLocked: false    
};

app.use(express.static('public'));
app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(publicPath, 'display.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

io.on('connection', (socket) => {
  
  socket.on('admin_connect', () => {
    socket.join('admin');
    socket.emit('init_data', { 
      categories: fullDb.categorie ? Object.keys(fullDb.categorie) : [],
      teams: Object.values(gameState.teams)
    });
  });

  socket.on('get_questions', (payload) => {
    let list = [];
    if (payload.type === 'categoria') list = fullDb.categorie[payload.key] || [];
    else if (payload.type === 'bonus') list = fullDb.bonus || [];
    else if (payload.type === 'stima') list = fullDb.stima || [];
    else if (payload.type === 'anagramma') list = fullDb.anagramma || [];
    else if (payload.type === 'raffica' && fullDb.raffica) {
         fullDb.raffica.forEach(r => { if(r.domande) list = list.concat(r.domande); });
    }
    socket.emit('receive_questions', list);
  });

  socket.on('regia_cmd', (cmd) => {
      if(cmd === 'classifica_round') {
          io.emit('cambia_vista', { view: 'classifica_round', data: gameState.roundAnswers });
      } else {
          io.emit('cambia_vista', { view: cmd });
      }
  });

  // --- START DOMANDA (MODIFICATO PER FIX) ---
 socket.on('invia_domanda', (dati) => {
    gameState.currentQuestion = JSON.parse(JSON.stringify(dati)); // Copia profonda
    gameState.questionStartTime = Date.now();
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = (dati.modalita === 'buzzer'); 

    // Prepariamo i dati per i telefoni
    let datiPerClient = JSON.parse(JSON.stringify(dati));
    
    // Se è Anagramma o Stima, CANCELLIAMO i dati sensibili prima dell'invio
    if (dati.modalita === 'anagramma' || dati.modalita === 'stima') {
        delete datiPerClient.risposte; 
        delete datiPerClient.corretta;
    }

    io.emit('cambia_vista', { view: 'game' });
    io.emit('nuova_domanda', datiPerClient);
    io.emit('stato_buzzer', { locked: gameState.buzzerLocked }); 
    io.to('admin').emit('reset_round_monitor');
  });

  // --- BUZZER LOGIC ---
  socket.on('prenoto', () => {
    if (!gameState.buzzerLocked && gameState.teams[socket.id]) {
      if(!gameState.buzzerQueue.find(p => p.id === socket.id)) {
          gameState.buzzerQueue.push({ id: socket.id, name: gameState.teams[socket.id].name });
      }
      if (gameState.buzzerQueue.length === 1) {
          gameState.buzzerLocked = true; 
          io.emit('stato_buzzer', { locked: true }); 
          
          const winner = gameState.buzzerQueue[0];
          let solText = "";
          if(gameState.currentQuestion) {
             const q = gameState.currentQuestion;
             solText = (typeof q.corretta === 'number' && q.risposte) ? q.risposte[q.corretta] : q.corretta;
          }
          io.emit('buzzer_vinto_display', { winner: winner.name });
          io.to(winner.id).emit('prenotazione_vinta'); 
          io.to('admin').emit('buzzer_admin_alert', { winner: winner.name, queueLen: gameState.buzzerQueue.length, correctAnswer: solText });
      }
    }
  });

  socket.on('buzzer_wrong_next', () => {
      gameState.buzzerQueue.shift();
      if(gameState.buzzerQueue.length > 0) {
          const next = gameState.buzzerQueue[0];
          let solText = "";
          if(gameState.currentQuestion) solText = gameState.currentQuestion.corretta;
          io.emit('buzzer_vinto_display', { winner: next.name });
          io.to(next.id).emit('prenotazione_vinta');
          io.to('admin').emit('buzzer_admin_alert', { winner: next.name, queueLen: gameState.buzzerQueue.length, correctAnswer: solText });
      } else {
          gameState.buzzerLocked = false;
          io.emit('stato_buzzer', { locked: false });
          io.emit('reset_buzzer_display'); 
          io.to('admin').emit('reset_buzzer_admin'); 
      }
  });

  socket.on('buzzer_correct_assign', (data) => {
      if(gameState.buzzerQueue.length > 0) {
          const winner = gameState.buzzerQueue[0];
          if(gameState.teams[winner.id]) gameState.teams[winner.id].score += parseInt(data.points);
          gameState.roundAnswers.push({
              teamName: winner.name, risposta: "Buzzer", corretta: true, tempo: "0.00", punti: data.points
          });
          io.emit('update_teams', Object.values(gameState.teams));
          io.emit('mostra_soluzione', { soluzione: "RISPOSTA CORRETTA!", risultati: gameState.roundAnswers });
          gameState.buzzerQueue = [];
          io.to('admin').emit('reset_buzzer_admin');
      }
  });

  socket.on('toggle_buzzer_lock', (s) => { gameState.buzzerLocked=s; io.emit('stato_buzzer', {locked:s}); });

  // --- RISPOSTE ---
  socket.on('invia_risposta', (risp) => {
      const team = gameState.teams[socket.id];
      if(!team || !gameState.currentQuestion) return;
      if(gameState.roundAnswers.find(x => x.teamId === socket.id)) return;

      const q = gameState.currentQuestion;
      const modalita = q.modalita || 'classico';
      const tempo = ((Date.now() - gameState.questionStartTime)/1000).toFixed(2);

      // 1. ANAGRAMMA
      if (modalita === 'anagramma') {
          let isCorrect = false;
          // Verifica lato server (qui abbiamo i dati completi)
          if(q.risposte && q.risposte.some(r => String(r).toUpperCase().trim() === String(risp).toUpperCase().trim())) {
              isCorrect = true;
          }
          if (isCorrect) {
              gameState.roundAnswers.push({ teamId: socket.id, teamName: team.name, risposta: risp, corretta: true, tempo: tempo });
              team.score += (q.punti || 150);
              io.emit('update_teams', Object.values(gameState.teams));
              io.emit('mostra_soluzione', { soluzione: risp.toUpperCase(), risultati: gameState.roundAnswers });
              io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
          }
          return; 
      }

      // 2. STIMA
      if (modalita === 'stima') {
          gameState.roundAnswers.push({ teamId: socket.id, teamName: team.name, risposta: risp, corretta: false, tempo: tempo });
          io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
          return;
      }

      // 3. CLASSICO
      let isCorrect = false;
      let corrStr = String(q.corretta);
      if(typeof q.corretta==='number' && q.risposte) corrStr = q.risposte[q.corretta];
      if(String(risp).trim().toLowerCase() === String(corrStr).trim().toLowerCase()) isCorrect = true;

      gameState.roundAnswers.push({ teamId: socket.id, teamName: team.name, risposta: risp, corretta: isCorrect, tempo: tempo });
      io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
  });

  socket.on('rivela_risposta', () => {
      if (!gameState.currentQuestion) return;
      const q = gameState.currentQuestion;
      
      if (q.modalita === 'stima') {
          const target = parseInt(q.corretta);
          gameState.roundAnswers.forEach(a => {
              const val = parseInt(a.risposta);
              if (isNaN(val)) a.diff = 999999999; else a.diff = Math.abs(target - val);
              a.isStima = true; 
          });
          gameState.roundAnswers.sort((a,b) => a.diff - b.diff);
          if(gameState.roundAnswers.length > 0) gameState.roundAnswers[0].corretta = true;
          io.emit('mostra_soluzione', { soluzione: q.corretta, risultati: gameState.roundAnswers });
          return;
      }

      let text = typeof q.corretta==='number'&&q.risposte ? q.risposte[q.corretta] : q.corretta;
      io.emit('mostra_soluzione', { soluzione: text, risultati: gameState.roundAnswers });
  });

  socket.on('assegna_punti_auto', () => {
      const q = gameState.currentQuestion;
      if (q && q.modalita === 'stima') {
          if(gameState.roundAnswers.length > 0) {
              const w = gameState.roundAnswers[0];
              if(gameState.teams[w.teamId]) gameState.teams[w.teamId].score += (q.punti || 200);
          }
      } else {
          gameState.roundAnswers.forEach((e, i) => {
              if(e.corretta && gameState.teams[e.teamId]) gameState.teams[e.teamId].score += (i===0?150:(i===1?125:100));
          });
      }
      io.emit('update_teams', Object.values(gameState.teams));
  });

  socket.on('reset_game', () => {
      gameState.teams={}; gameState.scores={}; gameState.buzzerQueue=[]; gameState.roundAnswers=[];
      io.emit('force_reload');
      socket.emit('init_data', { categories:[], teams:[] });
  });

  socket.on('login', (n) => {
      gameState.teams[socket.id]={id:socket.id, name:n, score:0};
      socket.emit('login_success', {id:socket.id, name:n});
      io.emit('update_teams', Object.values(gameState.teams));
  });
  
  socket.on('disconnect', () => {
      if(gameState.teams[socket.id]) {
          delete gameState.teams[socket.id];
          gameState.buzzerQueue = gameState.buzzerQueue.filter(x => x.id !== socket.id);
          io.emit('update_teams', Object.values(gameState.teams));
      }
  });
});

http.listen(PORT, '0.0.0.0', () => console.log(`Server su porta ${PORT}`));
