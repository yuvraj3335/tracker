/**
 * Reading job text: when it was posted, how much experience it wants, what it
 * pays, what level it is, and where it is. Pure; shared by the board readers
 * and the company career-site search.
 */
import { shiftKey, todayKey, type DayKey } from '../date';
import type { JobSource } from '../schema';

// ---------------------------------------------------------------------------
// Reading text
// ---------------------------------------------------------------------------

export type Seniority = 'intern' | 'entry' | 'mid' | 'senior' | 'unknown';
export type LevelWanted = 'entry' | 'mid' | 'senior' | 'any';

export type Listing = {
  role: string;
  company: string;
  location: string;
  source: JobSource;
  url: string;
  /** A little of what the page said about the posting, for the model to read. */
  snippet: string;
  experience: string;
  salary: string;
  /** Estimated from "3 days ago" style text; null when not stated. */
  postedOn: DayKey | null;
  seniority: Seniority;
  alreadyTracked: boolean;
  existingId: string | null;
};

export const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/** A company name from a URL slug: `progress-software` → "Progress Software". */
export function companyFromSlug(slug: string): string {
  const s = slug.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? titleCase(s.toLowerCase()) : '';
}

/**
 * Posting age written as text — "3 days ago", "18 hours ago", "Posted 11 Days
 * Ago", "yesterday", "Just now" — turned into a day. Hours count as today.
 */
export function postedFromText(text: string, today: DayKey = todayKey()): DayKey | null {
  const s = text.toLowerCase();
  if (/\b(just now|today|few (minutes|hours) ago|just posted)\b/.test(s)) return today;
  if (/\byesterday\b/.test(s)) return shiftKey(today, -1);
  // Glassdoor's short form: "24h", "5d", "30d+".
  const short = /^\s*(\d{1,3})\s*([hdwm])\+?\s*$/.exec(s);
  if (short) {
    const n = Number(short[1]);
    const d = short[2] === 'h' ? 0 : short[2] === 'd' ? n : short[2] === 'w' ? n * 7 : n * 30;
    return d > 365 ? null : shiftKey(today, -d);
  }
  const m = /\b(\d{1,3})\+?\s*(minute|min|hour|hr|day|week|month)s?\s+ago\b/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const days = unit.startsWith('min') || unit.startsWith('h') ? 0 : unit === 'day' ? n : unit === 'week' ? n * 7 : n * 30;
  return days > 365 ? null : shiftKey(today, -days);
}

/** "2 to 7 years", "0 - 2 Yrs", "4+ years", "Fresher" → a short range, or ''. */
export function experienceFromText(text: string): string {
  const range = /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b/i.exec(text);
  if (range) return `${range[1]}–${range[2]} yrs`;
  const plus = /\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i.exec(text);
  if (plus) return `${plus[1]}+ yrs`;
  // Wellfound: "2 years of exp".
  const of = /\b(\d{1,2})\s*(?:years?|yrs?)\s+(?:of\s+)?(?:exp|experience)\b/i.exec(text);
  if (of) return `${of[1]}+ yrs`;
  if (/\bfreshers?\b/i.test(text)) return '0 yrs';
  return '';
}

/** Rupee ranges ("₹7L - ₹9L", "₹19L - ₹23L / yr"), LPA figures, and "12-18 Lacs PA", as written. */
export function salaryFromText(text: string): string {
  const inr = /₹\s?[\d.,]+\s?(?:L|Lakh|Cr|K)?\s*[-–]\s*₹?\s?[\d.,]+\s?(?:L|Lakh|Cr|K)?(?:\s*\/\s*yr)?/i.exec(text);
  if (inr) return inr[0].replace(/\s+/g, ' ').trim();
  const lpa = /\b\d{1,2}(?:\.\d{1,2})?\s*[-–]\s*\d{1,2}(?:\.\d{1,2})?\s*(?:LPA|lacs?(?:\s*P\.?A\.?)?|lakhs?(?:\s*P\.?A\.?)?)/i.exec(text);
  return lpa ? lpa[0].replace(/\s+/g, ' ').trim() : '';
}

/**
 * A rough level from the title and the stated experience, so a search for
 * entry-level roles can drop the Staff and Principal postings a keyword search
 * always drags in. Unknown is kept, never guessed into a bucket.
 */
