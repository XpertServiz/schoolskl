-- SafeRoute (Phase 5), the free version: the BUS is tracked, never the child.
--   * the driver's (or attendant's) own phone shares the bus position while a trip is open — no GPS unit, no child device;
--   * a child carries a printed QR card; the crew scans it when the child gets on or off — that is the only "child" record;
--   * a parent sees the bus on a map only while a trip is open on their child's route, only after THEY consented, and no longer
--     once their child has got off;
--   * nothing here is gated on the legal-opinion flag: that flag (saferoute_child_phone) is about locating a child's phone, which
--     this design never does. The school still has to switch the `saferoute` flag on.
-- Rule 3 (CLAUDE.md): no boarding record is kept for a child without a recorded, revocable guardian consent.

-- ---------------------------------------------------------------- flags
create or replace function app.tenant_flag_on(p_tenant uuid, p_key text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select tf.enabled from public.tenant_flags tf where tf.tenant_id = p_tenant and tf.flag_key = p_key),
                  (select f.default_enabled from public.feature_flags f where f.key = p_key), false)
$$;

-- A transport manager assigns children to routes, so they must be able to look a child up (template + every existing school's role).
insert into public.role_template_permissions (role_key, permission_key) values ('transport_manager', 'students.view') on conflict do nothing;
insert into public.role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'students.view' from public.roles r
where r.key = 'transport_manager' and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = 'students.view');

-- ---------------------------------------------------------------- tables
create table public.transport_routes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  campus_id uuid, name text not null check (length(btrim(name)) between 1 and 80), vehicle_label text,
  driver_staff_id uuid, attendant_staff_id uuid, is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, campus_id) references public.campuses (tenant_id, id),
  foreign key (tenant_id, driver_staff_id) references public.staff_members (tenant_id, id),
  foreign key (tenant_id, attendant_staff_id) references public.staff_members (tenant_id, id),
  unique (tenant_id, name), unique (tenant_id, id)
);

-- one route per child (DECISION: a child on two buses — morning/evening — is a later need; one route covers both directions)
create table public.transport_riders (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null, route_id uuid not null, stop_name text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (tenant_id, student_id),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, route_id) references public.transport_routes (tenant_id, id) on delete cascade
);
create index transport_riders_route_idx on public.transport_riders (tenant_id, route_id);

-- The QR on a child's card holds only this random token ("SR1:<token>") — no name, no school, nothing readable.
-- A lost card is revoked by issuing a new one.
create table public.transport_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null, token text not null unique check (token ~ '^[0-9a-f]{32}$'),
  issued_at timestamptz not null default now(), revoked_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id) on delete cascade
);
create unique index transport_cards_one_live on public.transport_cards (tenant_id, student_id) where revoked_at is null;

-- One row per (child, guardian). Withdrawing sets revoked_at; giving again clears it. Every change is audited.
create table public.transport_consents (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null, guardian_id uuid not null,
  granted_at timestamptz not null default now(), revoked_at timestamptz, recorded_by uuid not null,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  primary key (tenant_id, student_id, guardian_id),
  foreign key (tenant_id, student_id, guardian_id) references public.student_guardians (tenant_id, student_id, guardian_id) on delete cascade
);

create table public.transport_trips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  route_id uuid not null, direction text not null check (direction in ('to_school', 'to_home')),
  crew_user_id uuid not null, started_at timestamptz not null default now(), ended_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  foreign key (tenant_id, route_id) references public.transport_routes (tenant_id, id) on delete cascade,
  unique (tenant_id, id)
);
create unique index transport_trips_one_open on public.transport_trips (tenant_id, route_id) where ended_at is null;

create table public.transport_positions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trip_id uuid not null, lat double precision not null check (lat between -90 and 90), lng double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m >= 0), speed_mps real, heading real, recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, trip_id) references public.transport_trips (tenant_id, id) on delete cascade,
  unique (trip_id, recorded_at)
);
create index transport_positions_trip_idx on public.transport_positions (tenant_id, trip_id, recorded_at desc);

create table public.transport_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trip_id uuid not null, student_id uuid not null, kind text not null check (kind in ('boarded', 'alighted')),
  method text not null check (method in ('qr', 'manual')), at timestamptz not null default now(), recorded_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, trip_id) references public.transport_trips (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references public.students (tenant_id, id) on delete cascade
);
create index transport_events_trip_idx on public.transport_events (tenant_id, trip_id, student_id, at desc);

