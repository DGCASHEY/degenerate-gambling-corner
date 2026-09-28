import { createHash, createHmac, randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fairNumbers, fingerprint } from "../../src/lib/fairness";
import {
  connect,
  newAccount,
  revealedSeeds,
  rotateSeed,
  seedStatus,
  settle,
  sqlNumbers,
  takeSpin,
} from "../db/helpers";

// Session 05: provably fair. The server seals a secret and shows its
// fingerprint, the player picks a client word, a counter numbers every spin.
// These tests attack that promise from every side.

let db: pg.Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

// An independent copy of the published recipe, written with Node's own
// crypto. If our code and this ever disagree, one of them is wrong.
function reference(serverSeed: string, clientWord: string, spin: number, count: number) {
  const out: number[] = [];
  for (let round = 0; out.length < count; round++) {
    const block = createHmac("sha256", serverSeed).update(`${clientWord}:${spin}:${round}`).digest();
    for (let i = 0; i < 32 && out.length < count; i += 4) out.push(block.readUInt32BE(i) / 2 ** 32);
  }
  return out;
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

// Every unrevealed secret: the live one and the one waiting to be next.
async function sealedSecrets(account: string): Promise<string[]> {
  const { rows } = await db.query(
    "select server_seed from public.seed_pairs where account_id = $1 and revealed_at is null",
    [account],
  );
  expect(rows).toHaveLength(2);
  return rows.map((r) => r.server_seed);
}

// Runs one statement as someone other than the test's superuser, then undoes it.
async function as(role: "anon" | "authenticated" | "service_role", sql: string, params: unknown[] = []) {
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    return await settle(db.query(sql, params));
  } finally {
    await db.query("rollback");
  }
}

describe("the recipe", () => {
  // Worked out once with Node's crypto (see reference() above) and written
  // down. Any change to the maths, anywhere, breaks this.
  const SEED = "97ae8b7c2b9ca1b9b0e57cddce471a43b9daf3992c8af187554477353794ab6a";
  const SEED_HASH = "e35d0099d0c156da26ed621b52b5d525bb5450f42a45418e99d6af850fcaab92";
  const SPIN_0 = [
    0.21023646253161132, 0.4227449980098754, 0.13167562568560243, 0.25743141607381403,
    0.051350018940865993, 0.5361537004355341, 0.939801893197, 0.6269696576055139,
    0.5427603293210268, 0.8965921665076166,
  ];
  const SPIN_1 = [0.832590431207791, 0.5695155391003937];

  it("gives the written-down answer in the browser code", async () => {
    expect(await fingerprint(SEED)).toBe(SEED_HASH);
    expect(await fairNumbers(SEED, "raccoon", 0, 10)).toEqual(SPIN_0);
    expect(await fairNumbers(SEED, "raccoon", 1, 2)).toEqual(SPIN_1);
  });

  it("gives the written-down answer in the database", async () => {
    expect(await sqlNumbers(db, SEED, "raccoon", 0, 10)).toEqual(SPIN_0);
    expect(await sqlNumbers(db, SEED, "raccoon", 1, 2)).toEqual(SPIN_1);
  });
});

