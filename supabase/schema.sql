-- Stake Youth app — database for a CHURCH Supabase project (never the Jericho one).
-- Run once in the SQL editor. Then set the two PINs (bottom of this file).
--
-- Model: every table has RLS on with NO policies, so the anon key cannot read or write
-- anything directly. The app only calls the sya_* functions below, which check the PIN
-- (stored as a bcrypt hash) on every call. Adult PIN = edit everything; youth PIN = read
-- plus check off the youth leader's own tasks. Wrong PINs are rate limited per IP.

create extension if not exists pgcrypto;

create table if not exists sya_settings (
  key text primary key,
  value text not null default ''
);

create table if not exists sya_people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('adult','youth')),
  role text default '',
  ward text default '',
  active boolean not null default true,
  created_at timestamptz default now(),
  created_by text,
  updated_at timestamptz default now(),
  updated_by text
);

create table if not exists sya_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text default '',
  event_date date,
  status text not null default 'planning' check (status in ('planning','active','done','cancelled')),
  purpose text default '',
  notes text default '',
  adult_lead uuid references sya_people(id) on delete set null,
  youth_lead uuid references sya_people(id) on delete set null,
  created_at timestamptz default now(),
  created_by text,
  updated_at timestamptz default now(),
  updated_by text
);

create table if not exists sya_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text default '',
  audience text default '',
  start_date date not null,
  end_date date,
  start_time time,
  end_time time,
  location text default '',
  description text default '',
  project_id uuid references sya_projects(id) on delete set null,
  adults uuid[] not null default '{}',  -- adult leaders attending
  created_at timestamptz default now(),
  created_by text,
  updated_at timestamptz default now(),
  updated_by text
);

create table if not exists sya_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  area text default '',
  notes text default '',
  due_date date,
  owner_id uuid references sya_people(id) on delete set null,
  project_id uuid references sya_projects(id) on delete cascade,
  done boolean not null default false,
  done_at timestamptz,
  done_by text,
  created_at timestamptz default now(),
  created_by text,
  updated_at timestamptz default now(),
  updated_by text
);

-- PIN hashes and failed attempts. Never readable from the app.
create table if not exists sya_auth (
  which text primary key check (which in ('adult','youth')),
  hash text not null
);
create table if not exists sya_pin_attempts (
  ip text primary key,
  fails int not null default 0,
  last_fail timestamptz not null default now()
);

alter table sya_settings enable row level security;
alter table sya_people enable row level security;
alter table sya_projects enable row level security;
alter table sya_events enable row level security;
alter table sya_tasks enable row level security;
alter table sya_auth enable row level security;
alter table sya_pin_attempts enable row level security;
revoke all on sya_settings, sya_people, sya_projects, sya_events, sya_tasks, sya_auth, sya_pin_attempts from anon, authenticated;

