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
let fullDb = { categorie: {}, raffica: [], bonus: [] };
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
  buzzerQueue: [],      // Coda ordinata di chi ha premuto
  buzzerLocked: true    // Parte bloccato
};

app.use(express.static('public'));
app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(publicPath, 'display.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

io.on('connection', (socket) => {
  
  // INIT
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
    else if (payload.type === 'raffica' && fullDb.raffica) {
         fullDb.raffica.forEach(r => { if(r.domande) list = list.concat(r.domande); });
    }
    socket.emit('receive_questions', list);
  });

  // --- REGIA ---
  socket.on('regia_cmd', (cmd) => {
      // cmd: 'logo', 'game', 'classifica_gen', 'classifica_round'
      if(cmd === 'classifica_round') {
          io.emit('cambia_vista', { view: 'classifica_round', data: gameState.roundAnswers });
      } else {
          io.emit('cambia_vista', { view: cmd });
      }
  });

  // --- START DOMANDA ---
  socket.on('invia_domanda', (dati) => {
    gameState.currentQuestion = dati;
    gameState.questionStartTime = Date.now();
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];
    
    // Se è buzzer, parte BLOCCATO (lo sblocca l'admin o automatico se preferisci)
    // Se è classico, parte sbloccato
    gameState.buzzerLocked = (dati.modalita === 'buzzer'); 

    io.emit('cambia_vista', { view: 'game' });
    io.emit('nuova_domanda', dati);
    
    // Aggiorna stato lucchetto client
    io.emit('stato_buzzer', { locked: gameState.buzzerLocked }); 
    io.to('admin').emit('reset_round_monitor');
  });

  // --- GESTIONE BUZZER LOCK ---
  socket.on('toggle_buzzer_lock', (stato) => {
      // stato: true (blocca), false (sblocca/via)
      gameState.buzzerLocked = stato;
      io.emit('stato_buzzer', { locked: stato });
  });

  // --- PRENOTAZIONE BUZZER ---
  socket.on('prenoto', () => {
    // Accetta solo se sbloccato e se squadra esiste
    if (!gameState.buzzerLocked && gameState.teams[socket.id]) {
      
      // Aggiungi in coda se non c'è
      if(!gameState.buzzerQueue.find(p => p.id === socket.id)) {
          gameState.buzzerQueue.push({ 
              id: socket.id, 
              name: gameState.teams[socket.id].name 
          });
      }

      // Se è il PRIMO, diventa il vincitore temporaneo
      if (gameState.buzzerQueue.length === 1) {
          // Blocchiamo temporaneamente gli altri (lato visuale) ma la coda continua a riempirsi in background se arrivano millesimi dopo
          // Per semplicità di gioco: Blocchiamo tutto
          gameState.buzzerLocked = true; 
          io.emit('stato_buzzer', { locked: true }); // Tutti pulsanti grigi
          
          const winner = gameState.buzzerQueue[0];
          io.emit('buzzer_vinto_display', { winner: winner.name }); // Display mostra nome
          io.to(winner.id).emit('prenotazione_vinta'); // Giocatore vede "Tocca a te"
          io.to('admin').emit('buzzer_admin_alert', { winner: winner.name, queueLen: gameState.buzzerQueue.length });
      }
    }
  });

  // --- BUZZER: RISPOSTA SBAGLIATA (NEXT) ---
  socket.on('buzzer_wrong_next', () => {
      // Rimuovi il primo
      gameState.buzzerQueue.shift();

      if(gameState.buzzerQueue.length > 0) {
          // C'è un secondo!
          const next = gameState.buzzerQueue[0];
          io.emit('buzzer_vinto_display', { winner: next.name });
          io.to(next.id).emit('prenotazione_vinta');
          io.to('admin').emit('buzzer_admin_alert', { winner: next.name, queueLen: gameState.buzzerQueue.length });
      } else {
          // Coda finita: riapri il buzzer per tutti? o chiudi round?
          // Riapriamo per permettere ad altri di prenotarsi
          gameState.buzzerLocked = false;
          io.emit('stato_buzzer', { locked: false });
          io.emit('reset_buzzer_display'); // Pulisci nome dal display
          io.to('admin').emit('reset_buzzer_admin'); // Pulisci alert admin
      }
  });

  // --- BUZZER: RISPOSTA CORRETTA (Admin da punti) ---
  socket.on('buzzer_correct_assign', (data) => {
      // data: { points: 100 }
      if(gameState.buzzerQueue.length > 0) {
          const winner = gameState.buzzerQueue[0];
          
          // Assegna punti
          if(gameState.teams[winner.id]) gameState.teams[winner.id].score += parseInt(data.points);
          
          // Salva nel round per la classifica round
          gameState.roundAnswers.push({
              teamName: winner.name,
              risposta: "(Buzzer)",
              corretta: true,
              tempo: "0.00",
              punti: data.points
          });

          io.emit('update_teams', Object.values(gameState.teams));
          io.emit('mostra_soluzione', { soluzione: "BUZZER CORRETTO!", risultati: gameState.roundAnswers });
          
          // Pulisci tutto
          gameState.buzzerQueue = [];
          io.to('admin').emit('reset_buzzer_admin');
      }
  });

  // --- RISPOSTE TESTUALI (Quiz Classico) ---
  socket.on('invia_risposta', (risp) => {
      const team = gameState.teams[socket.id];
      if(!team || !gameState.currentQuestion) return;
      if(gameState.roundAnswers.find(x => x.teamId === socket.id)) return;

      const q = gameState.currentQuestion;
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
      let text = typeof q.corretta==='number'&&q.risposte ? q.risposte[q.corretta] : q.corretta;
      io.emit('mostra_soluzione', { soluzione: text, risultati: gameState.roundAnswers });
  });

  socket.on('assegna_punti_auto', () => {
      gameState.roundAnswers.forEach((e, i) => {
          if(e.corretta && gameState.teams[e.teamId]) {
              gameState.teams[e.teamId].score += (i===0?150:(i===1?125:100));
          }
      });
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
