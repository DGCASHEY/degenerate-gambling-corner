-- Provably fair: sealed secrets, client words and the spin counter.
--
-- The promise this file keeps (see CLAUDE.md and /fairness):
--   * Before a player bets, the server has already sealed a secret and shown
--     them its fingerprint (SHA-256 of the secret). The fingerprint can only
--     ever match that one secret, so the secret can't be swapped later.
--   * The player picks the client word. There is always a NEXT secret,
--     sealed in advance, whose fingerprint the player sees before choosing a
--     new word. So the server can never pick a secret after seeing the word.
--   * Every spin gets the next number from a counter that only goes up.
--   * The numbers for a spin are HMAC-SHA256(key = secret,
--     message = "word:spin:round"), cut into 4-byte pieces, each divided by
--     2^32 to give a number from 0 up to (not including) 1. round is 0, 1,
--     2... for as many 32-byte blocks as the game needs.
--   * Rotating retires the live secret and reveals it, so every past spin
--     can be checked. The waiting secret goes live with the new word, and a
--     fresh one is sealed to wait. A live or waiting secret is never
--     revealed. A revealed one is frozen forever.
--   * The browser (anon / authenticated) can touch none of this.
--
-- src/lib/fairness.ts has the same recipe for the public verifier.
-- tests/cheat/fairness.test.ts proves the two always agree.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- The client word: 1 to 64 characters, no tabs or line breaks, no spaces at
-- either end. Anything that would be hard to paste back exactly is refused.
-- ---------------------------------------------------------------------------

create function public.client_seed_ok(p_word text) returns boolean
language sql immutable set search_path = '' as $$
  select p_word is not null
    and char_length(p_word) between 1 and 64
    and p_word = pg_catalog.btrim(p_word)
    and p_word !~ '[[:cntrl:]]'
$$;

-- ---------------------------------------------------------------------------
-- Seed pairs: a sealed secret plus a client word
--
-- Each pair is in one of three states:
--   waiting   client_seed is null. Sealed, fingerprint shown, not in use.
--   live      has a client word, not revealed. Every spin uses this one.
--   revealed  retired, secret readable by its player. Frozen.
-- ---------------------------------------------------------------------------

create table public.seed_pairs (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete restrict,
  -- 32 random bytes written as 64 hex characters. Secret until revealed.
  server_seed text not null check (server_seed ~ '^[0-9a-f]{64}$'),
  -- The fingerprint shown to the player: SHA-256 of server_seed's text.
  server_seed_hash text not null,
  -- null while waiting; set once, when the pair goes live.
  client_seed text,
  -- The number the next spin will use. Only ever goes up.
  next_spin bigint not null default 0 check (next_spin >= 0),
  created_at timestamptz not null default now(),
  revealed_at timestamptz,

  constraint seed_pair_fingerprint_matches check (
    server_seed_hash = encode(sha256(convert_to(server_seed, 'UTF8')), 'hex')
  ),
  constraint seed_pair_client_seed_ok check (
    client_seed is null or public.client_seed_ok(client_seed)
  )
);

-- At most one live pair and one waiting pair per player.
create unique index seed_pairs_one_live on public.seed_pairs (account_id)
where revealed_at is null and client_seed is not null;
create unique index seed_pairs_one_waiting on public.seed_pairs (account_id)
where client_seed is null;

-- Sealed: once written, the secret and fingerprint never change. A waiting
-- pair may only be given its word. A live pair's word never changes, its
-- counter only goes up, and it may be revealed. A revealed pair is frozen.
create function public.seed_pair_sealed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE'
    or old.revealed_at is not null
    or new.id is distinct from old.id
    or new.account_id is distinct from old.account_id
    or new.server_seed is distinct from old.server_seed
    or new.server_seed_hash is distinct from old.server_seed_hash
    or new.created_at is distinct from old.created_at
    or new.next_spin < old.next_spin
  then
    raise exception 'seed_pair_sealed';
  end if;

  if old.client_seed is null then
    -- Waiting: the only allowed change is receiving its word.
    if new.client_seed is null or new.next_spin <> old.next_spin or new.revealed_at is not null then
      raise exception 'seed_pair_sealed';
    end if;
  elsif new.client_seed is distinct from old.client_seed
    or (new.revealed_at is not null and new.next_spin <> old.next_spin)
  then
    raise exception 'seed_pair_sealed';
  end if;

  return new;
