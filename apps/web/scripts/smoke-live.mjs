// Fetch real pages from a RUNNING web app (next start -p 3458) with a real session for the dev users, against the live Supabase project.
//   node apps/web/scripts/smoke-live.mjs [port]
// Builds the same auth cookie @supabase/ssr sets, so server components see a signed-in user.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const env = readFileSync(join(repo, 'apps', 'web', '.env.local'), 'utf8');
const get = (k) => new RegExp(`^${k}=(.+)$`, 'm').exec(env)?.[1]?.trim();
const URL_ = get('NEXT_PUBLIC_SUPABASE_URL'), ANON = get('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const logins = readFileSync(join(repo, 'dev-logins.local.txt'), 'utf8');
const pw = (e) => new RegExp(`email:\\s+${e.replace(/\./g, '\\.')}\\s+password:\\s+(\\S+)`).exec(logins)?.[1];
const port = process.argv[2] ?? '3458';
const ref = new URL(URL_).hostname.split('.')[0];

async function cookieFor(email) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw(email) }) });
  const session = await r.json();
  if (!session.access_token) throw new Error(`sign-in failed for ${email}`);
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  const name = `sb-${ref}-auth-token`, size = 3180;
  if (value.length <= size) return `${name}=${value}`;
  const parts = []; for (let i = 0; i * size < value.length; i++) parts.push(`${name}.${i}=${value.slice(i * size, (i + 1) * size)}`);
  return parts.join('; ');
}

