-- A tiny stand-in for the parts of Supabase our migrations depend on, so the
-- tests can run against a plain Postgres. Test-only: never applied to Supabase.

create schema if not exists auth;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- The roles Supabase uses. anon = logged-out browser, authenticated =
-- logged-in browser, service_role = our server.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to supabase_auth_admin;
grant all on auth.users to supabase_auth_admin;

-- Supabase hands every new table and function in public to all three roles
-- by default. Copying that here means the tests catch any grant we forget
-- to take away.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
