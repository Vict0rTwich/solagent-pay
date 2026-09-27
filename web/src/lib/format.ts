// Formatting is done by hand in UTC so server and client render identical strings.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const twoDecimals = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 771150 -> "7,711.50" */
export function formatUsdc(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return sign + twoDecimals.format(Math.abs(cents) / 100);
}

/** 771150 -> "$7,711.50" */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${twoDecimals.format(Math.abs(cents) / 100)}`;
}

/** Axis ticks: 0 -> "$0", 2500 -> "$2.5K". Input is whole dollars. */
export function formatUsdAxis(dollars: number): string {
  if (dollars >= 1000) {
    const k = dollars / 1000;
    return `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return `$${wholeNumber.format(dollars)}`;
}

export function formatCount(n: number): string {
  return wholeNumber.format(n);
}

/** "1 transaction", "755 transactions". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/** 0.1243 -> "12.4%" (unsigned; direction is shown with an icon). */
export function formatPercent(ratio: number): string {
  return `${(Math.abs(ratio) * 100).toFixed(1)}%`;
}

export function truncateAddress(address: string, chars = 4): string {
  return address.length <= chars * 2 + 1 ? address : `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/** 45 min -> "45m", 3.2 h -> "3h 12m", 50 h -> "2d 2h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

/** A countdown: 872 s -> "14:32", 3725 s -> "1:02:05", past -> "0:00". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** "Sep 23, 15:08" */
export function formatDateTime(ms: number): string {
  return `${formatDay(ms)}, ${formatTime(ms)}`;
}

/** "Sep 23" */
export function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Tue, Sep 22" */
export function formatWeekdayDay(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getUTCDay()]}, ${formatDay(ms)}`;
}

/** "15:08" */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "September" */
export function formatMonth(ms: number): string {
  return MONTHS_LONG[new Date(ms).getUTCMonth()] ?? "";
}

/** "Aug 1–23" */
export function formatDayRange(startMs: number, endMs: number): string {
  const start = new Date(startMs);
  const end = new Date(endMs);
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}–${end.getUTCDate()}`;
  }
  return `${formatDay(startMs)} – ${formatDay(endMs)}`;
}
