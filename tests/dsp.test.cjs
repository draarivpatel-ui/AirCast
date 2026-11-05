"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("../js/modem-dsp.js");
const dsp = globalThis.AirCastDSP;
test("CRC-16-CCITT has the standard check value", () => assert.equal(dsp.crc16(dsp.strToBytes("123456789")), 0x29B1));
for (let nibble = 0; nibble < 16; nibble++) {
  for (let bit = 0; bit < 7; bit++) {
    test("Hamming corrects nibble " + nibble + " bit " + bit, () => {
      const coded = dsp.hammingEncode4bits(nibble);
      assert.equal(dsp.hammingDecode7bits(coded ^ (1 << bit)).nibble, nibble);
    });
  }
}
test("all byte values survive v2 framing", () => {
  const bytes = Uint8Array.from({length: 256}, (_, i) => i);
  const parsed = dsp.parseFrame(dsp.buildFrame(bytes).frame);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.payload, bytes);
});
test("v2 checks integrity after correcting a codeword", () => {
  const bytes = dsp.strToBytes("privacy");
  const frame = dsp.buildFrame(bytes).frame;
  frame[4] ^= 1;
  const parsed = dsp.parseFrame(frame);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.corrections.length, 1);
  assert.deepEqual(parsed.payload, bytes);
});
test("double-bit corruption and malformed frames fail closed", () => {
  const frame = dsp.buildFrame(dsp.strToBytes("privacy")).frame;
  const changed = frame.slice(); changed[4] ^= 3;
  assert.equal(dsp.parseFrame(changed).ok, false);
  assert.equal(dsp.parseFrame(frame.slice(0, -1)).ok, false);
  assert.equal(dsp.parseFrame(Uint8Array.from([...frame, 0])).ok, false);
  const odd = frame.slice(); odd[3] |= 1;
  assert.equal(dsp.parseFrame(odd).ok, false);
  assert.throws(() => dsp.hammingDecode(Uint8Array.of(1)));
  assert.throws(() => dsp.buildFrame(new Uint8Array(32768)));
});
test("seeded noise is byte-for-byte reproducible", () => {
  const pcm = Float32Array.from([0.1, 0.2, 0.3, -0.4]);
  assert.deepEqual(dsp.addAWGN(pcm, 0, dsp.seededRandom(0)), dsp.addAWGN(pcm, 0, dsp.seededRandom(0)));
});
for (const profile of ["audible", "ultrasonic", "stress"]) {
  test("real PCM synthesis and Goertzel loopback " + profile, () => {
    const pcm = dsp.synthesizePCM(dsp.buildFrame(dsp.strToBytes("hi")).frame, dsp.PROFILES[profile]);
    const result = dsp.demodulate(pcm.pcm, dsp.PROFILES[profile]);
    assert.equal(result.parsed.ok, true);
    assert.equal(result.payloadStr, "hi");
  });
}
test("BER sweep reports only measured rates", async () => {
  const one = await dsp.runBERSweep("hi", dsp.PROFILES.audible, [-24, 0], 2, null, 0);
  const two = await dsp.runBERSweep("hi", dsp.PROFILES.audible, [-24, 0], 2, null, 0);
  assert.deepEqual(one, two);
  for (const point of one) {
    assert.ok([0, 0.5, 1].includes(point.codedRate));
    assert.ok([0, 0.5, 1].includes(point.uncodedRate));
    assert.ok(point.codedDurationMs > point.uncodedDurationMs);
  }
});
