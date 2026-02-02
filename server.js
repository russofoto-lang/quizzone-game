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
  buzzerLocked: false,
  buzzerWinner: null
};

app.use(express.static('public'));
app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(publicPath, 'display.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

io.on('connection', (socket) => {
  
  // ADMIN SETUP
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

  // GIOCO
  socket.on('invia_domanda', (dati) => {
    gameState.currentQuestion = dati;
    gameState.questionStartTime = Date.now();
    gameState.roundAnswers = [];
    gameState.buzzerLocked = false;
    gameState.buzzerWinner = null;

    io.emit('nuova_domanda', dati);
    io.emit('reset_buzzer');
    io.to('admin').emit('reset_round_monitor');
  });

  // --- RIVELA RISPOSTA (MODIFICATO) ---
  socket.on('rivela_risposta', () => {
    if (!gameState.currentQuestion) return;
    const q = gameState.currentQuestion;
    
    // Trova testo risposta
    let text = q.corretta;
    if (typeof q.corretta === 'number' && q.risposte && q.risposte[q.corretta]) {
        text = q.risposte[q.corretta];
    }
    
    // Ordina i risultati per tempo
    gameState.roundAnswers.sort((a,b) => parseFloat(a.tempo) - parseFloat(b.tempo));

    // Manda al Display SIA la soluzione SIA la lista di chi ha indovinato
    io.emit('mostra_soluzione', {
        soluzione: text,
        risultati: gameState.roundAnswers
    });
  });

  // --- RISPOSTA GIOCATORI ---
  socket.on('invia_risposta', (rispGiocatore) => {
    const team = gameState.teams[socket.id];
    if (!team || !gameState.currentQuestion) return;

    // Evita risposte doppie
    if(gameState.roundAnswers.find(a => a.teamId === socket.id)) return;

    const tempoImpiegato = ((Date.now() - gameState.questionStartTime) / 1000).toFixed(2);
    const q = gameState.currentQuestion;
    
    // Verifica Correttezza
    let isCorrect = false;
    let rispostaCorrettaStringa = q.corretta;
    if (typeof q.corretta === 'number' && q.risposte) {
        rispostaCorrettaStringa = q.risposte[q.corretta];
    }
    if (String(rispGiocatore).trim().toLowerCase() === String(rispostaCorrettaStringa).trim().toLowerCase()) {
        isCorrect = true;
    }

    const answerEntry = {
        teamId: socket.id,
        teamName: team.name,
        risposta: rispGiocatore,
        tempo: tempoImpiegato,
        corretta: isCorrect
    };
    gameState.roundAnswers.push(answerEntry);
    
    // Aggiorna Admin in tempo reale
    gameState.roundAnswers.sort((a,b) => parseFloat(a.tempo) - parseFloat(b.tempo));
    io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
  });

  // --- ASSEGNAZIONE PUNTI AUTOMATICA (NUOVO) ---
  socket.on('assegna_punti_auto', () => {
      // Ordina per tempo (i più veloci primi)
      gameState.roundAnswers.sort((a,b) => parseFloat(a.tempo) - parseFloat(b.tempo));
      
      let correctCount = 0;

      gameState.roundAnswers.forEach((entry) => {
          if(entry.corretta) {
              correctCount++;
              let points = 100; // Base
              
              // Bonus Velocità
              if(correctCount === 1) points = 150; // 1° Posto
              else if(correctCount === 2) points = 125; // 2° Posto
              
              if(gameState.teams[entry.teamId]) {
                  gameState.teams[entry.teamId].score += points;
              }
          }
      });

      // Aggiorna classifica ovunque
      io.emit('update_teams', Object.values(gameState.teams));
  });

  // SETUP E BUZZER
  socket.on('login', (name) => {
    gameState.teams[socket.id] = { id: socket.id, name: name, score: 0 };
    socket.emit('login_success', { id: socket.id, name: name });
    io.emit('update_teams', Object.values(gameState.teams));
  });

  socket.on('prenoto', () => {
    if (!gameState.buzzerLocked && gameState.teams[socket.id]) {
      gameState.buzzerLocked = true;
      gameState.buzzerWinner = gameState.teams[socket.id].name;
      io.emit('buzzer_bloccato', { winner: gameState.buzzerWinner });
      io.to(socket.id).emit('prenotazione_vinta');
      io.to('admin').emit('buzzer_admin_alert', gameState.buzzerWinner);
    }
  });

  socket.on('disconnect', () => {
    if(gameState.teams[socket.id]) {
      delete gameState.teams[socket.id];
      io.emit('update_teams', Object.values(gameState.teams));
    }
  });
});

http.listen(PORT, '0.0.0.0', () => console.log(`Server su porta ${PORT}`));
