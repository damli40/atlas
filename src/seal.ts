// Sealing bets. A sealed bet is fixed before the run: its hash is shown on screen first,
// and anyone can later recompute it to confirm the bet was not changed after the run.
//
// sealedHash = sha256(canonicalJson({who, experimentId, question, measures, answer, nonce, sealedAt, rationale?}))
// The rationale (a model's reasoning) is sealed when the bet has one, so reasoning written after the
// run can never sit next to a sealed bet. A bet without a rationale hashes exactly the seven fields.
//
// canonicalJson writes the same object the same way every time (keys sorted at every
// level, no spaces), so the hash does not depend on the order fields were written in.
// The nonce is 16 random bytes, so nobody can guess a bet by hashing likely answers.
//
// SHA-256 is a small pure-TypeScript implementation (no dependency) so the same code
// runs synchronously in Node and in the browser; tests check it against node:crypto.

import { nanoid } from "nanoid";
import type { Bet } from "./types";

// ---------- canonical JSON ----------

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * JSON with keys sorted (by UTF-16 code unit, recursively) and no whitespace.
 * Throws on undefined, NaN, Infinity, bigint, functions, symbols, non-plain objects
 * (Date, Map, class instances) and cycles, rather than silently dropping or changing them.
 */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  const write = (v: unknown, path: string): string => {
    if (v === null) return "null";
    switch (typeof v) {
      case "string":
        return JSON.stringify(v);
      case "boolean":
        return v ? "true" : "false";
      case "number":
        if (!Number.isFinite(v)) throw new TypeError(`canonicalJson: ${path} is ${v}`);
        return JSON.stringify(v); // -0 is written as 0
      case "undefined":
        throw new TypeError(`canonicalJson: ${path} is undefined`);
      case "object": {
        if (seen.has(v)) throw new TypeError(`canonicalJson: ${path} is a cycle`);
        seen.add(v);
        let out: string;
        if (Array.isArray(v)) {
          const parts: string[] = [];
          for (let i = 0; i < v.length; i++) {
            if (!(i in v)) throw new TypeError(`canonicalJson: ${path}[${i}] is a hole`);
            parts.push(write(v[i], `${path}[${i}]`));
          }
          out = `[${parts.join(",")}]`;
        } else if (isPlainObject(v)) {
          const obj = v as Record<string, unknown>;
          const keys = Object.keys(obj).sort();
          out = `{${keys.map((k) => `${JSON.stringify(k)}:${write(obj[k], `${path}.${k}`)}`).join(",")}}`;
        } else {
          throw new TypeError(`canonicalJson: ${path} is not a plain object or array`);
        }
        seen.delete(v);
        return out;
      }
      default:
        throw new TypeError(`canonicalJson: ${path} is a ${typeof v}`);
    }
  };
  return write(value, "$");
}

// ---------- SHA-256 (FIPS 180-4) ----------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 of raw bytes, as 64 lowercase hex characters. */
export function sha256HexBytes(data: Uint8Array): string {
  const bitLen = data.length * 8;
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  // 64-bit big-endian length; split so lengths over 2^32 bits are written correctly.
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  let hex = "";
  for (const word of h) hex += word.toString(16).padStart(8, "0");
  return hex;
}

/** SHA-256 of a string's UTF-8 bytes, as 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  return sha256HexBytes(new TextEncoder().encode(text));
}

// ---------- sealing ----------

export type BetToSeal = Omit<Bet, "id" | "nonce" | "sealedAt" | "sealedHash"> & { id?: string };

type SealedFields = Pick<Bet, "who" | "experimentId" | "question" | "measures" | "answer" | "nonce" | "sealedAt" | "rationale">;

function sealPayload(bet: SealedFields) {
  return {
    who: bet.who,
    experimentId: bet.experimentId,
    question: bet.question,
    measures: bet.measures,
    answer: bet.answer,
    nonce: bet.nonce,
    sealedAt: bet.sealedAt,
    ...(bet.rationale !== undefined ? { rationale: bet.rationale } : {}),
  };
}

/** The hash a bet with these fields must carry. */
export function computeSealHash(bet: SealedFields): string {
  return sha256Hex(canonicalJson(sealPayload(bet)));
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Seal a bet: add a 16-byte random nonce, the time, and the hash. `now` is only for tests.
 * The rationale (model bets), when present, is part of the hash.
 */
export function sealBet(input: BetToSeal, now: Date = new Date()): Bet {
  const nonce = randomNonce();
  const sealedAt = now.toISOString();
  const { id, ...rest } = input;
  const bet: Omit<Bet, "sealedHash"> = { ...rest, id: id ?? nanoid(10), nonce, sealedAt };
  return { ...bet, sealedHash: computeSealHash(bet) };
}

/** True only if the bet's sealedHash is the hash of its sealed fields. Never throws. */
export function verifySeal(bet: Bet): boolean {
  try {
    if (!/^[0-9a-f]{32}$/.test(bet.nonce)) return false;
    if (!/^[0-9a-f]{64}$/.test(bet.sealedHash)) return false;
    return computeSealHash(bet) === bet.sealedHash;
  } catch {
    return false;
  }
}
