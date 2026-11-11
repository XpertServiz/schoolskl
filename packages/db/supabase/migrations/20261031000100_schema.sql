-- Phase 1 · tables only. Helpers/functions: 0200, policies/triggers: 0300, RPCs: 0400, reference data: 0500.
-- DECISION: every tenant-owned table carries tenant_id NOT NULL (CLAUDE.md rule 1). Role definitions are therefore
-- copied per tenant from global role_templates at provisioning instead of using tenant_id NULL "system" rows.

create schema if not exists app;

-- ---------------------------------------------------------------- vendor
create table public.vendor_staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('vendor_super_admin', 'vendor_support', 'vendor_finance')),
  created_at timestamptz not null default now()
);

create table public.organisations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  price_minor bigint check (price_minor is null or price_minor >= 0), -- NULL = TBD (Open Question 3)
  currency    char(3) not null default 'PKR',
  billing_unit text not null default 'active_student_month',
  limits      jsonb not null default '{}'::jsonb,
  is_public   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now()
);

create table public.plan_features (
  plan_id     uuid not null references public.plans (id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null default true,
  limit_value bigint,
  primary key (plan_id, feature_key)
);

create table public.feature_flags (
  key             text primary key,
  description     text not null default '',
  default_enabled boolean not null default false
);

-- ---------------------------------------------------------------- tenancy
create table public.tenants (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid references public.organisations (id),
  slug                 text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
           and slug not in ('www', 'app', 'admin', 'api', 'vendor', 'auth', 'static', 'cdn', 'mail', 'portal')),
  name                 text not null,
  region               text not null default 'pk',
  plan_id              uuid references public.plans (id),
  status               text not null default 'trial'
    check (status in ('lead', 'trial', 'onboarding', 'live', 'suspended', 'churned')),
  branding             jsonb not null default '{}'::jsonb,
  locale               text not null default 'en' check (locale in ('en', 'ur')),
  timezone             text not null default 'Asia/Karachi',
  base_currency        char(3) not null default 'PKR',
  allow_vendor_support boolean not null default true,
  settings             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now()
);

create table public.tenant_domains (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  domain      text not null unique check (domain = lower(domain)),
  kind        text not null check (kind in ('subdomain', 'custom')),
  is_primary  boolean not null default false,
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now()
);
create index tenant_domains_tenant_idx on public.tenant_domains (tenant_id);

create table public.campuses (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  code       text not null,
  name       text not null,
  city       text,
  address    text,
  timezone   text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table public.tenant_flags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  flag_key   text not null references public.feature_flags (key) on delete cascade,
  enabled    boolean not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (tenant_id, flag_key)
);

create table public.impersonation_sessions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  vendor_user_id  uuid not null,
  reason          text not null check (length(btrim(reason)) >= 10),
  ticket_ref      text not null check (length(btrim(ticket_ref)) >= 1),
  permission_keys text[] not null default '{}',
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  check (expires_at > started_at and expires_at <= started_at + interval '30 minutes')
);
create index impersonation_sessions_tenant_idx on public.impersonation_sessions (tenant_id, started_at desc);

-- ---------------------------------------------------------------- identity
create table public.profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  full_name        text,
  phone            text,
  locale           text not null default 'en' check (locale in ('en', 'ur')),
  active_tenant_id uuid references public.tenants (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.user_tenants (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'active' check (status in ('invited', 'active', 'suspended', 'left')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index user_tenants_user_idx on public.user_tenants (user_id);

-- ---------------------------------------------------------------- access control
create table public.permissions (
  key         text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  module      text not null,
  description text not null default '',
  sensitive   boolean not null default false,
  requires_mfa boolean not null default false -- money/admin keys need an aal2 session (CLAUDE.md §12)
);

create table public.role_templates (
  key         text primary key,
  name        text not null,
  description text not null default ''
);

create table public.role_template_permissions (
  role_key       text not null references public.role_templates (key) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  key         text not null,
  name        text not null,
  description text not null default '',
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, key),
  unique (tenant_id, id) -- lets child tables FK (tenant_id, role_id) so a row can never point at another tenant's role
);

create table public.role_permissions (
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  role_id        uuid not null,
  permission_key text not null references public.permissions (key) on delete cascade,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  primary key (role_id, permission_key),
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id) on delete cascade
);
create index role_permissions_tenant_idx on public.role_permissions (tenant_id);

create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role_id    uuid not null,
  scope_type text not null default 'tenant' check (scope_type in ('tenant', 'campus', 'class', 'route')),
  scope_id   uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id) on delete cascade,
  check ((scope_type = 'tenant') = (scope_id is null))
);
create unique index user_roles_unique on public.user_roles (tenant_id, user_id, role_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'));
create index user_roles_user_idx on public.user_roles (tenant_id, user_id);

create table public.user_permission_overrides (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  effect         text not null check (effect in ('grant', 'deny')),
  scope_type     text not null default 'tenant' check (scope_type in ('tenant', 'campus', 'class', 'route')),
  scope_id       uuid,
  reason         text,
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  check ((scope_type = 'tenant') = (scope_id is null))
);
create index user_permission_overrides_user_idx on public.user_permission_overrides (tenant_id, user_id);

-- ---------------------------------------------------------------- audit
create table public.audit_log (
  id                       bigint generated always as identity primary key,
  tenant_id                uuid not null references public.tenants (id) on delete cascade,
  actor_id                 uuid,
  impersonation_session_id uuid,
  action                   text not null,
  table_name               text,
  record_id                text,
  before                   jsonb,
  after                    jsonb,
  ip                       inet,
  device                   text,
  created_at               timestamptz not null default now(),
  created_by               uuid,
  updated_at               timestamptz not null default now()
);
create index audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);

create table public.sensitive_access_log (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  actor_id     uuid not null,
  subject_type text not null,
  subject_id   uuid,
  field        text not null,
  purpose      text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now()
);
create index sensitive_access_log_tenant_idx on public.sensitive_access_log (tenant_id, created_at desc);

-- ---------------------------------------------------------------- bulk import framework
create table public.import_batches (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  entity          text not null check (entity ~ '^[a-z_]+$'),
  status          text not null default 'uploaded'
    check (status in ('uploaded', 'dry_run_ok', 'dry_run_failed', 'committed', 'rolled_back')),
  idempotency_key text not null,
  summary         jsonb not null default '{}'::jsonb,
  committed_at    timestamptz,
  rolled_back_at  timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, id)
);

create table public.import_rows (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  batch_id     uuid not null,
  row_no       int not null,
  raw          jsonb not null,
  status       text not null default 'pending' check (status in ('pending', 'valid', 'error', 'committed', 'rolled_back')),
  errors       jsonb not null default '[]'::jsonb,
  target_table text,
  target_id    uuid,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  foreign key (tenant_id, batch_id) references public.import_batches (tenant_id, id) on delete cascade,
  unique (batch_id, row_no)
);
create index import_rows_tenant_idx on public.import_rows (tenant_id, batch_id);
