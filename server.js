const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const fs = require('fs');
const io = require('socket.io')(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3001;

// --- CARICAMENTO DATABASE ---
let fullDb = { categorie: {}, raffica: [], bonus: [] };

try {
  const data = fs.readFileSync(path.join(__dirname, 'public', 'domande.json'), 'utf8');
  fullDb = JSON.parse(data);
  console.log("DB Caricato: ", Object.keys(fullDb.categorie).length, "categorie,", fullDb.bonus.length, "bonus.");
} catch (err) {
  console.error("Errore JSON:", err);
}

// Stato Gioco
let gameState = {
  teams: {},           
  currentQuestion: null,
  buzzerLocked: false,
  buzzerWinner: null
};

app.use(express.static('public'));

// Rotte
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

io.on('connection', (socket) => {
  
  // --- ADMIN CONNECTION ---
  socket.on('admin_connect', () => {
    socket.join('admin');
    // Invia la STRUTTURA del gioco all'admin
    socket.emit('init_data', { 
      categories: Object.keys(fullDb.categorie), // ["storia", "sport"...]
      hasBonus: fullDb.bonus.length > 0,
      hasRaffica: fullDb.raffica.length > 0,
      teams: Object.values(gameState.teams)
    });
  });

  // Admin chiede le domande di una sezione specifica
  socket.on('get_questions', (payload) => {
    // payload = { type: 'categoria' | 'bonus' | 'raffica', key: 'storia' (opzionale) }
    
    let questionsToSend = [];

    if (payload.type === 'categoria') {
      questionsToSend = fullDb.categorie[payload.key] || [];
    } else if (payload.type === 'bonus') {
      questionsToSend = fullDb.bonus || [];
    } else if (payload.type === 'raffica') {
      // Per semplicità, qui mandiamo tutte le domande di tutte le raffiche in un'unica lista piatta
      // oppure potremmo far scegliere quale raffica. Qui le uniamo per test.
      fullDb.raffica.forEach(r => {
        questionsToSend = questionsToSend.concat(r.domande.map(d => ({...d, nomeRaffica: r.nome})));
      });
    }

    socket.emit('receive_questions', questionsToSend);
  });

  // --- LOGICA DI GIOCO ---
  socket.on('invia_domanda', (dati) => {
    gameState.currentQuestion = dati;
    gameState.buzzerLocked = false;
    gameState.buzzerWinner = null;
    io.emit('nuova_domanda', dati);
    io.emit('reset_buzzer');
  });

  // --- RIVELA RISPOSTA (FIX CORRETTO) ---
  socket.on('rivela_risposta', () => {
    if (!gameState.currentQuestion) return;
    
    const q = gameState.currentQuestion;
    let text = q.corretta;

    // Se la risposta è un indice numerico, convertilo in testo
    if (typeof q.corretta === 'number' && q.risposte && q.risposte[q.corretta]) {
        text = q.risposte[q.corretta];
    }
    
    io.emit('mostra_soluzione', text);
  });

  // --- BUZZER & SQUADRE ---
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
    }
  });

  socket.on('invia_risposta', (risp) => {
    const t = gameState.teams[socket.id];
    if(t) io.to('admin').emit('risposta_ricevuta', { teamName: t.name, teamId: socket.id, risposta: risp });
  });

  socket.on('assegna_punti', (data) => {
    if(gameState.teams[data.teamId]) {
      gameState.teams[data.teamId].score += data.punti;
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

http.listen(PORT, '0.0.0.0', () => console.log(`Server su porta ${PORT}`));
