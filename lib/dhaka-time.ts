const TIME_ZONE = 'Asia/Dhaka';

export function dhakaDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

export function dhakaMonthStart(date: Date = new Date()): string {
  return dhakaDateString(date).slice(0, 7) + '-01';
}

export function shiftMonthStart(monthStart: string, amount: number): string {
  const [year, month] = monthStart.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 10);
}

export function dhakaMonthBounds(monthStart: string): { start: Date; end: Date } {
  const nextMonth = shiftMonthStart(monthStart, 1);
  return {
    start: new Date(monthStart + 'T00:00:00+06:00'),
    end: new Date(nextMonth + 'T00:00:00+06:00'),
  };
}

export function dhakaDateBoundary(date: string): Date {
  return new Date(date + 'T00:00:00+06:00');
}