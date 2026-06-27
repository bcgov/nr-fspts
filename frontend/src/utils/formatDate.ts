const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a backend date string as the design's "Mon D, YYYY" (e.g.
 * "2021-04-10" → "Apr 10, 2021"). Shared across the search/list tables so
 * every date column reads the same way.
 *
 * Only the leading YYYY-MM-DD is parsed, so timestamps ("2021-04-10T…")
 * format fine. Empty input returns ''; anything that doesn't start with a
 * valid YYYY-MM-DD is returned unchanged so we never hide unexpected data.
 */
export const formatDate = (value: string | null | undefined): string => {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return value;
  const month = MONTH_ABBR[Number(m[2]) - 1];
  if (!month) return value;
  return `${month} ${Number(m[3])}, ${m[1]}`;
};

export default formatDate;
