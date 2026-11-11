/**
 * The website / app helper ("Aiman"): answers visitors' questions from a fixed, reviewed knowledge base. No paid API, no network call,
 * nothing is sent anywhere. It understands English, Urdu script and Roman Urdu ("mjhe cost btao"), forgives typos, and caches answers.
 *
 * Honesty rules: it only states what the product actually does today; for prices, dates and anything it cannot answer it points to a
 * person (WhatsApp / demo request) instead of guessing. It never collects personal data.
 */
export type Loc = 'en' | 'ur';
export interface Reply { kind: 'answer' | 'smalltalk' | 'fallback'; text: string; link?: { href: string; label: string }; chips: string[] }

interface Entry { id: string; kw: string[]; en: string; ur: string; link?: { href: string; en: string; ur: string }; chips?: string[] }

/** lower-case, strip punctuation/diacritics, unify common chat spellings */
export const normalize = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const ALIAS: Record<string, string> = {
  mjhe: 'mujhe', mujhy: 'mujhe', mjh: 'mujhe', mujh: 'mujhe', btao: 'batao', bta: 'batao', btaye: 'batao', bataye: 'batao', btaen: 'batao', bataen: 'batao', btana: 'batao',
  kia: 'kya', kiya: 'kya', ky: 'kya', hy: 'hai', he: 'hai', hn: 'hain', hein: 'hain', kitni: 'kitna', kitne: 'kitna', kta: 'kitna', qeemat: 'price', keemat: 'price', kimat: 'price', rate: 'price', rates: 'price',
  plz: 'please', pls: 'please', thx: 'thanks', tnx: 'thanks', wtsapp: 'whatsapp', watsapp: 'whatsapp', whatsap: 'whatsapp', wapp: 'whatsapp',
  skool: 'school', scool: 'school', schol: 'school', fees: 'fee', feee: 'fee', fess: 'fee', costs: 'cost', pricing: 'price', prices: 'price', charges: 'price', charge: 'price',
  apps: 'app', application: 'app', mobile: 'app', android: 'app', phone: 'app', apk: 'app', downlod: 'download', dwnload: 'download',
  salaries: 'salary', tankhwa: 'salary', tankhah: 'salary', result: 'results', marks: 'results', exam: 'results', exams: 'results',
};
const STOP = new Set('the a an is are am was be do does did i you we to for of in on at and or my me can how what which who why it this that with from have has will would should please tell about give need want get hai hain ka ki ke ko se ye yeh mujhe mera meri hum aap ap main mein bhi aur nahi nahin par per liye kya batao karo kar kro krna chahiye chahye chahiye mai may ho hota hoti hoga hogi kuch koi iska iski uska uski isme usme tum tumhara apka apki apna kaise kese kab kahan kidhar کیا ہے ہیں کا کی کے کو سے میں مجھے بتائیں بتاو بتائو براہ مہربانی اور بھی نہیں پر لیے کیسے کب کہاں'.split(' '));
const ROMAN_URDU = new Set('mujhe batao kya hai hain kitna kaise kese kab kahan chahiye chahye mera meri aap ap hum nahi nahin liye kar karo ka ki ke ko se mein main bhi aur salam assalam shukriya theek acha ji haan han'.split(' '));

/** Damerau-Levenshtein distance that gives up once it passes `max`. */
export function distance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      best = Math.min(best, d[i]![j]!);
    }
    if (best > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}
/** short words must match exactly ("fee" is not "free"); longer words may be 1–2 letters off */
const allowance = (len: number) => (len <= 4 ? 0 : len <= 7 ? 1 : 2);
export const near = (typed: string, target: string) => {
  if (typed === target) return true;
  const a = allowance(Math.min(typed.length, target.length));
  return a > 0 && distance(typed, target, a) <= a;
};

