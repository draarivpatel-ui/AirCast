/**
 * AirCast - app.js
 * UI controller: packet encoding, Web Audio TX/RX, loopback, WAV export,
 * classroom card, BER sweep, and live visualizers.
 */
(function () {
  'use strict';
  const DSP = window.AirCastDSP;
  const Viz = window.AirCastViz;

  // ── State ─────────────────────────────────────────────────
  let profileId = 'audible';
  let currentLang = 'en';
  let currentFrame = null;
  let currentPCM = null;
  let currentSampleRate = 44100;
  let audioCtx = null;
  let txSource = null;
  let micStream = null;
  let analyser = null;
  let listenRaf = 0;
  let isListening = false;

  // Visualizers
  let scope, waterfall, berChart;

  // ── Preset payloads ───────────────────────────────────────
  const PRESETS = {
    quiz: JSON.stringify({
      type: "quiz",
      title: { en: "Newton's Laws - Quick Check", es: "Leyes de Newton - Evaluación", hi: "न्यूटन के नियम - त्वरित जाँच" },
      question: {
        en: "A 5 kg block accelerates at 3 m/s². What is the net force?  F = m·a",
        es: "Un bloque de 5 kg acelera a 3 m/s². ¿Cuál es la fuerza neta?  F = m·a",
        hi: "5 किग्रा का ब्लॉक 3 m/s² से त्वरित होता है। नेट बल क्या है?  F = m·a"
      },
      formula: "F = m \\cdot a = 5 \\times 3 = 15\\,\\text{N}",
      options: {
        en: ["10 N", "15 N", "25 N", "30 N"],
        es: ["10 N", "15 N", "25 N", "30 N"],
        hi: ["10 N", "15 N", "25 N", "30 N"]
      },
      answer: 1,
      hint: { en: "Multiply mass × acceleration.", es: "Multiplica masa × aceleración.", hi: "द्रव्यमान × त्वरण गुणा करें।" }
    }, null, 2),

    beacon: JSON.stringify({
      type: "beacon",
      id: "BEACON-0427",
      gps: { lat: 28.6139, lon: 77.2090, alt_m: 216 },
      triage: "YELLOW - ambulatory, laceration left arm",
      message: { en: "Need bandages + water at north gate", es: "Necesito vendas + agua en puerta norte", hi: "उत्तरी गेट पर पट्टियाँ + पानी चाहिए" },
      ts: "2026-11-03T14:30:00Z",
      ttl_hops: 4
    }, null, 2),

    token: JSON.stringify({
      type: "credential",
      issuer: "AirCast Academy",
      recipient: "student@aircast.demo",
      badge: "Acoustic Modem - Level 1",
      issued: "2026-11-03",
      proof: "HMAC-SHA256 placeholder - replace with real sig in prod",
      ecc: "Hamming(7,4) protected payload"
    }, null, 2),
  };

  // ── DOM refs ──────────────────────────────────────────────
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  // ── Init ──────────────────────────────────────────────────
  function init() {
    scope = new Viz.Oscilloscope($('#scopeCanvas'));
    waterfall = new Viz.Waterfall($('#waterfallCanvas'));
    berChart = new Viz.BERChart($('#berCanvas'));

    bindEvents();
    applyPayload(PRESETS.quiz, 'quiz');
    setProfile('audible');
    onResize();
    window.addEventListener('resize', onResize);
  }

  function onResize() { scope.draw(); waterfall.drawStatic(); berChart.draw(); }

  // ── Profile switching ─────────────────────────────────────
  function setProfile(id) {
    profileId = id;
    $$('#profileSwitcher .pill').forEach(b => b.classList.toggle('active', b.dataset.profile === id));
    const labels = { audible: 'Audible Classroom Chime (1.8-4.2 kHz)', ultrasonic: 'Near-Ultrasonic Whisper (16.5-19.5 kHz)', stress: 'Noisy Multipath Stress-Test' };
    $('#profileHint').textContent = 'Profile: ' + (labels[id] || id);
    const cc = $('#channelControls');
    cc.style.display = (id === 'stress') ? 'flex' : 'none';
    rebuildPacket();
  }
  function getProfile() { return DSP.PROFILES[profileId]; }

  // ── Payload handling ──────────────────────────────────────
  function applyPayload(text, presetKey) {
    $('#payloadInput').value = text;
    if (presetKey) {
      $$('.preset-bar .chip').forEach(c => c.classList.toggle('active', c.dataset.preset === presetKey));
    }
    rebuildPacket();
  }

  function rebuildPacket() {
    const text = $('#payloadInput').value;
    const bytes = DSP.strToBytes(text);
    const { frame, encoded, crc } = DSP.buildFrame(bytes);
    currentFrame = frame;

    const profile = getProfile();
    const synth = DSP.synthesizePCM(frame, profile);
    currentPCM = synth.pcm;
    currentSampleRate = synth.sampleRate;

    // Update inspector
    $('#payloadBytesHint').textContent = bytes.length + ' bytes · ' + frame.length + ' B frame';
    $('#segLen').textContent = ((encoded.length >> 8) & 0xFF).toString(16).padStart(2, '0') + ' ' + (encoded.length & 0xFF).toString(16).padStart(2, '0');
    $('#segPayload').textContent = bytes.length + ' B';
    $('#segCrc').textContent = ((crc >> 8) & 0xFF).toString(16).padStart(2, '0') + ' ' + (crc & 0xFF).toString(16).padStart(2, '0');
    $('#frameBadge').textContent = frame.length + ' B frame';
    $('#frameBadge').className = 'badge badge-ok';

    const durMs = DSP.estimateDurationMs(frame.length, profile);
    const bps = DSP.estimateBitrate(frame.length, profile);
    $('#kvFrameSize').textContent = frame.length + ' bytes';
    $('#kvEncSize').textContent = encoded.length + ' bytes (Hamming 7/4)';
    $('#kvDuration').textContent = durMs + ' ms';
    $('#kvBitrate').textContent = bps + ' bps';
    $('#kvCarriers').textContent = profile.freqs.map(f => Math.round(f)).join(', ') + ' Hz';
    $('#kvBaud').textContent = profile.baudMs + ' ms / symbol (4-FSK)';

    $('#hexDump').textContent = DSP.frameToHexDump(frame);
    $('#bitStream').textContent = DSP.bitStreamStr(frame).slice(0, 1200) + (frame.length > 150 ? ' …' : '');

    // Symbol table
    const bits = DSP.frameToBits(frame);
    const symbols = DSP.bitsToSymbols(bits);
    const freqs = DSP.getDataFreqs(profile);
    let symStr = '';
    for (let i = 0; i < Math.min(symbols.length, 80); i++) {
      const s = symbols[i];
      symStr += `S${String(i).padStart(3, '0')}: ${s.toString(2).padStart(2, '0')} → ${Math.round(freqs[s])} Hz\n`;
    }
    if (symbols.length > 80) symStr += `… +${symbols.length - 80} symbols`;
    symStr += `\nTotal: ${symbols.length} symbols · ${bits.length} bits`;
    $('#symbolTable').textContent = symStr;

    // Update visualizers with new PCM
    scope.setData(currentPCM, currentSampleRate);
    waterfall.buildFromPCM(currentPCM, currentSampleRate, profile);
  }

  // ── Toast ─────────────────────────────────────────────────
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ── Transmit ──────────────────────────────────────────────
  async function transmit() {
    if (!currentPCM) return;
    stopTransmit();
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: currentSampleRate });
      if (audioCtx.state === 'suspended') await audioCtx.resume();
    } catch (e) { toast('AudioContext error: ' + e.message); return; }

    const buf = audioCtx.createBuffer(1, currentPCM.length, currentSampleRate);
    buf.getChannelData(0).set(currentPCM);
    txSource = audioCtx.createBufferSource();
    txSource.buffer = buf;
    txSource.connect(audioCtx.destination);

    $('#txBadge').textContent = 'Transmitting…';
    $('#txBadge').className = 'badge badge-warn';
    $('#btnTransmit').disabled = true;
    $('#btnStopTx').disabled = false;

    // Animate playhead
    const startTime = audioCtx.currentTime;
    const duration = currentPCM.length / currentSampleRate;
    let raf = 0;
    function tick() {
      if (!audioCtx) return;
      const elapsed = audioCtx.currentTime - startTime;
      const samp = Math.floor(elapsed * currentSampleRate);
      scope.setPlayhead(samp);
      if (elapsed < duration + 0.15) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    txSource.onended = () => {
      cancelAnimationFrame(raf);
      scope.setPlayhead(-1);
      $('#txBadge').textContent = 'Done';
      $('#txBadge').className = 'badge badge-ok';
      $('#btnTransmit').disabled = false;
      $('#btnStopTx').disabled = true;
      setTimeout(() => { $('#txBadge').textContent = 'Ready'; $('#txBadge').className = 'badge badge-idle'; }, 1600);
    };
    txSource.start();
    toast('Transmitting ' + currentFrame.length + ' B frame (' + Math.round(duration * 1000) + ' ms)');
  }

  function stopTransmit() {
    try { if (txSource) { txSource.onended = null; txSource.stop(); } } catch (_) {}
    txSource = null;
    if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
    scope.setPlayhead(-1);
    $('#btnTransmit').disabled = false;
    $('#btnStopTx').disabled = true;
    $('#txBadge').textContent = 'Ready';
    $('#txBadge').className = 'badge badge-idle';
  }

  // ── WAV export ────────────────────────────────────────────
  function exportWAV() {
    if (!currentPCM) return;
    const blob = DSP.encodeWAV(currentPCM, currentSampleRate);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'aircast-packet-' + Date.now() + '.wav';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('WAV downloaded (' + Math.round(blob.size / 1024) + ' KB)');
  }

  // ── Microphone listener ───────────────────────────────────
  async function toggleListen() {
    if (isListening) { stopListening(); return; }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { toast('Microphone access denied: ' + e.message); return; }

    const ACtx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new ACtx();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    const src = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.15;
    src.connect(analyser);

    isListening = true;
    $('#btnListen').textContent = '■ Stop Listening';
    $('#btnListen').classList.add('active');
    $('#rxBadge').textContent = 'Listening…';
    $('#rxBadge').className = 'badge badge-warn';

    waterfall.clear();
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);

    function loop() {
      if (!isListening) return;
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);
      waterfall.pushAnalyserData(freqData);
      // Lightweight time-domain scope update (throttled)
      if (Math.random() < 0.15) {
        const pcm = new Float32Array(timeData.length);
        for (let i = 0; i < timeData.length; i++) pcm[i] = (timeData[i] - 128) / 128;
        scope.setData(pcm, audioCtx.sampleRate);
      }
      listenRaf = requestAnimationFrame(loop);
    }
    listenRaf = requestAnimationFrame(loop);
    toast('Listening via microphone - waterfall is live');
  }

  function stopListening() {
    isListening = false;
    cancelAnimationFrame(listenRaf);
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
    analyser = null;
    $('#btnListen').textContent = '🎙 Listen via Microphone';
    $('#btnListen').classList.remove('active');
    $('#rxBadge').textContent = 'Idle';
    $('#rxBadge').className = 'badge badge-idle';
  }

  // ── Loopback simulation ───────────────────────────────────
  function runLoopback() {
    if (!currentPCM) return;
    const snrDb = parseFloat($('#snrSlider').value);
    const echoMs = parseFloat($('#echoDelay').value);
    const echoAtten = parseFloat($('#echoAtten').value);
    const profile = getProfile();

    // Allow stress-test overrides even if profile isn't 'stress'
    const noisy = DSP.simulateChannel(currentPCM, currentSampleRate, {
      snrDb: snrDb,
      multipathDelayMs: echoMs > 0 ? echoMs : null,
      multipathAtten: echoAtten > 0 ? echoAtten : null,
    });

    // Update visualizers with noisy signal
    scope.setData(noisy, currentSampleRate);
    waterfall.buildFromPCM(noisy, currentSampleRate, profile);

    // Demodulate
    const result = DSP.demodulate(noisy, profile);
    const estSnr = DSP.estimateSNR(result.energies);
    renderReceiver(result, estSnr, snrDb);
    toast(`Loopback: SNR ${snrDb} dB → est. ${estSnr.toFixed(1)} dB, CRC ${result.parsed.ok ? '✓ PASS' : '✗ FAIL'}`);
  }

  // ── Receiver rendering ────────────────────────────────────
  function renderReceiver(result, estSnr, injectedSnr) {
    const p = result.parsed;

    // Symbol lock
    const lockOk = p && p.ok !== undefined;
    $('#kvLock').innerHTML = lockOk
      ? `<span style="color:var(--emerald)">● LOCK</span> · ${result.numSymbols} symbols`
      : `<span style="color:var(--amber)">○ SEARCH</span>`;
    $('#kvSnrEst').textContent = (isFinite(estSnr) ? estSnr.toFixed(1) : ' - ') + ' dB' + (injectedSnr != null ? ` (injected ${injectedSnr} dB)` : '');
    if (p) {
      $('#kvCrcCheck').innerHTML = p.ok
        ? `<span style="color:var(--emerald)">✓ PASS</span> <span style="color:var(--text-muted)">0x${p.calcCrc.toString(16).padStart(4, '0').toUpperCase()}</span>`
        : `<span style="color:#f87171">✗ FAIL</span> <span style="color:var(--text-muted)">rx 0x${(p.rxCrc||0).toString(16).padStart(4,'0').toUpperCase()} ≠ calc 0x${(p.calcCrc||0).toString(16).padStart(4,'0').toUpperCase()}</span>`;
      const n = p.corrections ? p.corrections.length : 0;
      $('#kvCorrections').innerHTML = n > 0
        ? `<span style="color:var(--emerald)">${n} single-bit error(s) corrected ✓</span>`
        : (p.ok ? `<span style="color:var(--text-muted)">0 - clean</span>` : `<span style="color:var(--amber)">0 (uncorrectable)</span>`);
    }

    $('#rxBadge').textContent = p && p.ok ? 'Decoded ✓' : (p ? 'CRC FAIL' : 'No frame');
    $('#rxBadge').className = p && p.ok ? 'badge badge-ok' : 'badge badge-err';

    // Bit viz
    const bits = result.bits || [];
    let bitHtml = bits.slice(0, 400).map((b, i) => {
      // Check if this bit was part of a corrected codeword
      const byteIdx = Math.floor(i / 8);
      const isCorrected = p && p.corrections && p.corrections.some(c => {
        // correction byteIdx refers to encoded payload index; approximate
        return false; // per-bit highlight via correction log instead
      });
      return `<span class="bit ${b ? 'bit-1' : 'bit-0'}">${b}</span>`;
    }).join('');
    if (bits.length > 400) bitHtml += `<span style="font:11px var(--mono);color:var(--text-dim);margin-left:6px;">+${bits.length - 400} bits</span>`;
    $('#rxBitViz').innerHTML = `<div class="bit-row">${bitHtml}</div>`;
    $('#rxBits').textContent = bits.slice(0, 600).join('') + (bits.length > 600 ? ' …' : '') || ' - ';

    // Correction log
    if (p && p.corrections && p.corrections.length) {
      $('#correctionLog').innerHTML = p.corrections.map(c =>
        `<span style="color:var(--emerald)">✔ Byte ${c.byteIdx} nibble ${c.nibble} - bit ${c.errorPos} flipped (syndrome corrected)</span>`
      ).join('<br>');
    } else if (p && !p.ok) {
      $('#correctionLog').innerHTML = `<span style="color:#f87171">Uncorrectable errors - frame failed CRC. Try higher SNR.</span>`;
    } else {
      $('#correctionLog').textContent = 'No errors - clean channel.';
    }

    // Classroom card - try to parse JSON
    renderClassroomCard(result.payloadStr, p && p.ok);
  }

  function renderClassroomCard(payloadStr, crcOk) {
    const card = $('#classroomCard');
    if (!payloadStr || !crcOk) {
      $('#cardTitle').textContent = 'Classroom Receiver';
      $('#cardBadge').textContent = crcOk === false ? 'CRC failed' : 'No packet';
      $('#cardBadge').className = crcOk === false ? 'badge badge-err' : 'badge badge-idle';
      $('#cardBody').innerHTML = '<p>Transmit or run loopback to decode a classroom packet.</p>';
      $('#cardQuiz').innerHTML = '';
      return;
    }

    let obj = null;
    try { obj = JSON.parse(payloadStr); } catch (_) {
      // Plain text
      $('#cardTitle').textContent = 'Decoded Text';
      $('#cardBadge').textContent = '✓ Verified';
      $('#cardBadge').className = 'badge badge-ok';
      $('#cardBody').innerHTML = `<p style="color:var(--text);white-space:pre-wrap;word-break:break-word;">${escHtml(payloadStr)}</p>`;
      $('#cardQuiz').innerHTML = '';
      return;
    }

    if (obj.type === 'quiz') {
      $('#cardTitle').textContent = getLocalized(obj.title);
      $('#cardBadge').textContent = 'Quiz Packet ✓';
      $('#cardBadge').className = 'badge badge-ok';
      const q = getLocalized(obj.question);
      const hint = obj.hint ? getLocalized(obj.hint) : '';
      $('#cardBody').innerHTML = `
        <p style="color:var(--text);font-weight:600;">${escHtml(q)}</p>
        ${obj.formula ? `<p style="font:12px var(--mono);background:var(--bg-raised);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--amber);">${escHtml(obj.formula)}</p>` : ''}
        ${hint ? `<p style="font-size:11px;color:var(--text-dim);">💡 ${escHtml(hint)}</p>` : ''}
      `;
      const opts = getLocalizedArray(obj.options);
      const ans = obj.answer;
      $('#cardQuiz').innerHTML = opts.map((o, i) =>
        `<div class="quiz-opt" data-idx="${i}" data-ans="${ans}"><span class="qo-letter">${String.fromCharCode(65 + i)}</span><span>${escHtml(o)}</span></div>`
      ).join('');
      // Bind quiz clicks
      $$('#cardQuiz .quiz-opt').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.dataset.idx, 10), ans2 = parseInt(el.dataset.ans, 10);
          $$('#cardQuiz .quiz-opt').forEach(x => { x.classList.remove('correct', 'wrong'); });
          if (idx === ans2) el.classList.add('correct');
          else { el.classList.add('wrong'); const correct = $(`#cardQuiz .quiz-opt[data-idx="${ans2}"]`); if (correct) correct.classList.add('correct'); }
        });
      });
    } else if (obj.type === 'beacon') {
      $('#cardTitle').textContent = '🚨 Emergency Beacon - ' + escHtml(obj.id || '');
      $('#cardBadge').textContent = 'Beacon ✓';
      $('#cardBadge').className = 'badge badge-ok';
      const msg = obj.message ? getLocalized(obj.message) : '';
      $('#cardBody').innerHTML = `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font:11px var(--mono);">
          <span style="color:var(--text-muted)">GPS</span><span>${obj.gps ? obj.gps.lat + ', ' + obj.gps.lon + ' · ' + obj.gps.alt_m + ' m' : ' - '}</span>
          <span style="color:var(--text-muted)">Triage</span><span style="color:var(--amber);font-weight:700;">${escHtml(obj.triage || ' - ')}</span>
          <span style="color:var(--text-muted)">TTL</span><span>${obj.ttl_hops ?? ' - '} hops</span>
          <span style="color:var(--text-muted)">Time</span><span>${escHtml(obj.ts || ' - ')}</span>
        </div>
        ${msg ? `<p style="margin-top:8px;color:var(--text);">“${escHtml(msg)}”</p>` : ''}
      `;
      $('#cardQuiz').innerHTML = '';
    } else if (obj.type === 'credential') {
      $('#cardTitle').textContent = '🔐 ' + escHtml(obj.badge || 'Credential');
      $('#cardBadge').textContent = 'Token ✓';
      $('#cardBadge').className = 'badge badge-ok';
      $('#cardBody').innerHTML = `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font:11px var(--mono);">
          <span style="color:var(--text-muted)">Issuer</span><span>${escHtml(obj.issuer || ' - ')}</span>
          <span style="color:var(--text-muted)">Recipient</span><span>${escHtml(obj.recipient || ' - ')}</span>
          <span style="color:var(--text-muted)">Issued</span><span>${escHtml(obj.issued || ' - ')}</span>
          <span style="color:var(--text-muted)">ECC</span><span style="color:var(--emerald)">${escHtml(obj.ecc || ' - ')}</span>
        </div>
        ${obj.proof ? `<p style="margin-top:8px;font:10px var(--mono);color:var(--text-dim);word-break:break-all;">${escHtml(obj.proof)}</p>` : ''}
      `;
      $('#cardQuiz').innerHTML = '';
    } else {
      $('#cardTitle').textContent = 'Decoded JSON';
      $('#cardBadge').textContent = '✓ Verified';
      $('#cardBadge').className = 'badge badge-ok';
      $('#cardBody').innerHTML = `<pre style="font:11px var(--mono);white-space:pre-wrap;word-break:break-word;color:var(--text);margin:0;">${escHtml(JSON.stringify(obj, null, 2))}</pre>`;
      $('#cardQuiz').innerHTML = '';
    }
  }

  function getLocalized(map) {
    if (typeof map === 'string') return map;
    if (!map || typeof map !== 'object') return String(map);
    return map[currentLang] || map.en || Object.values(map)[0] || '';
  }
  function getLocalizedArray(map) {
    if (Array.isArray(map)) return map;
    if (!map || typeof map !== 'object') return [];
    return map[currentLang] || map.en || Object.values(map)[0] || [];
  }
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── BER sweep ─────────────────────────────────────────────
  async function runBerSweep() {
    const btn = $('#btnBerSweep');
    btn.disabled = true; btn.textContent = 'Running…';
    $('#berStatus').textContent = 'Running 50 trials per SNR point…';
    const text = $('#payloadInput').value || 'Hello AirCast';
    const profile = getProfile();
    const snrPoints = [-5, -2, 0, 3, 6, 9, 12, 16, 20, 25];
    const trialsPerPoint = 50;

    const results = await DSP.runBERSweep(text, profile, snrPoints, trialsPerPoint, ({ done, total }) => {
      $('#berStatus').textContent = `Sweeping… ${done}/${total} SNR points`;
    });

    berChart.setData(results);
    $('#berStatus').textContent = `Done - ${snrPoints.length} points × ${trialsPerPoint} trials. Green = Hamming(7,4) ECC, amber = uncoded baseline.`;
    btn.disabled = false; btn.textContent = 'Run 50-trial SNR Sweep';
    toast('BER sweep complete');
  }

  // ── Self-test ─────────────────────────────────────────────
  function selfTest() {
    const checks = [];
    function assert(name, cond) { checks.push({ name, ok: !!cond }); }

    // CRC
    assert('CRC-16 empty', DSP.crc16(new Uint8Array([])) === 0xFFFF);
    assert('CRC-16 "123456789" == 0x29B1', DSP.crc16(DSP.strToBytes('123456789')) === 0x29B1);
    // Hamming round-trip
    for (let b = 0; b < 256; b++) {
      const enc = DSP.hammingEncode(new Uint8Array([b]));
      const dec = DSP.hammingDecode(enc);
      if (dec.bytes[0] !== b) { assert(`Hamming round-trip byte ${b}`, false); break; }
    }
    assert('Hamming round-trip 0x00..0xFF', true);
    // Single-bit correction
    {
      const enc = DSP.hammingEncode(new Uint8Array([0xA5]));
      const corrupted = new Uint8Array(enc);
      corrupted[0] ^= 0x04; // flip one bit
      const dec = DSP.hammingDecode(corrupted);
      assert('Hamming single-bit correction', dec.bytes[0] === 0xA5);
    }
    // Frame round-trip
    {
      const payload = DSP.strToBytes('Hello AirCast!');
      const { frame } = DSP.buildFrame(payload);
      const parsed = DSP.parseFrame(frame);
      assert('Frame CRC OK', parsed.ok);
      assert('Frame payload match', DSP.bytesToStr(parsed.payload) === 'Hello AirCast!');
    }
    // Modem loopback (clean)
    {
      const payload = DSP.strToBytes('loopback test 123');
      const { frame } = DSP.buildFrame(payload);
      const profile = DSP.PROFILES.audible;
      const synth = DSP.synthesizePCM(frame, profile);
      const res = DSP.demodulate(synth.pcm, profile);
      assert('Clean loopback CRC pass', res.parsed.ok);
      assert('Clean loopback payload', res.payloadStr === 'loopback test 123');
    }
    // WAV header
    {
      const pcm = new Float32Array([0, 0.5, -0.5, 1, -1]);
      const blob = DSP.encodeWAV(pcm, 44100);
      assert('WAV blob size = 44 + 10 bytes', blob.size === 44 + 10);
      assert('WAV mime type', blob.type === 'audio/wav');
    }

    const ok = checks.every(c => c.ok);
    $('#footerStatus').textContent = checks.map(c => (c.ok ? '✓' : '✗') + ' ' + c.name).join('  ·  ');
    $('#footerStatus').style.color = ok ? 'var(--emerald)' : '#f87171';
    toast(ok ? 'Self-test: all ' + checks.length + ' checks passed ✓' : 'Self-test: some checks failed');
    return ok;
  }

  // ── Event bindings ────────────────────────────────────────
  function bindEvents() {
    // Profile
    $$('#profileSwitcher .pill').forEach(b => b.addEventListener('click', () => setProfile(b.dataset.profile)));
    // Presets
    $$('.preset-bar .chip').forEach(c => c.addEventListener('click', () => applyPayload(PRESETS[c.dataset.preset], c.dataset.preset)));
    // Payload input
    let debounce = 0;
    $('#payloadInput').addEventListener('input', () => {
      $$('.preset-bar .chip').forEach(c => c.classList.remove('active'));
      clearTimeout(debounce);
      debounce = setTimeout(rebuildPacket, 250);
    });
    // TX
    $('#btnTransmit').addEventListener('click', transmit);
    $('#btnStopTx').addEventListener('click', stopTransmit);
    $('#btnWav').addEventListener('click', exportWAV);
    // Listen
    $('#btnListen').addEventListener('click', toggleListen);
    // Loopback
    $('#btnLoopback').addEventListener('click', runLoopback);
    // Channel sliders
    $('#snrSlider').addEventListener('input', e => $('#snrVal').textContent = e.target.value + ' dB');
    $('#echoDelay').addEventListener('input', e => $('#echoDelayVal').textContent = e.target.value + ' ms');
    $('#echoAtten').addEventListener('input', e => $('#echoAttenVal').textContent = parseFloat(e.target.value).toFixed(2));
    // BER sweep
    $('#btnBerSweep').addEventListener('click', runBerSweep);
    // Lang tabs
    $$('#langTabs .lang-tab').forEach(t => t.addEventListener('click', () => {
      currentLang = t.dataset.lang;
      $$('#langTabs .lang-tab').forEach(x => x.classList.toggle('active', x === t));
      // Re-render card if we have a decoded payload
      const text = $('#payloadInput').value;
      // Re-render from last decoded if available
      // Simplest: rebuild from current input's decoded view
      // We stash last result globally
      if (window._lastDemodResult) renderClassroomCard(window._lastDemodResult.payloadStr, window._lastDemodResult.parsed.ok);
    }));
    // Footer self-test
    $('#footerSelfTest').addEventListener('click', e => { e.preventDefault(); selfTest(); });

    // Intercept renderReceiver to stash last result for lang switching
    const _origRender = renderReceiver;
    renderReceiver = function (result, estSnr, injectedSnr) {
      window._lastDemodResult = result;
      return _origRender(result, estSnr, injectedSnr);
    };
  }

  // ── Boot ──────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
