'use client';

import { useEffect } from 'react';

/** Remembers the school's (public) name in this browser so the sign-in screen can paint it on the 3D campus next time. */
export function RememberSchool({ name }: { name: string }) {
  useEffect(() => { try { window.localStorage.setItem('lastSchool', name); } catch { /* storage blocked: fine */ } }, [name]);
  return null;
}
