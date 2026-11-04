# AirCast — Ultrasonic & Audible OFDM Acoustic Data Modem

> **Browser-native acoustic data modem & offline classroom broadcast studio.**
> Zero dependencies. 100 % real DSP in the Web Audio API. Works between any two devices with a speaker and a microphone — or entirely in-software via a noisy channel simulator.

![AirCast](https://img.shields.io/badge/Web%20Audio-DSP-06B6D4) ![Zero Deps](https://img.shields.io/badge/deps-zero-10B981) ![License](https://img.shields.io/badge/license-MIT-7a8aaa)

---

## 1. What it does

AirCast turns the browser into a **software-defined acoustic modem**:

* **Modulates** JSON / text payloads into audible or near-ultrasonic MFSK tones played through the loudspeaker.
* **Demodulates** those tones captured by a microphone (or by a built-in AWGN + multipath channel simulator — no second device needed to demo).
* **Corrects** single-bit errors with Hamming(7,4) forward error correction and **verifies** frame integrity with CRC-16-CCITT.

It doubles as an **offline classroom broadcast studio**: a teacher encodes a multilingual STEM quiz (EN / ES / HI, with a LaTeX formula), transmits it acoustically, and every student's browser decodes and renders an interactive quiz card — no Wi-Fi required.

---

## 2. Acoustic protocol

### 2.1 Frame format

```
┌──────────────┬──────────┬────────────────────┬──────────────────────┬──────────────┐
│ Preamble     │ Length   │ Hamming(7,4)      │                      │ CRC-16-CCITT │
│ Chirp 0xAA55 │ 2 B BE   │ Encoded Payload    │  (FEC parity bits)   │ 2 B BE       │
│ 180–220 ms   │          │ 2× codewords / B   │  included in length  │ poly 0x1021  │
└──────────────┴──────────┴────────────────────┴──────────────────────┴──────────────┘
       ▲                ▲                       ▲                      ▲
  linear chirp    payload codeword count   4 data bits → 7-bit      init 0xFFFF
  f_lo → f_hi     (not raw bytes)         codeword (p0..p2 parity)  over [Length|Payload]
```

* **Preamble** — linear frequency chirp sweeping the profile's carrier band; used for frame sync.
* **Length** — number of Hamming codeword bytes that follow (big-endian `uint16`).
* **Hamming(7,4) payload** — each source byte is split into two nibbles; each nibble is encoded into a 7-bit codeword (stored in one byte, MSB zero).
* **CRC-16-CCITT** — polynomial `0x1021`, init `0xFFFF`, computed over `[Length | Encoded Payload]`.

### 2.2 Hamming(7,4) — systematic code

```
Data bits:  d0 d1 d2 d3
Parity:     p0 = d0⊕d1⊕d2
            p1 = d0⊕d1⊕d3
            p2 = d0⊕d2⊕d3
Codeword:  [d0 d1 d2 d3 p0 p1 p2]   (7 bits)
```

On decode the 3-bit syndrome `s = H·rᵀ` indexes a lookup table to locate and flip the single erroneous bit. Any single-bit error per 7-bit codeword is corrected; double-bit errors are detected but not corrected (CRC will still fail).

### 2.3 CRC-16-CCITT

Table-driven implementation (256-entry LUT), polynomial `0x1021`, init `0xFFFF`, no final XOR. Test vector: `CRC("123456789") == 0x29B1`.

### 2.4 Modulation — 4-FSK with raised-cosine pulse shaping

* **Constellation:** 4 tones selected from the profile's carrier set → 2 bits per symbol.
* **Symbol mapping:** bits are packed MSB-first; each consecutive pair selects one of the four data carriers.
* **Windowing:** each symbol window is shaped with a raised-cosine roll-off (12 % of symbol duration on each edge) to suppress spectral leakage.
* **Sample rate:** 44.1 kHz (audible / stress) or 48 kHz (ultrasonic).

| Profile | Carriers (Hz) | Baud | Preamble | Sample rate |
|---------|---------------|------|----------|-------------|
| Audible Classroom Chime | 1850 2250 2650 3100 3550 4000 | 90 ms | 220 ms | 44.1 kHz |
| Near-Ultrasonic Whisper | 16500 17000 17500 18000 18600 19200 | 70 ms | 180 ms | 48 kHz |
| Noisy Multipath Stress-Test | same as Audible | 90 ms | 220 ms | 44.1 kHz |

Estimated over-the-air bitrate ≈ **22 bps** (audible) / **28 bps** (ultrasonic) for typical payloads — enough for quiz packets and beacons in a few seconds.

### 2.5 Demodulation — Goertzel tone detector

For each symbol window the Goertzel algorithm evaluates energy at the four candidate frequencies. The tone with maximum energy wins. This is O(N) per tone and far cheaper than a full FFT when only a handful of bins matter.

### 2.6 Noisy channel simulator

* **AWGN** — Box-Muller Gaussian noise scaled to the requested SNR (dB): `P_noise = P_signal / 10^(SNR/10)`.
* **Multipath echo** — single delayed replica: `y[n] = x[n] + α·x[n − D]` with configurable delay (ms) and attenuation α.
* Both impairments can be combined and are applied before demodulation in the Loopback path.

---

## 3. Project structure

```
AirCast/
├── index.html          — 3-column instrument studio UI
├── styles.css          — oscilloscope / spectrum-analyzer dark theme
├── js/
│   ├── modem-dsp.js    — CRC, Hamming, framing, MFSK synthesis, WAV, Goertzel, BER sweep
│   ├── spectrogram.js  — oscilloscope, waterfall, BER chart canvas renderers
│   └── app.js          — UI controller, Web Audio TX/RX, classroom card, presets
└── README.md
```

---

## 4. Running locally

No build step, no dependencies, no server required.

```bash
# Option A — open directly
open index.html

# Option B — serve (needed for microphone access on some browsers)
npx serve .
# or
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a modern browser (Chrome / Edge / Firefox / Safari).

---

## 5. How to demo (judge walkthrough)

1. **Pick a payload** — click a preset chip (Quiz / Beacon / Token) or type custom text/JSON in the composer.
2. **Inspect the frame** — the left panel shows the hex dump, bit-stream, symbol table, duration and bitrate updating live.
3. **Transmit** — click **Transmit over Speakers** to play the modulated audio. Click **Export WAV** to download a valid `.wav` file.
4. **Loopback without a second device** — click **Acoustic Loopback Simulation** (adjust SNR / echo sliders in Stress-Test profile) to run the full chain: `PCM → AWGN+multipath → Goertzel demod → Hamming correction → CRC check → decoded classroom card`.
5. **Listen via microphone** — click **Listen via Microphone** to see the live waterfall from the mic (works across two devices/laptops).
6. **BER sweep** — click **Run 50-trial SNR Sweep** to benchmark Hamming(7,4) vs uncoded frame recovery across −5 to +25 dB SNR.
7. **Change carrier band** — switch between Audible / Ultrasonic / Stress-Test at the top; the oscilloscope and waterfall update immediately.
8. **Multilingual quiz** — after a successful decode, toggle EN / ES / HI tabs on the classroom card and tap an answer to see correct/wrong feedback.

---

## 6. Classroom use cases

| Scenario | Payload | Why acoustic? |
|----------|---------|---------------|
| Offline quiz broadcast | STEM quiz JSON with LaTeX formula | No Wi-Fi; works in rural / exam-hall settings |
| Emergency mesh beacon | GPS + triage status | Infrastructure-down coordination |
| Micro-credential | Signed token + Hamming ECC | Tamper-evident, error-resilient handout |

All payloads are UTF-8 JSON; any custom content can be composed in the live editor.

---

## 7. Self-test

Click **Run self-test** in the footer (or open DevTools console and call `AirCastDSP` directly). Checks:

* CRC-16 test vectors
* Hamming encode → decode round-trip for all 256 byte values
* Single-bit error correction
* Frame build → parse round-trip
* Clean modem loopback (synthesis → demodulation → payload match)
* WAV header validity

Zero console errors on load.

---

## 8. Browser support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Web Audio synthesis | ✅ | ✅ | ✅ | ✅ |
| Microphone capture | ✅ (HTTPS or localhost) | ✅ | ✅ | ✅ |
| WAV export | ✅ | ✅ | ✅ | ✅ |
| Canvas visualizers | ✅ | ✅ | ✅ | ✅ |

Microphone access requires a secure context (HTTPS or `localhost`).

---

## 9. Acknowledgements

Built for **Hack Club Embassy**, **STEM2Connect AI Hackathon (31789)**, **ML Empowerment Build Challenge 4.0 (31960)**, and **Task 5 — Cross-Language Classroom Live Note & Quiz Broadcaster**. All DSP is original and runs entirely in the browser.

---

*AirCast — hear the data.*
