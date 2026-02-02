const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const fs = require('fs');
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3001;
const publicPath = path.join(__dirname, 'public');
const jsonPath = path.join(publicPath, 'domande.json');

// Struttura dati per pacchetti
let fullDb = { 
  pacchetti: {
    "1": { nome: "Pacchetto Principale", categorie: {}, bonus: [], stima: [], anagramma: [] }
  }
};

// Carica i dati dal file domande.json
try {
  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (data.pacchetti) {
      fullDb.pacchetti = data.pacchetti;
      console.log(`✅ Caricati ${Object.keys(data.pacchetti).length} pacchetto/i da domande.json`);
    } else {
      console.log("⚠️  Formato vecchio di domande.json, usando pacchetto predefinito");
    }
  } else {
    console.log("❌ File domande.json non trovato nella cartella public/");
    console.log("📄 Crea il file domande.json con la struttura corretta");
  }
} catch (e) { 
  console.error("❌ Errore caricamento domande.json:", e.message);
}

let gameState = {
  teams: {},           
  currentQuestion: null, 
  questionStartTime: 0,
  roundAnswers: [], 
  buzzerQueue: [],      
  buzzerLocked: true    
};

let currentPackageId = "1"; // Pacchetto corrente

app.use(express.static('public'));
app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(publicPath, 'display.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

function inviaAggiornamentoCodaAdmin() {
    if (gameState.buzzerQueue.length > 0) {
        io.to('admin').emit('buzzer_queue_full', { 
            queue: gameState.buzzerQueue,
            correctAnswer: gameState.currentQuestion ? (gameState.currentQuestion.corretta || "---") : "---"
        });
    }
}

// Funzione per determinare e mostrare il vincitore
function mostraVincitoreFinale() {
    const teams = Object.values(gameState.teams);
    
    if (teams.length === 0) {
        console.log("Nessuna squadra registrata");
        io.emit('mostra_vincitore', { 
            name: "Nessun vincitore", 
            score: 0,
            message: "Nessuna squadra registrata!" 
        });
        return;
    }
    
    // Ordina le squadre per punteggio (decrescente)
    teams.sort((a, b) => b.score - a.score);
    
    // La prima è il vincitore
    const vincitore = teams[0];
    
    // Invia al display
    io.emit('mostra_vincitore', vincitore);
    console.log(`🎉 Vincitore: ${vincitore.name} con ${vincitore.score} punti`);
    
    // Invia anche la classifica completa
    io.emit('classifica_finale', teams);
}

io.on('connection', (socket) => {
  socket.on('admin_connect', () => {
    socket.join('admin');
    const packageList = Object.keys(fullDb.pacchetti).map(id => ({ 
      id, 
      name: fullDb.pacchetti[id].nome || `Pacchetto ${id}` 
    }));
    
    const currentPackage = fullDb.pacchetti[currentPackageId];
    socket.emit('init_data', { 
      packages: packageList,
      currentPackage: currentPackageId,
      categories: currentPackage && currentPackage.categorie ? Object.keys(currentPackage.categorie) : [],
      teams: Object.values(gameState.teams) 
    });
  });

  socket.on('select_package', (packageId) => {
    if (fullDb.pacchetti[packageId]) {
      currentPackageId = packageId;
      const currentPackage = fullDb.pacchetti[currentPackageId];
      
      // Invia l'elenco aggiornato delle categorie
      io.to('admin').emit('package_selected', { 
        packageId: currentPackageId,
        packageName: currentPackage.nome || `Pacchetto ${currentPackageId}`,
        categories: Object.keys(currentPackage.categorie)
      });
      
      console.log(`📦 Pacchetto selezionato: ${currentPackageId} - ${currentPackage.nome}`);
      console.log(`📚 Categorie caricate:`, Object.keys(currentPackage.categorie));
    }
  });

  // Nuovo evento per ottenere le categorie
  socket.on('get_categories', (data) => {
    const packageId = data.packageId || currentPackageId;
    if (fullDb.pacchetti[packageId]) {
      const currentPackage = fullDb.pacchetti[packageId];
      socket.emit('categories_list', {
        packageId: packageId,
        categories: Object.keys(currentPackage.categorie)
      });
    }
  });

  socket.on('get_questions', (p) => {
    let list = [];
    const currentPackage = fullDb.pacchetti[currentPackageId];
    if (!currentPackage) return socket.emit('receive_questions', []);

    if (p.type === 'categoria') {
      list = currentPackage.categorie[p.key] || [];
    } else if (p.type === 'bonus') list = currentPackage.bonus || [];
    else if (p.type === 'stima') list = currentPackage.stima || [];
    else if (p.type === 'anagramma') list = currentPackage.anagramma || [];
    socket.emit('receive_questions', list);
  });

  socket.on('invia_domanda', (d) => {
    gameState.currentQuestion = JSON.parse(JSON.stringify(d));
    gameState.questionStartTime = Date.now();
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];
    
    gameState.buzzerLocked = (d.modalita === 'buzzer'); 

    let datiPerClient = {
        id: d.id,
        domanda: d.domanda,
        modalita: d.modalita,
        categoria: d.categoria,
        startTime: gameState.questionStartTime
    };

    if (d.modalita !== 'buzzer') {
        if (d.risposte) datiPerClient.risposte = d.risposte;
    }

    io.emit('cambia_vista', { view: 'game' });
    io.emit('nuova_domanda', datiPerClient);
    
    io.emit('stato_buzzer', { 
        locked: gameState.buzzerLocked, 
        attiva: (d.modalita === 'buzzer') 
    }); 
    
    io.to('admin').emit('reset_round_monitor');
  });

  socket.on('admin_punti_manuali', (data) => {
    if (gameState.teams[data.id]) {
        gameState.teams[data.id].score += parseInt(data.punti);
        io.emit('update_teams', Object.values(gameState.teams));
    }
  });

  socket.on('prenoto', () => {
    if (!gameState.buzzerLocked && gameState.teams[socket.id]) {
      if (!gameState.buzzerQueue.find(p => p.id === socket.id)) {
          const reactionTime = ((Date.now() - gameState.questionStartTime) / 1000).toFixed(2);
          const position = gameState.buzzerQueue.length + 1;
          
          gameState.buzzerQueue.push({ 
              id: socket.id, 
              name: gameState.teams[socket.id].name,
              time: reactionTime,
              position: position
          });
          
          io.to(socket.id).emit('buzzer_position', { position: position, time: reactionTime });
          
          io.emit('buzzer_queue_update', { queue: gameState.buzzerQueue });
          inviaAggiornamentoCodaAdmin();
      }
    }
  });

  socket.on('buzzer_assign_points', (data) => {
    if(gameState.teams[data.teamId]) {
        gameState.teams[data.teamId].score += parseInt(data.points);
        io.emit('update_teams', Object.values(gameState.teams));
    }
  });

  socket.on('buzzer_wrong_next', () => {
    gameState.buzzerQueue.shift();
    if (gameState.buzzerQueue.length > 0) {
        inviaAggiornamentoCodaAdmin();
    } else {
        gameState.buzzerLocked = false;
        io.emit('stato_buzzer', { locked: false, attiva: true });
        io.emit('reset_buzzer_display'); 
        io.to('admin').emit('reset_buzzer_admin'); 
    }
  });

  socket.on('buzzer_correct_assign', (data) => {
    if(gameState.buzzerQueue.length > 0) {
        const winner = gameState.buzzerQueue[0];
        if(gameState.teams[winner.id]) gameState.teams[winner.id].score += parseInt(data.points);
        gameState.roundAnswers.push({ teamName: winner.name, risposta: "Risposta Vocale", corretta: true, tempo: winner.time || "---", punti: data.points });
        io.emit('update_teams', Object.values(gameState.teams));
        io.emit('mostra_soluzione', { soluzione: gameState.currentQuestion.corretta, risultati: gameState.roundAnswers });
        gameState.buzzerQueue = [];
        io.to('admin').emit('reset_buzzer_admin');
    }
  });

  socket.on('buzzer_close', () => {
    gameState.buzzerLocked = true;
    io.emit('stato_buzzer', { locked: true, attiva: false });
  });

  socket.on('toggle_buzzer_lock', (s) => { 
    gameState.buzzerLocked = s; 
    io.emit('stato_buzzer', { locked: s, attiva: true }); 
  });

  socket.on('update_answer_points', (data) => {
    const answer = gameState.roundAnswers[data.answerIndex];
    if (answer) {
        const oldPoints = answer.punti || 0;
        const newPoints = data.newPoints;
        answer.punti = newPoints;

        if (gameState.teams[answer.teamId]) {
            const diff = newPoints - oldPoints;
            gameState.teams[answer.teamId].score += diff;
            io.emit('update_teams', Object.values(gameState.teams));
        }

        io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
    }
  });

  socket.on('mostra_soluzione', (data) => {
    io.emit('mostra_soluzione', { 
        soluzione: data.soluzione, 
        risultati: gameState.roundAnswers 
    });
  });

  socket.on('invia_risposta', (risp) => {
      const team = gameState.teams[socket.id];
      if(!team || !gameState.currentQuestion) return;
      if(gameState.roundAnswers.find(x => x.teamId === socket.id)) return;

      const q = gameState.currentQuestion;
      let isCorrect = false;
      let corrStr = String(q.corretta);
      if(typeof q.corretta==='number' && q.risposte) corrStr = q.risposte[q.corretta];

      if(String(risp).trim().toLowerCase() === String(corrStr).trim().toLowerCase()) isCorrect = true;

      const tempoSecondi = (Date.now() - gameState.questionStartTime) / 1000;
      
      let punti = 0;
      if(isCorrect) {
          const puntiBase = q.punti || 100;
          const bonusVelocita = Math.max(0, 50 - (tempoSecondi * 2.5));
          punti = puntiBase + Math.round(bonusVelocita);
          
          team.score += punti;
          io.emit('update_teams', Object.values(gameState.teams));
      }

      gameState.roundAnswers.push({
          teamId: socket.id, 
          teamName: team.name, 
          risposta: risp, 
          corretta: isCorrect,
          tempo: tempoSecondi.toFixed(2),
          punti: punti
      });
      
      io.to('admin').emit('update_round_monitor', gameState.roundAnswers);
  });

  socket.on('regia_cmd', (cmd) => io.emit('cambia_vista', { view: cmd, data: gameState.roundAnswers }));
  socket.on('reset_game', () => { gameState.teams={}; gameState.roundAnswers=[]; gameState.buzzerQueue=[]; io.emit('force_reload'); });
  socket.on('login', (n) => { gameState.teams[socket.id]={id:socket.id, name:n, score:0}; socket.emit('login_success', {id:socket.id, name:n}); io.emit('update_teams', Object.values(gameState.teams)); });
  socket.on('disconnect', () => { if(gameState.teams[socket.id]) { delete gameState.teams[socket.id]; io.emit('update_teams', Object.values(gameState.teams)); } });
  
  // Evento per mostrare il vincitore finale
  socket.on('mostra_vincitore_finale', () => {
    mostraVincitoreFinale();
  });
});

http.listen(PORT, '0.0.0.0', () => console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║      🎮  SIPONTO FOREVER YOUNG - SERVER ONLINE  🎮       ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

✅ Server in ascolto sulla porta: ${PORT}

📱 Admin:      http://localhost:${PORT}/admin
🎯 Giocatori:  http://localhost:${PORT}/
📺 Display:    http://localhost:${PORT}/display

📦 Sistema a pacchetti attivo!
   Pacchetto disponibile: "Pacchetto Principale"
   Categorie: Storia, Geografia, Scienze, Cinema, Musica, Arte, Sport
   + Bonus, Stima e Anagrammi

🎉 Funzionalità vincitore aggiunta!

Pronto per il gioco!
`));