let bad = 0;
const page = async (label, host, path, cookie, expect) => {
  // node:http, not fetch: fetch (undici) silently drops a custom Host header, and the app routes by Host
  const r = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: Number(port), path, method: 'GET', headers: { Host: `${host}:${port}`, ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (d) => (body += d)); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
  const html = r.status < 300 ? r.body : '';
  const loc = r.headers.location ?? '';
  const absentOk = (expect.absent ?? []).every((t) => !html.includes(t));
  const pass = !absentOk ? false : expect.status ? r.status === expect.status && (!expect.loc || loc.includes(expect.loc)) : r.status === 200 && (expect.text ?? []).every((t) => html.includes(t));
  if (!pass) bad++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}  [${r.status}${loc ? ' → ' + loc : ''}]${pass ? '' : '  missing: ' + (expect.text ?? []).filter((t) => !html.includes(t)).join(' | ')}`);
};

const vendor = await cookieFor('vendor.admin@xpertserviz.test');
const parent = await cookieFor('parent@noor-academy.test');
const teacher = await cookieFor('teacher@noor-academy.test');
const owner = await cookieFor('owner@noor-academy.test');

await page('login page renders both sign-in methods', 'app.localhost', '/portal/login', null, { text: ['Send code', 'Email', 'name="email"', 'name="password"', 'auth-split', 'Forgot your password', 'Activate my account'], absent: ['Mobile number'] });
await page('signed-out visitor to /portal/schools is sent to login', 'app.localhost', '/portal/schools', null, { status: 307, loc: '/portal/login' });
await page('vendor console renders tenants list', 'vendor.localhost', '/vendor/tenants', vendor, { text: ['Noor Academy', 'City Grammar School', 'Crescent'] });
await page('vendor plans page lists the 4 plans', 'vendor.localhost', '/vendor/plans', vendor, { text: ['Starter', 'Growth', 'Chain', 'Enterprise', 'Contact us'] });
await page('vendor flags page shows the legal-opinion lock', 'vendor.localhost', '/vendor/flags', vendor, { text: ['saferoute_child_phone', 'No legal opinion on record'] });
await page('vendor leads page renders', 'vendor.localhost', '/vendor/leads', vendor, { text: ['Demo requests'] });
await page('a school owner is turned away from the vendor console', 'vendor.localhost', '/vendor/tenants', owner, { status: 307, loc: '/not-found' });
await page('owner sees only their own school on the picker', 'app.localhost', '/portal/schools', owner, { text: ['Noor Academy'] });
// school pages, signed in as real demo users against the real seeded data (no Auth hook needed)
const A = 'app.localhost';
await page('COCKPIT shows the school and its numbers', A, '/portal', owner, { text: ['Today at school', 'Students enrolled', 'Fees outstanding', 'Waiting for you'] });
await page('APPROVALS lists the pending item', A, '/portal/approvals', owner, { text: ['Approvals'] });
await page('FEES lists vouchers with students', A, '/portal/fees', owner, { text: ['Fees', 'Daniyal Chaudhry', 'Record payment'] });
await page('FEE SETUP shows heads and structures', A, '/portal/fees/setup', owner, { text: ['Tuition fee', 'Transport fee', 'Grade 5', 'Issue monthly vouchers'] });
await page('CONCESSIONS shows the approved request', A, '/portal/fees/concessions', owner, { text: ['Staff child', 'Approved'] });
await page('BANK MATCHING renders', A, '/portal/fees/reconcile', owner, { text: ['Match bank deposits', 'Import bank statement'] });
await page('ACCOUNTS shows P&L and balance sheet', A, '/portal/accounts', owner, { text: ['Income and expenses', 'Balance sheet', 'Books balance'] });
await page('STUDENTS lists all 12 and the enrol form', A, '/portal/students', owner, { text: ['Amna Khan', 'Daniyal Chaudhry', 'Enrol a student'] });
await page('ATTENDANCE register chooser', A, '/portal/attendance', owner, { text: ['Attendance'] });
await page('EXAMS shows the published mid-term', A, '/portal/exams', owner, { text: ['Mid-term 2026', 'Published'] });
await page('PAYROLL renders (Growth plan)', A, '/portal/payroll', owner, { text: ['Payroll'] });
await page('ADMISSIONS shows both inquiries', A, '/portal/admissions', owner, { text: ['Rida Khalid', 'Saad Hussain'] });
await page('PARENT sees only their own children', A, '/portal/family', parent, { text: ['Amna Khan', 'Bilal Khan'], absent: ['Zara Ahmed', 'Daniyal Chaudhry'] });
await page('PARENT is not shown staff menus', A, '/portal/family', parent, { text: ['My family'], absent: ['Fee setup', 'Payroll', 'Bank matching'] });
await page('PARENT sent away from the accounts page', A, '/portal/accounts', parent, { status: 307, loc: '/portal' });
await page('MENU is grouped by topic for the owner', A, '/portal', owner, { text: ['class="navgroup"', 'Students', 'Fees', 'Staff &amp; buses', 'Timetable', 'Add a student', 'Collect a fee'] });
await page('STAFF page: list, staff attendance and add form', A, '/portal/staff', owner, { text: ['Staff list', 'Staff attendance', 'Add staff member'] });
await page('TIMETABLE page: subjects, bell periods, class picker', A, '/portal/timetable', owner, { text: ['Timetable', 'Subjects', 'Bell periods', 'Add period'] });
await page('SECURITY page offers a password change', A, '/portal/security', owner, { text: ['Change password', 'name="again"'] });
await page('PARENT does not get staff or timetable', A, '/portal/timetable', parent, { status: 307, loc: '/portal' });
await page('TEACHER can view the timetable but not edit it', A, '/portal/timetable', teacher, { text: ['Timetable'], absent: ['Add period', 'Add subject'] });
await page('TEACHER gets the attendance page', A, '/portal/attendance', teacher, { text: ['Attendance'] });
await page('TEACHER sees no fee setup', A, '/portal/fees/setup', teacher, { status: 307, loc: '/portal' });
await page('marketing home', 'localhost', '/', null, { text: ['Your school, running itself.'] });
await page('pricing reads the live plan catalogue (no prices → Contact us)', 'localhost', '/pricing', null, { text: ['Starter', 'Growth', 'Contact us'] });
await page('tenant site resolves a real school host', 'noor-academy.localhost', '/', null, { text: ['Noor Academy'] });
await page('unknown school host is a 404', 'ghost-school.localhost', '/', null, { status: 404 });
await page('the root host never serves the portal (plain 404, not an RSC page)', 'localhost', '/portal', owner, { status: 404, text: ['couldn'], absent: ['Noor Academy'] });
await page('the root host never serves the vendor console', 'localhost', '/vendor/tenants', vendor, { status: 404, absent: ['City Grammar'] });
await page('STUDENT IMPORT page renders for the owner', A, '/portal/students/import', owner, { text: ['Import students', 'Upload and check', 'Download an example file'] });
await page('TEACHER cannot open student import', A, '/portal/students/import', teacher, { status: 307, loc: '/portal' });

// SafeRoute (needs packages/db/scripts/dev-saferoute.mjs)
await page('TRANSPORT page: routes, riders, cards link for the owner', A, '/portal/transport', owner, { text: ['School transport', 'Route 1', 'LES-1234', 'Amna Khan', 'Print QR cards', 'Live buses'] });
await page('MENU shows Transport to the owner', A, '/portal', owner, { text: ['/portal/transport'] });
await page('TEACHER cannot open transport', A, '/portal/transport', teacher, { status: 307, loc: '/portal' });
const route1 = /href="\/portal\/transport\/cards\/([0-9a-f-]{36})"/.exec((await new Promise((res) => {
  http.get({ host: '127.0.0.1', port: Number(port), path: '/portal/transport', headers: { Host: `${A}:${port}`, Cookie: owner } }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res(b)); });
})))?.[1];
await page('BUS CARDS print page renders a QR per rider', A, `/portal/transport/cards/${route1}`, owner, { text: ['Bus cards', '<svg', 'Amna Khan', 'Zara Ahmed', 'Re-issue'] });
await page('PARENT sees the school bus section with consent state', A, '/portal/family', parent, { text: ['School bus', 'Route 1', 'Withdraw consent', 'I agree'] });
await page('PARENT bus page renders', A, '/portal/family/bus', parent, { text: ['School bus', 'Amna'], absent: ['Zara'] });
await page('PARENT cannot open the staff live-bus page', A, '/portal/transport/live', parent, { status: 307, loc: '/portal' });

await page('VENDOR add-people page lists the schools', 'vendor.localhost', '/vendor/people', vendor, { text: ['Add people to a school', 'Noor Academy', 'School owner'] });
// Super-admin control room + SEO
await page('VENDOR dashboard: platform numbers, schools, quick links', 'vendor.localhost', '/vendor', vendor, { text: ['Platform dashboard', 'Every school', 'Noor Academy', 'Quick links', 'Google Search Console'] });
await page('VENDOR website content page', 'vendor.localhost', '/vendor/website', vendor, { text: ['Website content', 'Demo video and reels', 'Add video', 'WhatsApp number'] });
await page('VENDOR visitors page', 'vendor.localhost', '/vendor/visitors', vendor, { text: ['Website visitors', 'Last 7 days', 'Last 30 days'] });
await page('a school owner cannot open the visitors page', 'vendor.localhost', '/vendor/visitors', owner, { status: 307, loc: '/not-found' });
await page('sitemap.xml lists the public pages (English + Urdu)', 'localhost', '/sitemap.xml', null, { text: ['/pricing', '/ur/pricing', 'hreflang'] });
await page('robots.txt names the sitemap and blocks private areas', 'localhost', '/robots.txt', null, { text: ['Sitemap:', 'Disallow: /portal', 'Disallow: /vendor'] });
await page('Urdu home page has its own address (/ur)', 'localhost', '/ur', null, { text: ['lang="ur"', 'rel="canonical"'] });
// Logins (invites): users.manage needs 2FA, so the demo owner (no 2FA) gets the explanation, not the form; a teacher is sent away
await page('ADD PEOPLE page: the owner (no 2FA) can add teachers, drivers, accountants', A, '/portal/people', owner, { text: ['Add people', 'name="email"', 'Teacher', 'Driver', 'Accountant'], absent: ['School owner</option>'] });
await page('MENU shows Logins to the owner', A, '/portal', owner, { text: ['/portal/people'] });
await page('TEACHER cannot open people', A, '/portal/people', teacher, { status: 307, loc: '/portal' });

console.log(bad ? `\n${bad} page check(s) FAILED` : '\nall live page checks passed');
process.exit(bad ? 1 : 0);
