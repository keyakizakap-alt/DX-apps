create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
revoke usage on schema net from public,anon,authenticated;
create table angle_private.notice_dispatch(request_id bigint primary key,created_at timestamptz not null default now());
revoke all on angle_private.notice_dispatch from public,anon,authenticated;
create function angle_private.dispatch_reminders() returns void language plpgsql security definer set search_path='' as $$
declare payload jsonb; secret text; request_id bigint;
begin
 -- Remove expired projects, including associated history, members and notices.
 delete from public.angle_projects where expires_at<now();
 update public.angle_notices n set sent_at=now() where n.id::text in (
  select jsonb_array_elements_text(r.content::jsonb->'sent') from net._http_response r join angle_private.notice_dispatch d on d.request_id=r.id where r.status_code=200 and r.content::jsonb ? 'sent'
 );
 delete from angle_private.notice_dispatch d where exists(select 1 from net._http_response r where r.id=d.request_id) or d.created_at<now()-interval '10 minutes';
 if exists(select 1 from angle_private.notice_dispatch) then return; end if;
 select jsonb_agg(jsonb_build_object('id',id,'recipient',recipient,'kind',kind)) into payload from (select id,recipient,kind from public.angle_notices where sent_at is null and read_at is null and due_at<=now() order by due_at limit 10) pending;
 if payload is null then return; end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='angle_reminder_secret' limit 1;
 if secret is null then return; end if;
 select net.http_post(url:='https://agents-of-edit.vercel.app/api/reminders',body:=payload,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),timeout_milliseconds:=120000) into request_id;
 insert into angle_private.notice_dispatch(request_id) values(request_id);
end $$;
revoke all on function angle_private.dispatch_reminders() from public,anon,authenticated;
select cron.schedule('angle-workspace-reminders','*/2 * * * *','select angle_private.dispatch_reminders();');