export function seniorityOf(role: string, experience: string): Seniority {
  const r = role.toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(r)) return 'intern';
  if (/\b(senior|sr\.?|staff|principal|lead|manager|architect|director|dir|head|vp|avp|svp|evp|vice president|distinguished|fellow)\b/.test(r)) return 'senior';
  if (/\b(junior|jr\.?|graduate|entry|fresher|associate|new grad)\b/.test(r) || /\b(sde|swe|engineer|developer)\s*(-|\s)?\s*(i|1)\b/.test(r)) return 'entry';
  // Years written into the title ("Software Engineer (0-4 Years)") say more
  // than any digit in it.
  if (!experience) experience = experienceFromText(role);
  const min = /^(\d{1,2})/.exec(experience)?.[1];
  if (min !== undefined) {
    const n = Number(min);
    if (n <= 1) return 'entry';
    if (n <= 4) return 'mid';
    return 'senior';
  }
  // III and IV sit above the SDE-1 band (JPMorgan's "Software Engineer III"
  // asks for 3+ years); II is the reachable stretch. A digit counts only as a
  // level, right after the role word — "Grade 3", "3 months" and "0-4" are not.
  if (/\b(iii|iv)\b/.test(r) || /\b(sde|swe|engineer|developer)\s*[-–]?\s*[34]\b/.test(r)) return 'senior';
  if (/\bii\b/.test(r) || /\b(sde|swe|engineer|developer)\s*[-–]?\s*2\b/.test(r)) return 'mid';
  return 'unknown';
}

const LEVEL: Record<Seniority, number> = { intern: 0, entry: 1, mid: 2, senior: 3, unknown: -1 };

export function keepForLevel(l: Pick<Listing, 'seniority' | 'experience'>, wanted: LevelWanted): boolean {
  if (wanted === 'any' || l.seniority === 'unknown') return true;
  if (wanted === 'entry') {
    if (l.seniority === 'entry' || l.seniority === 'intern') return true;
    // "Software Engineer 2" with 0–2 or 2–4 years is still reachable from SDE-1.
    return l.seniority === 'mid' && !/^([3-9]|\d\d)/.test(l.experience);
  }
  if (wanted === 'mid') return LEVEL[l.seniority] >= 1 && LEVEL[l.seniority] <= 2;
  return LEVEL[l.seniority] >= 2;
}

/**
 * Indian cities, old names and states a posting might name. Test it on
 * `foldPlace(text)`: boards write "Hyderābād" as often as "Hyderabad", and an
 * unfolded accent silently failed the match — measured on Glassdoor.
 */
export const INDIAN_PLACES =
  /\b(bengaluru|bangalore|pune|hyderabad|secunderabad|chennai|madras|mumbai|bombay|navi mumbai|thane|delhi|new delhi|ncr|gurgaon|gurugram|noida|greater noida|faridabad|ghaziabad|kolkata|calcutta|ahmedabad|gandhinagar|kochi|cochin|jaipur|coimbatore|chandigarh|mohali|indore|trivandrum|thiruvananthapuram|mysore|mysuru|vadodara|surat|nagpur|nashik|bhubaneswar|visakhapatnam|vizag|lucknow|bhopal|karnataka|maharashtra|telangana|tamil nadu|kerala|gujarat|haryana|uttar pradesh|west bengal|rajasthan|andhra pradesh|madhya pradesh|punjab|odisha|goa|india)\b/i;

/** Lowercase, accents off: "Hyderābād" → "hyderabad". */
export const foldPlace = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Any place a title fragment might name, remote included. */
export const PLACES = new RegExp(INDIAN_PLACES.source.replace(/\|india\)/, '|india|remote|anywhere)'), 'i');

/** True for a fragment that names a place rather than a role or a company. */
export function looksLikePlace(s: string): boolean {
  return PLACES.test(foldPlace(s)) && s.split(/\s+/).length <= 8 && !/\b(engineer|developer|sde|analyst|lead|manager)\b/i.test(s);
}

/** A URL slug: "Software Engineer" → "software-engineer". */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The first real place in the query — "Bengaluru" out of "Bengaluru or Remote". */
export function primaryPlace(location: string): { city: string | null; remote: boolean; india: boolean } {
  const l = location.toLowerCase();
  const remote = /\bremote\b|\bwfh\b|work from home/.test(l);
  const m = INDIAN_PLACES.exec(l);
  const hit = m?.[1] ?? null;
  const city = hit && hit !== 'india' ? (hit === 'bangalore' ? 'bengaluru' : hit === 'gurgaon' ? 'gurugram' : hit) : null;
  return { city, remote, india: /\bindia\b/.test(l) || Boolean(city) || !l.trim() };
}
