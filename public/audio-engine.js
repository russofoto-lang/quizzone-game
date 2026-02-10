// ============================================
// SIPONTO QUIZ - AUDIO EFFECTS ENGINE
// Web Audio API synthesizer - no external files needed
// ============================================

const SipontoAudio = (function() {
    let ctx = null;
    let enabled = true;
    let volume = 0.5;
    let activeOscillators = [];

    function getCtx() {
        if (!ctx || ctx.state === 'closed') {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        return ctx;
    }

    function masterGain() {
        const ac = getCtx();
        const g = ac.createGain();
        g.gain.value = volume;
        g.connect(ac.destination);
        return g;
    }

    function stopAll() {
        activeOscillators.forEach(o => {
            try { o.stop(); } catch(e) {}
        });
        activeOscillators = [];
    }

    // ------------------------------------------
    // GONG - deep resonant hit
    // ------------------------------------------
    function gong() {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();

        [200, 250, 300, 400].forEach((freq, i) => {
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.3 / (i + 1), now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 3);
            osc.connect(gain);
            gain.connect(master);
            osc.start(now);
            osc.stop(now + 3);
            activeOscillators.push(osc);
        });
    }

    // ------------------------------------------
    // COUNTDOWN TICK - short click
    // ------------------------------------------
    function tick() {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();

        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.08);
    }

    // ------------------------------------------
    // COUNTDOWN TICK URGENT - higher pitch beep
    // ------------------------------------------
    function tickUrgent() {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();

        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'square';
        osc.frequency.value = 1200;
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.12);
    }

    // ------------------------------------------
    // TIME'S UP - alarm buzz
    // ------------------------------------------
    function timesUp() {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();

        for (let i = 0; i < 3; i++) {
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = 440;
            const start = now + i * 0.2;
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.3, start + 0.05);
            gain.gain.linearRampToValueAtTime(0, start + 0.15);
            osc.connect(gain);
            gain.connect(master);
            osc.start(start);
            osc.stop(start + 0.2);
            activeOscillators.push(osc);
        }
    }

    // ------------------------------------------
    // CORRECT ANSWER - happy rising chime
    // ------------------------------------------
    function correct() {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();

        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t = now + i * 0.1;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
            osc.connect(gain);
            gain.connect(master);
            osc.start(t);
            osc.stop(t + 0.4);
            activeOscillators.push(osc);
        });
    }

    // ------------------------------------------
    // WRONG ANSWER - descending buzz
    // ------------------------------------------
    function wrong() {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();

        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.linearRampToValueAtTime(200, now + 0.4);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.5);
        activeOscillators.push(osc);
    }

    // ------------------------------------------
    // BUZZER PRESS - loud buzz
    // ------------------------------------------
    function buzzer() {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();

        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'square';
        osc.frequency.value = 500;
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.3);
        activeOscillators.push(osc);
    }

    // ------------------------------------------
    // DRUM ROLL - rapid hits for suspense
    // ------------------------------------------
    function drumroll(durationSec) {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();
        const dur = durationSec || 3;
        const hits = Math.floor(dur * 20);

        for (let i = 0; i < hits; i++) {
            const t = now + (i / hits) * dur;
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = 'triangle';
            osc.frequency.value = 150 + Math.random() * 30;
            const vol = 0.1 + (i / hits) * 0.25;
            gain.gain.setValueAtTime(vol, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
            osc.connect(gain);
            gain.connect(master);
            osc.start(t);
            osc.stop(t + 0.05);
            activeOscillators.push(osc);
        }
    }

    // ------------------------------------------
    // FANFARE - victory jingle
    // ------------------------------------------
    function fanfare() {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();

        // C major fanfare: C E G C E G C
        const melody = [
            { f: 523.25, t: 0, d: 0.15 },
            { f: 659.25, t: 0.15, d: 0.15 },
            { f: 783.99, t: 0.3, d: 0.15 },
            { f: 1046.5, t: 0.5, d: 0.3 },
            { f: 783.99, t: 0.85, d: 0.1 },
            { f: 1046.5, t: 1.0, d: 0.5 },
        ];

        melody.forEach(note => {
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = 'triangle';
            osc.frequency.value = note.f;
            const t = now + note.t;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
            gain.gain.setValueAtTime(0.3, t + note.d * 0.7);
            gain.gain.exponentialRampToValueAtTime(0.001, t + note.d);
            osc.connect(gain);
            gain.connect(master);
            osc.start(t);
            osc.stop(t + note.d + 0.01);
            activeOscillators.push(osc);
        });
    }

    // ------------------------------------------
    // SUSPENSE - low pulsing drone
    // ------------------------------------------
    function suspense(durationSec) {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();
        const dur = durationSec || 5;

        const osc = ac.createOscillator();
        const lfo = ac.createOscillator();
        const lfoGain = ac.createGain();
        const gain = ac.createGain();

        osc.type = 'sine';
        osc.frequency.value = 100;
        lfo.type = 'sine';
        lfo.frequency.value = 4;
        lfoGain.gain.value = 0.15;

        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.setValueAtTime(0.2, now + dur - 0.5);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        lfo.start(now);
        osc.stop(now + dur);
        lfo.stop(now + dur);
        activeOscillators.push(osc, lfo);
    }

    // ------------------------------------------
    // WHEEL SPIN - accelerating then decelerating clicks
    // ------------------------------------------
    function wheelSpin(durationSec) {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();
        const dur = durationSec || 4;

        let t = 0;
        let interval = 0.04;
        const clicks = [];
        while (t < dur) {
            clicks.push(t);
            // accelerate first half, decelerate second half
            if (t < dur * 0.3) {
                interval = Math.max(0.03, interval - 0.001);
            } else {
                interval += 0.008;
            }
            t += interval;
        }

        clicks.forEach(ct => {
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = 'sine';
            osc.frequency.value = 600 + Math.random() * 200;
            const at = now + ct;
            gain.gain.setValueAtTime(0.2, at);
            gain.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
            osc.connect(gain);
            gain.connect(master);
            osc.start(at);
            osc.stop(at + 0.04);
            activeOscillators.push(osc);
        });
    }

    // ------------------------------------------
    // COUNTDOWN BEEPS - final 5 seconds pattern
    // ------------------------------------------
    function countdownBeeps(seconds) {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();
        const n = seconds || 5;

        for (let i = 0; i < n; i++) {
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = 'sine';
            const isLast = i === n - 1;
            osc.frequency.value = isLast ? 1000 : 700;
            const t = now + i;
            const dur = isLast ? 0.5 : 0.15;
            gain.gain.setValueAtTime(0.3, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
            osc.connect(gain);
            gain.connect(master);
            osc.start(t);
            osc.stop(t + dur + 0.01);
            activeOscillators.push(osc);
        }
    }

    // ------------------------------------------
    // POINT SCORED - short positive blip
    // ------------------------------------------
    function pointScored() {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();

        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.linearRampToValueAtTime(900, now + 0.1);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.2);
        activeOscillators.push(osc);
    }

    // ------------------------------------------
    // REVEAL - dramatic hit for showing answers
    // ------------------------------------------
    function reveal() {
        if (!enabled) return;
        const ac = getCtx();
        const now = ac.currentTime;
        const master = masterGain();

        // Impact hit
        const noise = ac.createBufferSource();
        const bufferSize = ac.sampleRate * 0.3;
        const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.05));
        }
        noise.buffer = buffer;
        const noiseGain = ac.createGain();
        noiseGain.gain.setValueAtTime(0.3, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        noise.connect(noiseGain);
        noiseGain.connect(master);
        noise.start(now);

        // Low tone
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = 150;
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.8);
        activeOscillators.push(osc);
    }

    // Public API
    return {
        gong: gong,
        tick: tick,
        tickUrgent: tickUrgent,
        timesUp: timesUp,
        correct: correct,
        wrong: wrong,
        buzzer: buzzer,
        drumroll: drumroll,
        fanfare: fanfare,
        suspense: suspense,
        wheelSpin: wheelSpin,
        countdownBeeps: countdownBeeps,
        pointScored: pointScored,
        reveal: reveal,
        stopAll: stopAll,

        setEnabled: function(val) { enabled = !!val; },
        isEnabled: function() { return enabled; },
        setVolume: function(val) { volume = Math.max(0, Math.min(1, val)); },
        getVolume: function() { return volume; },

        // Initialize audio context on user interaction
        init: function() {
            getCtx();
        }
    };
})();