const KB: Entry[] = [
  { id: 'price', kw: ['price', 'cost', 'fee', 'plan', 'plans', 'package', 'subscription', 'monthly', 'free', 'trial', 'kitna', 'paisa', 'paise', 'rupees', 'kharcha', 'قیمت', 'فیس', 'خرچہ', 'کتنا', 'پلان', 'مفت'],
    en: 'Pricing depends on the size of your school, so we quote after a short demo. Open the Pricing page for the plans, or ask us on WhatsApp for a quote — there is no hidden fee.',
    ur: 'قیمت آپ کے اسکول کے سائز پر منحصر ہے، اس لیے مختصر ڈیمو کے بعد کوٹیشن دی جاتی ہے۔ پلانز کے لیے قیمتوں کا صفحہ دیکھیں یا واٹس ایپ پر کوٹیشن مانگیں — کوئی چھپی ہوئی فیس نہیں۔',
    link: { href: '/pricing', en: 'See pricing', ur: 'قیمتیں دیکھیں' }, chips: ['demo', 'features'] },
  { id: 'demo', kw: ['demo', 'demonstration', 'show', 'try', 'test', 'sample', 'presentation', 'dikhao', 'dikhana', 'ڈیمو', 'دکھائیں', 'آزمائش'],
    en: 'You can book a free live demo — we walk through fees, attendance, results and the parent app with sample data. Fill the short demo form and we will call or WhatsApp you.',
    ur: 'آپ مفت لائیو ڈیمو بُک کر سکتے ہیں — ہم نمونہ ڈیٹا کے ساتھ فیس، حاضری، نتائج اور پیرنٹ ایپ دکھاتے ہیں۔ مختصر ڈیمو فارم بھریں، ہم کال یا واٹس ایپ کریں گے۔',
    link: { href: '/demo', en: 'Book a demo', ur: 'ڈیمو بُک کریں' }, chips: ['price', 'app'] },
  { id: 'features', kw: ['feature', 'features', 'module', 'modules', 'include', 'includes', 'what', 'offer', 'system', 'software', 'kya', 'خصوصیات', 'سہولیات', 'فیچرز'],
    en: 'It covers the whole school: admissions, students and families, fee vouchers and collection, attendance, timetable, exams and report cards, staff and payroll, accounting and reports, SafeRoute school-bus tracking, and apps for parents, teachers and drivers — in English and Urdu.',
    ur: 'یہ پورے اسکول کو سنبھالتا ہے: داخلے، طلبہ اور خاندان، فیس واؤچر اور وصولی، حاضری، ٹائم ٹیبل، امتحانات اور رپورٹ کارڈ، اسٹاف اور تنخواہیں، اکاؤنٹنگ اور رپورٹس، سیف روٹ اسکول بس ٹریکنگ، اور والدین، اساتذہ اور ڈرائیور کی ایپس — انگریزی اور اردو میں۔',
    link: { href: '/#features', en: 'See all features', ur: 'تمام خصوصیات' }, chips: ['demo', 'fees'] },
  { id: 'fees', kw: ['voucher', 'vouchers', 'challan', 'collection', 'collect', 'late', 'fine', 'concession', 'defaulter', 'defaulters', 'receivable', 'khata', 'ledger', 'واؤچر', 'چالان', 'رعایت', 'بقایا'],
    en: 'Fees: monthly vouchers/challans for every child, cash and bank collection with receipts, family accounts (khata), siblings linked automatically, late fines, instalments, concessions with owner approval, reminders, and a ledger that always balances.',
    ur: 'فیس: ہر بچے کے ماہانہ واؤچر/چالان، نقد اور بینک وصولی کی رسیدیں، فیملی اکاؤنٹ (کھاتہ)، بہن بھائیوں کا خودکار ربط، لیٹ فائن، اقساط، مالک کی منظوری سے رعایت، یاددہانیاں، اور ہمیشہ متوازن لیجر۔',
    chips: ['accounting', 'price'] },
  { id: 'attendance', kw: ['attendance', 'present', 'absent', 'register', 'hazri', 'hazir', 'حاضری', 'غیرحاضر'],
    en: 'Attendance: teachers mark only the absentees (everyone defaults to present), even offline on the phone; parents get an absence alert, and staff can check themselves in. Fingerprint/face machines can feed staff attendance.',
    ur: 'حاضری: اساتذہ صرف غیر حاضر طلبہ نشان زد کرتے ہیں (باقی سب حاضر)، موبائل پر آف لائن بھی؛ والدین کو غیر حاضری کا الرٹ ملتا ہے، اور اسٹاف خود چیک اِن کر سکتا ہے۔ فنگر پرنٹ/فیس مشینیں اسٹاف حاضری میں ڈیٹا بھیج سکتی ہیں۔',
    chips: ['app', 'payroll'] },
  { id: 'results', kw: ['results', 'report', 'card', 'cards', 'grade', 'grades', 'gradebook', 'marking', 'نتیجہ', 'نتائج', 'رپورٹ', 'گریڈ'],
    en: 'Exams: teachers enter marks per subject or per student, a coordinator moderates, then results are published with class positions and printable report cards. Parents see them in the app. A published card is frozen.',
    ur: 'امتحانات: اساتذہ فی مضمون یا فی طالب علم نمبر درج کرتے ہیں، کوآرڈینیٹر ماڈریشن کرتا ہے، پھر کلاس پوزیشن اور پرنٹ ایبل رپورٹ کارڈ کے ساتھ نتائج شائع ہوتے ہیں۔ والدین ایپ میں دیکھتے ہیں۔ شائع شدہ کارڈ منجمد ہوتا ہے۔' },
  { id: 'payroll', kw: ['payroll', 'salary', 'salaries', 'payslip', 'payslips', 'employee', 'employees', 'teacher', 'teachers', 'staff', 'leave', 'leaves', 'تنخواہ', 'تنخواہیں', 'ملازم', 'اسٹاف', 'رخصت'],
    en: 'Payroll: employee-wise sheet from salary, attendance, annual leave and joining date; one person prepares, another approves and posts, and each employee sees only their own payslip. It posts to the accounts automatically.',
    ur: 'پے رول: تنخواہ، حاضری، سالانہ رخصت اور شمولیت کی تاریخ سے ملازم وار شیٹ؛ ایک شخص تیار کرتا ہے، دوسرا منظور اور پوسٹ کرتا ہے، اور ہر ملازم صرف اپنی تنخواہ سلپ دیکھتا ہے۔ اکاؤنٹس میں خودکار اندراج ہوتا ہے۔' },
  { id: 'accounting', kw: ['accounting', 'accounts', 'account', 'bank', 'reconciliation', 'journal', 'balance', 'sheet', 'profit', 'loss', 'cash', 'flow', 'quickbooks', 'sage', 'reports', 'finance', 'اکاؤنٹنگ', 'بینک', 'رپورٹس', 'حسابات'],
    en: 'Accounting: chart of accounts, general journal (changes are done by reversal, so the trail stays), bank reconciliation with auto-matching, and reports — profit & loss, balance sheet, trial balance, cash flow, aged receivables — all from the same books as the fee desk.',
    ur: 'اکاؤنٹنگ: چارٹ آف اکاؤنٹس، جنرل جرنل (تبدیلی ریورسل سے ہوتی ہے تاکہ ریکارڈ باقی رہے)، آٹو میچنگ کے ساتھ بینک ریکنسلی ایشن، اور رپورٹس — نفع و نقصان، بیلنس شیٹ، ٹرائل بیلنس، کیش فلو، بقایا جات — سب فیس ڈیسک والی انہی کتابوں سے۔' },
  { id: 'app', kw: ['app', 'download', 'install', 'ios', 'iphone', 'play', 'store', 'parent', 'parents', 'ایپ', 'ڈاؤنلوڈ', 'موبائل', 'والدین'],
    en: 'There is an installable web app and an Android app (APK) for parents, teachers, drivers and the school owner. Parents see fees, attendance, results and the school bus; teachers mark attendance even offline.',
    ur: 'والدین، اساتذہ، ڈرائیورز اور اسکول مالک کے لیے انسٹال ہونے والی ویب ایپ اور اینڈرائیڈ ایپ (APK) موجود ہے۔ والدین فیس، حاضری، نتائج اور اسکول بس دیکھتے ہیں؛ اساتذہ آف لائن بھی حاضری لگاتے ہیں۔',
    link: { href: '/apps', en: 'Get the app', ur: 'ایپ حاصل کریں' }, chips: ['demo'] },
  { id: 'bus', kw: ['bus', 'transport', 'saferoute', 'tracking', 'track', 'gps', 'driver', 'location', 'van', 'بس', 'ٹرانسپورٹ', 'ڈرائیور', 'لوکیشن', 'ٹریکنگ'],
    en: 'SafeRoute tracks the school BUS, never the child: the driver’s phone shares the bus position during a trip, children scan a printed QR card when boarding, and parents who gave consent see the bus on a map. The school is alerted if a bus is late.',
    ur: 'سیف روٹ اسکول بس کو ٹریک کرتا ہے، بچے کو کبھی نہیں: سفر کے دوران ڈرائیور کا فون بس کی لوکیشن شیئر کرتا ہے، بچے سوار ہوتے وقت پرنٹڈ QR کارڈ اسکین کرتے ہیں، اور رضامندی دینے والے والدین نقشے پر بس دیکھتے ہیں۔ بس لیٹ ہو تو اسکول کو الرٹ ملتا ہے۔',
    chips: ['privacy', 'app'] },
  { id: 'privacy', kw: ['privacy', 'secure', 'security', 'safe', 'safety', 'data', 'consent', 'child', 'children', 'protect', 'private', 'rls', 'پرائیویسی', 'محفوظ', 'ڈیٹا', 'رضامندی', 'بچوں'],
    en: 'Each school’s data is isolated in the database itself, not just in code. Parents see only their own children, there are no ads or trackers, children are never tracked without recorded parental consent, and every important change is logged.',
    ur: 'ہر اسکول کا ڈیٹا ڈیٹا بیس کی سطح پر الگ ہے، صرف کوڈ میں نہیں۔ والدین صرف اپنے بچے دیکھتے ہیں، کوئی اشتہار یا ٹریکر نہیں، ریکارڈ شدہ والدین کی رضامندی کے بغیر بچوں کو ٹریک نہیں کیا جاتا، اور ہر اہم تبدیلی لاگ ہوتی ہے۔',
    link: { href: '/privacy', en: 'Privacy & children', ur: 'پرائیویسی اور بچے' } },
  { id: 'urdu', kw: ['urdu', 'language', 'english', 'rtl', 'languages', 'اردو', 'زبان', 'انگریزی'],
    en: 'Everything is available in English and Urdu (right-to-left), and each person can switch the language at any time.',
    ur: 'ہر چیز انگریزی اور اردو (دائیں سے بائیں) میں دستیاب ہے، اور ہر شخص جب چاہے زبان بدل سکتا ہے۔' },
  { id: 'start', kw: ['start', 'setup', 'begin', 'onboarding', 'import', 'migrate', 'excel', 'csv', 'existing', 'shuru', 'شروع', 'سیٹ', 'ایکسل'],
    en: 'Getting started is quick: a setup wizard adds your campuses, classes and fees, and you can import students from an Excel/CSV sheet. We help with the first setup during the demo.',
    ur: 'شروع کرنا آسان ہے: سیٹ اپ وزرڈ آپ کے کیمپس، کلاسیں اور فیسیں شامل کرتا ہے، اور آپ ایکسل/CSV شیٹ سے طلبہ امپورٹ کر سکتے ہیں۔ پہلے سیٹ اپ میں ڈیمو کے دوران مدد کی جاتی ہے۔',
    link: { href: '/demo', en: 'Book a demo', ur: 'ڈیمو بُک کریں' } },
  { id: 'payments', kw: ['jazzcash', 'easypaisa', 'raast', '1link', '1bill', 'online', 'gateway', 'payment', 'payments', 'pay', 'qr', 'ادائیگی', 'جازکیش', 'ایزی'],
    en: 'Today fees are collected at the school desk (cash or bank) and bank deposits can be matched from your statement. Online payment partners (Raast, JazzCash, Easypaisa, 1Link) are being integrated — ask us for the current status.',
    ur: 'آج فیس اسکول کاؤنٹر پر (نقد یا بینک) وصول ہوتی ہے اور بینک ڈپازٹس آپ کی اسٹیٹمنٹ سے میچ ہو جاتے ہیں۔ آن لائن پیمنٹ پارٹنرز (راست، جازکیش، ایزی پیسہ، ون لنک) کا انضمام جاری ہے — موجودہ صورتحال ہم سے پوچھیں۔' },
  { id: 'offline', kw: ['offline', 'internet', 'network', 'signal', 'connection', 'آف', 'انٹرنیٹ'],
    en: 'Teachers can mark attendance without internet; the phone saves it and syncs when the connection returns.',
    ur: 'اساتذہ انٹرنیٹ کے بغیر حاضری لگا سکتے ہیں؛ فون محفوظ رکھتا ہے اور رابطہ آنے پر خود بھیج دیتا ہے۔' },
  { id: 'multi', kw: ['campus', 'campuses', 'branch', 'branches', 'chain', 'multiple', 'groups', 'کیمپس', 'برانچ', 'برانچز'],
    en: 'Yes — one school can have several campuses, and each person can be limited to the campus or class they work in.',
    ur: 'جی ہاں — ایک اسکول کے کئی کیمپس ہو سکتے ہیں، اور ہر شخص کو اس کیمپس یا کلاس تک محدود کیا جا سکتا ہے جہاں وہ کام کرتا ہے۔' },
  { id: 'contact', kw: ['contact', 'call', 'whatsapp', 'human', 'person', 'agent', 'support', 'help', 'talk', 'number', 'email', 'phone', 'rabta', 'رابطہ', 'واٹس', 'کال', 'مدد'],
    en: 'Happy to connect you with a person. Use the WhatsApp button on this page, or send the demo form and we will reach out.',
    ur: 'آپ کو ہماری ٹیم سے ملوانے میں خوشی ہوگی۔ اس صفحے پر واٹس ایپ بٹن استعمال کریں، یا ڈیمو فارم بھیجیں، ہم رابطہ کریں گے۔',
    link: { href: '/demo', en: 'Request a call', ur: 'کال کی درخواست' } },
];

