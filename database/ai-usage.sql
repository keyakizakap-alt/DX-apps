-- Apply after workspace.sql and company-access.sql.
-- Shared AI usage limits. Counted per verified company user, so the limit holds across every
-- server instance (the in-memory limiter in the Worker only covers a single instance).
create table if not exists angle_private.ai_usage (
 user_id uuid not null references auth.users(id) on delete cascade,
 day date not null,
 calls integer not null default 0 check(calls>=0),
 minute timestamptz not null,
 minute_calls integer not null default 0 check(minute_calls>=0),
 primary key(user_id,day)
);
alter table angle_private.ai_usage enable row level security;
revoke all on angle_private.ai_usage from public,anon,authenticated;

-- Records one AI call for the signed-in user and returns false once the daily or per-minute limit is reached.
-- Limits come from the server; a caller invoking this directly can only spend their own allowance.
create or replace function public.angle_consume_ai(daily_limit integer,minute_limit integer) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 today date:=(now() at time zone 'utc')::date;
 this_minute timestamptz:=date_trunc('minute',now());
 daily integer:=least(greatest(coalesce(daily_limit,1),1),5000);
 per_minute integer:=least(greatest(coalesce(minute_limit,1),1),600);
 accepted boolean;
begin
 if uid is null or not exists(
  select 1 from auth.users u where u.id=uid and u.email_confirmed_at is not null and angle_private.email_allowed(u.email)
  and exists(select 1 from auth.sessions s where s.user_id=u.id and s.id::text=auth.jwt()->>'session_id')
 ) then raise exception 'ai usage requires an allowed company session' using errcode='42501'; end if;
 insert into angle_private.ai_usage as usage(user_id,day,calls,minute,minute_calls) values(uid,today,1,this_minute,1)
 on conflict(user_id,day) do update set
  calls=usage.calls+1,
  minute=excluded.minute,
  minute_calls=case when usage.minute=excluded.minute then usage.minute_calls+1 else 1 end
 where usage.calls<daily and (usage.minute<>excluded.minute or usage.minute_calls<per_minute)
 returning true into accepted;
 delete from angle_private.ai_usage where user_id=uid and day<today-7;
 return coalesce(accepted,false);
end $$;
revoke all on function public.angle_consume_ai(integer,integer) from public,anon;
grant execute on function public.angle_consume_ai(integer,integer) to authenticated;
