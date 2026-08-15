-- Time-decay scoring:
-- - correct answer at round start: 1000 points
-- - linear decay through the configured timed round
-- - correct answer immediately before deadline: 100 points
-- - wrong/no answer: 0 points
-- - Unlimited rounds: fixed 1000 points for a correct answer

alter table public.guesses drop constraint if exists guesses_points_check;
alter table public.guesses add constraint guesses_points_check check (points between 0 and 1000);

create or replace function private.calculate_timed_guess_points(
  p_started_at timestamptz,
  p_answer_deadline timestamptz,
  p_submitted_at timestamptz
) returns integer
language plpgsql immutable set search_path = public, private as $$
declare
  duration_seconds double precision;
  remaining_seconds double precision;
  score_value integer;
begin
  -- Unlimited rounds have no deadline and therefore no time decay.
  if p_answer_deadline is null then
    return 1000;
  end if;

  if p_started_at is null or p_answer_deadline <= p_started_at then
    return 100;
  end if;

  duration_seconds := extract(epoch from (p_answer_deadline - p_started_at));
  remaining_seconds := greatest(0.0, least(duration_seconds, extract(epoch from (p_answer_deadline - p_submitted_at))));

  score_value := round(100.0 + 900.0 * (remaining_seconds / duration_seconds))::integer;
  return greatest(100, least(1000, score_value));
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
  submitted_at_value timestamptz;
  awarded_points integer;
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

  submitted_at_value := clock_timestamp();
  if round_row.answer_deadline is not null and submitted_at_value >= round_row.answer_deadline then
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

  awarded_points := case when is_correct then private.calculate_timed_guess_points(
    round_row.started_at,
    round_row.answer_deadline,
    submitted_at_value
  ) else 0 end;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, submitted_at, correct, points)
    values (
      round_row.id,
      p_guessing_user_id,
      p_guessed_user_id,
      submitted_at_value,
      is_correct,
      awarded_points
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

-- Keep the older guarded RPC consistent in case a stale deployment calls it.
create or replace function public.submit_guess_guarded(
  p_round_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  r public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  is_correct boolean;
  submitted_at_value timestamptz;
  awarded_points integer;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  submitted_at_value := clock_timestamp();
  if r.answer_deadline is not null and submitted_at_value >= r.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessing_user_id and left_at is null) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessed_user_id and left_at is null) then raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001'; end if;

  select * into selected_activity from public.social_activity where id = r.activity_id;
  if not found or selected_activity.available = false then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;

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

  awarded_points := case when is_correct then private.calculate_timed_guess_points(
    r.started_at,
    r.answer_deadline,
    submitted_at_value
  ) else 0 end;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, submitted_at, correct, points)
    values (r.id, p_guessing_user_id, p_guessed_user_id, submitted_at_value, is_correct, awarded_points)
    returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;
  return guess_id;
end;
$$;

revoke all on function private.calculate_timed_guess_points(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_guess_guarded(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) to service_role;
grant execute on function public.submit_guess_guarded(uuid, uuid, uuid) to service_role;
