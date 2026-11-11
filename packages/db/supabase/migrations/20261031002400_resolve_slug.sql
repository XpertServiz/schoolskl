-- Path routing (one host, e.g. a *.vercel.app address): school sites live at /s/<slug>, so the public lookup must also accept a bare slug.
-- It returns exactly what the host lookup already returns for <slug>.<root> — public name and branding — and only for a school that has a
-- verified platform subdomain and is not churned. The anon surface stays one function (resolve_tenant). A value with a dot is a host, as before.
create or replace function public.resolve_tenant(p_host text)
returns table (tenant_id uuid, slug text, name text, branding jsonb, locale text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.slug, t.name, t.branding, t.locale
  from public.tenant_domains d join public.tenants t on t.id = d.tenant_id
  where d.domain = lower(p_host) and d.verified_at is not null and t.status <> 'churned'
  union
  select t.id, t.slug, t.name, t.branding, t.locale
  from public.tenants t
  where position('.' in p_host) = 0 and t.slug = lower(p_host) and t.status <> 'churned'
    and exists (select 1 from public.tenant_domains d where d.tenant_id = t.id and d.kind = 'subdomain' and d.verified_at is not null)
$$;

revoke all on function public.resolve_tenant(text) from public;
grant execute on function public.resolve_tenant(text) to anon, authenticated, service_role;
