function parseLocalDate(value) {
  if (!value) return new Date();
  const parts = String(value).split('-').map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, 12, 0, 0, 0);
}

export function todayLocalDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

export function toISODate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function displayDate(value, includeYear = true) {
  return parseLocalDate(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

export function getPeriodRange(type, anchorDate) {
  const anchor = parseLocalDate(anchorDate);
  let start = new Date(anchor);
  let endExclusive = new Date(anchor);

  if (type === 'month') {
    start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
    endExclusive = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1, 12);
  } else if (type === 'week') {
    const weekday = (anchor.getDay() + 6) % 7;
    start.setDate(anchor.getDate() - weekday);
    endExclusive = new Date(start);
    endExclusive.setDate(start.getDate() + 7);
  } else {
    start = new Date(anchor);
    endExclusive = new Date(anchor);
    endExclusive.setDate(anchor.getDate() + 1);
  }

  const end = new Date(endExclusive);
  end.setDate(end.getDate() - 1);
  const startISO = toISODate(start);
  const endISO = toISODate(end);
  let label = '';
  if (type === 'month') {
    label = start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  } else if (type === 'week') {
    label = displayDate(startISO, false) + ' – ' + displayDate(endISO, true);
  } else {
    label = displayDate(startISO, true);
  }

  return { start: startISO, end: endISO, endExclusive: toISODate(endExclusive), label };
}

export function shiftPeriod(anchorDate, type, amount) {
  const anchor = parseLocalDate(anchorDate);
  if (type === 'month') {
    return toISODate(new Date(anchor.getFullYear(), anchor.getMonth() + amount, 1, 12));
  }
  const shifted = new Date(anchor);
  shifted.setDate(anchor.getDate() + (type === 'week' ? 7 : 1) * amount);
  return toISODate(shifted);
}
