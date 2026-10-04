-- Apply to the dedicated Supabase project. No anonymous document access.
create schema if not exists angle_private;
revoke all on schema angle_private from public;
grant usage on schema angle_private to authenticated;
create table public.angle_projects (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 title text not null default '新しい記事' check(length(title)<=300), snapshot jsonb not null default '{}',
 details jsonb not null default '{}', revision integer not null default 0,
 updated_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '90 days'
);
create table public.angle_members (
 project_id uuid references public.angle_projects(id) on delete cascade, email text not null check(email=lower(email) and length(email)<254),
 role text not null check(role in ('viewer','editor','approver')), primary key(project_id,email)
);
create table public.angle_versions (
 id uuid primary key default gen_random_uuid(), project_id uuid references public.angle_projects(id) on delete cascade,
 revision integer not null, snapshot jsonb not null, author_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), unique(project_id,revision)
);
create table public.angle_notices (
 id uuid primary key default gen_random_uuid(),project_id uuid references public.angle_projects(id) on delete cascade,
 recipient text not null, kind text not null check(kind in ('review','deadline')), revision integer not null,
 due_at timestamptz not null default now(), read_at timestamptz, sent_at timestamptz,
 unique(project_id,recipient,kind,revision)
);
alter table public.angle_projects enable row level security;
alter table public.angle_members enable row level security;
alter table public.angle_versions enable row level security;
alter table public.angle_notices enable row level security;
revoke all on public.angle_projects,public.angle_members,public.angle_versions,public.angle_notices from anon,authenticated;
grant select on public.angle_projects,public.angle_members,public.angle_versions,public.angle_notices to authenticated;
-- Checks verified identity from auth.users, never editable user metadata. Require an active session.
create function angle_private.role_for(pid uuid) returns text language sql stable security definer set search_path='' as $$
 select case when p.owner_id=auth.uid() then 'owner' else m.role end
 from public.angle_projects p join auth.users u on u.id=auth.uid()
 left join public.angle_members m on m.project_id=p.id and m.email=lower(u.email)
 where p.id=pid and p.expires_at>now() and u.email_confirmed_at is not null
 and exists(select 1 from auth.sessions s where s.user_id=u.id and s.id::text=auth.jwt()->>'session_id')
$$;
revoke all on function angle_private.role_for(uuid) from public;
grant execute on function angle_private.role_for(uuid) to authenticated;
create policy project_read on public.angle_projects for select to authenticated using(angle_private.role_for(id) is not null);
create policy member_read on public.angle_members for select to authenticated using(angle_private.role_for(project_id) is not null);
create policy version_read on public.angle_versions for select to authenticated using(angle_private.role_for(project_id) is not null);
create policy notice_read on public.angle_notices for select to authenticated using(angle_private.role_for(project_id) is not null and recipient=lower(auth.jwt()->>'email'));
create function public.angle_save_project(pid uuid, expected_revision integer, body jsonb, info jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.angle_projects; role text; new_id uuid; email text; recipients text[];
begin
 if auth.uid() is null or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id where u.id=auth.uid() and u.email_confirmed_at is not null and s.id::text=auth.jwt()->>'session_id') then raise exception 'denied' using errcode='42501'; end if;
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
revoke all on function public.angle_save_project(uuid,integer,jsonb,jsonb) from public;
grant execute on function public.angle_save_project(uuid,integer,jsonb,jsonb) to authenticated;
create function public.angle_set_member(pid uuid, member_email text, member_role text) returns void language plpgsql security definer set search_path='' as $$
begin
 if angle_private.role_for(pid)<>'owner' or angle_private.role_for(pid) is null then raise exception 'denied' using errcode='42501'; end if;
 if member_role not in ('viewer','editor','approver') or member_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid'; end if;
 insert into public.angle_members values(pid,lower(member_email),member_role) on conflict(project_id,email) do update set role=excluded.role;
end $$;
revoke all on function public.angle_set_member(uuid,text,text) from public;
grant execute on function public.angle_set_member(uuid,text,text) to authenticated;
create function public.angle_delete_project(pid uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if angle_private.role_for(pid)<>'owner' or angle_private.role_for(pid) is null then raise exception 'denied' using errcode='42501'; end if;
 delete from public.angle_projects where id=pid;
end $$;
revoke all on function public.angle_delete_project(uuid) from public;
grant execute on function public.angle_delete_project(uuid) to authenticated;
create function public.angle_read_notice(nid uuid) returns void language plpgsql security definer set search_path='' as $$
begin update public.angle_notices set read_at=now() where id=nid and recipient=lower(auth.jwt()->>'email') and angle_private.role_for(project_id) is not null; end $$;
revoke all on function public.angle_read_notice(uuid) from public;
grant execute on function public.angle_read_notice(uuid) to authenticated;
-- Run daily in Supabase Cron (trusted database role). Never expose this operation through the browser.
-- delete from public.angle_projects where expires_at < now();
-- Keep privileged implementations outside the exposed API schema. Public wrappers are invoker-only.
alter function public.angle_save_project(uuid,integer,jsonb,jsonb) set schema angle_private;
alter function public.angle_set_member(uuid,text,text) set schema angle_private;
alter function public.angle_delete_project(uuid) set schema angle_private;
alter function public.angle_read_notice(uuid) set schema angle_private;
revoke all on all functions in schema angle_private from public,anon;
grant execute on all functions in schema angle_private to authenticated;
create function public.angle_save_project(pid uuid, expected_revision integer, body jsonb, info jsonb) returns jsonb language sql security invoker set search_path='' as $$select angle_private.angle_save_project(pid,expected_revision,body,info)$$;
create function public.angle_set_member(pid uuid, member_email text, member_role text) returns void language sql security invoker set search_path='' as $$select angle_private.angle_set_member(pid,member_email,member_role)$$;
create function public.angle_delete_project(pid uuid) returns void language sql security invoker set search_path='' as $$select angle_private.angle_delete_project(pid)$$;
create function public.angle_read_notice(nid uuid) returns void language sql security invoker set search_path='' as $$select angle_private.angle_read_notice(nid)$$;
revoke all on function public.angle_save_project(uuid,integer,jsonb,jsonb),public.angle_set_member(uuid,text,text),public.angle_delete_project(uuid),public.angle_read_notice(uuid) from public,anon;
grant execute on function public.angle_save_project(uuid,integer,jsonb,jsonb),public.angle_set_member(uuid,text,text),public.angle_delete_project(uuid),public.angle_read_notice(uuid) to authenticated;
