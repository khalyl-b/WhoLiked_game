-- Replace unavailable TikTok rounds only after TikTok's actual Embed Player
-- reports INVALID_VIDEO (1001). This avoids false negatives from trying to
-- preflight Data Portability share URLs through oEmbed without a creator handle.

-- Migration 0006's oEmbed preflight could falsely mark perfectly valid
-- Data Portability share links unavailable. Re-admit real imported posts once;
-- from this migration onward only the actual Embed Player's INVALID_VIDEO (1001)
-- report marks a post unavailable.
update public.social_activity
set available = true
where provider = 'TIKTOK'::public.social_provider
  and import_source <> 'fixture';

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
  if not found or current_activity.video_id <> p_video_id then
    -- Another client may already have replaced the same unavailable post.
    return false;
  end if;

  select exists(select 1 from public.guesses where round_id = round_row.id) into has_guesses;
  if has_guesses then
    -- The UI keeps guessing disabled until the player reports ready, so this is
    -- mainly a guard against a stale or malicious report.
    return false;
  end if;

  -- A TikTok media ID is globally unavailable, so mark every imported copy of
  -- this post unavailable regardless of which room member owned it.
  update public.social_activity
  set available = false
  where provider = current_activity.provider
    and video_id = current_activity.video_id;

  -- Prefer preserving the round's scheduled anchor owner and activity type so
  -- fairness remains as close as possible to the original allocation.
  select sa.* into replacement
  from public.social_activity sa
  join public.room_players rp
    on rp.room_id = p_room_id and rp.user_id = sa.user_id and rp.left_at is null
  where sa.provider = current_activity.provider
    and sa.available = true
    and sa.activity_type = current_activity.activity_type
    and sa.user_id = round_row.source_user_id
    and not exists (
      select 1
      from public.rounds used_round
      join public.social_activity used_activity on used_activity.id = used_round.activity_id
      where used_round.room_id = p_room_id
        and used_round.game_number = room_row.game_number
        and used_round.id <> round_row.id
        and used_activity.video_id = sa.video_id
    )
    and (
      (current_activity.import_source = 'fixture' and sa.import_source = 'fixture')
      or
      (current_activity.import_source <> 'fixture' and sa.import_source <> 'fixture')
    )
  order by random()
  limit 1;

  if not found then
    -- Fall back to any active room member and any selected activity type.
    select sa.* into replacement
    from public.social_activity sa
    join public.room_players rp
      on rp.room_id = p_room_id and rp.user_id = sa.user_id and rp.left_at is null
    where sa.provider = current_activity.provider
      and sa.available = true
      and sa.activity_type = any(room_row.activity_types)
      and not exists (
        select 1
        from public.rounds used_round
        join public.social_activity used_activity on used_activity.id = used_round.activity_id
        where used_round.room_id = p_room_id
          and used_round.game_number = room_row.game_number
          and used_round.id <> round_row.id
          and used_activity.video_id = sa.video_id
      )
      and (
        (current_activity.import_source = 'fixture' and sa.import_source = 'fixture')
        or
        (current_activity.import_source <> 'fixture' and sa.import_source <> 'fixture')
      )
    order by case when sa.user_id = round_row.source_user_id then 0 else 1 end, random()
    limit 1;
  end if;

  if not found then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  delete from public.round_end_votes where round_id = round_row.id;
  delete from public.guesses where round_id = round_row.id;

  update public.rounds
  set source_user_id = replacement.user_id,
      activity_id = replacement.id,
      started_at = clock_timestamp(),
      answer_deadline = case
        when room_row.guess_duration_seconds = 0 then null
        else clock_timestamp() + make_interval(secs => room_row.guess_duration_seconds)
      end,
      revealed_at = null
  where id = round_row.id;

  return true;
end;
$$;

revoke all on function public.replace_unavailable_current_round(uuid, uuid, uuid, text) from public, anon, authenticated;

-- The client listens for in-place round replacements so all players switch to
-- the new hidden/player-preflight video immediately.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rounds'
     ) then
    alter publication supabase_realtime add table public.rounds;
  end if;
end $$;