end $$;

create trigger seed_pairs_sealed_update before update on public.seed_pairs
for each row execute function public.seed_pair_sealed();
create trigger seed_pairs_sealed_delete before delete on public.seed_pairs
for each row execute function public.seed_pair_sealed();
create trigger seed_pairs_sealed_truncate before truncate on public.seed_pairs
for each statement execute function public.seed_pair_sealed();

-- ---------------------------------------------------------------------------
-- The recipe
-- ---------------------------------------------------------------------------

create function public.fair_numbers(
  p_server_seed text,
  p_client_seed text,
  p_spin bigint,
  p_count int
) returns double precision[]
language plpgsql immutable set search_path = '' as $$
declare
  v_out double precision[] := '{}';
  v_block bytea;
  v_round int := 0;
  v_i int;
begin
  if p_count is null or p_count < 1 or p_count > 64 then
    raise exception 'invalid_count';
  end if;

  while coalesce(array_length(v_out, 1), 0) < p_count loop
    v_block := extensions.hmac(
      convert_to(p_client_seed || ':' || p_spin::text || ':' || v_round::text, 'UTF8'),
      convert_to(p_server_seed, 'UTF8'),
      'sha256'
    );
    v_i := 0;
    while v_i < 32 and coalesce(array_length(v_out, 1), 0) < p_count loop
      v_out := v_out || (
        (get_byte(v_block, v_i)::bigint * 16777216
          + get_byte(v_block, v_i + 1) * 65536
          + get_byte(v_block, v_i + 2) * 256
          + get_byte(v_block, v_i + 3))::double precision / 4294967296
      );
      v_i := v_i + 4;
    end loop;
    v_round := v_round + 1;
  end loop;

  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Internal helpers (only other functions here call these)
-- ---------------------------------------------------------------------------

-- Seals a fresh secret to wait as the player's next one.
create function public.new_seed_pair(p_account uuid)
returns void
language plpgsql set search_path = '' as $$
declare
  v_seed text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.seed_pairs (account_id, server_seed, server_seed_hash)
  values (p_account, v_seed, encode(sha256(convert_to(v_seed, 'UTF8')), 'hex'));
end $$;

-- Puts the waiting secret live with the given word (a random 16-character
-- word when null), then seals a fresh one to wait. The caller has already
-- locked the player and retired any live pair.
create function public.activate_next_seed(p_account uuid, p_client_seed text)
returns public.seed_pairs
language plpgsql set search_path = '' as $$
declare
  v_pair public.seed_pairs;
begin
  update public.seed_pairs s
  set client_seed = coalesce(p_client_seed, encode(extensions.gen_random_bytes(8), 'hex'))
  where s.account_id = p_account and s.client_seed is null
  returning * into v_pair;
  perform public.new_seed_pair(p_account);
  return v_pair;
end $$;

-- Locks the player (so requests take turns, like the wallet) and returns
-- their live pair. A brand-new player gets a waiting secret sealed, then
-- put live with a random word; they choose their own word by rotating.
create function public.live_seed_pair(p_account uuid)
returns public.seed_pairs
language plpgsql set search_path = '' as $$
declare
  v_pair public.seed_pairs;
begin
  perform public.lock_account(p_account);
  if not exists (
    select 1 from public.seed_pairs s where s.account_id = p_account and s.client_seed is null
  ) then
    perform public.new_seed_pair(p_account);
  end if;

  select * into v_pair from public.seed_pairs s
  where s.account_id = p_account and s.revealed_at is null and s.client_seed is not null;
  if not found then
    v_pair := public.activate_next_seed(p_account, null);
  end if;
  return v_pair;
end $$;

-- The fingerprint of the secret waiting to be next.
create function public.next_seed_hash(p_account uuid) returns text
language sql stable set search_path = '' as $$
  select s.server_seed_hash from public.seed_pairs s
  where s.account_id = p_account and s.client_seed is null
$$;

