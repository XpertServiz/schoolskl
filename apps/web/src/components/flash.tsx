/** Result of the last server action (?ok= / ?err=). `role=alert` so screen readers announce failures. */
export function Flash({ sp }: { sp: { ok?: string; err?: string } }) {
  if (sp.err) return <p role="alert" className="flash err">{sp.err}</p>;
  if (sp.ok) return <p role="status" className="flash ok">{sp.ok}</p>;
  return null;
}
