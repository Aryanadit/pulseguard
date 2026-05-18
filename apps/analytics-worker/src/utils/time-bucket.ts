export function getMinuteBucket(timestampMs: number): Date {
  const date = new Date(timestampMs);

  date.setSeconds(0);
  date.setMilliseconds(0);

  return date;
}
