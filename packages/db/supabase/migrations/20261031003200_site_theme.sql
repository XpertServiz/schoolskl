-- Landing-page theme choice (public, chosen by the super admin). Only a short list of names is accepted, never free CSS.
alter table public.site_settings drop constraint if exists site_settings_key_check;
alter table public.site_settings add constraint site_settings_key_check
  check (key in ('whatsapp', 'phone', 'email', 'facebook', 'instagram', 'youtube', 'tiktok', 'announcement_en', 'announcement_ur', 'theme'));
alter table public.site_settings drop constraint if exists site_settings_theme_value;
alter table public.site_settings add constraint site_settings_theme_value check (key <> 'theme' or value in ('saffron', 'teal', 'violet', 'rose'));
