/**
 * AirCast - spectrogram.js
 * Dual-canvas renderer: oscilloscope (time-domain) + waterfall spectrogram + BER chart.
 * Exports window.AirCastViz
 */
(function (global) {
  'use strict';

  // ── Helpers ───────────────────────────────────────────────

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || name;
  }

  function resizeCanvas(canvas, dpr) {
    dpr = dpr || window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    return { w, h, dpr, rectW: rect.width, rectH: rect.height };
  }

  // ── Oscilloscope ──────────────────────────────────────────
  class Oscilloscope {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.pcm = null;
      this.sampleRate = 44100;
      this.playhead = -1; // sample index of playback head, -1 = hidden
      this.markers = [];  // [{ freq, color }]
    }

    setData(pcm, sampleRate) {
      this.pcm = pcm;
      this.sampleRate = sampleRate || 44100;
      this.draw();
    }

    setPlayhead(sampleIdx) {
      this.playhead = sampleIdx;
      this.draw();
    }

    draw() {
      const c = this.canvas, ctx = this.ctx;
      const { w, h, dpr } = resizeCanvas(c);
      ctx.save();
      ctx.scale(dpr, dpr);
      const W = c.getBoundingClientRect().width;
      const H = c.getBoundingClientRect().height;

      // bg
      ctx.fillStyle = '#0B101B';
      ctx.fillRect(0, 0, W, H);

      // grid
      ctx.strokeStyle = 'rgba(6,182,212,0.10)';
      ctx.lineWidth = 0.5;
      const gridX = 8, gridY = 4;
      for (let i = 1; i < gridX; i++) { ctx.beginPath(); ctx.moveTo(W * i / gridX, 0); ctx.lineTo(W * i / gridX, H); ctx.stroke(); }
      for (let i = 1; i < gridY; i++) { ctx.beginPath(); ctx.moveTo(0, H * i / gridY); ctx.lineTo(W, H * i / gridY); ctx.stroke(); }

      // center line
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

      if (!this.pcm || !this.pcm.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(' -  idle -  transmit or run loopback to see waveform', W / 2, H / 2 + 4);
        ctx.restore();
        return;
      }

      // Draw waveform - downsample to screen width
      const pcm = this.pcm;
      const step = Math.max(1, Math.floor(pcm.length / W / 1.2));

      ctx.strokeStyle = '#06B6D4';
      ctx.lineWidth = 1.1;
      ctx.shadowColor = 'rgba(6,182,212,0.55)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const idx = Math.floor((x / W) * pcm.length);
        // min/max in window for envelope
        let mn = 1, mx = -1;
        for (let k = 0; k < step && idx + k < pcm.length; k++) {
          const v = pcm[idx + k];
          if (v < mn) mn = v; if (v > mx) mx = v;
        }
        const y = H / 2 - ((pcm[idx] || 0) * (H * 0.42));
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // playhead
      if (this.playhead >= 0 && this.playhead < pcm.length) {
        const px = (this.playhead / pcm.length) * W;
        ctx.strokeStyle = 'rgba(245,158,11,0.9)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
        ctx.setLineDash([]);
      }

      // label
      ctx.fillStyle = 'rgba(6,182,212,0.7)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(pcm.length.toLocaleString() + ' samples  @ ' + this.sampleRate + ' Hz', 8, 14);

      ctx.restore();
    }
  }

  // ── Waterfall Spectrogram ─────────────────────────────────
  class Waterfall {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.profile = null;
      this.rows = []; // each row = Float32Array of magnitudes
      this.maxRows = 220;
      this.numBins = 256;
      this._animId = null;
      this.frozen = false;
      this.pcmSnapshot = null;
    }

    setProfile(profile) { this.profile = profile; }

    clear() { this.rows = []; this.drawStatic(); }

    // Push FFT magnitudes (length numBins) as new bottom row
    pushRow(mags) {
      if (this.frozen) return;
      this.rows.push(mags);
      if (this.rows.length > this.maxRows) this.rows.shift();
      this.drawStatic();
    }

    // Build rows from PCM via short-time Goertzel/DFT
    buildFromPCM(pcm, sampleRate, profile) {
      this.profile = profile;
      this.rows = [];
      const sr = sampleRate || profile.sampleRate;
      const winSize = 512;
      const hop = 256;
      const numFrames = Math.floor((pcm.length - winSize) / hop);
      const nyquist = sr / 2;
      for (let f = 0; f < numFrames && this.rows.length < this.maxRows; f++) {
        const off = f * hop;
        // Window + DFT (naïve for 256 bins - fine for ~200 frames)
        const mags = new Float32Array(this.numBins);
        // Apply Hann window and compute DFT magnitude per bin
        // Optimized: only compute up to nyquist
        for (let k = 0; k < this.numBins; k++) {
          let re = 0, im = 0;
          const freq = (k / this.numBins) * nyquist;
          // DFT bin
          for (let n = 0; n < winSize; n++) {
            const w = 0.5 * (1 - Math.cos(2 * Math.PI * n / (winSize - 1))); // Hann
            const s = pcm[off + n] * w;
            const ang = 2 * Math.PI * freq * n / sr;
            re += s * Math.cos(ang);
            im -= s * Math.sin(ang);
          }
          mags[k] = Math.sqrt(re * re + im * im);
        }
        // Normalize row
        let mx = 0; for (let k = 0; k < mags.length; k++) if (mags[k] > mx) mx = mags[k];
        if (mx > 1e-9) for (let k = 0; k < mags.length; k++) mags[k] /= mx;
        this.rows.push(mags);
      }
      this.drawStatic();
    }

    // Live analyser push (from AnalyserNode frequency data)
    pushAnalyserData(freqData) {
      // freqData is Uint8Array 0-255 from AnalyserNode
      const mags = new Float32Array(this.numBins);
      const step = freqData.length / this.numBins;
      for (let k = 0; k < this.numBins; k++) {
        const idx = Math.floor(k * step);
        mags[k] = freqData[idx] / 255;
      }
      this.pushRow(mags);
    }

    drawStatic() {
      const c = this.canvas, ctx = this.ctx;
      const { w, h, dpr } = resizeCanvas(c);
      ctx.save();
      ctx.scale(dpr, dpr);
      const W = c.getBoundingClientRect().width;
      const H = c.getBoundingClientRect().height;

      ctx.fillStyle = '#0B101B';
      ctx.fillRect(0, 0, W, H);

      if (!this.rows.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(' -  waterfall -  awaiting signal', W / 2, H / 2 + 4);
        ctx.restore();
        return;
      }

      const rowH = H / this.rows.length;
      const colW = W / this.numBins;

      for (let r = 0; r < this.rows.length; r++) {
        const mags = this.rows[r];
        const y = r * rowH;
        for (let k = 0; k < mags.length; k++) {
          const v = mags[k];
          if (v < 0.04) continue;
          // teal → amber → magenta heatmap
          let rr, gg, bb, a;
          if (v < 0.45) {
            const t = v / 0.45;
            rr = Math.round(6 + t * 80); gg = Math.round(16 + t * 140); bb = Math.round(27 + t * 120); a = 0.55 + t * 0.45;
          } else if (v < 0.75) {
            const t = (v - 0.45) / 0.30;
            rr = Math.round(86 + t * 120); gg = Math.round(156 + t * 40); bb = Math.round(147 - t * 80); a = 0.9;
          } else {
            const t = (v - 0.75) / 0.25;
            rr = Math.round(206 + t * 30); gg = Math.round(196 - t * 80); bb = Math.round(67 + t * 70); a = 1;
          }
          ctx.fillStyle = `rgba(${rr},${gg},${bb},${a})`;
          ctx.fillRect(k * colW, y, Math.ceil(colW) + 0.5, Math.ceil(rowH) + 0.5);
        }
      }

      // Carrier markers
      if (this.profile) {
        const sr = this.profile.sampleRate;
        const nyquist = sr / 2;
        ctx.strokeStyle = 'rgba(236,72,153,0.85)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(236,72,153,0.95)';
        ctx.textAlign = 'center';
        for (const f of this.profile.freqs) {
          const x = (f / nyquist) * W;
          if (x < 0 || x > W) continue;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
          ctx.fillText(Math.round(f) + '', x, 10);
        }
        ctx.setLineDash([]);
      }

      // freq axis labels
      if (this.profile) {
        const nyquist = this.profile.sampleRate / 2;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'left'; ctx.fillText('0 Hz', 4, H - 4);
        ctx.textAlign = 'right'; ctx.fillText(Math.round(nyquist) + ' Hz', W - 4, H - 4);
      }

      ctx.restore();
    }
  }

  // ── BER Chart ─────────────────────────────────────────────
  class BERChart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.data = null; // [{snrDb, codedRate, uncodedRate}]
    }

    setData(data) { this.data = data; this.draw(); }
    clear() { this.data = null; this.draw(); }

    draw() {
      const c = this.canvas, ctx = this.ctx;
      const { w, h, dpr } = resizeCanvas(c);
      ctx.save();
      ctx.scale(dpr, dpr);
      const W = c.getBoundingClientRect().width;
      const H = c.getBoundingClientRect().height;

      ctx.fillStyle = '#0B101B';
      ctx.fillRect(0, 0, W, H);

      if (!this.data || !this.data.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BER sweep results will appear here', W / 2, H / 2 + 4);
        ctx.restore();
        return;
      }

      const pad = { l: 46, r: 14, t: 18, b: 28 };
      const plotW = W - pad.l - pad.r;
      const plotH = H - pad.t - pad.b;

      const snrs = this.data.map(d => d.snrDb);
      const minSnr = Math.min(...snrs), maxSnr = Math.max(...snrs);
      const snrRange = maxSnr - minSnr || 1;

      function sx(snr) { return pad.l + ((snr - minSnr) / snrRange) * plotW; }
      function sy(rate) { return pad.t + (1 - rate) * plotH; }

      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const y = pad.t + (i / 4) * plotH;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      }
      for (let i = 0; i <= 6; i++) {
        const x = pad.l + (i / 6) * plotW;
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
      }

      // axes labels
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      for (let i = 0; i <= 6; i++) {
        const snr = minSnr + (i / 6) * snrRange;
        ctx.fillText(Math.round(snr) + ' dB', pad.l + (i / 6) * plotW, H - 8);
      }
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const rate = 1 - i / 4;
        ctx.fillText(rate.toFixed(2), pad.l - 6, pad.t + (i / 4) * plotH + 3);
      }
      ctx.save();
      ctx.translate(12, H / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText('Frame Success Rate', 0, 0);
      ctx.restore();

      // lines
      function drawLine(key, color, width) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < c.data.length; i++) {
          const x = sx(c.data[i].snrDb), y = sy(c.data[i][key]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // dots
        ctx.fillStyle = color;
        for (let i = 0; i < c.data.length; i++) {
          const x = sx(c.data[i].snrDb), y = sy(c.data[i][key]);
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      const self = this;
      // bind for closure
      (function () {
        const c = self;
        // uncoded dashed
        ctx.strokeStyle = 'rgba(245,158,11,0.95)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        for (let i = 0; i < c.data.length; i++) {
          const x = sx(c.data[i].snrDb), y = sy(c.data[i].uncodedRate);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(245,158,11,0.95)';
        for (let i = 0; i < c.data.length; i++) {
          const x = sx(c.data[i].snrDb), y = sy(c.data[i].uncodedRate);
          ctx.beginPath(); ctx.arc(x, y, 2.8, 0, Math.PI * 2); ctx.fill();
        }
        // coded solid
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(16,185,129,0.4)'; ctx.shadowBlur = 6;
        ctx.beginPath();
        for (let i = 0; i < c.data.length; i++) {
          const x = sx(c.data[i].snrDb), y = sy(c.data[i].codedRate);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#10B981';
        for (let i = 0; i < c.data.length; i++) {
          const x = sx(c.data[i].snrDb), y = sy(c.data[i].codedRate);
          ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#0B101B'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = '#10B981';
        }
      })();

      // legend
      const lx = W - 170, ly = pad.t + 6;
      ctx.fillStyle = 'rgba(11,16,27,0.85)';
      ctx.fillRect(lx - 6, ly - 4, 164, 34);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.strokeRect(lx - 6, ly - 4, 164, 34);
      ctx.fillStyle = '#10B981'; ctx.fillRect(lx, ly + 4, 14, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillText('Hamming(7,4) ECC', lx + 20, ly + 8);
      ctx.fillStyle = 'rgba(245,158,11,0.95)'; ctx.fillRect(lx, ly + 18, 14, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fillText('Uncoded', lx + 20, ly + 22);

      ctx.restore();
    }
  }

  global.AirCastViz = { Oscilloscope, Waterfall, BERChart, resizeCanvas };

})(typeof window !== 'undefined' ? window : globalThis);
