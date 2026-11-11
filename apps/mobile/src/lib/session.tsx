import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { formatMoney, money } from '@ilmora/core';
import { t, type Locale } from '@ilmora/i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

export interface Access {
  tenant: { id: string; name: string; status: string; locale: Locale; currency: string };
  permissions: string[];
  features: string[];
  /** feature flags switched on for this school (e.g. saferoute) */
  flags?: string[];
  is_guardian: boolean;
  /** driver or attendant on an active route */
  is_crew?: boolean;
}


interface Ctx {
  ready: boolean;
  session: Session | null;
  access: Access | null;
  /** set when this login is platform staff (super admin); they have no school, so the app shows the admin area */
  vendorRole: string | null;
  locale: Locale;
  rtl: boolean;
  setLocale: (l: Locale) => Promise<void>;
  tr: (key: string, vars?: Record<string, string | number>) => string;
  fmt: (minor: number | string | null | undefined) => string;
  can: (permission: string) => boolean;
  refreshAccess: () => Promise<void>;
  signOut: () => Promise<void>;
}

const C = createContext<Ctx | null>(null);
export const useApp = (): Ctx => {
  const v = useContext(C);
  if (!v) throw new Error('useApp outside <AppProvider>');
  return v;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [vendorRole, setVendorRole] = useState<string | null>(null);
  const [locale, setLocaleState] = useState<Locale>('en');

  const refreshAccess = useCallback(async () => {
    // permissions come from the database; the app only uses them to choose what to show. vendor_staff shows a row only to its owner.
    // (the super admin may read EVERY vendor_staff row, so the lookup must name this login's own row)
    const uid = (await supabase.auth.getSession()).data.session?.user.id ?? '00000000-0000-0000-0000-000000000000';
    const [{ data }, v] = await Promise.all([supabase.rpc('my_access'), supabase.from('vendor_staff').select('role').eq('user_id', uid).maybeSingle()]);
    setAccess((data as Access | null) ?? null);
    setVendorRole(((v.data as { role?: string } | null)?.role) ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem('locale');
      if (saved === 'ur' || saved === 'en') setLocaleState(saved);
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      if (data.session) await refreshAccess();
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) void refreshAccess(); else { setAccess(null); setVendorRole(null); }
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshAccess]);

  const setLocale = useCallback(async (l: Locale) => { setLocaleState(l); await AsyncStorage.setItem('locale', l); }, []);
  const value = useMemo<Ctx>(() => {
    const perms = new Set(access?.permissions ?? []);
    const cur = access?.tenant.currency ?? 'PKR';
    return {
      ready, session, access, vendorRole, locale, rtl: locale === 'ur', setLocale,
      tr: (k, v) => t(locale, k, v),
      fmt: (m) => formatMoney(money(BigInt(Math.trunc(Number(m ?? 0))), cur), locale === 'ur' ? 'ur-PK' : 'en-PK'),
      can: (p) => perms.has(p),
      refreshAccess,
      signOut: async () => { await supabase.auth.signOut(); },
    };
  }, [ready, session, access, vendorRole, locale, setLocale, refreshAccess]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
