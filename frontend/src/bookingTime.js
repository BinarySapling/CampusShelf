export function bookingMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function bookingEndTimes(slots, start, spaceType) {
  return slots.filter((end) => end > start && (spaceType !== "pod" || bookingMinutes(end) - bookingMinutes(start) <= 120));
}