-- ---------------------------------------------------------------- RLS
-- Policies only use the allow-listed helpers (has_permission, is_guardian_of_student). The crew and parents read through RPCs.
select app.secure_tenant_table('public.transport_routes', 'transport.manage');
select app.secure_tenant_table('public.transport_riders', 'transport.manage');
alter policy tenant_select on public.transport_riders using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('transport.manage')) or (select app.is_guardian_of_student(student_id))));
select app.secure_tenant_table('public.transport_cards', '-', 'transport.manage');
select app.secure_tenant_table('public.transport_consents', '-');
alter policy tenant_select on public.transport_consents using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.has_permission('transport.manage')) or (select app.is_guardian_of_student(student_id))));
select app.secure_tenant_table('public.transport_trips', '-', 'transport.manage');
select app.secure_tenant_table('public.transport_positions', '-', 'tracking.live.view');
select app.secure_tenant_table('public.transport_events', '-', 'transport.manage');

select app.attach_standard_triggers('public.transport_routes');
select app.attach_standard_triggers('public.transport_riders');
select app.attach_standard_triggers('public.transport_cards');
select app.attach_standard_triggers('public.transport_consents');
select app.attach_standard_triggers('public.transport_trips', false);
-- positions and events are high-volume and append-only by design; they are not row-audited (the trip row is)

-- ---------------------------------------------------------------- helpers
create or replace function app.saferoute_ready() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id();
begin
  if t is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if not app.tenant_flag_on(t, 'saferoute') then raise exception 'saferoute is not switched on for this school' using errcode = 'P0001', hint = 'saferoute_off'; end if;
  return t;
end $$;

-- the caller is the route's driver or attendant (a staff record linked to their login, still active)
create or replace function app.is_route_crew(p_route uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.transport_routes r join public.staff_members s on s.tenant_id = r.tenant_id and s.id in (r.driver_staff_id, r.attendant_staff_id)
    where r.tenant_id = app.current_tenant_id() and r.id = p_route and s.user_id = auth.uid() and s.status = 'active')
$$;

create or replace function app.consent_on(p_tenant uuid, p_student uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.transport_consents c where c.tenant_id = p_tenant and c.student_id = p_student and c.revoked_at is null)
$$;

