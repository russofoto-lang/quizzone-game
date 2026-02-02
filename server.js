const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const fs = require('fs');
const io = require('socket.io')(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3001;

// --- PERCORSI ---
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

// --- STATO GIOCO AVANZATO ---
let gameState = {
  teams: {},           
  currentQuestion: null, // Contiene la domanda attiva
  questionStartTime: 0,  // Timestamp inizio domanda
  roundAnswers: [],      // Elenco risposte del round corrente
  buzzerLocked: false,
  buzzerWinner: null
};

app.use(express.static('public'));
app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(publicPath, 'display.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

io.on('connection', (socket) => {
  
  // --- ADMIN ---
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

  // --- LOGICA DI GIOCO ---
  socket.on('invia_domanda', (dati) => {
    gameState.currentQuestion = dati;
    gameState.questionStartTime = Date.now(); // AVVIA IL CRONOMETRO
    gameState.roundAnswers = []; // Resetta risposte vecchie
    gameState.buzzerLocked = false;
    gameState.buzzerWinner = null;

    io.emit('nuova_domanda', dati);
    io.emit('reset_buzzer');
    
    // Pulisce la tabella risposte dell'admin
    io.to('admin').emit('reset_round_monitor');
  });

  socket.on('rivela_risposta', () => {
    if (!gameState.currentQuestion) return;
    const q = gameState.currentQuestion;
    
    // Calcola testo soluzione
    let text = q.corretta;
    if (typeof q.corretta === 'number' && q.risposte && q.risposte[q.corretta]) {
        text = q.risposte[q.corretta];
    }
    
    io.emit('mostra_soluzione', text);
    // NON resettiamo ancora il round, così l'admin può dare i punti
  });

  // --- RISPOSTA GIOCATORI ---
  socket.on('invia_risposta', (rispGiocatore) => {
    const team = gameState.teams[socket.id];
    if (!team || !gameState.currentQuestion) return;

    // 1. Calcola Tempo
    const tempoImpiegato = ((Date.now() - gameState.questionStartTime) / 1000).toFixed(2);
    
    // 2. Verifica Correttezza (Server-Side)
    let isCorrect = false;
    const q = gameState.currentQuestion;
    
    // Se la risposta corretta è un numero (indice), troviamo la stringa
    let rispostaCorrettaStringa = q.corretta;
    if (typeof q.corretta === 'number' && q.risposte) {
        rispostaCorrettaStringa = q.risposte[q.corretta];
    }

    // Confronto (case insensitive)
    if (String(rispGiocatore).trim().toLowerCase() === String(rispostaCorrettaStringa).trim().toLowerCase()) {
        isCorrect = true;
    }

    // 3. Salva nel round
    const answerEntry = {
        teamId: socket.id,
        teamName: team.name,
        risposta: rispGiocatore,
        tempo: tempoImpiegato,
        corretta: isCorrect,
        giaPuntata: false // Per evitare doppi punti
    };
    gameState.roundAnswers.push(answerEntry);

    // 4. Invia AGGIORNAMENTO COMPLETO all'Admin (Ordinato per tempo)
    // Ordiniamo: Prima i corretti, poi per tempo
    gameState.roundAnswers.sort((a,b) => parseFloat(a.tempo) - parseFloat(b.tempo));
    
    io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
  });

  // --- BUZZER ---
  socket.on('prenoto', () => {
    if (!gameState.buzzerLocked && gameState.teams[socket.id]) {
      gameState.buzzerLocked = true;
      gameState.buzzerWinner = gameState.teams[socket.id].name;
      io.emit('buzzer_bloccato', { winner: gameState.buzzerWinner });
      io.to(socket.id).emit('prenotazione_vinta');
      
      // Notifica Admin che qualcuno ha prenotato (ma non ancora risposto)
      io.to('admin').emit('buzzer_admin_alert', gameState.buzzerWinner);
    }
  });

  // --- SETUP ---
  socket.on('login', (name) => {
    gameState.teams[socket.id] = { id: socket.id, name: name, score: 0 };
    socket.emit('login_success', { id: socket.id, name: name });
    io.emit('update_teams', Object.values(gameState.teams));
  });

  socket.on('assegna_punti', (data) => {
    if(gameState.teams[data.teamId]) {
      gameState.teams[data.teamId].score += parseInt(data.punti);
      io.emit('update_teams', Object.values(gameState.teams));
    }
  });

  socket.on('disconnect', () => {
    if(gameState.teams[socket.id]) {
      delete gameState.teams[socket.id];
      io.emit('update_teams', Object.values(gameState.teams));
    }
  });
});

http.listen(PORT, '0.0.0.0', () => console.log(`Server avviato su porta ${PORT}`));
