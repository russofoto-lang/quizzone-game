const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Stato del gioco
let gameState = {
  teams: {},           // Elenco squadre { id: {name, score, ...} }
  currentQuestion: null,
  currentMode: 'attesa', // 'classico', 'raffica', 'buzzer', 'bonus'
  buzzerLocked: false,
  buzzerWinner: null,
  scores: {}
};

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('Nuovo client:', socket.id);

  // --- 1. ADMIN ---
  socket.on('admin_connect', () => {
    socket.join('admin');
    // Invia subito la lista squadre attuale all'admin
    socket.emit('update_teams', Object.values(gameState.teams));
    console.log('Admin connesso');
  });

  // --- 2. DISPLAY (IL GRANDE SCHERMO) ---
  socket.on('display_connect', () => {
    socket.join('display');
    console.log('Display connesso');
    // Aggiorna il display con lo stato attuale
    if(gameState.currentQuestion) {
        socket.emit('mostra_domanda', gameState.currentQuestion);
    }
  });

  // --- 3. GIOCATORE (LOGIN) ---
  socket.on('login', (nickname) => {
    // Salva la squadra
    gameState.teams[socket.id] = {
      id: socket.id,
      name: nickname,
      score: 0
    };
    gameState.scores[socket.id] = 0;

    socket.emit('login_success', { id: socket.id, name: nickname });
    
    // Aggiorna TUTTI: Admin e Display vedono la nuova lista
    const teamList = Object.values(gameState.teams);
    io.to('admin').emit('update_teams', teamList);
    io.to('display').emit('update_teams', teamList);
    
    console.log(`Squadra registrata: ${nickname}`);
  });

  // --- LOGICA DI GIOCO ---

  // Admin invia domanda
  socket.on('invia_domanda', (domanda) => {
    gameState.currentQuestion = domanda;
    gameState.buzzerLocked = false;
    gameState.buzzerWinner = null;
    gameState.currentMode = domanda.modalita || 'classico'; // Imposta la modalità

    // Manda a tutti (Giocatori + Display)
    io.emit('nuova_domanda', domanda);
    
    // Reset stato buzzer sui client
    io.emit('reset_buzzer');
  });

  // Admin mostra risposta corretta (o risultato)
  socket.on('rivela_risposta', () => {
      io.to('display').emit('mostra_soluzione', gameState.currentQuestion.corretta);
      io.emit('fine_round'); // Dice ai giocatori di attendere
  });

  // --- LOGICA BUZZER (FIXATO) ---
  socket.on('prenoto', () => {
    // Se il buzzer non è bloccato e chi preme è una squadra registrata
    if (!gameState.buzzerLocked && gameState.teams[socket.id]) {
      gameState.buzzerLocked = true;
      gameState.buzzerWinner = gameState.teams[socket.id].name;
      
      console.log(`Buzzer vinto da: ${gameState.buzzerWinner}`);

      // 1. Dico CHI ha vinto a tutti (per bloccare i pulsanti grigi e mostrare su Admin/Display)
      io.emit('buzzer_bloccato', { winner: gameState.buzzerWinner });

      // 2. Dico SPECIFICAMENTE al vincitore "Hai vinto tu! Scrivi!"
      // Questo sblocca il giocatore rimasto su "In attesa"
      io.to(socket.id).emit('prenotazione_vinta'); 
    }
  });

  // --- RICEZIONE RISPOSTA (Testo o Scelta) ---
  socket.on('invia_risposta', (risposta) => {
      const team = gameState.teams[socket.id];
      if (!team) return;

      console.log(`Risposta da ${team.name}: ${risposta}`);
      
      // Manda all'admin la risposta per valutarla
      io.to('admin').emit('risposta_ricevuta', {
          teamId: socket.id,
          teamName: team.name,
          risposta: risposta
      });
  });

  // --- ASSEGNAZIONE PUNTI ---
  socket.on('assegna_punti', ({ teamId, punti }) => {
      if (gameState.teams[teamId]) {
          gameState.teams[teamId].score += punti;
          gameState.scores[teamId] = gameState.teams[teamId].score;
          
          // Aggiorna classifiche ovunque
          const teamList = Object.values(gameState.teams);
          io.to('admin').emit('update_teams', teamList);
          io.to('display').emit('update_classifica', teamList);
          io.to(teamId).emit('punti_aggiornati', gameState.teams[teamId].score);
      }
  });

  // Disconnessione
  socket.on('disconnect', () => {
    if (gameState.teams[socket.id]) {
      delete gameState.teams[socket.id];
      delete gameState.scores[socket.id];
      // Aggiorna lista admin
      io.to('admin').emit('update_teams', Object.values(gameState.teams));
    }
  });
});

http.listen(PORT, () => {
  console.log(`Server avviato su porta ${PORT}`);
});
