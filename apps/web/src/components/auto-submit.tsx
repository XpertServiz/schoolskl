'use client';

import { useEffect } from 'react';

/** Submits the form with this id once the page has hydrated (a server-action form cannot be submitted before React attaches its action). */
export function AutoSubmit({ formId }: { formId: string }) {
  useEffect(() => { (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit(); }, [formId]);
  return null;
}