const GREET = ['hi', 'hello', 'hey', 'salam', 'salaam', 'assalam', 'assalamualaikum', 'aoa', 'سلام', 'السلام', 'ہیلو'];
const THANKS = ['thanks', 'thank', 'shukriya', 'shukria', 'jazakallah', 'شکریہ'];
const BYE = ['bye', 'goodbye', 'allah', 'khuda', 'الوداع'];

const T = (loc: Loc, en: string, ur: string) => (loc === 'ur' ? ur : en);
const CHIP_LABEL: Record<string, [string, string]> = {
  price: ['Pricing', 'قیمتیں'], demo: ['Book a demo', 'ڈیمو'], features: ['Features', 'خصوصیات'], fees: ['Fee management', 'فیس'], app: ['Mobile app', 'ایپ'],
  accounting: ['Accounting', 'اکاؤنٹنگ'], payroll: ['Payroll', 'تنخواہیں'], privacy: ['Privacy', 'پرائیویسی'], bus: ['School bus', 'اسکول بس'], contact: ['Talk to a person', 'ٹیم سے بات'],
};
export const chipLabel = (id: string, loc: Loc) => (CHIP_LABEL[id] ? T(loc, CHIP_LABEL[id]![0], CHIP_LABEL[id]![1]) : id);
export const STARTER_CHIPS = ['price', 'demo', 'features', 'app', 'contact'];

