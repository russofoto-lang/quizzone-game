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
    "1": { nome: "Pacchetto 1", categorie: {}, bonus: [], stima: [], anagramma: [] },
    "2": { nome: "Pacchetto 2", categorie: {}, bonus: [], stima: [], anagramma: [] },
    "3": { nome: "Pacchetto 3", categorie: {}, bonus: [], stima: [], anagramma: [] }
  }
};

// Carica i dati dal file domande.json
try {
  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (data.pacchetti) {
      fullDb.pacchetti = data.pacchetti;
    } else if (data.categorie) {
      fullDb.pacchetti["1"] = data;
    }
    console.log("Dati caricati correttamente da domande.json");
  } else {
    console.log("File domande.json non trovato, verrà creato un file di esempio.");
    createExampleData();
  }
} catch (e) { 
  console.error("Errore caricamento JSON:", e.message);
  createExampleData();
}

// Funzione per creare dati di esempio se il file non esiste
function createExampleData() {
  // Definizione delle categorie comuni a tutti i pacchetti
  const categorieComuni = ["Storia", "Geografia", "Scienze", "Cinema", "Musica", "Arte", "Sport"];
  
  const exampleData = {
    pacchetti: {
      "1": createPackage("Pacchetto 1", 1),
      "2": createPackage("Pacchetto 2", 100),
      "3": createPackage("Pacchetto 3", 200)
    }
  };
  
  // Salva i dati di esempio nel file
  fs.writeFileSync(jsonPath, JSON.stringify(exampleData, null, 2), 'utf8');
  fullDb = exampleData;
  console.log("Dati di esempio creati e salvati in domande.json");
}

// Funzione per creare un pacchetto completo
function createPackage(nomePacchetto, idBase) {
  return {
    nome: nomePacchetto,
    categorie: {
      "Storia": createDomandeCategoria("Storia", idBase + 1),
      "Geografia": createDomandeCategoria("Geografia", idBase + 11),
      "Scienze": createDomandeCategoria("Scienze", idBase + 21),
      "Cinema": createDomandeCategoria("Cinema", idBase + 31),
      "Musica": createDomandeCategoria("Musica", idBase + 41),
      "Arte": createDomandeCategoria("Arte", idBase + 51),
      "Sport": createDomandeCategoria("Sport", idBase + 61)
    },
    "bonus": createDomandeBonus(idBase + 71),
    "stima": createDomandeStima(idBase + 76),
    "anagramma": createDomandeAnagrammi(idBase + 81)
  };
}

