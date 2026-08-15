create extension if not exists pgcrypto;

create type public.room_status as enum ('LOBBY', 'ACTIVE', 'FINISHED', 'CANCELLED');
create type public.round_status as enum ('PENDING', 'ACTIVE', 'REVEAL', 'FINISHED', 'SKIPPED');
create type public.activity_type as enum ('LIKE', 'REPOST');
create type public.social_provider as enum ('TIKTOK');

create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 30),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider public.social_provider not null,
  provider_user_id text not null,
  provider_display_name text,
  provider_avatar_url text,
  connected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, provider_user_id),
  unique (user_id, provider)
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.social_account_tokens (
  social_account_id uuid primary key references public.social_accounts(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  encryption_key_version integer not null default 1,
  updated_at timestamptz not null default now()
);
revoke all on private.social_account_tokens from public, anon, authenticated;

create table public.social_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider public.social_provider not null default 'TIKTOK',
  provider_activity_id text,
  video_id text not null,
  video_url text not null,
  activity_type public.activity_type not null,
  activity_date timestamptz,
  imported_at timestamptz not null default now(),
  available boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, provider, activity_type, video_id)
);
create index social_activity_user_type_available_idx on public.social_activity(user_id, activity_type, available);
create index social_activity_video_idx on public.social_activity(video_id);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code varchar(6) not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  host_user_id uuid not null references public.users(id),
  status public.room_status not null default 'LOBBY',
  round_count integer not null check (round_count in (5,10,15,20)),
  guess_duration_seconds integer not null default 15 check (guess_duration_seconds in (10,15,20,30)),
  activity_types public.activity_type[] not null default array['LIKE']::public.activity_type[] check (cardinality(activity_types) >= 1),
  current_round_number integer not null default 0 check (current_round_number >= 0),
  game_number integer not null default 1 check (game_number >= 1),
  reveal_ends_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index rooms_status_idx on public.rooms(status);

create table public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  score integer not null default 0 check (score >= 0),
  ready boolean not null default true,
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (room_id, user_id)
);
create index room_players_room_active_idx on public.room_players(room_id) where left_at is null;

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_number integer not null,
  round_number integer not null,
  source_user_id uuid not null references public.users(id),
  activity_id uuid not null references public.social_activity(id),
  status public.round_status not null default 'PENDING',
  started_at timestamptz,
  answer_deadline timestamptz,
  revealed_at timestamptz,
  unique (room_id, game_number, round_number),
  unique (room_id, game_number, activity_id)
);
create index rounds_room_game_idx on public.rounds(room_id, game_number, round_number);

create table public.guesses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  guessing_user_id uuid not null references public.users(id),
  guessed_user_id uuid not null references public.users(id),
  submitted_at timestamptz not null default now(),
  correct boolean not null,
  points integer not null check (points in (0,1)),
  unique (round_id, guessing_user_id)
);
create index guesses_round_idx on public.guesses(round_id);

alter table public.users enable row level security;
alter table public.social_accounts enable row level security;
alter table public.social_activity enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.rounds enable row level security;
alter table public.guesses enable row level security;

create or replace function public.current_app_user_id() returns uuid
language sql stable security definer set search_path = public
as $$ select id from public.users where auth_user_id = auth.uid() limit 1 $$;

create policy users_read_self on public.users for select to authenticated
using (id = public.current_app_user_id());
create policy social_accounts_self on public.social_accounts for select to authenticated
using (user_id = public.current_app_user_id());
create policy social_activity_self on public.social_activity for select to authenticated
using (user_id = public.current_app_user_id());

create or replace function public.is_room_member(target_room_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.room_players rp
    where rp.room_id = target_room_id
      and rp.user_id = public.current_app_user_id()
      and rp.left_at is null
  )
$$;

revoke all on function public.current_app_user_id() from public, anon;
grant execute on function public.current_app_user_id() to authenticated;
revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;

create policy rooms_member_read on public.rooms for select to authenticated
using (public.is_room_member(rooms.id));

create policy room_players_member_read on public.room_players for select to authenticated
using (public.is_room_member(room_players.room_id));

-- Deliberately no client SELECT policies on rounds or guesses. Before reveal, those rows
-- contain source_user_id/correct and must only be transformed by trusted server code.

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;
