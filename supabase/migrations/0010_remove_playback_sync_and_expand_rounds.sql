-- Remove cross-player playback synchronisation and expand the round-count choices.
-- Active rounds now start their timer immediately when the round becomes active.
-- New-room round counts: 10, 20, 30, 50, 100. Legacy 5/15 values remain DB-valid so existing rooms can finish cleanly.

alter table public.rooms drop constraint if exists rooms_round_count_check;
alter table public.rooms add constraint rooms_round_count_check
  check (round_count in (5,10,15,20,30,50,100));

-- Playback synchronisation is no longer part of the game model.
drop function if exists public.report_round_playback_started(uuid, uuid, uuid, text);
drop table if exists public.round_playback_starts;

-- Keep the 1000 -> 500 timed scoring curve introduced in migration 0009.
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
  if p_answer_deadline is null then
    return 1000;
  end if;

  if p_started_at is null or p_answer_deadline <= p_started_at then
    return 500;
  end if;

  duration_seconds := extract(epoch from (p_answer_deadline - p_started_at));
  remaining_seconds := greatest(0.0, least(duration_seconds, extract(epoch from (p_answer_deadline - p_submitted_at))));

  score_value := round(500.0 + 500.0 * (remaining_seconds / duration_seconds))::integer;
  return greatest(500, least(1000, score_value));
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
  started_value timestamptz;
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
  started_value := clock_timestamp();

  update public.rooms
  set status = 'ACTIVE',
      started_at = started_value,
      finished_at = null,
      current_round_number = 1,
      reveal_ends_at = null
  where id = p_room_id;

  update public.rounds
  set status = 'ACTIVE',
      started_at = started_value,
      answer_deadline = case
        when room_row.guess_duration_seconds = 0 then null
        else started_value + make_interval(secs => room_row.guess_duration_seconds)
      end
  where id = first_round_id;
end;
$$;

create or replace function private.advance_after_reveal(p_room_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  next_round public.rounds%rowtype;
  started_value timestamptz;
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

  started_value := clock_timestamp();
  update public.rounds
  set status = 'ACTIVE',
      started_at = started_value,
      answer_deadline = case
        when room_row.guess_duration_seconds = 0 then null
        else started_value + make_interval(secs => room_row.guess_duration_seconds)
      end
  where id = next_round.id and status = 'PENDING';
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
    values (round_row.id, p_guessing_user_id, p_guessed_user_id, submitted_at_value, is_correct, awarded_points)
    returning id into guess_id;
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

create or replace function public.vote_to_end_current_round(
  p_room_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  active_players integer;
  vote_count integer;
  required_votes integer;
  did_reveal boolean := false;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = p_actor_user_id and left_at is null
  ) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  insert into public.round_end_votes(room_id, round_id, user_id)
  values (p_room_id, round_row.id, p_actor_user_id)
  on conflict (round_id, user_id) do nothing;

  select count(*) into active_players
  from public.room_players
  where room_id = p_room_id and left_at is null;
  required_votes := floor(active_players / 2.0)::integer + 1;

  select count(*) into vote_count
  from public.round_end_votes v
  where v.round_id = round_row.id
    and exists (
      select 1 from public.room_players rp
      where rp.room_id = p_room_id and rp.user_id = v.user_id and rp.left_at is null
    );

  if vote_count >= required_votes then
    perform private.reveal_current_round(p_room_id);
    did_reveal := true;
  end if;

  return jsonb_build_object('voteCount', vote_count, 'requiredVotes', required_votes, 'revealed', did_reveal);
end;
$$;

create or replace function public.replace_unavailable_current_round(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_round_id uuid,
  p_video_id text
) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  current_activity public.social_activity%rowtype;
  replacement public.social_activity%rowtype;
  has_guesses boolean;
  started_value timestamptz;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then return false; end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = p_actor_user_id and left_at is null
  ) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where id = p_round_id
    and room_id = p_room_id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found or round_row.status <> 'ACTIVE' then return false; end if;

  select * into current_activity from public.social_activity where id = round_row.activity_id;
  if not found or current_activity.video_id <> p_video_id then return false; end if;

  select exists(select 1 from public.guesses where round_id = round_row.id) into has_guesses;
  if has_guesses then return false; end if;

  update public.social_activity
  set available = false
  where provider = current_activity.provider and video_id = current_activity.video_id;

  select sa.* into replacement
  from public.social_activity sa
  join public.room_players rp
    on rp.room_id = p_room_id and rp.user_id = sa.user_id and rp.left_at is null
  where sa.provider = current_activity.provider
    and sa.available = true
    and sa.activity_type = current_activity.activity_type
    and sa.user_id = round_row.source_user_id
    and not exists (
      select 1 from public.rounds used_round
      join public.social_activity used_activity on used_activity.id = used_round.activity_id
      where used_round.room_id = p_room_id
        and used_round.game_number = room_row.game_number
        and used_round.id <> round_row.id
        and used_activity.video_id = sa.video_id
    )
    and (
      (current_activity.import_source = 'fixture' and sa.import_source = 'fixture')
      or (current_activity.import_source <> 'fixture' and sa.import_source <> 'fixture')
    )
  order by random()
  limit 1;

  if not found then
    select sa.* into replacement
    from public.social_activity sa
    join public.room_players rp
      on rp.room_id = p_room_id and rp.user_id = sa.user_id and rp.left_at is null
    where sa.provider = current_activity.provider
      and sa.available = true
      and sa.activity_type = any(room_row.activity_types)
      and not exists (
        select 1 from public.rounds used_round
        join public.social_activity used_activity on used_activity.id = used_round.activity_id
        where used_round.room_id = p_room_id
          and used_round.game_number = room_row.game_number
          and used_round.id <> round_row.id
          and used_activity.video_id = sa.video_id
      )
      and (
        (current_activity.import_source = 'fixture' and sa.import_source = 'fixture')
        or (current_activity.import_source <> 'fixture' and sa.import_source <> 'fixture')
      )
    order by case when sa.user_id = round_row.source_user_id then 0 else 1 end, random()
    limit 1;
  end if;

  if not found then raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001'; end if;

  delete from public.round_end_votes where round_id = round_row.id;
  delete from public.guesses where round_id = round_row.id;

  started_value := clock_timestamp();
  update public.rounds
  set source_user_id = replacement.user_id,
      activity_id = replacement.id,
      started_at = started_value,
      answer_deadline = case
        when room_row.guess_duration_seconds = 0 then null
        else started_value + make_interval(secs => room_row.guess_duration_seconds)
      end,
      revealed_at = null
  where id = round_row.id;

  return true;
end;
$$;

revoke all on function private.calculate_timed_guess_points(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_guess_guarded(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.vote_to_end_current_round(uuid, uuid) from public, anon, authenticated;
revoke all on function public.replace_unavailable_current_round(uuid, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) to service_role;
grant execute on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) to service_role;
grant execute on function public.submit_guess_guarded(uuid, uuid, uuid) to service_role;
grant execute on function public.vote_to_end_current_round(uuid, uuid) to service_role;
grant execute on function public.replace_unavailable_current_round(uuid, uuid, uuid, text) to service_role;
