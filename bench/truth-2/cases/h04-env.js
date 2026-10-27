// Values that depend on the machine: local time zone and randomness.
export function localHour() {
  return { hour: new Date().getHours(), offset: new Date().getTimezoneOffset(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
export function coin() {
  return Math.random() < 0.5 ? "heads" : "tails";
}
export function uuidPrefix() {
  return crypto.randomUUID().slice(0, 8);
}
