import { formatDay, formatTime } from "./format";

// Wall-clock times beside UTC: the business's own zone (Nigeria), and the viewer's when they're somewhere else.
// Unlike format.ts, these read time zones through Intl, so call them in the browser only (after mount): a server
// render would format in the server's zone.

export interface TimeZoneSpec {
  /** IANA zone. */
  id: string;
  /** Locale whose short name for the zone reads naturally: en-NG says "WAT" where en-US says "GMT+1". */
  locale: string;
  /** Where it is, for tooltips. */
  place: string;
}

/** The business's time zone: Lagos, West Africa Time (UTC+1, no daylight saving). */
export const BUSINESS_TIME_ZONE: TimeZoneSpec = { id: "Africa/Lagos", locale: "en-NG", place: "Lagos, Nigeria" };

export interface ZonedTime {
  /** "Sep 25" */
  day: string;
  /** "14:02" */
  time: string;
  /** "WAT", "EDT", "GMT+5:30" */
  zone: string;
  /** "West Africa Standard Time" */
  zoneName: string;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** `ms` on the wall clock of `zone`, 24-hour. */
export function zonedTime(ms: number, zone: Pick<TimeZoneSpec, "id" | "locale">): ZonedTime {
  const date = new Date(ms);
  const parts = new Intl.DateTimeFormat(zone.locale, {
    timeZone: zone.id,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(date);
  const zoneName = part(new Intl.DateTimeFormat(zone.locale, { timeZone: zone.id, timeZoneName: "long" }).formatToParts(date), "timeZoneName");
  // The date as numbers, named by formatDay: locales spell months their own way (en-NG writes "Sept"), and the
  // zone's day is compared with the UTC one.
  const localDay = Date.UTC(Number(part(parts, "year")), Number(part(parts, "month")) - 1, Number(part(parts, "day")));
  return {
    day: formatDay(localDay),
    time: `${part(parts, "hour")}:${part(parts, "minute")}`,
    zone: part(parts, "timeZoneName"),
    zoneName,
  };
}

/**
 * The viewer's own time zone, from their device, when it's a real place other than the business's zone and UTC.
 * Null otherwise: generic offsets (Etc/GMT+8, which Windows reports when daylight saving is switched off) say
 * nothing about where someone is.
 */
export function viewerTimeZone(): TimeZoneSpec | null {
  let id: string | undefined;
  try {
    id = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (!id || id === BUSINESS_TIME_ZONE.id || id === "UTC" || id.startsWith("Etc/")) return null;
  return { id, locale: "en-US", place: id.split("/").pop()?.replace(/_/g, " ") ?? id };
}

/** "14:02 WAT", with the day in front when it isn't the same day as in UTC: "Sep 26, 00:30 WAT". */
export function formatZoned(ms: number, zone: TimeZoneSpec): string {
  const local = zonedTime(ms, zone);
  return `${local.day === formatDay(ms) ? "" : `${local.day}, `}${local.time} ${local.zone}`;
}

/** "Sep 25, 13:02 UTC", the reference every zoned time is shown beside. */
export function formatUtc(ms: number, withDay = true): string {
  return `${withDay ? `${formatDay(ms)}, ` : ""}${formatTime(ms)} UTC`;
}
