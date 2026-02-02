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
  buzzerQueue: [],      // NUOVO: Coda di chi si prenota
  buzzerLocked: false   // Se true, nessuno può prenotarsi (fase risposta)
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

  // --- REGIA DISPLAY ---
  socket.on('regia_cmd', (comando) => {
      // comando: 'logo', 'classifica_gen', 'classifica_round', 'gioco'
      if(comando === 'classifica_round') {
          // Invia solo i dati del round corrente
          io.emit('cambia_vista', { view: 'classifica_round', data: gameState.roundAnswers });
      } else {
          io.emit('cambia_vista', { view: comando });
      }
  });

  // --- LOGICA GIOCO ---
  socket.on('invia_domanda', (dati) => {
    gameState.currentQuestion = dati;
    gameState.questionStartTime = Date.now();
    gameState.roundAnswers = [];
    gameState.buzzerQueue = []; // Reset coda
    gameState.buzzerLocked = false;

    // Forza vista gioco
    io.emit('cambia_vista', { view: 'gioco' });
    io.emit('nuova_domanda', dati);
    io.emit('reset_buzzer'); // Sblocca i tasti rossi dei giocatori
    io.to('admin').emit('reset_round_monitor');
  });

  // --- GESTIONE BUZZER AVANZATA ---
  socket.on('prenoto', () => {
    // Se la domanda è attiva e il giocatore esiste
    if (gameState.teams[socket.id]) {
      
      // Aggiungi alla coda se non c'è già
      const giaInCoda = gameState.buzzerQueue.find(p => p.id === socket.id);
      if(!giaInCoda) {
          gameState.buzzerQueue.push({ 
              id: socket.id, 
              name: gameState.teams[socket.id].name,
              time: Date.now()
          });

          // Se è il PRIMO della coda, blocca gli altri e fallo rispondere
          if (gameState.buzzerQueue.length === 1) {
              gameState.buzzerLocked = true;
              io.emit('buzzer_bloccato', { winner: gameState.buzzerQueue[0].name }); // Display mostra chi suona
              io.to(gameState.buzzerQueue[0].id).emit('prenotazione_vinta'); // Sblocca input al giocatore
              io.to('admin').emit('buzzer_admin_alert', gameState.buzzerQueue[0].name);
          }
      }
    }
  });

  // Admin segnala risposta SBAGLIATA nel buzzer -> Passa al prossimo
  socket.on('buzzer_wrong_next', () => {
      // Rimuovi il primo (che ha sbagliato)
      const errato = gameState.buzzerQueue.shift();
      
      if(gameState.buzzerQueue.length > 0) {
          // C'è un secondo in coda? Tocca a lui!
          const prossimo = gameState.buzzerQueue[0];
          
          io.emit('buzzer_bloccato', { winner: prossimo.name }); // Aggiorna Display
          io.to(prossimo.id).emit('prenotazione_vinta'); // Sblocca input al secondo
          io.to('admin').emit('buzzer_admin_alert', prossimo.name); // Aggiorna Admin
      } else {
          // Nessun altro in coda, riapri il buzzer per tutti? O chiudi?
          // Per ora resettiamo lo stato "Bloccato" permettendo nuove prenotazioni
          gameState.buzzerLocked = false;
          io.emit('reset_buzzer'); 
          io.to('admin').emit('reset_round_monitor'); // Pulisci alert admin
      }
  });

  // --- RIVELA RISPOSTA ---
  socket.on('rivela_risposta', () => {
    if (!gameState.currentQuestion) return;
    const q = gameState.currentQuestion;
    
    let text = q.corretta;
    if (typeof q.corretta === 'number' && q.risposte && q.risposte[q.corretta]) {
        text = q.risposte[q.corretta];
    } else {
        text = q.corretta.toString(); 
    }
    
    gameState.roundAnswers.sort((a,b) => parseFloat(a.tempo) - parseFloat(b.tempo));

    io.emit('mostra_soluzione', {
        soluzione: text,
        risultati: gameState.roundAnswers
    });
  });

  // --- RISPOSTA GIOCATORI ---
  socket.on('invia_risposta', (rispGiocatore) => {
    const team = gameState.teams[socket.id];
    if (!team || !gameState.currentQuestion) return;

    if(gameState.roundAnswers.find(a => a.teamId === socket.id)) return;

    const tempoImpiegato = ((Date.now() - gameState.questionStartTime) / 1000).toFixed(2);
    const q = gameState.currentQuestion;
    
    let isCorrect = false;
    let rispostaCorrettaStringa = String(q.corretta);
    if (typeof q.corretta === 'number' && q.risposte && q.risposte[q.corretta]) {
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
    
    gameState.roundAnswers.sort((a,b) => parseFloat(a.tempo) - parseFloat(b.tempo));
    io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
  });

  // --- PUNTI ---
  socket.on('assegna_punti_auto', () => {
      gameState.roundAnswers.sort((a,b) => parseFloat(a.tempo) - parseFloat(b.tempo));
      let correctCount = 0;
      gameState.roundAnswers.forEach((entry) => {
          if(entry.corretta) {
              correctCount++;
              let points = 100; 
              if(correctCount === 1) points = 150;
              else if(correctCount === 2) points = 125;
              
              if(gameState.teams[entry.teamId]) {
                  gameState.teams[entry.teamId].score += points;
              }
          }
      });
      io.emit('update_teams', Object.values(gameState.teams));
  });

  socket.on('assegna_punti', (data) => {
    if(gameState.teams[data.teamId]) {
      gameState.teams[data.teamId].score += parseInt(data.punti);
      io.emit('update_teams', Object.values(gameState.teams));
    }
  });

  // --- RESET GIOCO ---
  socket.on('reset_game', () => {
      gameState.teams = {};
      gameState.currentQuestion = null;
      gameState.roundAnswers = [];
      gameState.buzzerQueue = [];
      gameState.scores = {};
      
      // Ricarica pagina a tutti i client
      io.emit('force_reload');
      // A se stesso (admin) manda dati puliti
      socket.emit('init_data', { 
        categories: fullDb.categorie ? Object.keys(fullDb.categorie) : [],
        teams: []
      });
  });

  // SETUP
  socket.on('login', (name) => {
    gameState.teams[socket.id] = { id: socket.id, name: name, score: 0 };
    socket.emit('login_success', { id: socket.id, name: name });
    io.emit('update_teams', Object.values(gameState.teams));
  });

  socket.on('disconnect', () => {
    if(gameState.teams[socket.id]) {
      delete gameState.teams[socket.id];
      // Rimuovi dalla coda buzzer se presente
      gameState.buzzerQueue = gameState.buzzerQueue.filter(p => p.id !== socket.id);
      io.emit('update_teams', Object.values(gameState.teams));
    }
  });
});

http.listen(PORT, '0.0.0.0', () => console.log(`Server su porta ${PORT}`));
