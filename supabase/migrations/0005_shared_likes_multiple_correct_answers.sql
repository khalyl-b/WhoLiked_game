-- Shared likes are valid rounds.
-- A video can be owned by multiple players in the same room. Any player whose
-- matching activity exists for the round's video/type is a correct answer.

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

  -- The scheduled owner must genuinely own the selected activity. It is an
  -- anchor used for fair round allocation, not necessarily the only correct user.
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

  -- A video may only be used once per game, even if several players liked it.
  if (
    select count(distinct sa.video_id)
    from jsonb_array_elements(p_rounds) item
    join public.social_activity sa on sa.id = (item->>'activityId')::uuid
  ) <> round_count_payload then
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
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  active_players integer;
  submitted_guesses integer;
  is_correct boolean;
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

  select * into selected_activity from public.social_activity where id = round_row.activity_id;
  if not found or selected_activity.available = false then
    raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The guess is correct if that room member has the same video under the same
  -- activity type. Shared likes therefore create multiple valid answers.
  select exists (
    select 1
    from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, correct, points)
    values (
      round_row.id,
      p_guessing_user_id,
      p_guessed_user_id,
      is_correct,
      case when is_correct then 1 else 0 end
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

-- Keep the older guarded RPC consistent in case any stale deployment calls it.
create or replace function public.submit_guess_guarded(
  p_round_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  is_correct boolean;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if r.answer_deadline is null or clock_timestamp() > r.answer_deadline then raise exception 'DEADLINE_PASSED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessing_user_id and left_at is null) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessed_user_id and left_at is null) then raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001'; end if;

  select * into selected_activity from public.social_activity where id = r.activity_id;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;

  select exists (
    select 1 from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  insert into public.guesses(round_id, guessing_user_id, guessed_user_id, correct, points)
  values (r.id, p_guessing_user_id, p_guessed_user_id, is_correct, case when is_correct then 1 else 0 end)
  returning id into guess_id;
  return guess_id;
exception when unique_violation then
  raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
end;
$$;

revoke all on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_guess_guarded(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) to service_role;
grant execute on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) to service_role;
grant execute on function public.submit_guess_guarded(uuid, uuid, uuid) to service_role;
