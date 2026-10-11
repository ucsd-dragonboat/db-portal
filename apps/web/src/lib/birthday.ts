/** A birthday from a date input: YYYY-MM-DD, a real date, not in the future, after 1900. */
export function parseBirthday(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s >= "1900-01-01" && d <= new Date() ? s : null;
}

/** Month-day ("MM-DD") a birthday falls on in `year` — Feb 29 birthdays land on Feb 28 in other years. */
export function birthdayInYear(md: string, year: number): string {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return md === "02-29" && !leap ? "02-28" : md;
}
