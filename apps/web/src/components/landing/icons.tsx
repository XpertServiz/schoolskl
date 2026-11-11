import type { ReactNode } from 'react';

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const I = (children: ReactNode) => <svg {...base}>{children}</svg>;

export const Icons = {
  fees: I(<><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9v.01M18 15v.01" /></>),
  ledger: I(<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6" /></>),
  results: I(<><path d="M3 9l9-5 9 5-9 5z" /><path d="M7 11.5V16c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5v-4.5" /><path d="M21 9v5" /></>),
  attendance: I(<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M8 13l2.5 2.5L16 10" /></>),
  language: I(<><path d="M4 6h9M8.5 4v2M6 6c.5 3 2.5 5.5 5 7M11 6c-.5 3-3 6-6.5 8" /><path d="M13 20l4-9 4 9M14.4 17h5.2" /></>),
  offline: I(<><path d="M3 3l18 18" /><path d="M8.5 16.5a5 5 0 0 1 4.8-1.3M5 12.5a9.5 9.5 0 0 1 3.2-2M2 9a14 14 0 0 1 6-3.4M12 20h.01M15.5 10.4A9.5 9.5 0 0 1 19 12.5M17 7a14 14 0 0 1 5 2" /></>),
  phone: I(<><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>),
  users: I(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.8.7 3 2.3 3 5.2" /></>),
  office: I(<><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M8 7h2M14 7h2M8 11h2M14 11h2M10 21v-4h4v4" /></>),
  shield: I(<><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>),
  eyeOff: I(<><path d="M3 3l18 18M10.6 6.2A9.5 9.5 0 0 1 12 6c5 0 8.5 4 9.5 6-.4.8-1.2 2-2.4 3.1M6.2 7.6C4.4 8.9 3.1 10.7 2.5 12c1 2 4.5 6 9.5 6 1.4 0 2.7-.3 3.8-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>),
  lock: I(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>),
  hand: I(<><path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5V4.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v6c0 4-2.5 7-6 7-2.5 0-4-1.2-5.2-3.2L4 13.5a1.4 1.4 0 0 1 2.3-1.6L8 14" /></>),
  bus: I(<><rect x="3.5" y="4" width="17" height="13" rx="2.5" /><path d="M3.5 11h17M7 20v-3M17 20v-3M7.5 14.5h.01M16.5 14.5h.01" /></>),
  admissions: I(<><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5V3h6v1.5M9 10h6M9 14h4" /><path d="M15.5 17.5l1.5 1.5 3-3" /></>),
  timetable: I(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  compass: I(<><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>),
  logo: <svg viewBox="0 0 120 110" aria-hidden="true"><g fill="none" stroke="#F5A524" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round"><path d="M14 52 60 18l46 34M24 50v42h72V50M52 92V68h16v24M60 18V4M10 98h100" /></g><path d="M60 4l22 7-22 7z" fill="#F5A524" /></svg>,
};
