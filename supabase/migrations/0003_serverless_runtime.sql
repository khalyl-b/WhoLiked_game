-- Stateless/serverless game runtime.
-- These RPCs keep room transitions authoritative and atomic when multiple Vercel
-- function instances act on the same room concurrently.

create or replace function public.join_room_guarded(
  p_room_id uuid,
  p_user_id uuid,
  p_max_players integer default 10
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  room_state public.room_status;
  player_id uuid;
begin
  select status into room_state from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_state <> 'LOBBY' then raise exception 'ROOM_CLOSED' using errcode = 'P0001'; end if;

  select id into player_id
  from public.room_players
  where room_id = p_room_id and user_id = p_user_id and left_at is null;
  if player_id is not null then
    update public.room_players set connected = true where id = player_id;
    return player_id;
  end if;

  if (select count(*) from public.room_players where room_id = p_room_id and left_at is null) >= p_max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  insert into public.room_players(room_id, user_id, score, ready, connected, left_at)
  values (p_room_id, p_user_id, 0, true, true, null)
  on conflict (room_id, user_id) do update
    set left_at = null, connected = true, score = 0, ready = true
  returning id into player_id;
  return player_id;
end;
$$;

create or replace function private.reveal_current_round(p_room_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id;
  if not found or room_row.status <> 'ACTIVE' then return; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;

  if not found or round_row.status <> 'ACTIVE' then return; end if;

  update public.room_players rp
  set score = rp.score + g.points
  from public.guesses g
  where g.round_id = round_row.id
    and g.guessing_user_id = rp.user_id
    and rp.room_id = room_row.id
    and rp.left_at is null
    and g.correct = true;

  update public.rounds
  set status = 'REVEAL', revealed_at = clock_timestamp()
  where id = round_row.id and status = 'ACTIVE';

  update public.rooms
  set reveal_ends_at = clock_timestamp() + interval '4 seconds'
  where id = room_row.id;
end;
$$;

create or replace function private.advance_after_reveal(p_room_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  next_round public.rounds%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id;
  if not found or room_row.status <> 'ACTIVE' then return; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status not in ('REVEAL', 'SKIPPED') then return; end if;

  if round_row.status = 'REVEAL' then
    update public.rounds set status = 'FINISHED' where id = round_row.id and status = 'REVEAL';
  end if;

  if room_row.current_round_number >= room_row.round_count then
    update public.rooms
    set status = 'FINISHED', finished_at = clock_timestamp(), reveal_ends_at = null
    where id = room_row.id;
    return;
  end if;

  select * into next_round
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number + 1
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if next_round.status <> 'PENDING' then return; end if;

  update public.rooms
  set current_round_number = room_row.current_round_number + 1,
      reveal_ends_at = null
  where id = room_row.id;

  update public.rounds
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      answer_deadline = clock_timestamp() + make_interval(secs => room_row.guess_duration_seconds)
  where id = next_round.id and status = 'PENDING';
end;
$$;

create or replace function public.commit_game_start(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_game_number integer,
  p_player_ids uuid[],
  p_rounds jsonb
) returns void
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  active_count integer;
  round_count_payload integer;
  first_round_id uuid;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'LOBBY' or room_row.game_number <> p_game_number then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select count(*) into active_count from public.room_players where room_id = p_room_id and left_at is null;
  if active_count < 2 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if active_count <> cardinality(p_player_ids)
     or exists (
       select 1 from public.room_players rp
       where rp.room_id = p_room_id and rp.left_at is null and not (rp.user_id = any(p_player_ids))
     )
     or exists (
       select 1 from unnest(p_player_ids) requested(user_id)
       where not exists (
         select 1 from public.room_players rp
         where rp.room_id = p_room_id and rp.user_id = requested.user_id and rp.left_at is null
       )
     ) then
    raise exception 'PLAYER_SET_CHANGED' using errcode = 'P0001';
  end if;

  round_count_payload := jsonb_array_length(p_rounds);
  if round_count_payload <> room_row.round_count then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rounds) item
    left join public.social_activity sa on sa.id = (item->>'activityId')::uuid
    where sa.id is null
       or sa.user_id <> (item->>'sourceUserId')::uuid
       or sa.available = false
       or not (sa.activity_type = any(room_row.activity_types))
       or not ((item->>'sourceUserId')::uuid = any(p_player_ids))
  ) then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  if (
    select count(distinct sa.video_id)
    from jsonb_array_elements(p_rounds) item
    join public.social_activity sa on sa.id = (item->>'activityId')::uuid
  ) <> round_count_payload then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  if exists (
    select selected.video_id
    from (
      select sa.video_id
      from jsonb_array_elements(p_rounds) item
      join public.social_activity sa on sa.id = (item->>'activityId')::uuid
    ) selected
    join public.social_activity candidate
      on candidate.video_id = selected.video_id
     and candidate.user_id = any(p_player_ids)
     and candidate.available = true
     and candidate.activity_type = any(room_row.activity_types)
    group by selected.video_id
    having count(distinct candidate.user_id) > 1
  ) then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  delete from public.rounds where room_id = p_room_id and game_number = p_game_number;

  insert into public.rounds(room_id, game_number, round_number, source_user_id, activity_id, status)
  select p_room_id,
         p_game_number,
         ordinal::integer,
         (item->>'sourceUserId')::uuid,
         (item->>'activityId')::uuid,
         'PENDING'::public.round_status
  from jsonb_array_elements(p_rounds) with ordinality as input(item, ordinal);

  select id into first_round_id
  from public.rounds
  where room_id = p_room_id and game_number = p_game_number and round_number = 1
  for update;

  update public.room_players set score = 0 where room_id = p_room_id and left_at is null;
  update public.rooms
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      finished_at = null,
      current_round_number = 1,
      reveal_ends_at = null
  where id = p_room_id;

  update public.rounds
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      answer_deadline = clock_timestamp() + make_interval(secs => room_row.guess_duration_seconds)
  where id = first_round_id;
end;
$$;

create or replace function public.submit_guess_and_maybe_reveal(
  p_room_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  guess_id uuid;
  active_players integer;
  submitted_guesses integer;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if round_row.answer_deadline is null or clock_timestamp() > round_row.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessing_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessed_user_id and left_at is null) then
    raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001';
  end if;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, correct, points)
    values (
      round_row.id,
      p_guessing_user_id,
      p_guessed_user_id,
      p_guessed_user_id = round_row.source_user_id,
      case when p_guessed_user_id = round_row.source_user_id then 1 else 0 end
    ) returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;

  select count(*) into active_players from public.room_players where room_id = p_room_id and left_at is null;
  select count(*) into submitted_guesses from public.guesses where round_id = round_row.id;
  if submitted_guesses >= active_players then
    perform private.reveal_current_round(p_room_id);
  end if;
  return guess_id;