// Funzioni per creare domande per ogni categoria/sezione
function createDomandeCategoria(tipoCategoria, idInizio) {
  // Mappe per domande diverse per ogni pacchetto
  const mappeDomande = {
    "1": {
      "Storia": [
        {
          "id": idInizio,
          "domanda": "In quale anno è caduto l'Impero Romano d'Occidente?",
          "risposte": ["476 d.C.", "410 d.C.", "1453 d.C.", "800 d.C."],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Chi fu il primo presidente degli Stati Uniti?",
          "risposte": ["George Washington", "Thomas Jefferson", "Abraham Lincoln", "John Adams"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "In quale secolo visse Leonardo da Vinci?",
          "risposte": ["XV-XVI secolo", "XIII secolo", "XVII secolo", "XIX secolo"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale imperatore romano costruì il Vallo di Adriano?",
          "risposte": ["Adriano", "Augusto", "Traiano", "Costantino"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale famosa battaglia segnò la fine delle guerre napoleoniche?",
          "risposte": ["Waterloo", "Austerlitz", "Borodino", "Trafalgar"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Geografia": [
        {
          "id": idInizio,
          "domanda": "Qual è la capitale dell'Australia?",
          "risposte": ["Canberra", "Sydney", "Melbourne", "Perth"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Qual è il fiume più lungo d'Italia?",
          "risposte": ["Po", "Tevere", "Adige", "Arno"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "In quale continente si trova il deserto del Kalahari?",
          "risposte": ["Africa", "Asia", "America", "Australia"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale paese ha come capitale Brasilia?",
          "risposte": ["Brasile", "Argentina", "Cile", "Perù"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale catena montuosa separa l'Europa dall'Asia?",
          "risposte": ["Monti Urali", "Alpi", "Himalaya", "Ande"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Scienze": [
        {
          "id": idInizio,
          "domanda": "Quale pianeta è noto come il Pianeta Rosso?",
          "risposte": ["Marte", "Venere", "Giove", "Saturno"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Quale gas è essenziale per la respirazione?",
          "risposte": ["Ossigeno", "Azoto", "Anidride carbonica", "Idrogeno"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale elemento chimico ha simbolo 'Au'?",
          "risposte": ["Oro", "Argento", "Alluminio", "Arsenico"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale parte della cellula contiene il DNA?",
          "risposte": ["Nucleo", "Mitocondrio", "Ribosoma", "Cloroplasto"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale scienziato formulò la teoria della relatività?",
          "risposte": ["Albert Einstein", "Isaac Newton", "Galileo Galilei", "Stephen Hawking"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Cinema": [
        {
          "id": idInizio,
          "domanda": "Chi ha diretto 'Il Padrino'?",
          "risposte": ["Francis Ford Coppola", "Martin Scorsese", "Steven Spielberg", "Quentin Tarantino"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "In quale film compare il personaggio di Forrest Gump?",
          "risposte": ["Forrest Gump", "Rain Man", "Il curioso caso di Benjamin Button", "Shawshank Redemption"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale attrice ha interpretato il ruolo di Hermione in Harry Potter?",
          "risposte": ["Emma Watson", "Emma Stone", "Jennifer Lawrence", "Natalie Portman"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Chi ha vinto l'Oscar come miglior attore per 'Il gladiatore'?",
          "risposte": ["Russell Crowe", "Joaquin Phoenix", "Richard Harris", "Oliver Reed"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale film di Stanley Kubrick è basato su un romanzo di Stephen King?",
          "risposte": ["Shining", "2001: Odissea nello spazio", "Arancia meccanica", "Eyes Wide Shut"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Musica": [
        {
          "id": idInizio,
          "domanda": "Quale famosa band britannica ha pubblicato 'Bohemian Rhapsody'?",
          "risposte": ["Queen", "The Beatles", "The Rolling Stones", "Led Zeppelin"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Chi è conosciuto come il 'Re del Pop'?",
          "risposte": ["Michael Jackson", "Elvis Presley", "Prince", "Madonna"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale compositore classico è sordo per gran parte della sua vita?",
          "risposte": ["Ludwig van Beethoven", "Wolfgang Amadeus Mozart", "Johann Sebastian Bach", "Frédéric Chopin"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale cantante italiana ha vinto il Festival di Sanremo 2022?",
          "risposte": ["Mahmood e Blanco", "Elisa", "Marco Mengoni", "Annalisa"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "In quale anno i Beatles si sono sciolti ufficialmente?",
          "risposte": ["1970", "1969", "1971", "1972"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Arte": [
        {
          "id": idInizio,
          "domanda": "Chi dipinse la Cappella Sistina?",
          "risposte": ["Michelangelo", "Leonardo da Vinci", "Raffaello", "Donatello"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "In quale città si trova il Museo del Louvre?",
          "risposte": ["Parigi", "Londra", "Roma", "New York"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale movimento artistico è associato a Salvador Dalì?",
          "risposte": ["Surrealismo", "Impressionismo", "Cubismo", "Espressionismo"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Chi è l'autore della scultura 'David'?",
          "risposte": ["Michelangelo", "Donatello", "Bernini", "Cellini"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale famoso quadro rappresenta una notte stellata?",
          "risposte": ["Notte stellata di Van Gogh", "Urlo di Munch", "Nascita di Venere", "Guernica"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Sport": [
        {
          "id": idInizio,
          "domanda": "In quale sport si usa la mazza da hockey?",
          "risposte": ["Hockey su ghiaccio", "Golf", "Tennis", "Baseball"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Quanti giocatori ci sono in una squadra di calcio?",
          "risposte": ["11", "10", "9", "12"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale paese ha vinto il Mondiale di calcio 2018?",
          "risposte": ["Francia", "Croazia", "Brasile", "Germania"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "In quale sport si compete per il Trofeo della Coppa Davis?",
          "risposte": ["Tennis", "Calcio", "Rugby", "Golf"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Chi detiene il record mondiale dei 100 metri piani maschili?",
          "risposte": ["Usain Bolt", "Carl Lewis", "Justin Gatlin", "Asafa Powell"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ]
    },
    "2": {
      "Storia": [
        {
          "id": idInizio,
          "domanda": "In quale anno Cristoforo Colombo scoprì l'America?",
          "risposte": ["1492", "1502", "1488", "1510"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Chi fu il primo imperatore romano?",
          "risposte": ["Augusto", "Giulio Cesare", "Nerone", "Costantino"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "In quale secolo avvenne la Rivoluzione francese?",
          "risposte": ["XVIII secolo", "XVI secolo", "XVII secolo", "XIX secolo"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale imperatore romano costruì il Colosseo?",
          "risposte": ["Vespasiano", "Nerone", "Augusto", "Traiano"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale famoso condottiero mongolo conquistò gran parte dell'Asia?",
          "risposte": ["Gengis Khan", "Kublai Khan", "Attila", "Alessandro Magno"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Geografia": [
        {
          "id": idInizio,
          "domanda": "Qual è la capitale del Canada?",
          "risposte": ["Ottawa", "Toronto", "Vancouver", "Montreal"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Qual è il monte più alto d'Italia?",
          "risposte": ["Monte Bianco", "Monte Rosa", "Cervino", "Gran Paradiso"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "In quale oceano si trovano le Maldive?",
          "risposte": ["Oceano Indiano", "Oceano Pacifico", "Oceano Atlantico", "Oceano Artico"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale fiume attraversa Parigi?",
          "risposte": ["Senna", "Reno", "Tamigi", "Danubio"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale deserto è il più grande del mondo?",
          "risposte": ["Deserto del Sahara", "Deserto del Gobi", "Deserto Arabico", "Deserto del Kalahari"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Scienze": [
        {
          "id": idInizio,
          "domanda": "Qual è il pianeta più vicino al Sole?",
          "risposte": ["Mercurio", "Venere", "Marte", "Terra"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Quale gas emettiamo quando respiriamo?",
          "risposte": ["Anidride carbonica", "Ossigeno", "Azoto", "Idrogeno"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale elemento chimico ha simbolo 'Fe'?",
          "risposte": ["Ferro", "Fosforo", "Fluoro", "Francio"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale parte della pianta esegue la fotosintesi?",
          "risposte": ["Foglie", "Radici", "Fusto", "Fiori"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Chi scoprì la penicillina?",
          "risposte": ["Alexander Fleming", "Louis Pasteur", "Marie Curie", "Robert Koch"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Cinema": [
        {
          "id": idInizio,
          "domanda": "Chi ha interpretato Jack in Titanic?",
          "risposte": ["Leonardo DiCaprio", "Brad Pitt", "Tom Cruise", "Johnny Depp"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Quale film ha vinto l'Oscar come miglior film nel 2020?",
          "risposte": ["Parasite", "1917", "Joker", "Once Upon a Time in Hollywood"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Chi ha diretto 'Pulp Fiction'?",
          "risposte": ["Quentin Tarantino", "Martin Scorsese", "Steven Spielberg", "Christopher Nolan"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale attore ha interpretato Iron Man?",
          "risposte": ["Robert Downey Jr.", "Chris Evans", "Chris Hemsworth", "Mark Ruffalo"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "In quale film compare il personaggio di Hannibal Lecter?",
          "risposte": ["Il silenzio degli innocenti", "Seven", "Shutter Island", "Psycho"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Musica": [
        {
          "id": idInizio,
          "domanda": "Chi canta 'Like a Prayer'?",
          "risposte": ["Madonna", "Lady Gaga", "Britney Spears", "Beyoncé"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Quale band ha pubblicato l'album 'The Dark Side of the Moon'?",
          "risposte": ["Pink Floyd", "Led Zeppelin", "The Beatles", "The Rolling Stones"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Chi ha composto 'Le quattro stagioni'?",
          "risposte": ["Antonio Vivaldi", "Johann Sebastian Bach", "Wolfgang Amadeus Mozart", "Ludwig van Beethoven"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale cantante è conosciuta come la 'Regina del Soul'?",
          "risposte": ["Aretha Franklin", "Whitney Houston", "Diana Ross", "Tina Turner"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "In quale anno è uscito l'album 'Thriller' di Michael Jackson?",
          "risposte": ["1982", "1979", "1985", "1980"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Arte": [
        {
          "id": idInizio,
          "domanda": "Chi dipinse la Gioconda?",
          "risposte": ["Leonardo da Vinci", "Michelangelo", "Raffaello", "Caravaggio"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "In quale città si trova la Galleria degli Uffizi?",
          "risposte": ["Firenze", "Roma", "Venezia", "Milano"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale movimento artistico è associato a Claude Monet?",
          "risposte": ["Impressionismo", "Cubismo", "Surrealismo", "Espressionismo"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Chi è l'autore del dipinto 'Il bacio'?",
          "risposte": ["Gustav Klimt", "Edvard Munch", "Vincent van Gogh", "Pablo Picasso"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale famoso architetto ha progettato la Sagrada Familia a Barcellona?",
          "risposte": ["Antoni Gaudí", "Frank Lloyd Wright", "Le Corbusier", "Renzo Piano"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Sport": [
        {
          "id": idInizio,
          "domanda": "Quanti giocatori ci sono in una squadra di basket?",
          "risposte": ["5", "6", "7", "8"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "In quale sport si usa la racchetta?",
          "risposte": ["Tennis", "Calcio", "Pallavolo", "Rugby"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale paese ha vinto più mondiali di calcio?",
          "risposte": ["Brasile", "Italia", "Germania", "Argentina"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "In quale sport si compete per il Trofeo Borg-Warner?",
          "risposte": ["Formula 1", "MotoGP", "NASCAR", "Indy 500"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Chi detiene il record mondiale di gol in una stagione di calcio?",
          "risposte": ["Lionel Messi", "Cristiano Ronaldo", "Pelé", "Gerd Müller"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ]
    },
    "3": {
      "Storia": [
        {
          "id": idInizio,
          "domanda": "In quale anno è finita la Seconda Guerra Mondiale?",
          "risposte": ["1945", "1944", "1946", "1943"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Chi fu il primo uomo sulla Luna?",
          "risposte": ["Neil Armstrong", "Buzz Aldrin", "Yuri Gagarin", "Michael Collins"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "In quale secolo visse Galileo Galilei?",
          "risposte": ["XVI-XVII secolo", "XV secolo", "XVIII secolo", "XIX secolo"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale imperatore romano costruì il Pantheon?",
          "risposte": ["Adriano", "Augusto", "Traiano", "Marco Aurelio"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale famosa spedizione fu guidata da Ferdinando Magellano?",
          "risposte": ["Prima circumnavigazione del globo", "Scoperta dell'America", "Via della seta", "Spedizione in Antartide"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Geografia": [
        {
          "id": idInizio,
          "domanda": "Qual è la capitale del Giappone?",
          "risposte": ["Tokyo", "Osaka", "Kyoto", "Seoul"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Qual è il lago più grande d'Italia?",
          "risposte": ["Lago di Garda", "Lago Maggiore", "Lago di Como", "Lago Trasimeno"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "In quale continente si trova il deserto di Atacama?",
          "risposte": ["Sud America", "Africa", "Asia", "Australia"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale paese ha come capitale Wellington?",
          "risposte": ["Nuova Zelanda", "Australia", "Canada", "Sud Africa"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale catena montuosa attraversa l'Italia da nord a sud?",
          "risposte": ["Appennini", "Alpi", "Pirenei", "Carpazi"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Scienze": [
        {
          "id": idInizio,
          "domanda": "Qual è l'organo più grande del corpo umano?",
          "risposte": ["Pelle", "Fegato", "Polmoni", "Cervello"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Quale gas costituisce la maggior parte dell'atmosfera terrestre?",
          "risposte": ["Azoto", "Ossigeno", "Anidride carbonica", "Idrogeno"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale elemento chimico ha simbolo 'Na'?",
          "risposte": ["Sodio", "Nichel", "Naftalene", "Nettunio"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale parte della cellula produce energia?",
          "risposte": ["Mitocondrio", "Nucleo", "Ribosoma", "Membrana cellulare"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Chi formulò la legge della gravitazione universale?",
          "risposte": ["Isaac Newton", "Albert Einstein", "Galileo Galilei", "Nikola Tesla"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Cinema": [
        {
          "id": idInizio,
          "domanda": "Chi ha diretto 'Star Wars: Una nuova speranza'?",
          "risposte": ["George Lucas", "Steven Spielberg", "James Cameron", "Ridley Scott"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Quale film ha come protagonista Rocky Balboa?",
          "risposte": ["Rocky", "Raging Bull", "The Fighter", "Million Dollar Baby"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Chi ha interpretato il Joker in 'The Dark Knight'?",
          "risposte": ["Heath Ledger", "Joaquin Phoenix", "Jack Nicholson", "Jared Leto"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale regista ha diretto 'Inception'?",
          "risposte": ["Christopher Nolan", "David Fincher", "Darren Aronofsky", "Alfonso Cuarón"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale film ha vinto 11 Oscar, record assoluto?",
          "risposte": ["Titanic, Il Signore degli Anelli: Il ritorno del re, Ben-Hur", "Avatar", "La La Land"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Musica": [
        {
          "id": idInizio,
          "domanda": "Chi canta 'Rolling in the Deep'?",
          "risposte": ["Adele", "Taylor Swift", "Rihanna", "Beyoncé"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "Quale band ha pubblicato l'album 'Abbey Road'?",
          "risposte": ["The Beatles", "The Rolling Stones", "The Who", "Led Zeppelin"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Chi ha composto 'La traviata'?",
          "risposte": ["Giuseppe Verdi", "Gioachino Rossini", "Giacomo Puccini", "Wolfgang Amadeus Mozart"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Quale cantante è conosciuto come 'The Boss'?",
          "risposte": ["Bruce Springsteen", "Bob Dylan", "Elvis Presley", "John Lennon"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "In quale anno è uscito l'album 'Nevermind' dei Nirvana?",
          "risposte": ["1991", "1989", "1993", "1995"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Arte": [
        {
          "id": idInizio,
          "domanda": "Chi dipinse 'La creazione di Adamo'?",
          "risposte": ["Michelangelo", "Leonardo da Vinci", "Raffaello", "Donatello"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "In quale città si trova il Museo del Prado?",
          "risposte": ["Madrid", "Barcellona", "Siviglia", "Valencia"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale movimento artistico è associato a Pablo Picasso?",
          "risposte": ["Cubismo", "Impressionismo", "Surrealismo", "Espressionismo"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "Chi è l'autore della scultura 'Il pensatore'?",
          "risposte": ["Auguste Rodin", "Michelangelo", "Donatello", "Bernini"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Quale famoso architetto ha progettato il Guggenheim Museum di New York?",
          "risposte": ["Frank Lloyd Wright", "Frank Gehry", "Zaha Hadid", "I.M. Pei"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ],
      "Sport": [
        {
          "id": idInizio,
          "domanda": "Quanti giocatori ci sono in una squadra di baseball?",
          "risposte": ["9", "10", "11", "8"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 1,
          "domanda": "In quale sport si usa il pallone ovale?",
          "risposte": ["Rugby", "Calcio", "Pallavolo", "Basket"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "facile"
        },
        {
          "id": idInizio + 2,
          "domanda": "Quale paese ha vinto il Mondiale di calcio 2022?",
          "risposte": ["Argentina", "Francia", "Brasile", "Croazia"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 3,
          "domanda": "In quale sport si compete per la Stanley Cup?",
          "risposte": ["Hockey su ghiaccio", "Football americano", "Baseball", "Basket"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "medio"
        },
        {
          "id": idInizio + 4,
          "domanda": "Chi detiene il record mondiale di medaglie olimpiche?",
          "risposte": ["Michael Phelps", "Usain Bolt", "Carl Lewis", "Larisa Latynina"],
          "corretta": 0,
          "punti": 100,
          "difficolta": "difficile"
        }
      ]
    }
  };
  
  // Determina quale pacchetto siamo creando
  let pacchettoNum = Math.floor(idBase / 100) + 1;
  return mappeDomande[pacchettoNum.toString()][tipoCategoria];
}

function createDomandeBonus(idInizio) {
  return [
    {
      "id": idInizio,
      "domanda": "Qual è l'animale più veloce sulla terra?",
      "risposte": ["Ghepardo", "Leone", "Antilope", "Leopardo"],
      "corretta": 0,
      "punti": 100,
      "difficolta": "facile"
    },
    {
      "id": idInizio + 1,
      "domanda": "Quale pianeta ha il giorno più lungo?",
      "risposte": ["Venere", "Marte", "Giove", "Saturno"],
      "corretta": 0,
      "punti": 100,
      "difficolta": "facile"
    },
    {
      "id": idInizio + 2,
      "domanda": "Chi ha scritto 'Il vecchio e il mare'?",
      "risposte": ["Ernest Hemingway", "Mark Twain", "John Steinbeck", "F. Scott Fitzgerald"],
      "corretta": 0,
      "punti": 100,
      "difficolta": "medio"
    },
    {
      "id": idInizio + 3,
      "domanda": "Quale organo del corpo umano filtra il sangue?",
      "risposte": ["Reni", "Fegato", "Polmoni", "Cuore"],
      "corretta": 0,
      "punti": 100,
      "difficolta": "medio"
    },
    {
      "id": idInizio + 4,
      "domanda": "In quale anno è stato inventato il World Wide Web?",
      "risposte": ["1989", "1975", "1995", "2000"],
      "corretta": 0,
      "punti": 100,
      "difficolta": "difficile"
    }
  ];
}

function createDomandeStima(idInizio) {
  return [
    {
      "id": idInizio,
      "domanda": "Quanto è alta la Torre di Pisa in metri? (approssimativamente)",
      "corretta": "56",
      "punti": 100,
      "difficolta": "facile"
    },
    {
      "id": idInizio + 1,
      "domanda": "Quanti abitanti ha la città di Milano? (approssimativamente in milioni)",
      "corretta": "1.4",
      "punti": 100,
      "difficolta": "facile"
    },
    {
      "id": idInizio + 2,
      "domanda": "Quanti anni aveva Leonardo da Vinci quando è morto?",
      "corretta": "67",
      "punti": 100,
      "difficolta": "medio"
    },
    {
      "id": idInizio + 3,
      "domanda": "Quanti stati ci sono nell'Unione Europea? (aggiornato al 2023)",
      "corretta": "27",
      "punti": 100,
      "difficolta": "medio"
    },
    {
      "id": idInizio + 4,
      "domanda": "Quante ossa ci sono nel corpo umano adulto?",
      "corretta": "206",
      "punti": 100,
      "difficolta": "difficile"
    }
  ];
}

function createDomandeAnagrammi(idInizio) {
  return [
    {
      "id": idInizio,
      "domanda": "Anagramma di 'CENERE'",
      "corretta": "ENERCE",
      "punti": 100,
      "difficolta": "facile"
    },
    {
      "id": idInizio + 1,
      "domanda": "Anagramma di 'MARITO'",
      "corretta": "MORATI",
      "punti": 100,
      "difficolta": "facile"
    },
    {
      "id": idInizio + 2,
      "domanda": "Anagramma di 'CARTONE'",
      "corretta": "CONTRARE",
      "punti": 100,
      "difficolta": "medio"
    },
    {
      "id": idInizio + 3,
      "domanda": "Anagramma di 'SPAGHETTI'",
      "corretta": "PASSEGGIATA",
      "punti": 100,
      "difficolta": "medio"
    },
    {
      "id": idInizio + 4,
      "domanda": "Anagramma di 'ELETTROCARDIOGRAMMA'",
      "corretta": "CARDIOLOGIA ELETTROMEDICA",
      "punti": 100,
      "difficolta": "difficile"
    }
  ];
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
    console.log(`Vincitore: ${vincitore.name} con ${vincitore.score} punti`);
    
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
      
      console.log(`Pacchetto selezionato: ${currentPackageId}, Categorie:`, Object.keys(currentPackage.categorie));
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

Server in ascolto sulla porta: ${PORT}

📱 Admin:      http://localhost:${PORT}/admin
🎯 Giocatori:  http://localhost:${PORT}/
📺 Display:    http://localhost:${PORT}/display

✅ Sistema a pacchetti attivo! 3 pacchetti disponibili.
✅ Ogni pacchetto ha le stesse 7 categorie con domande diverse.
✅ Ogni pacchetto contiene: 35 domande categorie + 5 bonus + 5 stima + 5 anagrammi.
✅ Funzionalità vincitore aggiunta!

Pronto per il gioco!
`));
