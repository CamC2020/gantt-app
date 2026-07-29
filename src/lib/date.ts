// Date helpers that work with plain "YYYY-MM-DD" strings (as stored in Postgres
// `date` columns) without timezone surprises.

export function parseISODate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(value: string, days: number): string {
  const date = parseISODate(value);
  date.setDate(date.getDate() + days);
  return formatISODate(date);
}

export function diffInDays(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(
    (parseISODate(b).getTime() - parseISODate(a).getTime()) / msPerDay
  );
}

export function todayISO(): string {
  return formatISODate(new Date());
}

// Monday of the week containing `value`. Weeks run Mon–Sun on this project.
export function mondayOf(value: string): string {
  const d = parseISODate(value);
  const dow = d.getDay(); // 0 = Sun
  return addDays(value, dow === 0 ? -6 : 1 - dow);
}

// ISO-8601 week number. Crews and the Village both talk in week numbers
// ("what's in week 32?"), so the Lookahead bands by this rather than by date.
export function isoWeek(value: string): number {
  const d = parseISODate(value);
  // Shift to the Thursday of this week — ISO weeks are defined by which year
  // that Thursday falls in, which is what makes the year boundary behave.
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  target.setDate(target.getDate() - ((target.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-07-30" → "Jul 30". Dates are the most-scanned value on the task pages,
// and a crew reads a month name faster than an ISO string. The year is dropped
// because the lookahead only ever spans six weeks.
export function formatShortDate(value: string): string {
  const d = parseISODate(value);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function isWorkingDay(date: string, workSat: boolean, workSun: boolean, holidays: Set<string>): boolean {
  if (holidays.has(date)) return false;
  const dow = parseISODate(date).getDay();
  if (dow === 6 && !workSat) return false;
  if (dow === 0 && !workSun) return false;
  return true;
}

export function countWorkingDays(start: string, end: string, workSat: boolean, workSun: boolean, holidays: Set<string>): number {
  if (start > end) return 0;
  let count = 0, cur = start;
  while (cur <= end) {
    if (isWorkingDay(cur, workSat, workSun, holidays)) count++;
    cur = addDays(cur, 1);
  }
  return count;
}

// Adds n additional working days after start. n=0 returns start.
export function addWorkingDays(start: string, n: number, workSat: boolean, workSun: boolean, holidays: Set<string>): string {
  let cur = start, remaining = n;
  while (remaining > 0) {
    cur = addDays(cur, 1);
    if (isWorkingDay(cur, workSat, workSun, holidays)) remaining--;
  }
  return cur;
}

// Snaps forward to the nearest working day (returns `date` unchanged if it's already one).
export function nextWorkingDay(date: string, workSat: boolean, workSun: boolean, holidays: Set<string>): string {
  let d = date;
  while (!isWorkingDay(d, workSat, workSun, holidays)) d = addDays(d, 1);
  return d;
}
