// ✅ AGGIUNGERE QUESTE NUOVE VISTE per la SFIDA FINALE:

<!-- VISTA FINALE - SPIEGAZIONE -->
<div id="view-finale_explanation" class="view-section hidden absolute inset-0 bg-gradient-to-br from-red-900 via-orange-900 to-yellow-900 z-50 flex flex-col items-center justify-center overflow-y-auto">
    <div class="relative z-10 max-w-5xl text-center animate__animated animate__zoomIn px-4 py-2">
        <div class="text-5xl mb-2">🔥🔥🔥</div>
        
        <h1 class="text-5xl font-black text-white mb-2 uppercase tracking-tight animate__animated animate__fadeInDown">
            SFIDA FINALE
        </h1>
        <p class="text-4xl font-bold text-yellow-300 mb-4 animate__animated animate__fadeInUp" style="animation-delay: 0.2s;">
            5 PROVE
        </p>
        
        <div class="bg-black/40 rounded-2xl p-4 mb-3 text-left space-y-3">
            <!-- ALL IN -->
            <div class="border-b border-yellow-500/30 pb-3 animate__animated animate__fadeInLeft" style="animation-delay: 0.4s;">
                <h2 class="text-2xl font-black text-yellow-300 mb-1">💰 PROVA 1: ALL IN</h2>
                <p class="text-lg text-white mb-1">Scommetti: 100 - 200 - 300 - 500</p>
                <div class="ml-4 space-y-0.5 text-sm">
                    <p class="text-green-400">✅ Corretta → DOPPIO</p>
                    <p class="text-red-400">❌ Sbagliata → PERDI</p>
                </div>
            </div>
            
            <!-- PUNTI X2 -->
            <div class="border-b border-orange-500/30 pb-3 animate__animated animate__fadeInLeft" style="animation-delay: 0.6s;">
                <h2 class="text-2xl font-black text-orange-300 mb-1">🔥 PROVE 2-5: PUNTI x2</h2>
                <p class="text-lg text-white">Ogni risposta vale il DOPPIO!</p>
            </div>
            
            <!-- CLASSIFICA NASCOSTA -->
            <div class="animate__animated animate__fadeInLeft" style="animation-delay: 0.8s;">
                <h2 class="text-2xl font-black text-red-300 mb-1">⚠️ CLASSIFICA NASCOSTA</h2>
                <p class="text-lg text-white">Punteggi segreti fino alla fine!</p>
            </div>
        </div>
        
        <p class="text-2xl text-white font-bold mb-3 animate__animated animate__fadeIn" style="animation-delay: 1s;">
            Tutto può cambiare!
        </p>
        
        <div class="text-4xl mb-2 animate__animated animate__bounceIn" style="animation-delay: 1.2s;">
            🏆🏆🏆
        </div>
        
        <div id="finale-countdown" class="text-5xl font-black text-yellow-300 animate-pulse">
            PRONTI?
        </div>
    </div>
</div>

<!-- VISTA ALL IN BETTING -->
<div id="view-allin_betting" class="view-section hidden absolute inset-0 bg-gradient-to-br from-yellow-900 via-orange-900 to-red-900 z-50 flex flex-col items-center justify-center">
    <div class="text-center animate__animated animate__zoomIn">
        <div class="text-9xl mb-8 animate-bounce">💰</div>
        <h1 class="text-9xl font-black text-white mb-6 uppercase">ALL IN!</h1>
        <p class="text-6xl text-yellow-300 mb-12">Scommettete sui vostri telefoni!</p>
        <div class="bg-black/40 rounded-3xl p-8 max-w-2xl mx-auto">
            <p class="text-4xl text-white mb-4">Scegliete: 100 - 200 - 300 - 500</p>
            <p class="text-3xl text-green-400 mb-2">✅ Corretta → Doppio</p>
            <p class="text-3xl text-red-400">❌ Sbagliata → Perdi tutto</p>
        </div>
        <div class="mt-12 text-5xl text-yellow-300 animate-pulse">
            📱 Guardate i vostri telefoni! 📱
        </div>
    </div>
</div>

<!-- VISTA ALL IN RESULTS -->
<div id="view-allin_results" class="view-section hidden absolute inset-0 bg-gradient-to-br from-yellow-900 via-orange-800 to-red-900 z-50 flex flex-col items-center justify-center p-6 overflow-y-auto">
    <div class="w-full max-w-6xl animate__animated animate__fadeIn">
        <!-- Risultati verranno popolati dinamicamente -->
    </div>
</div>

// ✅ AGGIUNGERE QUESTI LISTENER SOCKET:

// SPIEGAZIONE FINALE con countdown
if(data.view === 'finale_explanation') {
    setTimeout(() => {
        const countdownEl = document.getElementById('finale-countdown');
        let count = 3;
        countdownEl.textContent = count;
        
        const countInterval = setInterval(() => {
            count--;
            if(count > 0) {
                countdownEl.textContent = count;
                countdownEl.classList.add('animate__animated', 'animate__bounce');
                setTimeout(() => countdownEl.classList.remove('animate__animated', 'animate__bounce'), 1000);
            } else {
                countdownEl.textContent = 'VIA!';
                countdownEl.classList.add('animate__animated', 'animate__heartBeat');
                clearInterval(countInterval);
                
                // Torna alla classifica dopo 3 secondi
                setTimeout(() => {
                    showView('classifica_gen');
                }, 3000);
            }
        }, 1000);
    }, 17000); // Dopo 17 secondi inizia countdown 3-2-1
}

