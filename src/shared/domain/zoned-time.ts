/** Wall-clock days and times of a time zone (the organisation's), as instants. */

function offsetAt(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)!.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a wall-clock time of a day is in the time zone. */
export function zonedInstant(day: string, time: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetAt(new Date(wall), timeZone);
  const second = offsetAt(new Date(wall - first), timeZone);
  return new Date(wall - second);
}

export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** The day's first instant and the next day's, in the time zone. */
export function dayBounds(day: string, timeZone: string): [Date, Date] {
  return [zonedInstant(day, '00:00', timeZone), zonedInstant(nextDay(day), '00:00', timeZone)];
}