end;
$$;

create or replace function public.advance_room_clock(p_room_id uuid)
returns text
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then return 'NOOP'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;

  if round_row.status = 'ACTIVE' and round_row.answer_deadline is not null and clock_timestamp() >= round_row.answer_deadline then
    perform private.reveal_current_round(p_room_id);
    return 'REVEALED';
  end if;
  if round_row.status = 'REVEAL' and room_row.reveal_ends_at is not null and clock_timestamp() >= room_row.reveal_ends_at then
    perform private.advance_after_reveal(p_room_id);
    return 'ADVANCED';
  end if;
  return 'NOOP';
end;
$$;

create or replace function public.skip_current_round(p_room_id uuid, p_actor_user_id uuid)
returns void
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into round_row from public.rounds
  where room_id = p_room_id and game_number = room_row.game_number and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status not in ('ACTIVE', 'REVEAL') then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  update public.rounds set status = 'SKIPPED' where id = round_row.id;
  update public.rooms set reveal_ends_at = null where id = p_room_id;
  perform private.advance_after_reveal(p_room_id);
end;
$$;

create or replace function public.end_game_guarded(p_room_id uuid, p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare room_row public.rooms%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status not in ('LOBBY', 'ACTIVE') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.rooms set status = 'FINISHED', finished_at = clock_timestamp(), reveal_ends_at = null where id = p_room_id;
end;
$$;

create or replace function public.create_rematch_guarded(p_room_id uuid, p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare room_row public.rooms%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'FINISHED' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.rooms
  set game_number = game_number + 1,
      status = 'LOBBY',
      current_round_number = 0,
      started_at = null,
      finished_at = null,
      reveal_ends_at = null
  where id = p_room_id;
  update public.room_players set score = 0, ready = true where room_id = p_room_id and left_at is null;
end;
$$;

create or replace function public.leave_room_guarded(p_room_id uuid, p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  room_row public.rooms%rowtype;
  replacement uuid;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_actor_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;

  if room_row.status = 'ACTIVE' then
    update public.room_players set connected = false where room_id = p_room_id and user_id = p_actor_user_id;
  else
    update public.room_players set connected = false, left_at = clock_timestamp() where room_id = p_room_id and user_id = p_actor_user_id;
  end if;

  if room_row.host_user_id = p_actor_user_id then
    select user_id into replacement
    from public.room_players
    where room_id = p_room_id and user_id <> p_actor_user_id and left_at is null
    order by joined_at asc
    limit 1;
    if replacement is not null then update public.rooms set host_user_id = replacement where id = p_room_id; end if;
  end if;

  if room_row.status <> 'ACTIVE'
     and not exists (select 1 from public.room_players where room_id = p_room_id and left_at is null) then
    update public.rooms set status = 'CANCELLED' where id = p_room_id;
  end if;
end;
$$;

create or replace function public.kick_player_guarded(p_room_id uuid, p_actor_user_id uuid, p_target_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare room_row public.rooms%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'LOBBY' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_target_user_id = p_actor_user_id then raise exception 'INVALID_TARGET' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_target_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;
  update public.room_players set connected = false, left_at = clock_timestamp()
  where room_id = p_room_id and user_id = p_target_user_id;
end;
$$;

-- Server-only token helpers. The underlying token table remains outside the exposed public schema.
create or replace function public.upsert_social_account_token(
  p_social_account_id uuid,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text,
  p_access_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz,
  p_scopes text[]
) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  insert into private.social_account_tokens(
    social_account_id, access_token_ciphertext, refresh_token_ciphertext,
    access_token_expires_at, refresh_token_expires_at, scopes, updated_at
  ) values (
    p_social_account_id, p_access_token_ciphertext, p_refresh_token_ciphertext,
    p_access_token_expires_at, p_refresh_token_expires_at, coalesce(p_scopes, '{}'), clock_timestamp()
  )
  on conflict (social_account_id) do update set
    access_token_ciphertext = excluded.access_token_ciphertext,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    access_token_expires_at = excluded.access_token_expires_at,
    refresh_token_expires_at = excluded.refresh_token_expires_at,
    scopes = excluded.scopes,
    updated_at = clock_timestamp();
end;
$$;

create or replace function public.get_social_account_token(p_social_account_id uuid)
returns table(
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes text[]
)
language sql stable security definer set search_path = public, private as $$
  select t.access_token_ciphertext, t.refresh_token_ciphertext,
         t.access_token_expires_at, t.refresh_token_expires_at, t.scopes
  from private.social_account_tokens t
  where t.social_account_id = p_social_account_id
$$;

revoke all on function public.join_room_guarded(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.advance_room_clock(uuid) from public, anon, authenticated;
revoke all on function public.skip_current_round(uuid, uuid) from public, anon, authenticated;
revoke all on function public.end_game_guarded(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_rematch_guarded(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_room_guarded(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kick_player_guarded(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.upsert_social_account_token(uuid, text, text, timestamptz, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.get_social_account_token(uuid) from public, anon, authenticated;

-- The Next.js server uses a Supabase secret/service-role credential. Browser clients cannot call these mutation/token RPCs.
grant execute on function public.join_room_guarded(uuid, uuid, integer) to service_role;
grant execute on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) to service_role;
grant execute on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) to service_role;
grant execute on function public.advance_room_clock(uuid) to service_role;
grant execute on function public.skip_current_round(uuid, uuid) to service_role;
grant execute on function public.end_game_guarded(uuid, uuid) to service_role;
grant execute on function public.create_rematch_guarded(uuid, uuid) to service_role;
grant execute on function public.leave_room_guarded(uuid, uuid) to service_role;
grant execute on function public.kick_player_guarded(uuid, uuid, uuid) to service_role;
grant execute on function public.upsert_social_account_token(uuid, text, text, timestamptz, timestamptz, text[]) to service_role;
grant execute on function public.get_social_account_token(uuid) to service_role;

revoke all on function private.reveal_current_round(uuid) from public, anon, authenticated;
revoke all on function private.advance_after_reveal(uuid) from public, anon, authenticated;
