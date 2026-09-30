// Job timestamps are epoch seconds. Today's jobs show the clock time only; older ones add
// the date (and the year once it is not this one) so a scan down the queue stays short.
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatJobTime(epochSeconds: number, now: Date = new Date()): string {
  const d = new Date(epochSeconds * 1000);
  if (d.toDateString() === now.toDateString()) return clock(d);
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${date}${year}, ${clock(d)}`;
}

export function formatJobTimeFull(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(d)}:${pad(d.getSeconds())}`;
}
