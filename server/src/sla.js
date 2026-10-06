import { DateTime } from "luxon";
export function businessMinutes(from, to, calendar) {
  let a = DateTime.fromJSDate(new Date(from), { zone: calendar.timezone });
  const end = DateTime.fromJSDate(new Date(to), { zone: calendar.timezone });
  if (!a.isValid || !end.isValid || end <= a) return 0;
  let total = 0;
  while (a < end) {
    const day = a.startOf("day");
    if (
      calendar.days.includes(day.weekday) &&
      !calendar.holidays.includes(day.toISODate())
    ) {
      const [sh, sm] = calendar.start.split(":").map(Number),
        [eh, em] = calendar.end.split(":").map(Number);
      const start = day.set({ hour: sh, minute: sm }),
        stop = day.set({ hour: eh, minute: em });
      const lo = Math.max(a.toMillis(), start.toMillis()),
        hi = Math.min(end.toMillis(), stop.toMillis());
      if (hi > lo) total += (hi - lo) / 60000;
    }
    a = day.plus({ days: 1 });
  }
  return total;
}
export function effectiveElapsed(t, now = new Date()) {
  return (
    Number(t.elapsed_minutes) +
    (["Waiting on Client", "Resolved", "Closed"].includes(t.status)
      ? 0
      : businessMinutes(t.last_tick, now, t.calendar))
  );
}
export function slaState(t, now = new Date()) {
  const elapsed = effectiveElapsed(t, now);
  const targets = [
    !t.responded_at ? t.response_minutes : null,
    !t.resolved_at ? t.resolution_minutes : null,
  ].filter((x) => x !== null);
  const remaining = targets.length ? Math.min(...targets) - elapsed : null;
  return {
    elapsed,
    remaining,
    state:
      remaining === null
        ? "complete"
        : remaining <= 0
          ? "breached"
          : elapsed / Math.min(...targets) >= 0.75
            ? "at-risk"
            : "on-track",
  };
}
