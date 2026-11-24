export function bookingMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function bookingEndTimes(slots, start, spaceType) {
  return slots.filter((end) => end > start && (spaceType !== "pod" || bookingMinutes(end) - bookingMinutes(start) <= 120));
}

export function campusDateTime(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function bookingStartTimes(slots, date, now = new Date()) {
  const current = campusDateTime(now);
  return slots.slice(0, -1).filter((start) => date > current.date || (date === current.date && start > current.time));
}
