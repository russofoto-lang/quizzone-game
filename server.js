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
    console.log("✅ DB Caricato Correttamente.");
  }
} catch (e) { console.error("❌ Errore Caricamento JSON:", e.message); }

// --- STATO GIOCO ---
let gameState = {
  teams: {},           
  currentQuestion: null, 
  questionStartTime: 0,
  roundAnswers: [], 
  buzzerQueue: [],      
  buzzerLocked: true    
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
    socket.emit('receive_questions', list);
  });

  socket.on('regia_cmd', (cmd) => {
      io.emit('cambia_vista', { view: cmd, data: gameState.roundAnswers });
  });

  // --- LOGICA INVIO DOMANDA BLINDATA ---
  socket.on('invia_domanda', (dati) => {
    // Il Server tiene la versione originale (con la risposta)
    gameState.currentQuestion = JSON.parse(JSON.stringify(dati));
    gameState.questionStartTime = Date.now();
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = (dati.modalita === 'buzzer'); 

    // Creiamo la versione "PULITA" per i giocatori
    let datiPerClient = {
        id: dati.id,
        domanda: dati.domanda,
        modalita: dati.modalita,
        categoria: dati.categoria
    };

    // Inviamo le opzioni ABCD solo se NON è un buzzer/stima/anagramma
    if (dati.modalita !== 'buzzer' && dati.modalita !== 'stima' && dati.modalita !== 'anagramma') {
        if (dati.risposte) datiPerClient.risposte = dati.risposte;
    }

    // Al Display mandiamo tutto (tranne la risposta corretta finché non serve)
    io.emit('cambia_vista', { view: 'game' });
    io.emit('nuova_domanda', datiPerClient);
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
          let solText = "Vedi Admin";
          if(gameState.currentQuestion) {
             const q = gameState.currentQuestion;
             solText = (typeof q.corretta === 'number' && q.risposte) ? q.risposte[q.corretta] : q.corretta;
          }

          io.emit('buzzer_bloccato', { winner: winner.name });
          io.to(winner.id).emit('prenotazione_vinta'); 
          io.to('admin').emit('buzzer_admin_alert', { 
              winner: winner.name, 
              queueLen: gameState.buzzerQueue.length,
              correctAnswer: solText 
          });
      }
    }
  });

  // --- ERRORE BUZZER (Passa al prossimo) ---
  socket.on('buzzer_wrong_next', () => {
      gameState.buzzerQueue.shift();
      if(gameState.buzzerQueue.length > 0) {
          const next = gameState.buzzerQueue[0];
          let solText = gameState.currentQuestion ? gameState.currentQuestion.corretta : "---";
          io.emit('buzzer_bloccato', { winner: next.name });
          io.to(next.id).emit('prenotazione_vinta');
          io.to('admin').emit('buzzer_admin_alert', { winner: next.name, queueLen: gameState.buzzerQueue.length, correctAnswer: solText });
      } else {
          gameState.buzzerLocked = false;
          io.emit('stato_buzzer', { locked: false });
          io.emit('reset_buzzer_display'); 
          io.to('admin').emit('reset_buzzer_admin'); 
      }
  });

  // --- CORRETTO BUZZER (Assegna punti) ---
  socket.on('buzzer_correct_assign', (data) => {
      if(gameState.buzzerQueue.length > 0) {
          const winner = gameState.buzzerQueue[0];
          if(gameState.teams[winner.id]) gameState.teams[winner.id].score += parseInt(data.points);
          
          gameState.roundAnswers.push({
              teamName: winner.name, risposta: "Risposta Vocale", corretta: true, tempo: "---"
          });

          io.emit('update_teams', Object.values(gameState.teams));
          io.emit('mostra_soluzione', { 
              soluzione: gameState.currentQuestion.corretta, 
              risultati: gameState.roundAnswers 
          });
          
          gameState.buzzerQueue = [];
          io.to('admin').emit('reset_buzzer_admin');
      }
  });

  socket.on('toggle_buzzer_lock', (s) => {
      gameState.buzzerLocked = s;
      io.emit('stato_buzzer', { locked: s });
  });

  // --- RISPOSTE STANDARD ---
  socket.on('invia_risposta', (risp) => {
      const team = gameState.teams[socket.id];
      if(!team || !gameState.currentQuestion) return;
      if(gameState.roundAnswers.find(x => x.teamId === socket.id)) return;

      const q = gameState.currentQuestion;
      let isCorrect = false;
      let corrStr = String(q.corretta);
      if(typeof q.corretta==='number' && q.risposte) corrStr = q.risposte[q.corretta];

      if(String(risp).trim().toLowerCase() === String(corrStr).trim().toLowerCase()) isCorrect = true;

      gameState.roundAnswers.push({
          teamId: socket.id, teamName: team.name, risposta: risp, corretta: isCorrect,
          tempo: ((Date.now() - gameState.questionStartTime)/1000).toFixed(2)
      });
      io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
  });

  socket.on('rivela_risposta', () => {
      if (!gameState.currentQuestion) return;
      const q = gameState.currentQuestion;
      let text = (typeof q.corretta==='number' && q.risposte) ? q.risposte[q.corretta] : q.corretta;
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
      gameState.teams={}; gameState.roundAnswers=[]; gameState.buzzerQueue=[];
      io.emit('force_reload');
  });

  socket.on('login', (n) => {
      gameState.teams[socket.id]={id:socket.id, name:n, score:0};
      socket.emit('login_success', {id:socket.id, name:n});
      io.emit('update_teams', Object.values(gameState.teams));
  });
  
  socket.on('disconnect', () => {
      if(gameState.teams[socket.id]) {
          delete gameState.teams[socket.id];
          io.emit('update_teams', Object.values(gameState.teams));
      }
  });
});

http.listen(PORT, '0.0.0.0', () => console.log(`Server Siponto Forever Young Pronto!`));
