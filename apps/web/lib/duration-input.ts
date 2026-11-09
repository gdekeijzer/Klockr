/** Parse `mm:ss`, `h:mm:ss` or plain minutes into milliseconds; null when invalid. */
export function parseDurationInput(text: string): number | null {
  const value = text.trim();
  if (/^\d{1,3}$/.test(value)) {
    const minutes = Number(value);
    return minutes > 0 ? minutes * 60_000 : null;
  }
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, ...nums];
  if (
    h === undefined ||
    m === undefined ||
    s === undefined ||
    s > 59 ||
    (nums.length === 3 && m > 59)
  ) {
    return null;
  }
  const ms = ((h * 60 + m) * 60 + s) * 1_000;
  return ms > 0 ? ms : null;
}
