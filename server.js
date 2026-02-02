const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const fs = require('fs'); // Serve per leggere il file JSON
const io = require('socket.io')(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3001;

// --- CARICAMENTO DOMANDE ---
let questionDatabase = {};
try {
  const data = fs.readFileSync(path.join(__dirname, 'public', 'domande.json'), 'utf8');
  const json = JSON.parse(data);
  questionDatabase = json.categorie;
  console.log("Domande caricate:", Object.keys(questionDatabase));
} catch (err) {
  console.error("Errore lettura domande.json:", err);
  // Database vuoto di fallback
  questionDatabase = { "DEMO": [{ id:0, domanda:"Nessuna domanda trovata", risposte:["A","B"], corretta:0 }] };
}

// Stato del gioco
let gameState = {
  teams: {},           
  currentQuestion: null,
  buzzerLocked: false,
  buzzerWinner: null,
};

// --- CONFIGURAZIONE SERVER ---
app.use(express.static('public'));

// Rotte specifiche (Fondamentali per Render)
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- LOGICA SOCKET ---
io.on('connection', (socket) => {
  
  // --- ADMIN ---
  socket.on('admin_connect', () => {
    socket.join('admin');
    // Invia le categorie disponibili all'admin
    socket.emit('init_data', { 
      categories: Object.keys(questionDatabase),
      teams: Object.values(gameState.teams)
    });
  });

  socket.on('get_questions', (categoria) => {
    if (questionDatabase[categoria]) {
      socket.emit('receive_questions', questionDatabase[categoria]);
    }
  });

  // --- DISPLAY ---
  socket.on('display_connect', () => {
    socket.join('display');
    socket.emit('update_teams', Object.values(gameState.teams)); // Aggiorna classifica subito
  });

  // --- GIOCATORE ---
  socket.on('login', (nickname) => {
    gameState.teams[socket.id] = { id: socket.id, name: nickname, score: 0 };
    socket.emit('login_success', { id: socket.id, name: nickname });
    
    // Aggiorna tutti con la nuova classifica
    io.emit('update_teams', Object.values(gameState.teams));
  });

  // --- GESTIONE GIOCO ---
  socket.on('invia_domanda', (dati) => {
    // dati contiene: { domandaId, categoria, modalita, testoDomanda, ... }
    gameState.currentQuestion = dati;
    gameState.buzzerLocked = false;
    gameState.buzzerWinner = null;

    io.emit('nuova_domanda', dati);
    io.emit('reset_buzzer');
  });

  socket.on('rivela_risposta', () => {
    // Invia la risposta corretta (testo o indice)
    const corr = gameState.currentQuestion ? gameState.currentQuestion.corretta : "";
    io.emit('mostra_soluzione', corr);
  });

  // --- BUZZER ---
  socket.on('prenoto', () => {
    if (!gameState.buzzerLocked && gameState.teams[socket.id]) {
      gameState.buzzerLocked = true;
      gameState.buzzerWinner = gameState.teams[socket.id].name;
      io.emit('buzzer_bloccato', { winner: gameState.buzzerWinner });
      io.to(socket.id).emit('prenotazione_vinta');
    }
  });

  // --- RISPOSTA E PUNTEGGI ---
  socket.on('invia_risposta', (risposta) => {
    const team = gameState.teams[socket.id];
    if (team) {
      io.to('admin').emit('risposta_ricevuta', {
        teamId: socket.id,
        teamName: team.name,
        risposta: risposta
      });
    }
  });

  socket.on('assegna_punti', ({ teamId, punti }) => {
    if (gameState.teams[teamId]) {
      gameState.teams[teamId].score += punti;
      io.emit('update_teams', Object.values(gameState.teams)); // Aggiorna classifiche su tutti i dispositivi
    }
  });

  socket.on('disconnect', () => {
    if (gameState.teams[socket.id]) {
      delete gameState.teams[socket.id];
      io.emit('update_teams', Object.values(gameState.teams));
    }
  });
});

http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server avviato su porta ${PORT}`);
});
