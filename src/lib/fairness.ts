// The provably fair recipe, for checking results. It runs in any browser
// (and in Node) using the built-in Web Crypto, so the verifier page works
// out every number on the player's own machine.
//
// This file never decides a result. Real results come from the database
// (supabase/migrations/..._fairness.sql, public.take_spin). The two copies
// of the recipe must agree exactly; tests/cheat/fairness.test.ts checks.
//
// The recipe:
//   fingerprint = SHA-256(secret)
//   block(round) = HMAC-SHA256(key = secret, message = "word:spin:round")
//   Each 4 bytes of a block, read as one whole number and divided by 2^32,
//   is one number from 0 up to (not including) 1. round counts 0, 1, 2...
//   until there are enough numbers.

const text = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fingerprint(serverSeed: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", text.encode(serverSeed)));
}

export const MAX_NUMBERS_PER_SPIN = 64;

export async function fairNumbers(
  serverSeed: string,
  clientWord: string,
  spin: number,
  count: number,
): Promise<number[]> {
  const key = await crypto.subtle.importKey(
    "raw",
    text.encode(serverSeed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const out: number[] = [];
  for (let round = 0; out.length < count; round++) {
    const block = new DataView(
      await crypto.subtle.sign("HMAC", key, text.encode(`${clientWord}:${spin}:${round}`)),
    );
    for (let i = 0; i < 32 && out.length < count; i += 4) {
      out.push(block.getUint32(i) / 2 ** 32);
    }
  }
  return out;
}
