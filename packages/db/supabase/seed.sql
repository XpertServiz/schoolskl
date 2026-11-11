-- Dev seed (CLAUDE.md §18 rule 9, Phase 1 slice): vendor + 3 demo tenants. FAKE people only — never real children's data.
-- Students, staff, vouchers etc. join this seed in the phases that introduce those tables.
-- Emails use the reserved .test TLD. Passwords are set by `supabase db reset` tooling / the dev script, not here.

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'vendor.admin@xpertserviz.test'),
  ('00000000-0000-4000-8000-000000000002', 'vendor.support@xpertserviz.test'),
  ('00000000-0000-4000-8000-0000000000a1', 'owner@noor-academy.test'),
  ('00000000-0000-4000-8000-0000000000b1', 'owner@city-grammar.test'),
  ('00000000-0000-4000-8000-0000000000c1', 'owner@crescent-schools.test')
on conflict do nothing;

insert into public.profiles (user_id, full_name, locale) values
  ('00000000-0000-4000-8000-000000000001', 'Vendor Admin (demo)', 'en'),
  ('00000000-0000-4000-8000-000000000002', 'Vendor Support (demo)', 'en'),
  ('00000000-0000-4000-8000-0000000000a1', 'Noor Academy Owner (demo)', 'ur'),
  ('00000000-0000-4000-8000-0000000000b1', 'City Grammar Owner (demo)', 'en'),
  ('00000000-0000-4000-8000-0000000000c1', 'Crescent Owner (demo)', 'en')
on conflict do nothing;

insert into public.vendor_staff (user_id, role) values
  ('00000000-0000-4000-8000-000000000001', 'vendor_super_admin'),
  ('00000000-0000-4000-8000-000000000002', 'vendor_support')
on conflict do nothing;

-- act as the vendor admin so create_tenant's role check and the audit trail see a real actor
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2"}', false);

select public.create_tenant('noor-academy',     'Noor Academy',          'starter', 'pk', 'ur', '00000000-0000-4000-8000-0000000000a1');
select public.create_tenant('city-grammar',     'City Grammar School',   'growth',  'pk', 'en', '00000000-0000-4000-8000-0000000000b1');
select public.create_tenant('crescent-schools', 'Crescent Schools Chain','chain',   'pk', 'en', '00000000-0000-4000-8000-0000000000c1');

insert into public.campuses (tenant_id, code, name, city)
select t.id, c.code, c.name, c.city from public.tenants t join (values
  ('city-grammar',     'NORTH', 'North Campus', 'Lahore'),
  ('crescent-schools', 'DHA',   'DHA Campus',   'Karachi'),
  ('crescent-schools', 'GULBERG','Gulberg Campus','Lahore')) as c(slug, code, name, city) on c.slug = t.slug
on conflict do nothing;

select set_config('request.jwt.claims', '', false);
