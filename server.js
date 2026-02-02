const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path'); // Aggiunto per gestire meglio i percorsi
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
  currentMode: 'attesa', 
  buzzerLocked: false,
  buzzerWinner: null,
  scores: {}
};

// 1. SERVI I FILE STATICI (CSS, JS, Immagini)
app.use(express.static('public'));

// 2. ROTTE ESPLICITE (LA TUA CORREZIONE FONDAMENTALE)
// Quando uno va su sito.com/admin -> gli diamo admin.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Quando uno va su sito.com/display -> gli diamo display.html
app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

// Quando uno va sulla home -> gli diamo index.html (Giocatore)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// --- LOGICA SOCKET.IO (Il cuore del gioco) ---

io.on('connection', (socket) => {
  console.log('Client connesso:', socket.id);

  // --- ADMIN ---
  socket.on('admin_connect', () => {
    socket.join('admin');
    socket.emit('update_teams', Object.values(gameState.teams));
    console.log('Admin connesso');
  });

  // --- DISPLAY ---
  socket.on('display_connect', () => {
    socket.join('display');
    if(gameState.currentQuestion) {
        socket.emit('nuova_domanda', gameState.currentQuestion);
    }
  });

  // --- GIOCATORE (LOGIN) ---
  socket.on('login', (nickname) => {
    gameState.teams[socket.id] = {
      id: socket.id,
      name: nickname,
      score: 0
    };
    gameState.scores[socket.id] = 0;

    socket.emit('login_success', { id: socket.id, name: nickname });
    
    // Aggiorna admin e display
    io.to('admin').emit('update_teams', Object.values(gameState.teams));
    io.to('display').emit('update_teams', Object.values(gameState.teams));
  });

  // --- GESTIONE DOMANDE ---
  socket.on('invia_domanda', (domanda) => {
    gameState.currentQuestion = domanda;
    gameState.buzzerLocked = false;
    gameState.buzzerWinner = null;
    gameState.currentMode = domanda.modalita || 'classico';

    io.emit('nuova_domanda', domanda);
    io.emit('reset_buzzer');
  });

  socket.on('rivela_risposta', () => {
      io.to('display').emit('mostra_soluzione', gameState.currentQuestion ? gameState.currentQuestion.corretta : "");
      io.emit('fine_round');
  });

  // --- BUZZER LOGIC ---
  socket.on('prenoto', () => {
    if (!gameState.buzzerLocked && gameState.teams[socket.id]) {
      gameState.buzzerLocked = true;
      gameState.buzzerWinner = gameState.teams[socket.id].name;
      
      // Blocca tutti
      io.emit('buzzer_bloccato', { winner: gameState.buzzerWinner });
      // Sblocca SOLO il vincitore
      io.to(socket.id).emit('prenotazione_vinta'); 
    }
  });

  // --- RICEZIONE RISPOSTA ---
  socket.on('invia_risposta', (risposta) => {
      const team = gameState.teams[socket.id];
      if (!team) return;
      
      io.to('admin').emit('risposta_ricevuta', {
          teamId: socket.id,
          teamName: team.name,
          risposta: risposta
      });
  });

  // --- PUNTEGGI ---
  socket.on('assegna_punti', ({ teamId, punti }) => {
      if (gameState.teams[teamId]) {
          gameState.teams[teamId].score += punti;
          io.to('admin').emit('update_teams', Object.values(gameState.teams));
          io.to('display').emit('update_classifica', Object.values(gameState.teams));
      }
  });

  socket.on('disconnect', () => {
    if (gameState.teams[socket.id]) {
      delete gameState.teams[socket.id];
      io.to('admin').emit('update_teams', Object.values(gameState.teams));
    }
  });
});

// Avvio Server
http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server avviato su porta ${PORT}`);
});
