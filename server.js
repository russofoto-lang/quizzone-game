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
    else if (payload.type === 'stima') list = fullDb.stima || []; // NUOVO
    else if (payload.type === 'anagramma') list = fullDb.anagramma || []; // NUOVO
    else if (payload.type === 'raffica' && fullDb.raffica) {
         fullDb.raffica.forEach(r => { if(r.domande) list = list.concat(r.domande); });
    }
    socket.emit('receive_questions', list);
  });

  socket.on('regia_cmd', (cmd) => {
      if(cmd === 'classifica_round') io.emit('cambia_vista', { view: 'classifica_round', data: gameState.roundAnswers });
      else io.emit('cambia_vista', { view: cmd });
  });

  // --- START DOMANDA ---
  socket.on('invia_domanda', (dati) => {
    gameState.currentQuestion = dati;
    gameState.questionStartTime = Date.now();
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];
    // Buzzer attivo solo se modalità è buzzer O anagramma (chi prima scrive vince)
    gameState.buzzerLocked = (dati.modalita === 'buzzer'); 

    io.emit('cambia_vista', { view: 'game' });
    io.emit('nuova_domanda', dati);
    io.emit('stato_buzzer', { locked: gameState.buzzerLocked }); 
    io.to('admin').emit('reset_round_monitor');
  });

  // --- GESTIONE PRENOTAZIONE ---
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
             if(typeof q.corretta === 'number' && q.risposte) solText = q.risposte[q.corretta];
             else solText = q.corretta;
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
          if(gameState.currentQuestion) {
             const q = gameState.currentQuestion;
             solText = (typeof q.corretta === 'number' && q.risposte) ? q.risposte[q.corretta] : q.corretta;
          }
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
              teamName: winner.name, risposta: "Buzzer Vinto", corretta: true, tempo: "0.00", punti: data.points
          });
          io.emit('update_teams', Object.values(gameState.teams));
          
          let solText = "RISPOSTA CORRETTA!";
          if(gameState.currentQuestion) {
              const q = gameState.currentQuestion;
              solText = (typeof q.corretta === 'number' && q.risposte) ? q.risposte[q.corretta] : q.corretta;
          }
          io.emit('mostra_soluzione', { soluzione: solText, risultati: gameState.roundAnswers });
          gameState.buzzerQueue = [];
          io.to('admin').emit('reset_buzzer_admin');
      }
  });

  // --- LOGICA RISPOSTA GENERALE (Quiz, Stima, Anagramma) ---
  socket.on('invia_risposta', (risp) => {
      const team = gameState.teams[socket.id];
      if(!team || !gameState.currentQuestion) return;
      if(gameState.roundAnswers.find(x => x.teamId === socket.id)) return; // Già risposto

      const q = gameState.currentQuestion;
      const modalita = q.modalita || 'classico';

      // 1. ANAGRAMMA (Vince il primo che scrive la parola esatta)
      if (modalita === 'anagramma') {
          // Controlla se una delle risposte accettate è uguale
          let isCorrect = false;
          const userText = String(risp).trim().toUpperCase();
          if(q.risposte && q.risposte.some(r => r.toUpperCase() === userText)) isCorrect = true;

          if (isCorrect) {
              // Ha indovinato! Ferma tutto come il buzzer
              const tempo = ((Date.now() - gameState.questionStartTime)/1000).toFixed(2);
              gameState.roundAnswers.push({
                  teamId: socket.id, teamName: team.name, risposta: risp, corretta: true, tempo: tempo
              });
              
              // Assegna subito punti e chiudi
              team.score += (q.punti || 150);
              io.emit('update_teams', Object.values(gameState.teams));
              io.emit('mostra_soluzione', { soluzione: userText, risultati: gameState.roundAnswers });
              // Notifica admin
              io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
          }
          return; // Per l'anagramma salviamo solo chi indovina
      }

      // 2. STIMA (Salviamo tutto, calcoliamo alla fine)
      if (modalita === 'stima') {
          gameState.roundAnswers.push({
              teamId: socket.id, teamName: team.name, risposta: risp, corretta: false, // Per ora false, calcoliamo dopo
              tempo: ((Date.now() - gameState.questionStartTime)/1000).toFixed(2)
          });
          io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
          return;
      }

      // 3. CLASSICO (Giusto/Sbagliato immediato)
      let isCorrect = false;
      let corrStr = String(q.corretta);
      if(typeof q.corretta==='number' && q.risposte) corrStr = q.risposte[q.corretta];

      if(String(risp).trim().toLowerCase() === String(corrStr).trim().toLowerCase()) isCorrect = true;

      const entry = {
          teamId: socket.id, teamName: team.name, risposta: risp, corretta: isCorrect,
          tempo: ((Date.now() - gameState.questionStartTime)/1000).toFixed(2)
      };
      gameState.roundAnswers.push(entry);
      gameState.roundAnswers.sort((a,b) => a.tempo - b.tempo);
      io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
  });

  socket.on('rivela_risposta', () => {
      if (!gameState.currentQuestion) return;
      const q = gameState.currentQuestion;
      
      // LOGICA SPECIALE STIMA: Calcola il vincitore
      if (q.modalita === 'stima') {
          const target = parseInt(q.corretta);
          
          // Calcola la differenza per ogni risposta
          gameState.roundAnswers.forEach(a => {
              const val = parseInt(a.risposta);
              if (isNaN(val)) a.diff = 999999999; // Chi scrive testo perde
              else a.diff = Math.abs(target - val);
          });

          // Ordina dal più vicino al più lontano
          gameState.roundAnswers.sort((a,b) => a.diff - b.diff);

          // Segna il primo come corretto (Vincitore)
          if(gameState.roundAnswers.length > 0) gameState.roundAnswers[0].corretta = true;
          
          io.emit('mostra_soluzione', { soluzione: q.corretta, risultati: gameState.roundAnswers });
          return;
      }

      // Logica Standard
      let text = typeof q.corretta==='number'&&q.risposte ? q.risposte[q.corretta] : q.corretta;
      io.emit('mostra_soluzione', { soluzione: text, risultati: gameState.roundAnswers });
  });

  socket.on('assegna_punti_auto', () => {
      // Per la STIMA, il primo della lista (già ordinata per differenza) vince
      const q = gameState.currentQuestion;
      
      if (q && q.modalita === 'stima') {
          if(gameState.roundAnswers.length > 0) {
              const winner = gameState.roundAnswers[0];
              if(gameState.teams[winner.teamId]) gameState.teams[winner.teamId].score += (q.punti || 200);
          }
      } else {
          // Standard
          gameState.roundAnswers.forEach((e, i) => {
              if(e.corretta && gameState.teams[e.teamId]) {
                  gameState.teams[e.teamId].score += (i===0?150:(i===1?125:100));
              }
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
