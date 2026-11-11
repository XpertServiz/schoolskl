'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Top-menu behaviour: a menu closes when the pointer leaves it, when you click elsewhere, when another opens, and after you navigate. */
export function NavBehavior() {
  const path = usePathname();
  useEffect(() => {
    const groups = () => Array.from(document.querySelectorAll<HTMLDetailsElement>('details.navgroup'));
    const closeAll = (except?: Element | null) => groups().forEach((d) => { if (d !== except) d.open = false; });
    const onLeave = (e: Event) => { (e.currentTarget as HTMLDetailsElement).open = false; };
    const onToggle = (e: Event) => { const d = e.currentTarget as HTMLDetailsElement; if (d.open) closeAll(d); };
    const onDoc = (e: Event) => { if (!(e.target as Element | null)?.closest?.('details.navgroup')) closeAll(); };
    closeAll();
    groups().forEach((d) => { d.addEventListener('mouseleave', onLeave); d.addEventListener('toggle', onToggle); });
    document.addEventListener('pointerdown', onDoc);
    return () => { groups().forEach((d) => { d.removeEventListener('mouseleave', onLeave); d.removeEventListener('toggle', onToggle); }); document.removeEventListener('pointerdown', onDoc); };
  }, [path]);
  return null;
}

/** "← Cockpit" on every page except the cockpit itself. */
export function BackBar({ label }: { label: string }) {
  const path = usePathname() ?? '/';
  if (path === '/' || path === '/portal' || path === '/portal/') return null;
  return <p className="backbar no-print"><Link href="/portal">{label}</Link></p>;
}
