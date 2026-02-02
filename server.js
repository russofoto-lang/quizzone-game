const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const fs = require('fs');
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3001;
const publicPath = path.join(__dirname, 'public');
const jsonPath = path.join(publicPath, 'domande.json');

let fullDb = { categorie: {}, raffica: [], bonus: [], stima: [], anagramma: [] };
try {
  if (fs.existsSync(jsonPath)) {
    fullDb = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  }
} catch (e) { console.error("Errore JSON:", e.message); }

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

function inviaAggiornamentoCodaAdmin() {
    if (gameState.buzzerQueue.length > 0) {
        const winner = gameState.buzzerQueue[0];
        const codaRestante = gameState.buzzerQueue.slice(1).map(p => p.name);
        const solText = gameState.currentQuestion ? (gameState.currentQuestion.corretta || "---") : "---";
        io.to('admin').emit('buzzer_admin_alert', { 
            winner: winner.name, 
            queueLen: gameState.buzzerQueue.length,
            others: codaRestante,
            correctAnswer: solText 
        });
    }
}

io.on('connection', (socket) => {
  socket.on('admin_connect', () => {
    socket.join('admin');
    socket.emit('init_data', { 
        categories: fullDb.categorie ? Object.keys(fullDb.categorie) : [],
        teams: Object.values(gameState.teams) 
    });
  });

  socket.on('get_questions', (p) => {
    let list = [];
    if (p.type === 'categoria') list = fullDb.categorie[p.key] || [];
    else if (p.type === 'bonus') list = fullDb.bonus || [];
    else if (p.type === 'stima') list = fullDb.stima || [];
    else if (p.type === 'anagramma') list = fullDb.anagramma || [];
    socket.emit('receive_questions', list);
  });

  socket.on('invia_domanda', (d) => {
    gameState.currentQuestion = JSON.parse(JSON.stringify(d));
    gameState.questionStartTime = Date.now();
    gameState.roundAnswers = [];
    gameState.buzzerQueue = [];
    gameState.buzzerLocked = (d.modalita === 'buzzer'); 
    io.emit('cambia_vista', { view: 'game' });
    io.emit('nuova_domanda', d);
    io.emit('stato_buzzer', { locked: gameState.buzzerLocked }); 
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
          gameState.buzzerQueue.push({ id: socket.id, name: gameState.teams[socket.id].name });
      }
      if (gameState.buzzerQueue.length === 1) {
          gameState.buzzerLocked = true;
          io.emit('stato_buzzer', { locked: true });
          io.emit('buzzer_bloccato', { winner: gameState.buzzerQueue[0].name });
          io.to(gameState.buzzerQueue[0].id).emit('prenotazione_vinta');
      }
      inviaAggiornamentoCodaAdmin();
    }
  });

  socket.on('buzzer_wrong_next', () => {
    gameState.buzzerQueue.shift();
    if (gameState.buzzerQueue.length > 0) {
        const next = gameState.buzzerQueue[0];
        io.emit('buzzer_bloccato', { winner: next.name });
        io.to(next.id).emit('prenotazione_vinta');
        inviaAggiornamentoCodaAdmin();
    } else {
        gameState.buzzerLocked = false;
        io.emit('stato_buzzer', { locked: false });
        io.emit('reset_buzzer_display'); 
        io.to('admin').emit('reset_buzzer_admin'); 
    }
  });

  socket.on('buzzer_correct_assign', (data) => {
    if(gameState.buzzerQueue.length > 0) {
        const winner = gameState.buzzerQueue[0];
        if(gameState.teams[winner.id]) gameState.teams[winner.id].score += parseInt(data.points);
        gameState.roundAnswers.push({ teamName: winner.name, risposta: "Risposta Vocale", corretta: true, tempo: "---" });
        io.emit('update_teams', Object.values(gameState.teams));
        io.emit('mostra_soluzione', { soluzione: gameState.currentQuestion.corretta, risultati: gameState.roundAnswers });
        gameState.buzzerQueue = [];
        io.to('admin').emit('reset_buzzer_admin');
    }
  });

  socket.on('toggle_buzzer_lock', (s) => { gameState.buzzerLocked = s; io.emit('stato_buzzer', { locked: s }); });
  socket.on('regia_cmd', (cmd) => io.emit('cambia_vista', { view: cmd, data: gameState.roundAnswers }));
  socket.on('reset_game', () => { gameState.teams={}; gameState.roundAnswers=[]; gameState.buzzerQueue=[]; io.emit('force_reload'); });
  socket.on('login', (n) => { gameState.teams[socket.id]={id:socket.id, name:n, score:0}; socket.emit('login_success', {id:socket.id, name:n}); io.emit('update_teams', Object.values(gameState.teams)); });
  socket.on('disconnect', () => { if(gameState.teams[socket.id]) { delete gameState.teams[socket.id]; io.emit('update_teams', Object.values(gameState.teams)); } });
});

http.listen(PORT, '0.0.0.0', () => console.log(`Server Pronto su porta ${PORT}`));
