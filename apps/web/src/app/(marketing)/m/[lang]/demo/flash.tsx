'use client';

import { useSearchParams } from 'next/navigation';

/** The result of the last demo-form submit (?sent=1 / ?err=…), read in the browser so the page itself can stay static. */
export function DemoFlash({ thanks, errors }: { thanks: string; errors: { phone: string; fields: string; failed: string } }) {
  const sp = useSearchParams();
  const err = sp.get('err');
  if (sp.get('sent')) return <p role="status" className="flash ok">{thanks}</p>;
  if (err) return <p role="alert" className="flash err">{err === 'phone' ? errors.phone : err === 'fields' ? errors.fields : errors.failed}</p>;
  return null;
}