-- ---------------------------------------------------------------------------
-- What the server calls
-- ---------------------------------------------------------------------------

-- What the player is shown before betting: the live secret's fingerprint,
-- their word, the next spin number, and the waiting secret's fingerprint.
-- Never a secret itself.
create function public.seed_status(p_account uuid)
returns table (
  server_seed_hash text,
  client_seed text,
  next_spin bigint,
  next_server_seed_hash text
)
language plpgsql set search_path = '' as $$
declare
  v_pair public.seed_pairs;
begin
  v_pair := public.live_seed_pair(p_account);
  return query select
    v_pair.server_seed_hash, v_pair.client_seed, v_pair.next_spin,
    public.next_seed_hash(p_account);
end $$;

-- Retires the live secret and reveals it. The waiting secret (whose
-- fingerprint the player has already seen) goes live with the new word, or
-- a random word when p_client_seed is null. A fresh secret is sealed to wait.
create function public.rotate_seed(p_account uuid, p_client_seed text)
returns table (
  revealed_server_seed text,
  revealed_server_seed_hash text,
  revealed_client_seed text,
  revealed_spins bigint,
  server_seed_hash text,
  client_seed text,
  next_server_seed_hash text
)
language plpgsql set search_path = '' as $$
declare
  v_old public.seed_pairs;
  v_new public.seed_pairs;
begin
  if p_client_seed is not null and not public.client_seed_ok(p_client_seed) then
    raise exception 'invalid_client_seed';
  end if;

  v_old := public.live_seed_pair(p_account);
  update public.seed_pairs s set revealed_at = now() where s.id = v_old.id;
  v_new := public.activate_next_seed(p_account, p_client_seed);

  return query select
    v_old.server_seed, v_old.server_seed_hash, v_old.client_seed, v_old.next_spin,
    v_new.server_seed_hash, v_new.client_seed, public.next_seed_hash(p_account);
end $$;

-- Takes the next spin number and the numbers for it, in one step. Games
-- (session 06 onwards) call this inside the same transaction as the bet.
-- The secret never leaves the database.
create function public.take_spin(p_account uuid, p_count int)
returns table (seed_pair_id bigint, spin bigint, numbers double precision[])
language plpgsql set search_path = '' as $$
declare
  v_pair public.seed_pairs;
begin
  if p_count is null or p_count < 1 or p_count > 64 then
    raise exception 'invalid_count';
  end if;

  v_pair := public.live_seed_pair(p_account);
  update public.seed_pairs s set next_spin = s.next_spin + 1 where s.id = v_pair.id;

  return query select
    v_pair.id,
    v_pair.next_spin,
    public.fair_numbers(v_pair.server_seed, v_pair.client_seed, v_pair.next_spin, p_count);
end $$;

-- A player's retired secrets, newest first, ready to check.
create function public.revealed_seeds(p_account uuid)
returns table (
  server_seed text,
  server_seed_hash text,
  client_seed text,
  spins bigint,
  created_at timestamptz,
  revealed_at timestamptz
)
language sql stable set search_path = '' as $$
  select s.server_seed, s.server_seed_hash, s.client_seed, s.next_spin, s.created_at, s.revealed_at
  from public.seed_pairs s
  where s.account_id = p_account and s.revealed_at is not null
  order by s.revealed_at desc, s.id desc
  limit 50
$$;

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

-- Row level security on, no policies: the browser can read nothing here.
alter table public.seed_pairs enable row level security;

revoke all on public.seed_pairs from public, anon, authenticated;
revoke all on function
  public.client_seed_ok(text),
  public.seed_pair_sealed(),
  public.fair_numbers(text, text, bigint, int),
  public.new_seed_pair(uuid),
  public.activate_next_seed(uuid, text),
  public.live_seed_pair(uuid),
  public.next_seed_hash(uuid),
  public.seed_status(uuid),
  public.rotate_seed(uuid, text),
  public.take_spin(uuid, int),
  public.revealed_seeds(uuid)
from public, anon, authenticated;

-- Not even the server may delete a secret. (It may update, but only in the
-- ways seed_pair_sealed allows: giving a waiting pair its word, counting
-- spins, and revealing.)
revoke delete, truncate on public.seed_pairs from service_role;