-- ---------- PIN check ----------
create or replace function sya_check_pin(p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ip text := coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', 'local');
  v_att sya_pin_attempts;
  v_role text;
begin
  select * into v_att from sya_pin_attempts where ip = v_ip;
  if v_att.fails >= 5 and v_att.last_fail > now() - interval '15 minutes' then
    raise exception 'Too many wrong PINs. Try again in 15 minutes.';
  end if;
  select which into v_role from sya_auth where hash = crypt(coalesce(p_pin, ''), hash) limit 1;
  if v_role is null then
    insert into sya_pin_attempts (ip, fails, last_fail) values (v_ip, 1, now())
      on conflict (ip) do update set fails = case when sya_pin_attempts.last_fail > now() - interval '15 minutes' then sya_pin_attempts.fails + 1 else 1 end, last_fail = now();
    raise exception 'Wrong PIN.';
  end if;
  delete from sya_pin_attempts where ip = v_ip;
  return v_role;
end $$;

-- ---------- load everything ----------
create or replace function sya_load(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text := sya_check_pin(p_pin);
begin
  return json_build_object(
    'role', v_role,
    'settings', coalesce((select json_object_agg(key, value) from sya_settings), '{}'::json),
    'people', coalesce((select json_agg(to_json(p) order by name) from sya_people p), '[]'::json),
    'projects', coalesce((select json_agg(to_json(p) order by event_date nulls last) from sya_projects p), '[]'::json),
    'events', coalesce((select json_agg(to_json(e) order by start_date, start_time) from sya_events e), '[]'::json),
    'tasks', coalesce((select json_agg(to_json(t) order by due_date nulls last) from sya_tasks t), '[]'::json)
  );
end $$;

-- ---------- save one row (adult only). p_kind: person | project | event | task | setting ----------
create or replace function sya_save(p_pin text, p_actor text, p_kind text, p_row jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_out json;
begin
  if sya_check_pin(p_pin) <> 'adult' then raise exception 'Only adult leaders can make changes.'; end if;
  p_actor := left(coalesce(p_actor, ''), 80);
  if p_kind = 'setting' then
    insert into sya_settings (key, value) values (p_row->>'key', coalesce(p_row->>'value', ''))
      on conflict (key) do update set value = excluded.value;
    return json_build_object('key', p_row->>'key', 'value', coalesce(p_row->>'value', ''));
  end if;
  v_id := coalesce((p_row->>'id')::uuid, gen_random_uuid());
  if p_kind = 'person' then
    insert into sya_people as t (id, name, kind, role, ward, active, created_by, updated_by)
    values (v_id, p_row->>'name', p_row->>'kind', coalesce(p_row->>'role',''), coalesce(p_row->>'ward',''),
            coalesce((p_row->>'active')::boolean, true), p_actor, p_actor)
    on conflict (id) do update set name = excluded.name, kind = excluded.kind, role = excluded.role, ward = excluded.ward,
      active = excluded.active, updated_at = now(), updated_by = p_actor;
    select to_json(t) into v_out from sya_people t where id = v_id;
  elsif p_kind = 'project' then
    insert into sya_projects as t (id, title, kind, event_date, status, purpose, notes, adult_lead, youth_lead, created_by, updated_by)
    values (v_id, p_row->>'title', coalesce(p_row->>'kind',''), (p_row->>'event_date')::date, coalesce(p_row->>'status','planning'),
            coalesce(p_row->>'purpose',''), coalesce(p_row->>'notes',''), (p_row->>'adult_lead')::uuid, (p_row->>'youth_lead')::uuid, p_actor, p_actor)
    on conflict (id) do update set title = excluded.title, kind = excluded.kind, event_date = excluded.event_date, status = excluded.status,
      purpose = excluded.purpose, notes = excluded.notes, adult_lead = excluded.adult_lead, youth_lead = excluded.youth_lead,
      updated_at = now(), updated_by = p_actor;
    select to_json(t) into v_out from sya_projects t where id = v_id;
  elsif p_kind = 'event' then
    insert into sya_events as t (id, title, category, audience, start_date, end_date, start_time, end_time, location, description, project_id, adults, created_by, updated_by)
    values (v_id, p_row->>'title', coalesce(p_row->>'category',''), coalesce(p_row->>'audience',''), (p_row->>'start_date')::date,
            (p_row->>'end_date')::date, nullif(p_row->>'start_time','')::time, nullif(p_row->>'end_time','')::time,
            coalesce(p_row->>'location',''), coalesce(p_row->>'description',''), (p_row->>'project_id')::uuid,
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_row->'adults','[]'::jsonb)) x), '{}'), p_actor, p_actor)
    on conflict (id) do update set title = excluded.title, category = excluded.category, audience = excluded.audience,
      start_date = excluded.start_date, end_date = excluded.end_date, start_time = excluded.start_time, end_time = excluded.end_time,
      location = excluded.location, description = excluded.description, project_id = excluded.project_id, adults = excluded.adults,
      updated_at = now(), updated_by = p_actor;
    select to_json(t) into v_out from sya_events t where id = v_id;
  elsif p_kind = 'task' then
    insert into sya_tasks as t (id, title, area, notes, due_date, owner_id, project_id, done, created_by, updated_by)
    values (v_id, p_row->>'title', coalesce(p_row->>'area',''), coalesce(p_row->>'notes',''), (p_row->>'due_date')::date,
            (p_row->>'owner_id')::uuid, (p_row->>'project_id')::uuid, coalesce((p_row->>'done')::boolean, false), p_actor, p_actor)
    on conflict (id) do update set title = excluded.title, area = excluded.area, notes = excluded.notes, due_date = excluded.due_date,
      owner_id = excluded.owner_id, project_id = excluded.project_id, updated_at = now(), updated_by = p_actor;
    select to_json(t) into v_out from sya_tasks t where id = v_id;
  else
    raise exception 'Unknown kind %', p_kind;
  end if;
  return v_out;
