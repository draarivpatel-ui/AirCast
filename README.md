# AirCast

A browser-local 4-FSK acoustic modem and privacy-boundary laboratory. Actual PCM synthesis, Gaussian channel simulation, Goertzel detection, error correction and integrity checks run in the JavaScript DSP engine.

This is 4-FSK, not OFDM. No physical room, microphone decoding reliability or communication range is claimed by the software loopback benchmark.

## Start and verify

```bash
python3 -m http.server 8000
npm test
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

Open `http://localhost:8000`. Speaker and microphone features require an appropriate secure context and permission. Channel simulations need neither device access nor network.

## Protocol version 2

The frame is `AA 56 | encoded length, 2 bytes | Hamming payload | CRC-16, 2 bytes`. The marker distinguishes the revised framing from the legacy integrity-before-correction format.

Each data nibble becomes a systematic Hamming(7,4) codeword stored in a byte. The syndrome lookup now matches the columns of the parity-check matrix. Every one of the 112 possible single-bit/nibble cases is tested.

The receiver corrects codewords before checking a CRC over the encoded-length field and decoded payload. A corrected single-bit error can therefore recover a valid frame. Legacy code checked corrupted encoded bytes, which defeated error recovery.

Odd codeword counts, invalid padding, oversized payloads, truncation and trailing frame data are rejected. Hamming can miscorrect multi-bit errors; CRC is an error-detection check, not a cryptographic authenticator.

The preamble chirp uses integrated linear-frequency phase. The detector still assumes known frame and symbol alignment in software loopback. Real asynchronous acoustic reception requires additional synchronization work.

## Measured channel comparisons

The BER sweep transmits and decodes both coded and genuinely uncoded frames through seeded Gaussian noise. Both displayed rates are measured counts. There is no theoretical/measured blending to smooth the chart.

The uncoded packet carries the same payload but takes less airtime. Comparisons are at equal input SNR and fixed symbol duration, not equal latency or equal energy per information bit. Coding is not guaranteed to improve frame recovery at every condition.

The privacy research package calls this exact DSP module from Node, reports authenticated packet recovery, Wilson intervals, correction counts, software runtime and over-the-air duration. Its fixtures are encrypted synthetic measurements, not recordings of people.

## Local cryptographic boundary

`js/private-packets.js` provides real WebCrypto AES-GCM packets with a closed schema and replay rejection. The schema permits only an enumerated intent, enumerated status, bounded numeric measurement and sequence. No direct personal fields or free-form text are accepted.

Concurrent receives cannot both accept the same nonce. Noncanonical nonce encodings cannot bypass replay checks. Keys are generated locally, are nonextractable and are not persisted. This helper has no network transport.

The studio also generates an anonymous Ed25519-signed identity object. It contains an opaque random subject, public key and signature. Verification establishes control of that ephemeral key, not a real identity, school affiliation or recognized credential issuer. The original unsigned example is labelled unsigned.

Closed schemas alone cannot prevent a malicious sender from encoding sensitive information in numbers. Compromised devices, traffic analysis and covert channels are outside the direct-field privacy claim.

## Studio features

The packet inspector exposes bytes, frame duration, carrier mapping and CRC. WAV export produces PCM audio. The loopback path displays demodulated bits, corrections and decoded demonstration cards.

The quiz examples include language variants. Emergency-beacon examples contain synthetic status data, not real people or locations. Microphone capture is a local spectral-monitor feature, not evidence of reliable two-device reception.

Air-quality panels use explicitly synthetic pollutant fixtures and illustrative curves. There is no live EPA feed, real-time respiratory prediction or clinical advice. Do not make health decisions from the demonstration.

## Hack Club Embassy positioning

The anonymous signed-identity feature is technically aligned with Embassy's public identity-project theme. The current public FAQ requires at least seven hours of project work and organizer approval.

This update does not create, backdate or claim human work hours, a shipped submission, an approved identity document or a reward. Program-specific AI and originality rules must be confirmed before using agent-written material in an entry. Stardance and ShaderGator have separate rules and cannot inherit Embassy eligibility.

MIT licensed. AI assistance is disclosed, and empirical results distinguish simulation from physical validation.
