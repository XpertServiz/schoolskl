-- CLAUDE.md §7.1 / rules 3-4: features that track or profile children stay OFF until a written legal opinion is on record.
-- Until now that was only a seeded default; a vendor user could still insert the tenant_flags row. This makes the database refuse it.

alter table public.feature_flags
  add column requires_legal_ref boolean not null default false,
  add column legal_ref text; -- reference to the written opinion (document id / date / firm); recorded by a vendor super-admin

update public.feature_flags set requires_legal_ref = true where key in ('saferoute_child_phone', 'face_attendance', 'learning_compass');

create or replace function app.guard_legal_flag() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.feature_flags;
begin
  if tg_table_name = 'tenant_flags' then
    if new.enabled then
      select * into f from public.feature_flags where key = new.flag_key;
      if f.requires_legal_ref and coalesce(btrim(f.legal_ref), '') = '' then
        raise exception 'the feature "%" cannot be switched on: no written legal opinion is on record for it', new.flag_key using errcode = '42501', hint = 'legal_opinion_required';
      end if;
    end if;
  else -- feature_flags
    if new.requires_legal_ref and coalesce(btrim(new.legal_ref), '') = '' then
      if new.default_enabled then
        raise exception 'the feature "%" cannot be on by default: no written legal opinion is on record for it', new.key using errcode = '42501', hint = 'legal_opinion_required';
      end if;
      -- withdrawing an opinion must not leave schools running the feature
      if exists (select 1 from public.tenant_flags tf where tf.flag_key = new.key and tf.enabled) then
        raise exception 'the legal opinion for "%" cannot be removed while schools still have it switched on', new.key using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger tenant_flags_legal_guard before insert or update on public.tenant_flags
  for each row execute function app.guard_legal_flag();
create trigger feature_flags_legal_guard before insert or update on public.feature_flags
  for each row execute function app.guard_legal_flag();

select app.harden_internal_functions();
select app.apply_grants();
