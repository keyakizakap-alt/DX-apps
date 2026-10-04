-- Company access is enforced in the database as well as the web gateway.
-- Empty by default. Only an operator may add approved addresses or @domains.
create table if not exists angle_private.allowed_email_rules (
 rule text primary key check(rule=lower(rule) and length(rule)<254 and rule ~ '^([^@[:space:]]+)?@[^@[:space:]]+\.[^@[:space:]]+$')
);
alter table angle_private.allowed_email_rules enable row level security;
revoke all on angle_private.allowed_email_rules from public,anon,authenticated;
create or replace function angle_private.email_allowed(address text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from angle_private.allowed_email_rules r where lower(address)=r.rule or (left(r.rule,1)='@' and lower(address) like '%@%' and substring(lower(address) from position('@' in address))=r.rule))
$$;
revoke all on function angle_private.email_allowed(text) from public,anon,authenticated;

create or replace function angle_private.role_for(pid uuid) returns text language sql stable security definer set search_path='' as $$
 select case when p.owner_id=auth.uid() then 'owner' else m.role end
 from public.angle_projects p join auth.users u on u.id=auth.uid()
 left join public.angle_members m on m.project_id=p.id and m.email=lower(u.email)
 where p.id=pid and p.expires_at>now() and u.email_confirmed_at is not null and angle_private.email_allowed(u.email)
 and exists(select 1 from auth.sessions s where s.user_id=u.id and s.id::text=auth.jwt()->>'session_id')
$$;

create or replace function angle_private.angle_save_project(pid uuid, expected_revision integer, body jsonb, info jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.angle_projects; role text; new_id uuid; email text; recipients text[];
begin
 if auth.uid() is null or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id where u.id=auth.uid() and u.email_confirmed_at is not null and angle_private.email_allowed(u.email) and s.id::text=auth.jwt()->>'session_id') then raise exception 'denied' using errcode='42501'; end if;
 if octet_length(body::text)>1500000 or octet_length(info::text)>20000 or jsonb_typeof(body)<>'object' or jsonb_typeof(info)<>'object' then raise exception 'invalid'; end if;
 if pid is null then
  insert into public.angle_projects(owner_id) values(auth.uid()) returning * into p;
 else
  select * into p from public.angle_projects where id=pid for update;
  role:=angle_private.role_for(pid);
  if role is null or role='viewer' then raise exception 'denied' using errcode='42501'; end if;
  if p.revision<>expected_revision then raise exception 'conflict' using errcode='40001'; end if;
  if role not in ('owner','approver') and coalesce(body#>'{run,approvals}','{}')<>'{}' then raise exception 'approval_denied' using errcode='42501'; end if;
 end if;
 new_id:=p.id;
 -- Every saved revision is immutable to callers. Direct table writes are revoked.
 update public.angle_projects set title=left(coalesce(body#>>'{input,topic}','新しい記事'),300),snapshot=body,details=info,revision=p.revision+1,updated_at=now() where id=new_id returning * into p;
 insert into public.angle_versions(project_id,revision,snapshot,author_id) values(new_id,p.revision,body,auth.uid());
 -- Retain a bounded history; expired project data is removed by cleanup.
 delete from public.angle_versions where project_id=new_id and revision<=p.revision-30;
 recipients:=array[lower(info->>'approver')];
 if body#>>'{run,status}'='awaiting_review' then
  foreach email in array recipients loop
   if email is not null and (exists(select 1 from public.angle_members m where m.project_id=new_id and m.email=email and m.role='approver') or exists(select 1 from auth.users u where u.id=p.owner_id and lower(u.email)=email)) then
    insert into public.angle_notices(project_id,recipient,kind,revision) values(new_id,email,'review',coalesce((body#>>'{run,revision}')::integer,0)*10000+coalesce((body#>>'{run,interventionVersion}')::integer,0)) on conflict do nothing;
   end if;
  end loop;
 end if;
 if info->>'deadline' ~ '^\d{4}-\d{2}-\d{2}$' then
  foreach email in array array[lower(info->>'assignee'),lower(info->>'approver')] loop
   if email is not null and (exists(select 1 from public.angle_members m where m.project_id=new_id and m.email=email) or exists(select 1 from auth.users u where u.id=p.owner_id and lower(u.email)=email)) then
    insert into public.angle_notices(project_id,recipient,kind,revision,due_at) values(new_id,email,'deadline',replace(info->>'deadline','-','')::integer,(info->>'deadline')::date-interval '1 day') on conflict do nothing;
   end if;
  end loop;
  delete from public.angle_notices where project_id=new_id and kind='deadline' and revision<>replace(info->>'deadline','-','')::integer;
 end if;
 return to_jsonb(p);
end $$;

create or replace function angle_private.angle_set_member(pid uuid, member_email text, member_role text) returns void language plpgsql security definer set search_path='' as $$
begin
 if angle_private.role_for(pid)<>'owner' or angle_private.role_for(pid) is null then raise exception 'denied' using errcode='42501'; end if;
 if not angle_private.email_allowed(member_email) then raise exception 'denied' using errcode='42501'; end if;
 if member_role not in ('viewer','editor','approver') or member_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid'; end if;
 insert into public.angle_members values(pid,lower(member_email),member_role) on conflict(project_id,email) do update set role=excluded.role;
end $$;