describe("the same three inputs always give the same answer", () => {
  const words = ["raccoon", "a", "lucky 7", "späß", "🦝🎲", "x".repeat(64), "colon:in:word"];

  it("in the browser code, the database and Node's crypto alike", async () => {
    for (let i = 0; i < 40; i++) {
      const seed = randomBytes(32).toString("hex");
      const word = words[i % words.length];
      const spin = i * 997;
      const count = 1 + (i % 20);

      const expected = reference(seed, word, spin, count);
      expect(await fairNumbers(seed, word, spin, count)).toEqual(expected);
      expect(await fairNumbers(seed, word, spin, count)).toEqual(expected);
      expect(await sqlNumbers(db, seed, word, spin, count)).toEqual(expected);
      expect(await sqlNumbers(db, seed, word, spin, count)).toEqual(expected);
    }
  });

  it("changes when any one of the three changes", async () => {
    const seed = randomBytes(32).toString("hex");
    const base = await fairNumbers(seed, "raccoon", 5, 4);
    expect(await fairNumbers(randomBytes(32).toString("hex"), "raccoon", 5, 4)).not.toEqual(base);
    expect(await fairNumbers(seed, "raccoon!", 5, 4)).not.toEqual(base);
    expect(await fairNumbers(seed, "raccoon", 6, 4)).not.toEqual(base);
  });

  it("only ever gives numbers from 0 up to (not including) 1", async () => {
    const numbers = await fairNumbers(randomBytes(32).toString("hex"), "raccoon", 0, 64);
    for (const n of numbers) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe("the revealed secret matches the fingerprint shown earlier", () => {
  it("and every past spin can be re-derived from it", async () => {
    const player = await newAccount(db);
    await rotateSeed(db, player, "my lucky word");

    // What the player saw before betting.
    const shown = await seedStatus(db, player);
    const spins = [await takeSpin(db, player, 3), await takeSpin(db, player, 3), await takeSpin(db, player, 3)];

    const { revealed } = await rotateSeed(db, player, "next word");

    expect(sha256(revealed.serverSeed)).toBe(shown.fingerprint);
    expect(await fingerprint(revealed.serverSeed)).toBe(shown.fingerprint);
    expect(revealed.fingerprint).toBe(shown.fingerprint);
    expect(revealed.clientWord).toBe("my lucky word");
    expect(revealed.spins).toBe(3);

    for (const s of spins) {
      expect(await fairNumbers(revealed.serverSeed, revealed.clientWord, s.spin, 3)).toEqual(s.numbers);
    }
  });

  it("is listed with the player's revealed secrets, and the new one is not", async () => {
    const player = await newAccount(db);
    const shown = await seedStatus(db, player);
    const { next } = await rotateSeed(db, player, "fresh");

    const list = await revealedSeeds(db, player);
    expect(list).toHaveLength(1);
    expect(list[0].fingerprint).toBe(shown.fingerprint);
    expect(sha256(list[0].serverSeed)).toBe(shown.fingerprint);
    expect(list.map((r) => r.fingerprint)).not.toContain(next.fingerprint);
  });

  it("starts a new sealed secret with the counter back at zero", async () => {
    const player = await newAccount(db);
    const before = await seedStatus(db, player);
    await takeSpin(db, player, 1);
    await rotateSeed(db, player, "new word");

    const after = await seedStatus(db, player);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.clientWord).toBe("new word");
    expect(after.nextSpin).toBe(0);
    expect((await takeSpin(db, player, 1)).spin).toBe(0);
  });
});

describe("cheat: choosing a secret after seeing the player's word", () => {
  it("shows the next secret's fingerprint before the word is chosen, and uses exactly that secret", async () => {
    const player = await newAccount(db);
    const before = await seedStatus(db, player);
    expect(before.nextFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(before.nextFingerprint).not.toBe(before.fingerprint);

    const { next } = await rotateSeed(db, player, "chosen after");
    expect(next.fingerprint).toBe(before.nextFingerprint);

    const after = await seedStatus(db, player);
    expect(after.fingerprint).toBe(before.nextFingerprint);
    expect(after.clientWord).toBe("chosen after");
    expect(after.nextFingerprint).not.toBe(before.nextFingerprint);
    expect(next.nextFingerprint).toBe(after.nextFingerprint);
  });

  it("refuses to spin on a secret that is still waiting", async () => {
    const player = await newAccount(db);
    await seedStatus(db, player);
    const result = await as(
      "service_role",
      "update public.seed_pairs set next_spin = 1 where account_id = $1 and client_seed is null",
      [player],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seed_pair_sealed/);
  });

  it("refuses to reveal a secret that is still waiting", async () => {
    const player = await newAccount(db);
    await seedStatus(db, player);
    const result = await as(
      "service_role",
      "update public.seed_pairs set revealed_at = now() where account_id = $1 and client_seed is null",
      [player],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seed_pair_sealed/);
  });
});

describe("cheat: peeking at the live secret", () => {
  it("nothing the player is shown contains it", async () => {
    const player = await newAccount(db);
    const status = await seedStatus(db, player);
    const spin = await takeSpin(db, player, 5);
    const shown = JSON.stringify([status, spin, await revealedSeeds(db, player)]);

    for (const secret of await sealedSecrets(player)) expect(shown).not.toContain(secret);
  });

  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot read the secrets table`, async () => {
      const result = await as(role, "select server_seed from public.seed_pairs");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });

    it(`${role} cannot call any seed function`, async () => {
      const player = await newAccount(db);
      for (const sql of [
        "select * from public.seed_status($1)",
        "select * from public.rotate_seed($1, 'x')",
        "select * from public.take_spin($1, 1)",
        "select * from public.revealed_seeds($1)",
      ]) {
        const result = await as(role, sql, [player]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/permission denied/);
      }
    });
  }
});

describe("cheat: changing a secret after its fingerprint was shown", () => {
  it("refuses a new secret, even with a matching new fingerprint", async () => {
    const player = await newAccount(db);
    await seedStatus(db, player);
    const swap = randomBytes(32).toString("hex");

    const result = await as(
      "service_role",
      "update public.seed_pairs set server_seed = $2, server_seed_hash = $3 where account_id = $1",
      [player, swap, sha256(swap)],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seed_pair_sealed/);
  });

  it("refuses a fingerprint that does not match its secret", async () => {
    const player = await newAccount(db);
    const result = await as(
      "service_role",
      "insert into public.seed_pairs (account_id, server_seed, server_seed_hash, client_seed) values ($1, $2, $3, 'x')",
      [player, randomBytes(32).toString("hex"), sha256("something else")],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seed_pair_fingerprint_matches/);
  });

  it("refuses to swap the client word under a live secret", async () => {
    const player = await newAccount(db);
    await seedStatus(db, player);
    const result = await as(
      "service_role",
      "update public.seed_pairs set client_seed = 'swapped' where account_id = $1",
      [player],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seed_pair_sealed/);
  });

  it("refuses to delete a secret", async () => {
    const player = await newAccount(db);
    await seedStatus(db, player);
    const result = await as("service_role", "delete from public.seed_pairs where account_id = $1", [player]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/permission denied/);
  });
});

describe("cheat: replaying a spin number", () => {
  it("never hands out the same spin twice, even to twenty requests at once", async () => {
    const player = await newAccount(db);
    await seedStatus(db, player);
    const clients = await Promise.all(Array.from({ length: 20 }, connect));

    try {
      const spins = await Promise.all(clients.map((c) => takeSpin(c, player, 1)));
      expect(spins.map((s) => s.spin).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
      expect(new Set(spins.map((s) => s.seedPairId)).size).toBe(1);
      expect((await seedStatus(db, player)).nextSpin).toBe(20);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("refuses to wind the counter back", async () => {
    const player = await newAccount(db);
    await takeSpin(db, player, 1);
    await takeSpin(db, player, 1);
    const result = await as(
      "service_role",
      "update public.seed_pairs set next_spin = 0 where account_id = $1",
      [player],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seed_pair_sealed/);
  });
});

describe("cheat: bringing a revealed secret back", () => {
  it("refuses to un-reveal it", async () => {
    const player = await newAccount(db);
    await seedStatus(db, player);
    await rotateSeed(db, player, "later");
    const result = await as(
      "service_role",
      "update public.seed_pairs set revealed_at = null where account_id = $1 and revealed_at is not null",
      [player],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seed_pair_sealed/);
  });

  it("refuses to spin on it again", async () => {
    const player = await newAccount(db);
    await takeSpin(db, player, 1);
    await rotateSeed(db, player, "later");
    const result = await as(
      "service_role",
      "update public.seed_pairs set next_spin = next_spin + 1 where account_id = $1 and revealed_at is not null",
      [player],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seed_pair_sealed/);
  });
});

describe("the client word", () => {
  it("is random until the player picks one", async () => {
    const a = await seedStatus(db, await newAccount(db));
    const b = await seedStatus(db, await newAccount(db));
    expect(a.clientWord).not.toBe(b.clientWord);
    expect(a.clientWord.length).toBeGreaterThan(0);
  });

  it("gets a random one when rotating without a word", async () => {
    const player = await newAccount(db);
    const { next } = await rotateSeed(db, player, null);
    expect(next.clientWord.length).toBeGreaterThan(0);
  });

  it("refuses words that would be hard to paste back exactly", async () => {
    const player = await newAccount(db);
    for (const word of ["", "x".repeat(65), " padded", "padded ", "tab\there", "line\nbreak"]) {
      const result = await settle(rotateSeed(db, player, word));
      expect(result.ok, JSON.stringify(word)).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/invalid_client_seed/);
    }
  });

  it("refuses silly amounts of numbers per spin", async () => {
    const player = await newAccount(db);
    for (const count of [0, 65]) {
      const result = await settle(takeSpin(db, player, count));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/invalid_count/);
    }
  });
});
