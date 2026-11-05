"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const privacy = require("../js/private-packets.js");
const packet = {version: 1, sequence: 0, intent: "measure", level: "ok", value: 7};
test("closed schemas reject extra fields and free-form values", () => {
  assert.equal(privacy.validatePacket(packet), true);
  assert.equal(privacy.validatePacket({...packet, private_field: "synthetic"}), false);
  assert.equal(privacy.validatePacket({...packet, intent: "free text"}), false);
  assert.equal(privacy.validatePacket({...packet, value: true}), false);
});
test("real AES-GCM round trip, replay and wrong-key rejection", async () => {
  const boundary = await privacy.createBoundary();
  const envelope = await boundary.seal(packet);
  assert.deepEqual(await boundary.open(envelope), packet);
  await assert.rejects(boundary.open(envelope));
  const wrong = await privacy.createBoundary();
  await assert.rejects(wrong.open(envelope));
  const second = await boundary.seal({...packet, sequence: 1});
  const changed = {...second, ciphertext: "AA=="};
  await assert.rejects(boundary.open(changed));
});
test("anonymous Ed25519 identity is signed and tampering is rejected", async () => {
  const credential = await privacy.createCredential();
  assert.equal(await privacy.verifyCredential(credential), true);
  assert.equal(await privacy.verifyCredential({...credential, badge: "tampered"}), false);
  assert.equal(Object.hasOwn(credential, "name"), false);
  assert.equal(Object.hasOwn(credential, "email"), false);
});
