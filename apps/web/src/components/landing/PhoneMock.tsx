/**
 * CSS-only phone mock-ups of the real app screens (apps/mobile). The numbers and names are SAMPLE data, labelled as such,
 * and every word comes from the same EN/UR catalogue the real app uses.
 */
type Tr = (key: string, vars?: Record<string, string | number>) => string;

export function PhoneMock({ kind, tr }: { kind: 'parent' | 'teacher'; tr: Tr }) {
  return (
    <figure className={`phone phone-${kind}`} aria-label={tr(kind === 'parent' ? 'marketing.apps.parent' : 'marketing.apps.teacher')}>
      <div className="phone-notch" aria-hidden="true" />
      <div className="phone-screen">
        <div className="ph-bar"><strong>{tr('marketing.mock.school')}</strong><span className="ph-chip">{tr('marketing.mock.sample')}</span></div>
        {kind === 'parent' ? (
          <>
            <div className="ph-card">
              <strong>{tr('marketing.mock.child')}</strong>
              <span className="ph-muted">{tr('family.attendance')}: <b className="ltr">27/28</b></span>
            </div>
            <div className="ph-card">
              <span className="ph-muted">{tr('marketing.mock.feeDue')}</span>
              <b className="ph-big ltr">PKR 6,000.00</b>
              <span className="ph-muted">{tr('mobile.fees.payWith')}</span>
              <b className="ltr ph-code">1000000042</b>
              <span className="ph-btn secondary">{tr('mobile.fees.copy')}</span>
            </div>
            <div className="ph-card">
              <strong>{tr('marketing.mock.exam')}</strong>
              <span className="ph-muted ltr">86% · A1</span>
            </div>
          </>
        ) : (
          <>
            <div className="ph-card ph-note">{tr('mobile.att.waiting', { count: 1 })}</div>
            {([['marketing.mock.s1', 'present'], ['marketing.mock.s2', 'absent'], ['marketing.mock.s3', 'present'], ['marketing.mock.s4', 'late'], ['marketing.mock.s5', 'present']] as const).map(([name, st]) => (
              <div key={name} className={`ph-row st-${st}`}>
                <span>{tr(name)}</span>
                <b>{tr(st === 'present' ? 'cockpit.present' : st === 'absent' ? 'cockpit.absent' : 'attendance.late')}</b>
              </div>
            ))}
            <span className="ph-btn">{tr('attendance.save')}</span>
            <span className="ph-ok">{tr('mobile.att.queued')}</span>
          </>
        )}
      </div>
    </figure>
  );
}