/** words → canonical tokens (alias map applied, stop words dropped) */
export const tokens = (q: string) => normalize(q).split(' ').filter(Boolean).map((w) => ALIAS[w] ?? w).filter((w) => !STOP.has(w));

// inverse document frequency: a keyword that appears in only one entry is worth more than one shared by many
const DF = new Map<string, number>();
for (const e of KB) for (const k of new Set(e.kw)) DF.set(k, (DF.get(k) ?? 0) + 1);
const VOCAB = [...DF.keys()];

function score(toks: string[]) {
  const scores = new Map<string, number>();
  for (const tok of toks) {
    for (const e of KB) {
      for (const k of e.kw) {
        if (near(tok, k)) { scores.set(e.id, (scores.get(e.id) ?? 0) + 1 / (DF.get(k) ?? 1)); break; }
      }
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

const cache = new Map<string, Reply>();

/** Detects whether the person typed Urdu script or Roman Urdu, so the answer can come back in Urdu even when the page is English. */
export function detectLoc(q: string, fallback: Loc): Loc {
  if (/[؀-ۿ]/.test(q)) return 'ur';
  const raw = normalize(q).split(' ');
  return raw.some((w) => ROMAN_URDU.has(ALIAS[w] ?? w)) && raw.length >= 2 ? 'ur' : fallback;
}

export function reply(question: string, ui: Loc): Reply {
  const loc = detectLoc(question, ui);
  const key = `${loc}|${normalize(question)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = compute(question, loc);
  if (cache.size > 300) cache.clear();
  cache.set(key, r);
  return r;
}

function compute(question: string, loc: Loc): Reply {
  const raw = normalize(question).split(' ').filter(Boolean);
  const toks = tokens(question);
  const chips = (ids: string[]) => ids;
  if (raw.length === 0) return { kind: 'fallback', text: T(loc, 'Ask me anything about the school software.', 'اسکول سافٹ ویئر کے بارے میں کچھ بھی پوچھیں۔'), chips: STARTER_CHIPS };
  const content = toks.length;
  const isTalk = raw.some((w) => [...GREET, ...THANKS, ...BYE].some((g) => near(w, g)));
  if (content === 0 || (content <= 1 && isTalk)) {
    if (raw.some((w) => THANKS.some((g) => near(w, g)))) return { kind: 'smalltalk', text: T(loc, 'You are welcome! Anything else?', 'خوش آمدید! اور کچھ پوچھنا ہے؟'), chips: chips(STARTER_CHIPS) };
    if (raw.some((w) => BYE.some((g) => near(w, g)))) return { kind: 'smalltalk', text: T(loc, 'Goodbye! Come back any time.', 'خدا حافظ! جب چاہیں واپس آئیں۔'), chips: [] };
    if (raw.some((w) => GREET.some((g) => near(w, g)))) return { kind: 'smalltalk', text: T(loc, 'Hello! I can tell you about features, pricing, the app and a free demo. What would you like to know?', 'السلام علیکم! میں خصوصیات، قیمت، ایپ اور مفت ڈیمو کے بارے میں بتا سکتا ہوں۔ آپ کیا جاننا چاہتے ہیں؟'), chips: STARTER_CHIPS };
  }
  const ranked = score(toks);
  const top = ranked[0];
  if (!top || top[1] < 0.2) {
    // maybe a one-word typo of a keyword: suggest instead of failing
    const sugg = VOCAB.filter((k) => /^[a-z]+$/.test(k) && toks.some((w) => w.length >= 4 && distance(w, k, 2) <= 2)).slice(0, 2);
    return { kind: 'fallback', text: T(loc, 'I am not sure about that one. I can help with pricing, features, the mobile app, privacy and booking a free demo — or you can talk to our team on WhatsApp.', 'اس بارے میں مجھے یقین نہیں۔ میں قیمت، خصوصیات، موبائل ایپ، پرائیویسی اور مفت ڈیمو میں مدد کر سکتا ہوں — یا واٹس ایپ پر ہماری ٹیم سے بات کریں۔'), chips: sugg.length ? chips([...STARTER_CHIPS]) : STARTER_CHIPS };
  }
  const e = KB.find((x) => x.id === top[0])!;
  return { kind: 'answer', text: T(loc, e.en, e.ur), link: e.link ? { href: e.link.href, label: T(loc, e.link.en, e.link.ur) } : undefined, chips: chips([...(e.chips ?? []), 'contact'].filter((c, i, a) => a.indexOf(c) === i && c !== e.id)) };
}
