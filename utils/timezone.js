const formatterCache = new Map();

const formatterFor = (timeZone) => {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return formatterCache.get(timeZone);
};

export const getZonedParts = (date, timeZone) => Object.fromEntries(
  formatterFor(timeZone)
    .formatToParts(date)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]),
);

const offsetAt = (date, timeZone) => {
  const part = getZonedParts(date, timeZone);
  return Date.UTC(
    part.year,
    part.month - 1,
    part.day,
    part.hour,
    part.minute,
    part.second,
  ) - Math.floor(date.getTime() / 1000) * 1000;
};

export const zonedDateTimeToUtc = (
  { year, month, day, hour = 0, minute = 0, second = 0 },
  timeZone,
) => {
  const wallTime = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = wallTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = wallTime - offsetAt(new Date(result), timeZone);
  }
  return new Date(result);
};

export const getCalendarBoundaries = (
  asOf = new Date(),
  timeZone = 'Europe/London',
) => {
  const part = getZonedParts(asOf, timeZone);
  const localDate = new Date(Date.UTC(part.year, part.month - 1, part.day));
  const mondayOffset = (localDate.getUTCDay() + 6) % 7;
  const weekDate = new Date(localDate);
  weekDate.setUTCDate(localDate.getUTCDate() - mondayOffset);

  return {
    day: zonedDateTimeToUtc({
      year: part.year,
      month: part.month,
      day: part.day,
    }, timeZone),
    week: zonedDateTimeToUtc({
      year: weekDate.getUTCFullYear(),
      month: weekDate.getUTCMonth() + 1,
      day: weekDate.getUTCDate(),
    }, timeZone),
    month: zonedDateTimeToUtc({
      year: part.year,
      month: part.month,
      day: 1,
    }, timeZone),
    year: zonedDateTimeToUtc({
      year: part.year,
      month: 1,
      day: 1,
    }, timeZone),
  };
};

export const getMonthWindow = (
  asOf = new Date(),
  months = 12,
  timeZone = 'Europe/London',
) => {
  const part = getZonedParts(asOf, timeZone);
  const labels = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(part.year, part.month - 1 - offset, 1));
    labels.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const [year, month] = labels[0].split('-').map(Number);
  return {
    labels,
    start: zonedDateTimeToUtc({ year, month, day: 1 }, timeZone),
  };
};