end $$;

-- ---------- delete (adult only) ----------
create or replace function sya_delete(p_pin text, p_actor text, p_kind text, p_id uuid) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  if sya_check_pin(p_pin) <> 'adult' then raise exception 'Only adult leaders can make changes.'; end if;
  if p_kind = 'person' then
    update sya_events set adults = array_remove(adults, p_id) where p_id = any(adults);
    delete from sya_people where id = p_id;
  elsif p_kind = 'project' then delete from sya_projects where id = p_id;   -- tasks cascade, events unlink
  elsif p_kind = 'event' then delete from sya_events where id = p_id;
  elsif p_kind = 'task' then delete from sya_tasks where id = p_id;
  else raise exception 'Unknown kind %', p_kind;
  end if;
  return json_build_object('ok', true);
end $$;

-- ---------- check off a task. Adults: any task. Youth: only tasks whose owner's name matches theirs. ----------
create or replace function sya_task_done(p_pin text, p_actor text, p_id uuid, p_done boolean) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_role text := sya_check_pin(p_pin);
  v_owner text;
  v_out json;
begin
  p_actor := left(coalesce(p_actor, ''), 80);
  if v_role <> 'adult' then
    select p.name into v_owner from sya_tasks t left join sya_people p on p.id = t.owner_id where t.id = p_id;
    if v_owner is null or lower(v_owner) <> lower(p_actor) then
      raise exception 'You can only check off your own tasks.';
    end if;
  end if;
  update sya_tasks set done = p_done, done_at = case when p_done then now() end, done_by = case when p_done then p_actor end,
    updated_at = now(), updated_by = p_actor where id = p_id;
  select to_json(t) into v_out from sya_tasks t where id = p_id;
  if v_out is null then raise exception 'Not found.'; end if;
  return v_out;
end $$;

-- ---------- change a PIN (adult only) ----------
create or replace function sya_set_pin(p_pin text, p_which text, p_new text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  if sya_check_pin(p_pin) <> 'adult' then raise exception 'Only adult leaders can change PINs.'; end if;
  if p_which not in ('adult','youth') then raise exception 'Unknown PIN.'; end if;
  if length(coalesce(p_new,'')) < 4 then raise exception 'Use at least 4 digits.'; end if;
  if p_which = 'youth' and exists (select 1 from sya_auth where which = 'adult' and hash = crypt(p_new, hash)) then
    raise exception 'The youth PIN must be different from the adult PIN.';
  end if;
  insert into sya_auth (which, hash) values (p_which, crypt(p_new, gen_salt('bf')))
    on conflict (which) do update set hash = excluded.hash;
  return json_build_object('ok', true);
end $$;

revoke all on function sya_check_pin(text) from public, anon, authenticated;
grant execute on function sya_load(text), sya_save(text, text, text, jsonb), sya_delete(text, text, text, uuid),
  sya_task_done(text, text, uuid, boolean), sya_set_pin(text, text, text) to anon;

-- ---------- first-time setup: pick your two PINs and run these two lines ----------
-- insert into sya_auth (which, hash) values ('adult', crypt('CHANGE-ME-ADULT', gen_salt('bf'))) on conflict (which) do update set hash = excluded.hash;
-- insert into sya_auth (which, hash) values ('youth', crypt('CHANGE-ME-YOUTH', gen_salt('bf'))) on conflict (which) do update set hash = excluded.hash;
-- insert into sya_settings (key, value) values ('stake_name', '[FILL IN] Stake'), ('wards', E'Ward 1\nWard 2') on conflict (key) do update set value = excluded.value;