-- an open trip the caller may work on (crew of its route, or the person who started it, or a transport manager)
create or replace function app.crew_trip(p_trip uuid) returns public.transport_trips
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.saferoute_ready(); tr public.transport_trips;
begin
  select * into tr from public.transport_trips where id = p_trip and tenant_id = t;
  if not found or not (tr.crew_user_id = auth.uid() or app.is_route_crew(tr.route_id) or app.has_permission('transport.manage')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if tr.ended_at is not null then raise exception 'trip has ended' using errcode = 'P0001', hint = 'trip_ended'; end if;
  if not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  return tr;
end $$;

-- ---------------------------------------------------------------- manager RPCs
-- Cards for every child on a route, issuing one for any child without a live card. p_reissue revokes and replaces them all.
create or replace function public.route_cards(p_route uuid, p_reissue boolean default false)
returns table (student_id uuid, full_name text, admission_no text, class_name text, stop_name text, token text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id(); r record;
begin
  if t is null or not app.has_permission('transport.manage') or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.transport_routes where id = p_route and tenant_id = t) then raise exception 'route not found' using errcode = '42501'; end if;
  for r in select tr.student_id from public.transport_riders tr where tr.tenant_id = t and tr.route_id = p_route loop
    if p_reissue then update public.transport_cards c set revoked_at = now() where c.tenant_id = t and c.student_id = r.student_id and c.revoked_at is null; end if;
    insert into public.transport_cards (tenant_id, student_id, token) values (t, r.student_id, replace(gen_random_uuid()::text, '-', ''))
    on conflict (tenant_id, student_id) where revoked_at is null do nothing;
  end loop;
  return query
    select s.id, s.full_name, s.admission_no,
           (select c.name from public.student_enrolments e join public.classes c on c.tenant_id = e.tenant_id and c.id = e.class_id
              join public.academic_sessions a on a.tenant_id = e.tenant_id and a.id = e.session_id and a.is_current
            where e.tenant_id = t and e.student_id = s.id limit 1),
           tr.stop_name, k.token
    from public.transport_riders tr join public.students s on s.tenant_id = tr.tenant_id and s.id = tr.student_id
    join public.transport_cards k on k.tenant_id = tr.tenant_id and k.student_id = tr.student_id and k.revoked_at is null
    where tr.tenant_id = t and tr.route_id = p_route order by s.full_name;
end $$;

-- Staff view of every open trip: where the bus is, how many are on board. Location is sensitive (tracking.live.view).
create or replace function public.live_trips()
returns table (trip_id uuid, route_id uuid, route_name text, vehicle_label text, direction text, started_at timestamptz,
               lat double precision, lng double precision, accuracy_m real, position_at timestamptz, riders int, on_board int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id();
begin
  if t is null or not app.has_permission('tracking.live.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select tr.id, r.id, r.name, r.vehicle_label, tr.direction, tr.started_at, p.lat, p.lng, p.accuracy_m, p.recorded_at,
           (select count(*)::int from public.transport_riders x where x.tenant_id = t and x.route_id = r.id),
           (select count(*)::int from (select distinct on (e.student_id) e.kind from public.transport_events e
              where e.tenant_id = t and e.trip_id = tr.id order by e.student_id, e.at desc) z where z.kind = 'boarded')
    from public.transport_trips tr join public.transport_routes r on r.tenant_id = tr.tenant_id and r.id = tr.route_id
    left join lateral (select * from public.transport_positions pp where pp.tenant_id = t and pp.trip_id = tr.id order by pp.recorded_at desc limit 1) p on true
    where tr.tenant_id = t and tr.ended_at is null order by r.name;
end $$;

-- ---------------------------------------------------------------- crew RPCs (driver / attendant phone)
create or replace function public.my_transport_routes()
returns table (route_id uuid, name text, vehicle_label text, riders int, open_trip_id uuid, open_direction text, saferoute_on boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id();
begin
  if t is null then return; end if;
  return query
    select r.id, r.name, r.vehicle_label, (select count(*)::int from public.transport_riders x where x.tenant_id = t and x.route_id = r.id),
           o.id, o.direction, app.tenant_flag_on(t, 'saferoute')
    from public.transport_routes r left join public.transport_trips o on o.tenant_id = r.tenant_id and o.route_id = r.id and o.ended_at is null
    where r.tenant_id = t and r.is_active and (app.is_route_crew(r.id) or app.has_permission('transport.manage'))
    order by r.name;
end $$;

-- Starting twice returns the trip that is already open (a phone that lost its state can resume). Only crew or a transport manager.
create or replace function public.start_trip(p_route uuid, p_direction text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.saferoute_ready(); v uuid;
begin
  if not (app.is_route_crew(p_route) or app.has_permission('transport.manage')) or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.transport_routes where id = p_route and tenant_id = t and is_active) then raise exception 'route not found' using errcode = '42501'; end if;
  if p_direction not in ('to_school', 'to_home') then raise exception 'bad direction' using errcode = '22023'; end if;
  select id into v from public.transport_trips where tenant_id = t and route_id = p_route and ended_at is null;
  if v is not null then return v; end if;
  insert into public.transport_trips (tenant_id, route_id, direction, crew_user_id) values (t, p_route, p_direction, auth.uid()) returning id into v;
  return v;
end $$;

-- Batched so the phone can queue points while offline. Points outside the trip's time window, or duplicates, are dropped silently.
create or replace function public.post_trip_positions(p_trip uuid, p_points jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare tr public.transport_trips := app.crew_trip(p_trip); n int;
begin
  if coalesce(jsonb_typeof(p_points), '') <> 'array' or jsonb_array_length(p_points) > 500 then raise exception 'bad points' using errcode = '22023'; end if;
  insert into public.transport_positions (tenant_id, trip_id, lat, lng, accuracy_m, speed_mps, heading, recorded_at)
  select tr.tenant_id, tr.id, (x ->> 'lat')::double precision, (x ->> 'lng')::double precision,
         nullif(x ->> 'accuracy', '')::real, nullif(x ->> 'speed', '')::real, nullif(x ->> 'heading', '')::real, (x ->> 'at')::timestamptz
  from jsonb_array_elements(p_points) x
  where (x ->> 'lat')::double precision between -90 and 90 and (x ->> 'lng')::double precision between -180 and 180
    and (x ->> 'at')::timestamptz between tr.started_at - interval '1 minute' and now() + interval '2 minutes'
  on conflict (trip_id, recorded_at) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Record a child getting on/off. Never raises for a scan problem: the driver's screen shows the code and moves on.
--   result: boarded | alighted | duplicate | unknown_card | not_on_route | no_consent
create or replace function app.record_rider_event(tr public.transport_trips, p_student uuid, p_kind text, p_method text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare last_kind text; last_at timestamptz; k text; nm text;
begin
  select split_part(btrim(s.full_name), ' ', 1) into nm from public.students s where s.tenant_id = tr.tenant_id and s.id = p_student;
  if not exists (select 1 from public.transport_riders x where x.tenant_id = tr.tenant_id and x.student_id = p_student and x.route_id = tr.route_id) then
    return jsonb_build_object('result', 'not_on_route', 'name', nm);
  end if;
  if not app.consent_on(tr.tenant_id, p_student) then return jsonb_build_object('result', 'no_consent', 'name', nm); end if;
  select e.kind, e.at into last_kind, last_at from public.transport_events e
  where e.tenant_id = tr.tenant_id and e.trip_id = tr.id and e.student_id = p_student order by e.at desc limit 1;
  k := coalesce(p_kind, case when last_kind = 'boarded' then 'alighted' else 'boarded' end);
  if k not in ('boarded', 'alighted') then raise exception 'bad kind' using errcode = '22023'; end if;
  -- DECISION: the same state twice, or any second scan within 2 minutes, is a double scan — not a get-off
  if last_kind is not null and (last_kind = k or last_at > now() - interval '2 minutes') then
    return jsonb_build_object('result', 'duplicate', 'name', nm, 'kind', last_kind);
  end if;
  insert into public.transport_events (tenant_id, trip_id, student_id, kind, method, recorded_by) values (tr.tenant_id, tr.id, p_student, k, p_method, auth.uid());
  return jsonb_build_object('result', k, 'name', nm, 'kind', k);
end $$;

create or replace function public.scan_transport_card(p_trip uuid, p_code text, p_kind text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare tr public.transport_trips := app.crew_trip(p_trip); tok text := lower(btrim(coalesce(p_code, ''))); v_student uuid;
begin
  if tok like 'sr1:%' then tok := substr(tok, 5); end if;
  select c.student_id into v_student from public.transport_cards c where c.tenant_id = tr.tenant_id and c.token = tok and c.revoked_at is null;
  if v_student is null then return jsonb_build_object('result', 'unknown_card'); end if;
  return app.record_rider_event(tr, v_student, p_kind, 'qr');
end $$;

-- lost or forgotten card: the crew picks the child from the trip list
create or replace function public.mark_rider(p_trip uuid, p_student uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare tr public.transport_trips := app.crew_trip(p_trip);
begin
  if p_kind not in ('boarded', 'alighted') then raise exception 'bad kind' using errcode = '22023'; end if;
  return app.record_rider_event(tr, p_student, p_kind, 'manual');
end $$;

-- The crew's list for a trip: first names only (enough to call a child), consent yes/no, and state on this trip.
create or replace function public.trip_riders(p_trip uuid)
returns table (student_id uuid, first_name text, stop_name text, consent boolean, state text, state_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.saferoute_ready(); tr public.transport_trips;
begin
  select * into tr from public.transport_trips where id = p_trip and tenant_id = t;
  if not found or not (tr.crew_user_id = auth.uid() or app.is_route_crew(tr.route_id) or app.has_permission('transport.manage')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select x.student_id, split_part(btrim(s.full_name), ' ', 1), x.stop_name, app.consent_on(t, x.student_id), e.kind, e.at
    from public.transport_riders x join public.students s on s.tenant_id = x.tenant_id and s.id = x.student_id
    left join lateral (select ev.kind, ev.at from public.transport_events ev where ev.tenant_id = t and ev.trip_id = tr.id and ev.student_id = x.student_id order by ev.at desc limit 1) e on true
    where x.tenant_id = t and x.route_id = tr.route_id order by x.stop_name nulls last, s.full_name;
end $$;

create or replace function public.end_trip(p_trip uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare tr public.transport_trips := app.crew_trip(p_trip); still int;
begin
  -- children still marked on board are reported back so the crew checks the bus before leaving it
  select count(*)::int into still from (select distinct on (e.student_id) e.kind from public.transport_events e
    where e.tenant_id = tr.tenant_id and e.trip_id = tr.id order by e.student_id, e.at desc) z where z.kind = 'boarded';
  update public.transport_trips set ended_at = now() where id = tr.id;
  return jsonb_build_object('ended', true, 'still_on_board', still);
end $$;

-- ---------------------------------------------------------------- parent RPCs
create or replace function public.set_transport_consent(p_student uuid, p_granted boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); g uuid;
begin
  if t is null or not app.tenant_writable() then raise exception 'permission denied' using errcode = '42501'; end if;
  select sg.guardian_id into g from public.student_guardians sg join public.guardians gg on gg.tenant_id = sg.tenant_id and gg.id = sg.guardian_id
  where sg.tenant_id = t and sg.student_id = p_student and gg.user_id = auth.uid() limit 1;
  if g is null then raise exception 'permission denied' using errcode = '42501'; end if; -- only the child's own guardian decides
  if coalesce(p_granted, false) then
    insert into public.transport_consents (tenant_id, student_id, guardian_id, recorded_by) values (t, p_student, g, auth.uid())
    on conflict (tenant_id, student_id, guardian_id) do update set granted_at = now(), revoked_at = null, recorded_by = auth.uid();
  else
    update public.transport_consents set revoked_at = now(), recorded_by = auth.uid()
    where tenant_id = t and student_id = p_student and guardian_id = g and revoked_at is null;
  end if;
end $$;

-- For each of the caller's children on a route: consent, the open trip, the bus's last position (only while the parent may see it)
-- and the child's last on/off event on that trip.
create or replace function public.my_bus_status()
returns table (student_id uuid, first_name text, route_name text, vehicle_label text, stop_name text, consent boolean, saferoute_on boolean,
               trip_id uuid, direction text, trip_started_at timestamptz, last_event text, last_event_at timestamptz,
               lat double precision, lng double precision, accuracy_m real, position_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare t uuid := app.current_tenant_id(); on_ boolean;
begin
  if t is null then return; end if;
  on_ := app.tenant_flag_on(t, 'saferoute');
  return query
    with mine as (
      select distinct sg.student_id, sg.guardian_id from public.student_guardians sg join public.guardians g on g.tenant_id = sg.tenant_id and g.id = sg.guardian_id
      where sg.tenant_id = t and g.user_id = auth.uid())
    select x.student_id, split_part(btrim(s.full_name), ' ', 1), r.name, r.vehicle_label, x.stop_name,
           exists (select 1 from public.transport_consents c where c.tenant_id = t and c.student_id = x.student_id and c.guardian_id = m.guardian_id and c.revoked_at is null),
           on_, tr.id, tr.direction, tr.started_at, e.kind, e.at,
           p.lat, p.lng, p.accuracy_m, p.recorded_at
    from mine m join public.transport_riders x on x.tenant_id = t and x.student_id = m.student_id
    join public.students s on s.tenant_id = t and s.id = x.student_id
    join public.transport_routes r on r.tenant_id = t and r.id = x.route_id
    left join public.transport_trips tr on on_ and tr.tenant_id = t and tr.route_id = r.id and tr.ended_at is null
      and exists (select 1 from public.transport_consents c where c.tenant_id = t and c.student_id = x.student_id and c.guardian_id = m.guardian_id and c.revoked_at is null)
    left join lateral (select ev.kind, ev.at from public.transport_events ev where ev.tenant_id = t and ev.trip_id = tr.id and ev.student_id = x.student_id order by ev.at desc limit 1) e on true
    -- DECISION: once their child is off the bus, the parent no longer sees where it goes (that is other children's journey)
    left join lateral (select pp.lat, pp.lng, pp.accuracy_m, pp.recorded_at from public.transport_positions pp
                       where pp.tenant_id = t and pp.trip_id = tr.id and coalesce(e.kind, '') <> 'alighted' order by pp.recorded_at desc limit 1) p on true
    order by s.full_name;
end $$;

-- ---------------------------------------------------------------- retention (service role, nightly)
-- DECISION: bus positions are kept 30 days (enough to answer "where was the bus at 7:40 last week"), boarding events for the session.
create or replace function public.purge_transport_positions(p_days int default 30) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  delete from public.transport_positions where recorded_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics n = row_count;
  -- a phone that died mid-trip leaves it open; close anything older than 12 hours
  update public.transport_trips set ended_at = started_at + interval '12 hours' where ended_at is null and started_at < now() - interval '12 hours';
  return n;
end $$;

-- ---------------------------------------------------------------- my_access: also report the school's switched-on flags (menus)
create or replace function public.my_access() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t uuid := app.current_tenant_id(); r jsonb;
begin
  if t is null then return null; end if;
  select jsonb_build_object(
    'tenant', jsonb_build_object('id', tn.id, 'name', tn.name, 'status', tn.status, 'locale', tn.locale, 'currency', tn.base_currency, 'timezone', tn.timezone),
    'permissions', coalesce((select jsonb_agg(p.key order by p.key) from public.permissions p where app.has_permission(p.key)), '[]'::jsonb),
    'features', to_jsonb(public.my_plan_features()),
    'flags', coalesce((select jsonb_agg(f.key order by f.key) from public.feature_flags f where app.tenant_flag_on(t, f.key)), '[]'::jsonb),
    'is_guardian', exists (select 1 from public.guardians g where g.tenant_id = t and g.user_id = auth.uid()),
    'is_crew', exists (select 1 from public.transport_routes r join public.staff_members s on s.tenant_id = r.tenant_id and s.id in (r.driver_staff_id, r.attendant_staff_id)
                       where r.tenant_id = t and r.is_active and s.user_id = auth.uid() and s.status = 'active')
  ) into r from public.tenants tn where tn.id = t;
  return r;
end $$;

-- apply_grants() re-runs in later migrations; the RPC-only list must include the new tables or a later call would re-open them.
create or replace function app.apply_grants() returns void language plpgsql as $$
declare n text;
begin
  revoke all on all tables in schema public from anon;
  grant select on public.plans, public.plan_features to anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  foreach n in array array[
    'audit_log', 'sensitive_access_log', 'impersonation_sessions', 'import_batches', 'import_rows', 'vendor_staff', 'tenant_counters',
    'accounts', 'accounting_periods', 'journal_entries', 'journal_lines',
    'concessions', 'cashier_sessions', 'payment_webhooks', 'vouchers', 'voucher_lines', 'voucher_adjustments', 'payments', 'payment_allocations',
    'guardian_contact_prefs', 'notification_deliveries', 'payroll_runs', 'payslips', 'exams', 'assessments', 'marks', 'mark_amendments', 'result_lines', 'result_summaries',
    'staff_attendance', 'admission_inquiries', 'admission_events', 'bank_statement_lines', 'family_refunds', 'security_deposits', 'installment_plans', 'installments', 'payment_promises', 'fee_reminders',
    'attendance_days', 'student_attendance', 'notification_outbox',
    'transport_cards', 'transport_consents', 'transport_trips', 'transport_positions', 'transport_events'
  ] loop
    if to_regclass('public.' || n) is not null then
      execute format('revoke insert, update, delete, truncate on public.%I from authenticated', n);
    end if;
  end loop;
  -- demo leads: the server creates them with the service role; vendor staff only update their status
  if to_regclass('public.demo_requests') is not null then
    revoke insert, delete, truncate on public.demo_requests from authenticated;
    revoke all on public.demo_requests from anon;
  end if;
end $$;
select app.apply_grants();
select app.harden_internal_functions();

revoke all on function public.route_cards(uuid, boolean), public.live_trips(), public.my_transport_routes(), public.start_trip(uuid, text),
  public.post_trip_positions(uuid, jsonb), public.scan_transport_card(uuid, text, text), public.mark_rider(uuid, uuid, text),
  public.trip_riders(uuid), public.end_trip(uuid), public.set_transport_consent(uuid, boolean), public.my_bus_status(), public.my_access() from public, anon;
grant execute on function public.route_cards(uuid, boolean), public.live_trips(), public.my_transport_routes(), public.start_trip(uuid, text),
  public.post_trip_positions(uuid, jsonb), public.scan_transport_card(uuid, text, text), public.mark_rider(uuid, uuid, text),
  public.trip_riders(uuid), public.end_trip(uuid), public.set_transport_consent(uuid, boolean), public.my_bus_status(), public.my_access() to authenticated, service_role;
revoke all on function public.purge_transport_positions(int) from public, anon, authenticated;
grant execute on function public.purge_transport_positions(int) to service_role;
