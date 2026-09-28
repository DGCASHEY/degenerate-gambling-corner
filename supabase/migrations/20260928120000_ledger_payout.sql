-- A new kind of ledger line: a game paying out a win.
--
-- On its own because Postgres won't let a new kind be used in the same
-- transaction that creates it. The rule for it (always positive) is in the
-- next migration, ..._dice.sql.

alter type public.ledger_kind add value 'payout';