// Ricevi evento ALL IN betting
socket.on('cambia_vista', (data) => {
    if(data.view === 'allin_betting') {
        showView('allin_betting');
        console.log('💰 Mostrata schermata ALL IN betting');
    }
});

// Ricevi risultati ALL IN
socket.on('finale_allin_results', (data) => {
    showView('allin_results');
    
    const container = document.querySelector('#view-allin_results .max-w-6xl');
    container.innerHTML = '';
    
    // Header risultati
    container.innerHTML = `
        <div class="text-center mb-8 animate__animated animate__fadeInDown">
            <div class="text-9xl mb-6 animate-bounce">💰</div>
            <h1 class="text-7xl font-black text-yellow-400 mb-4">RISULTATI ALL IN</h1>
            <div class="bg-black/40 rounded-3xl p-6 mb-6">
                <p class="text-3xl text-white mb-2">Domanda: "${data.question}"</p>
                <p class="text-2xl text-green-400">Risposta corretta: <span class="font-black">${data.correctAnswer}</span></p>
            </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    `;
    
    // Mostra risultati per ogni squadra
    if(data.results && data.results.length > 0) {
        data.results.forEach((result, index) => {
            const bgClass = result.correct ? 'bg-green-900/40' : 'bg-red-900/40';
            const emoji = result.correct ? '✅' : '❌';
            const points = result.correct ? `+${result.pointsChange}` : result.pointsChange;
            const pointsClass = result.correct ? 'text-green-400' : 'text-red-400';
            
            container.innerHTML += `
                <div class="${bgClass} p-6 rounded-2xl border-2 ${result.correct ? 'border-green-500' : 'border-red-500'} animate__animated animate__fadeInUp" style="animation-delay: ${index * 0.1}s">
                    <div class="flex justify-between items-start mb-3">
                        <div class="text-4xl">${emoji}</div>
                        <div class="text-5xl font-black ${pointsClass}">${points}</div>
                    </div>
                    <div class="text-3xl font-black mb-2">${result.teamName}</div>
                    <div class="text-lg text-gray-300 mb-1">Scommessa: ${result.bet} punti</div>
                    <div class="text-lg">Risposta: "${result.answer}"</div>
                    <div class="text-sm text-gray-400 mt-3">Nuovo totale: ${result.newScore} punti</div>
                </div>
            `;
        });
    } else {
        container.innerHTML += `
            <div class="col-span-2 text-center p-8">
                <div class="text-6xl mb-4">😢</div>
                <p class="text-3xl text-gray-400">Nessuna scommessa ricevuta</p>
            </div>
        `;
    }
    
    container.innerHTML += `
        </div>
        
        <div class="text-center mt-8">
            <div class="text-4xl text-yellow-300 animate-pulse">
                Prossima domanda tra 10 secondi...
            </div>
        </div>
    `;
    
    // Dopo 15 secondi torna alla classifica
    setTimeout(() => {
        showView('classifica_gen');
    }, 15000);
    
    console.log('💰 Risultati ALL IN mostrati:', data.results?.length, 'squadre');
});

// Se ricevi direttamente bets (compatibilità)
socket.on('finale_allin_reveal', (data) => {
    showView('allin_results');
    
    const container = document.querySelector('#view-allin_results .max-w-6xl');
    container.innerHTML = '';
    
    container.innerHTML = `
        <div class="text-center mb-8">
            <div class="text-9xl mb-6">💰</div>
            <h1 class="text-7xl font-black text-yellow-400 mb-4">ALL IN - RISULTATI</h1>
            <div class="bg-black/40 rounded-3xl p-6 mb-6">
                <p class="text-3xl text-white mb-2">${data.question}</p>
                <p class="text-2xl text-green-400">Risposta corretta: <span class="font-black">${data.correctAnswer}</span></p>
            </div>
        </div>
        
        <div class="space-y-4 max-w-4xl mx-auto">
    `;
    
    if(data.bets && data.bets.length > 0) {
        data.bets.forEach((bet, index) => {
            const isCorrect = bet.answer === data.correctAnswer;
            const points = isCorrect ? bet.bet : -bet.bet;
            const rowClass = isCorrect ? 'bg-green-900/40 border-green-500' : 'bg-red-900/40 border-red-500';
            
            container.innerHTML += `
                <div class="${rowClass} p-6 rounded-2xl border-2 animate__animated animate__fadeInLeft" style="animation-delay: ${index * 0.1}s">
                    <div class="flex justify-between items-center">
                        <div>
                            <div class="text-3xl font-black">${bet.teamName}</div>
                            <div class="text-lg mt-1">"${bet.answer}"</div>
                            <div class="text-sm text-gray-300 mt-2">Puntata: ${bet.bet} punti</div>
                        </div>
                        <div class="text-5xl font-black ${isCorrect ? 'text-green-400' : 'text-red-400'}">
                            ${points > 0 ? '+' : ''}${points}
                        </div>
                    </div>
                </div>
            `;
        });
    }
    
    container.innerHTML += `
        </div>
    `;
});
