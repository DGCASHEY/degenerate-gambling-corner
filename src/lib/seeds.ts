import { serverClient } from "./supabase/server";

// The website's only way into the provably fair seeds. Every function here
// calls a database function (supabase/migrations/..._fairness.sql) that does
// the real work. Nothing here ever sees the live secret: the database hands
// out only its fingerprint until the secret is retired.

export type SeedStatus = {
  // SHA-256 of the sealed secret, shown before any bet.
  fingerprint: string;
  clientWord: string;
  // The spin number the next bet will use.
  nextSpin: number;
  // The secret that goes live at the next rotation, sealed before the
  // player picks their next word.
  nextFingerprint: string;
};

export async function getSeedStatus(id: string): Promise<SeedStatus> {
  const { data, error } = await serverClient()
    .rpc("seed_status", { p_account: id })
    .single<{
      server_seed_hash: string;
      client_seed: string;
      next_spin: number;
      next_server_seed_hash: string;
    }>();
  if (error) throw new Error(error.message);
  return {
    fingerprint: data.server_seed_hash,
    clientWord: data.client_seed,
    nextSpin: Number(data.next_spin),
    nextFingerprint: data.next_server_seed_hash,
  };
}

export type RevealedSeed = {
  serverSeed: string;
  fingerprint: string;
  clientWord: string;
  // Spins 0 to spins - 1 were played with this secret.
  spins: number;
  revealedAt: Date;
};

export async function getRevealedSeeds(id: string): Promise<RevealedSeed[]> {
  const { data, error } = await serverClient().rpc("revealed_seeds", { p_account: id });
  if (error) throw new Error(error.message);
  return (data as Array<Record<string, string | number>>).map((r) => ({
    serverSeed: String(r.server_seed),
    fingerprint: String(r.server_seed_hash),
    clientWord: String(r.client_seed),
    spins: Number(r.spins),
    revealedAt: new Date(String(r.revealed_at)),
  }));
}

// Reveals the live secret and seals a new one with the given word (a random
// word when null). Returns the database's error code instead of throwing.
export async function rotateSeed(
  id: string,
  clientWord: string | null,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const { error } = await serverClient().rpc("rotate_seed", {
    p_account: id,
    p_client_seed: clientWord,
  });
  if (error) return { ok: false, code: error.message };
  return { ok: true };
}
