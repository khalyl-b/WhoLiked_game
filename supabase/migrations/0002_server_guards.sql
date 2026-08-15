-- Production mutation helpers. These constraints are intentionally duplicated at the database
-- boundary so concurrent requests cannot overfill rooms or create multiple guesses.

create or replace function public.assert_room_capacity(target_room_id uuid, max_players integer default 10)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.rooms where id = target_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if (select count(*) from public.room_players where room_id = target_room_id and left_at is null) >= max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.submit_guess_guarded(
  p_round_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.rounds%rowtype;
  guess_id uuid;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if r.answer_deadline is null or clock_timestamp() > r.answer_deadline then raise exception 'DEADLINE_PASSED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessing_user_id and left_at is null) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessed_user_id and left_at is null) then raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001'; end if;

  insert into public.guesses(round_id, guessing_user_id, guessed_user_id, correct, points)
  values (r.id, p_guessing_user_id, p_guessed_user_id, p_guessed_user_id = r.source_user_id, case when p_guessed_user_id = r.source_user_id then 1 else 0 end)
  returning id into guess_id;
  return guess_id;
exception when unique_violation then
  raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
end;
$$;

revoke all on function public.assert_room_capacity(uuid, integer) from public, anon, authenticated;
revoke all on function public.submit_guess_guarded(uuid, uuid, uuid) from public, anon, authenticated;


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
  if (select count(*) from public.room_players where room_id = p_room_id and left_at is null) >= p_max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  insert into public.room_players(room_id, user_id) values (p_room_id, p_user_id)
  on conflict (room_id, user_id) do update set left_at = null, connected = true
  returning id into player_id;
  return player_id;
end;
$$;

revoke all on function public.join_room_guarded(uuid, uuid, integer) from public, anon, authenticated;
