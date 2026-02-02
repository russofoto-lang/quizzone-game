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
    // Se il file ha la nuova struttura con pacchetti
    if (data.pacchetti) {
      fullDb.pacchetti = data.pacchetti;
    } 
    // Se ha la vecchia struttura senza pacchetti
    else if (data.categorie) {
      // Converti la vecchia struttura in pacchetto 1
      fullDb.pacchetti["1"] = data;
    }
  } else {
    console.log("File domande.json non trovato, verrà creato un file di esempio.");
    // Crea un file di esempio
    createExampleData();
  }
} catch (e) { 
  console.error("Errore caricamento JSON:", e.message);
  createExampleData();
}

// Funzione per creare dati di esempio se il file non esiste
function createExampleData() {
  const exampleData = {
    pacchetti: {
      "1": {
        nome: "Pacchetto 1 - Cultura Generale",
        categorie: {
          "Storia": [
            {
              "id": 1,
              "domanda": "In quale anno è caduto l'Impero Romano d'Occidente?",
              "risposte": ["476 d.C.", "410 d.C.", "1453 d.C.", "800 d.C."],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 2,
              "domanda": "Chi fu il primo presidente degli Stati Uniti?",
              "risposte": ["George Washington", "Thomas Jefferson", "Abraham Lincoln", "John Adams"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 3,
              "domanda": "In quale secolo visse Leonardo da Vinci?",
              "risposte": ["XV-XVI secolo", "XIII secolo", "XVII secolo", "XIX secolo"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 4,
              "domanda": "Quale imperatore romano costruì il Vallo di Adriano?",
              "risposte": ["Adriano", "Augusto", "Traiano", "Costantino"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 5,
              "domanda": "Quale famosa battaglia segnò la fine delle guerre napoleoniche?",
              "risposte": ["Waterloo", "Austerlitz", "Borodino", "Trafalgar"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Geografia": [
            {
              "id": 6,
              "domanda": "Qual è la capitale dell'Australia?",
              "risposte": ["Canberra", "Sydney", "Melbourne", "Perth"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 7,
              "domanda": "Qual è il fiume più lungo d'Italia?",
              "risposte": ["Po", "Tevere", "Adige", "Arno"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 8,
              "domanda": "In quale continente si trova il deserto del Kalahari?",
              "risposte": ["Africa", "Asia", "America", "Australia"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 9,
              "domanda": "Quale paese ha come capitale Brasilia?",
              "risposte": ["Brasile", "Argentina", "Cile", "Perù"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 10,
              "domanda": "Quale catena montuosa separa l'Europa dall'Asia?",
              "risposte": ["Monti Urali", "Alpi", "Himalaya", "Ande"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Scienze": [
            {
              "id": 11,
              "domanda": "Quale pianeta è noto come il Pianeta Rosso?",
              "risposte": ["Marte", "Venere", "Giove", "Saturno"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 12,
              "domanda": "Quale gas è essenziale per la respirazione?",
              "risposte": ["Ossigeno", "Azoto", "Anidride carbonica", "Idrogeno"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 13,
              "domanda": "Quale elemento chimico ha simbolo 'Au'?",
              "risposte": ["Oro", "Argento", "Alluminio", "Arsenico"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 14,
              "domanda": "Quale parte della cellula contiene il DNA?",
              "risposte": ["Nucleo", "Mitocondrio", "Ribosoma", "Cloroplasto"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 15,
              "domanda": "Quale scienziato formulò la teoria della relatività?",
              "risposte": ["Albert Einstein", "Isaac Newton", "Galileo Galilei", "Stephen Hawking"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Arte": [
            {
              "id": 16,
              "domanda": "Chi dipinse la Cappella Sistina?",
              "risposte": ["Michelangelo", "Leonardo da Vinci", "Raffaello", "Donatello"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 17,
              "domanda": "In quale città si trova il Museo del Louvre?",
              "risposte": ["Parigi", "Londra", "Roma", "New York"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 18,
              "domanda": "Quale movimento artistico è associato a Salvador Dalì?",
              "risposte": ["Surrealismo", "Impressionismo", "Cubismo", "Espressionismo"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 19,
              "domanda": "Chi è l'autore della scultura 'David'?",
              "risposte": ["Michelangelo", "Donatello", "Bernini", "Cellini"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 20,
              "domanda": "Quale famoso quadro rappresenta una notte stellata?",
              "risposte": ["Notte stellata di Van Gogh", "Urlo di Munch", "Nascita di Venere", "Guernica"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Sport": [
            {
              "id": 21,
              "domanda": "In quale sport si usa la mazza da hockey?",
              "risposte": ["Hockey su ghiaccio", "Golf", "Tennis", "Baseball"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 22,
              "domanda": "Quanti giocatori ci sono in una squadra di calcio?",
              "risposte": ["11", "10", "9", "12"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 23,
              "domanda": "Quale paese ha vinto il Mondiale di calcio 2018?",
              "risposte": ["Francia", "Croazia", "Brasile", "Germania"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 24,
              "domanda": "In quale sport si compete per il Trofeo della Coppa Davis?",
              "risposte": ["Tennis", "Calcio", "Rugby", "Golf"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 25,
              "domanda": "Chi detiene il record mondiale dei 100 metri piani maschili?",
              "risposte": ["Usain Bolt", "Carl Lewis", "Justin Gatlin", "Asafa Powell"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ]
        },
        "bonus": [
          {
            "id": 101,
            "domanda": "Qual è il fiume più lungo del mondo?",
            "risposte": ["Nilo", "Rio delle Amazzoni", "Mississippi", "Yangtze"],
            "corretta": 1,
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 102,
            "domanda": "Quale pianeta del sistema solare ha gli anelli più visibili?",
            "risposte": ["Saturno", "Giove", "Urano", "Nettuno"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 103,
            "domanda": "Chi scrisse 'Il nome della rosa'?",
            "risposte": ["Umberto Eco", "Italo Calvino", "Luigi Pirandello", "Gabriele D'Annunzio"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 104,
            "domanda": "Quale organo del corpo umano produce l'insulina?",
            "risposte": ["Pancreas", "Fegato", "Stomaco", "Intestino"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 105,
            "domanda": "In quale anno è stata firmata la Dichiarazione di Indipendenza degli Stati Uniti?",
            "risposte": ["1776", "1789", "1492", "1812"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "difficile"
          }
        ],
        "stima": [
          {
            "id": 201,
            "domanda": "Quanti abitanti ha la città di Roma? (approssimativamente in milioni)",
            "corretta": "2.8",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 202,
            "domanda": "Quanti stati ci sono negli Stati Uniti d'America?",
            "corretta": "50",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 203,
            "domanda": "Quanti anni ha avuto la regina Elisabetta II alla sua morte?",
            "corretta": "96",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 204,
            "domanda": "Quanti elementi ci sono nella tavola periodica degli elementi (aggiornata al 2021)?",
            "corretta": "118",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 205,
            "domanda": "Quanti satelliti naturali (lune) ha Giove? (approssimativamente, le più grandi)",
            "corretta": "79",
            "punti": 100,
            "difficolta": "difficile"
          }
        ],
        "anagramma": [
          {
            "id": 301,
            "domanda": "Anagramma di 'CENERE'",
            "corretta": "ENERCE",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 302,
            "domanda": "Anagramma di 'MARITO'",
            "corretta": "MORATI",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 303,
            "domanda": "Anagramma di 'CARTONE'",
            "corretta": "CONTRARE",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 304,
            "domanda": "Anagramma di 'SPAGHETTI'",
            "corretta": "PASSEGGIATA",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 305,
            "domanda": "Anagramma di 'ELETTROCARDIOGRAMMA'",
            "corretta": "CARDIOLOGIA ELETTROMEDICA",
            "punti": 100,
            "difficolta": "difficile"
          }
        ]
      },
      "2": {
        "nome": "Pacchetto 2 - Letteratura e Cinema",
        "categorie": {
          "Letteratura": [
            {
              "id": 31,
              "domanda": "Chi scrisse 'I Promessi Sposi'?",
              "risposte": ["Alessandro Manzoni", "Italo Calvino", "Luigi Pirandello", "Giovanni Verga"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 32,
              "domanda": "Qual è il protagonista di 'Moby Dick'?",
              "risposte": ["Il Capitano Achab", "Ishmael", "Queequeg", "Starbuck"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 33,
              "domanda": "In quale opera compare il personaggio di Amleto?",
              "risposte": ["Amleto di Shakespeare", "Macbeth", "Romeo e Giulietta", "Otello"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 34,
              "domanda": "Chi è l'autore di 'Cent'anni di solitudine'?",
              "risposte": ["Gabriel García Márquez", "Jorge Luis Borges", "Pablo Neruda", "Isabel Allende"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 35,
              "domanda": "Quale famoso poeta italiano scrisse 'L'infinito'?",
              "risposte": ["Giacomo Leopardi", "Ugo Foscolo", "Dante Alighieri", "Francesco Petrarca"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Cinema": [
            {
              "id": 36,
              "domanda": "Chi ha diretto 'Il Padrino'?",
              "risposte": ["Francis Ford Coppola", "Martin Scorsese", "Steven Spielberg", "Quentin Tarantino"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 37,
              "domanda": "In quale film compare il personaggio di Forrest Gump?",
              "risposte": ["Forrest Gump", "Rain Man", "Il curioso caso di Benjamin Button", "Shawshank Redemption"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 38,
              "domanda": "Quale attrice ha interpretato il ruolo di Hermione in Harry Potter?",
              "risposte": ["Emma Watson", "Emma Stone", "Jennifer Lawrence", "Natalie Portman"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 39,
              "domanda": "Chi ha vinto l'Oscar come miglior attore per 'Il gladiatore'?",
              "risposte": ["Russell Crowe", "Joaquin Phoenix", "Richard Harris", "Oliver Reed"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 40,
              "domanda": "Quale film di Stanley Kubrick è basato su un romanzo di Stephen King?",
              "risposte": ["Shining", "2001: Odissea nello spazio", "Arancia meccanica", "Eyes Wide Shut"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Musica": [
            {
              "id": 41,
              "domanda": "Quale famosa band britannica ha pubblicato 'Bohemian Rhapsody'?",
              "risposte": ["Queen", "The Beatles", "The Rolling Stones", "Led Zeppelin"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 42,
              "domanda": "Chi è conosciuto come il 'Re del Pop'?",
              "risposte": ["Michael Jackson", "Elvis Presley", "Prince", "Madonna"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 43,
              "domanda": "Quale compositore classico è sordo per gran parte della sua vita?",
              "risposte": ["Ludwig van Beethoven", "Wolfgang Amadeus Mozart", "Johann Sebastian Bach", "Frédéric Chopin"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 44,
              "domanda": "Quale cantante italiana ha vinto il Festival di Sanremo 2022?",
              "risposte": ["Mahmood e Blanco", "Elisa", "Marco Mengoni", "Annalisa"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 45,
              "domanda": "In quale anno i Beatles si sono sciolti ufficialmente?",
              "risposte": ["1970", "1969", "1971", "1972"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Filosofia": [
            {
              "id": 46,
              "domanda": "Chi è l'autore de 'La Repubblica'?",
              "risposte": ["Platone", "Aristotele", "Socrate", "Eraclito"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 47,
              "domanda": "Quale filosofo è noto per la frase 'Cogito, ergo sum'?",
              "risposte": ["René Descartes (Cartesio)", "Immanuel Kant", "Friedrich Nietzsche", "Jean-Paul Sartre"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 48,
              "domanda": "Quale filosofo greco era il maestro di Alessandro Magno?",
              "risposte": ["Aristotele", "Platone", "Socrate", "Diogene"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 49,
              "domanda": "Chi scrisse 'Così parlò Zarathustra'?",
              "risposte": ["Friedrich Nietzsche", "Arthur Schopenhauer", "Martin Heidegger", "Søren Kierkegaard"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 50,
              "domanda": "Quale filosofo illuminista scrisse 'Il contratto sociale'?",
              "risposte": ["Jean-Jacques Rousseau", "Voltaire", "Montesquieu", "Denis Diderot"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Mitologia": [
            {
              "id": 51,
              "domanda": "Chi è il re degli dei nella mitologia greca?",
              "risposte": ["Zeus", "Poseidone", "Ade", "Apollo"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 52,
              "domanda": "Chi è la dea della saggezza nella mitologia greca?",
              "risposte": ["Atena", "Era", "Afrodite", "Artemide"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 53,
              "domanda": "Quale eroe greco ha ucciso il Minotauro?",
              "risposte": ["Teseo", "Ercole", "Perseo", "Achille"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 54,
              "domanda": "Chi è il dio del fuoco nella mitologia romana?",
              "risposte": ["Vulcano", "Marte", "Giove", "Saturno"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 55,
              "domanda": "Quale famosa guerra della mitologia greca è raccontata nell'Iliade?",
              "risposte": ["Guerra di Troia", "Guerra di Tebe", "Guerra degli Dei", "Guerra dei Titani"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ]
        },
        "bonus": [
          {
            "id": 106,
            "domanda": "Chi ha scritto 'Il Piccolo Principe'?",
            "risposte": ["Antoine de Saint-Exupéry", "Jules Verne", "Victor Hugo", "Gustave Flaubert"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 107,
            "domanda": "Quale attore ha interpretato Iron Man nei film Marvel?",
            "risposte": ["Robert Downey Jr.", "Chris Evans", "Chris Hemsworth", "Mark Ruffalo"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 108,
            "domanda": "Quale famoso compositore è morto mentre scriveva il 'Requiem'?",
            "risposte": ["Wolfgang Amadeus Mozart", "Ludwig van Beethoven", "Johann Sebastian Bach", "Franz Schubert"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 109,
            "domanda": "Quale filosofo disse 'La vita è quello che ti accade mentre sei occupato a fare altri progetti'?",
            "risposte": ["John Lennon", "Albert Einstein", "Steve Jobs", "Confucio"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 110,
            "domanda": "Quale mitologico personaggio è condannato a spingere un masso su una collina per l'eternità?",
            "risposte": ["Sisifo", "Prometeo", "Tantalo", "Issione"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "difficile"
          }
        ],
        "stima": [
          {
            "id": 206,
            "domanda": "Quanti libri ci sono nella serie di Harry Potter?",
            "corretta": "7",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 207,
            "domanda": "Quanti Oscar ha vinto il film 'Titanic'?",
            "corretta": "11",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 208,
            "domanda": "Quante sinfonie ha composto Beethoven?",
            "corretta": "9",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 209,
            "domanda": "Quanti anni aveva Dante quando iniziò a scrivere la Divina Commedia?",
            "corretta": "35",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 210,
            "domanda": "Quanti episodi ha la serie TV 'Friends'?",
            "corretta": "236",
            "punti": 100,
            "difficolta": "difficile"
          }
        ],
        "anagramma": [
          {
            "id": 306,
            "domanda": "Anagramma di 'ROMA'",
            "corretta": "AMOR",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 307,
            "domanda": "Anagramma di 'LIRA'",
            "corretta": "ARIL",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 308,
            "domanda": "Anagramma di 'TRENO'",
            "corretta": "ONRET",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 309,
            "domanda": "Anagramma di 'CINEMA'",
            "corretta": "MENICA",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 310,
            "domanda": "Anagramma di 'FILOSOFIA'",
            "corretta": "OSOFILIAF",
            "punti": 100,
            "difficolta": "difficile"
          }
        ]
      },
      "3": {
        "nome": "Pacchetto 3 - Scienza e Tecnologia",
        "categorie": {
          "Matematica": [
            {
              "id": 56,
              "domanda": "Qual è il risultato di 7 x 8?",
              "risposte": ["56", "54", "64", "48"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 57,
              "domanda": "Quale numero è primo?",
              "risposte": ["17", "15", "21", "27"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 58,
              "domanda": "Qual è il valore di π approssimato a due decimali?",
              "risposte": ["3.14", "3.16", "3.12", "3.18"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 59,
              "domanda": "Quanti gradi ha la somma degli angoli interni di un triangolo?",
              "risposte": ["180", "90", "360", "270"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 60,
              "domanda": "Qual è la radice quadrata di 144?",
              "risposte": ["12", "14", "16", "18"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Fisica": [
            {
              "id": 61,
              "domanda": "Qual è l'unità di misura della forza?",
              "risposte": ["Newton", "Joule", "Watt", "Pascal"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 62,
              "domanda": "Chi formulò la legge della gravitazione universale?",
              "risposte": ["Isaac Newton", "Albert Einstein", "Galileo Galilei", "Nikola Tesla"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 63,
              "domanda": "Qual è la velocità della luce nel vuoto (approssimativamente)?",
              "risposte": ["300.000 km/s", "150.000 km/s", "450.000 km/s", "600.000 km/s"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 64,
              "domanda": "Quale particella dell'atomo ha carica positiva?",
              "risposte": ["Protone", "Elettrone", "Neutrone", "Fotone"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 65,
              "domanda": "Quale famoso fisico formulò la teoria della relatività ristretta?",
              "risposte": ["Albert Einstein", "Niels Bohr", "Max Planck", "Werner Heisenberg"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Informatica": [
            {
              "id": 66,
              "domanda": "Cosa significa l'acronimo 'HTML'?",
              "risposte": ["HyperText Markup Language", "HighText Machine Language", "HyperTransfer Markup Language", "HighTech Markup Language"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 67,
              "domanda": "Quale società ha sviluppato il sistema operativo Windows?",
              "risposte": ["Microsoft", "Apple", "Google", "IBM"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 68,
              "domanda": "Quale linguaggio di programazione è noto per essere usato nello sviluppo web lato server?",
              "risposte": ["PHP", "Python", "Java", "C++"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 69,
              "domanda": "Cosa significa l'acronimo 'URL'?",
              "risposte": ["Uniform Resource Locator", "Universal Resource Link", "Uniform Resource Link", "Universal Resource Locator"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 70,
              "domanda": "Chi è considerato il padre dell'informatica?",
              "risposte": ["Alan Turing", "Bill Gates", "Steve Jobs", "Tim Berners-Lee"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Biologia": [
            {
              "id": 71,
              "domanda": "Qual è l'unità base della vita?",
              "risposte": ["La cellula", "L'atomo", "La molecola", "Il tessuto"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 72,
              "domanda": "Quale parte della pianta assorbe acqua e nutrienti dal terreno?",
              "risposte": ["Le radici", "Le foglie", "Il fusto", "I fiori"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 73,
              "domanda": "Quale organo del corpo umano pompa il sangue?",
              "risposte": ["Il cuore", "Il fegato", "I polmoni", "Il cervello"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 74,
              "domanda": "Quale scienziato propose la teoria dell'evoluzione per selezione naturale?",
              "risposte": ["Charles Darwin", "Gregor Mendel", "Louis Pasteur", "Alfred Wallace"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 75,
              "domanda": "Quante paia di cromosomi ha l'essere umano?",
              "risposte": ["23", "22", "24", "46"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ],
          "Astronomia": [
            {
              "id": 76,
              "domanda": "Qual è il pianeta più grande del sistema solare?",
              "risposte": ["Giove", "Saturno", "Nettuno", "Urano"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 77,
              "domanda": "Qual è la stella più vicina alla Terra?",
              "risposte": ["Il Sole", "Proxima Centauri", "Sirio", "Alpha Centauri"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "facile"
            },
            {
              "id": 78,
              "domanda": "Quale pianeta è noto per i suoi anelli?",
              "risposte": ["Saturno", "Giove", "Urano", "Nettuno"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 79,
              "domanda": "Quanti pianeti ci sono nel sistema solare?",
              "risposte": ["8", "7", "9", "10"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "medio"
            },
            {
              "id": 80,
              "domanda": "In quale anno l'uomo è atterrato sulla Luna per la prima volta?",
              "risposte": ["1969", "1965", "1972", "1959"],
              "corretta": 0,
              "punti": 100,
              "difficolta": "difficile"
            }
          ]
        },
        "bonus": [
          {
            "id": 111,
            "domanda": "Qual è il sistema operativo open source più popolare?",
            "risposte": ["Linux", "Windows", "macOS", "Android"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 112,
            "domanda": "Quale scienziato scoprì la penicillina?",
            "risposte": ["Alexander Fleming", "Louis Pasteur", "Marie Curie", "Robert Koch"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 113,
            "domanda": "Quale famoso matematico greco è noto per il suo teorema sui triangoli rettangoli?",
            "risposte": ["Pitagora", "Euclide", "Archimede", "Talete"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 114,
            "domanda": "Quale pianeta è noto come il 'pianeta gemello' della Terra?",
            "risposte": ["Venere", "Marte", "Mercurio", "Giove"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 115,
            "domanda": "Quanti bit ci sono in un byte?",
            "risposte": ["8", "4", "16", "32"],
            "corretta": 0,
            "punti": 100,
            "difficolta": "difficile"
          }
        ],
        "stima": [
          {
            "id": 211,
            "domanda": "Quanto vale approssimativamente il numero di Avogadro? (in notazione scientifica)",
            "corretta": "6.022e23",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 212,
            "domanda": "Quanti elementi chimici ci sono nella tavola periodica? (aggiornato)",
            "corretta": "118",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 213,
            "domanda": "Quante lune ha Saturno? (approssimativamente)",
            "corretta": "83",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 214,
            "domanda": "Quanti neuroni ci sono nel cervello umano? (in miliardi)",
            "corretta": "86",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 215,
            "domanda": "Quante operazioni al secondo può fare un supercomputer moderno? (in quadrilioni)",
            "corretta": "1",
            "punti": 100,
            "difficolta": "difficile"
          }
        ],
        "anagramma": [
          {
            "id": 311,
            "domanda": "Anagramma di 'ATOMO'",
            "corretta": "MOOTA",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 312,
            "domanda": "Anagramma di 'CELLA'",
            "corretta": "CALLE",
            "punti": 100,
            "difficolta": "facile"
          },
          {
            "id": 313,
            "domanda": "Anagramma di 'NUMERO'",
            "corretta": "MUNERO",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 314,
            "domanda": "Anagramma di 'FISICA'",
            "corretta": "CASIF I",
            "punti": 100,
            "difficolta": "medio"
          },
          {
            "id": 315,
            "domanda": "Anagramma di 'ASTROFISICA'",
            "corretta": "FISICA ASTRO",
            "punti": 100,
            "difficolta": "difficile"
          }
        ]
      }
    }
  };
  
  // Salva i dati di esempio nel file
  fs.writeFileSync(jsonPath, JSON.stringify(exampleData, null, 2), 'utf8');
  fullDb = exampleData;
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
      io.to('admin').emit('package_selected', { 
        packageId: currentPackageId,
        categories: currentPackage && currentPackage.categorie ? Object.keys(currentPackage.categorie) : []
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

Pronto per il gioco!
`));
