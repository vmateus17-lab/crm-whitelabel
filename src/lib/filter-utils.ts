import { formatDateBR, formatMonthBR } from "./date-format.ts";

export type DatePreset = "all" | "today" | "last7" | "last30" | "month" | "lastMonth" | "year";

export function localToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function dateKey(value?: string | null): string {
  if (!value) return "";
  if (validDate(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : localToday(parsed);
}

export function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateInRange(value: string | null | undefined, from = "", to = ""): boolean {
  if (!from && !to) return true;
  const day = dateKey(value);
  return Boolean(day && (!from || day >= from) && (!to || day <= to));
}

export function getDatePreset(
  preset: DatePreset,
  today = localToday(),
): { from: string; to: string } {
  const [year, month] = today.split("-").map(Number);
  const serialize = (value: Date) => value.toISOString().slice(0, 10);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "last7":
      return { from: shiftDate(today, -6), to: today };
    case "last30":
      return { from: shiftDate(today, -29), to: today };
    case "month":
      return {
        from: `${today.slice(0, 7)}-01`,
        to: serialize(new Date(Date.UTC(year, month, 0, 12))),
      };
    case "lastMonth":
      return {
        from: serialize(new Date(Date.UTC(year, month - 2, 1, 12))),
        to: serialize(new Date(Date.UTC(year, month - 1, 0, 12))),
      };
    case "year":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    default:
      return { from: "", to: "" };
  }
}

export function matchesDateShortcut(
  value: string | null | undefined,
  shortcut: string,
  completed = false,
  today = localToday(),
  hasTime = false,
  now = new Date(),
): boolean {
  if (shortcut === "all") return true;
  const day = dateKey(value);
  if (shortcut === "none") return !day;
  if (!day || completed) return false;
  if (shortcut === "today") return day === today;
  if (shortcut === "next7") return day >= today && day <= shiftDate(today, 6);
  if (shortcut === "overdue")
    return hasTime ? new Date(value!).getTime() < now.getTime() : day < today;
  return true;
}

export function readFilterParams<T extends Record<string, string>>(
  params: URLSearchParams,
  defaults: T,
  allowed: Partial<Record<keyof T, readonly string[]>> = {},
): T {
  const values = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const candidate = params.get(key);
    if (candidate === null || (key !== "leadIds" && candidate.length > 1000)) continue;
    if (allowed[key] && !allowed[key]!.includes(candidate)) continue;
    if ((key === "from" || key === "to") && candidate && !validDate(candidate)) continue;
    values[key] = candidate as T[typeof key];
  }
  if (values.from && values.to && values.from > values.to) {
    Object.assign(values, { from: defaults.from, to: defaults.to });
  }
  return values;
}

export function writeFilterParams<T extends Record<string, string>>(
  params: URLSearchParams,
  filters: T,
  defaults: T,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of Object.keys(defaults)) {
    if (filters[key] === defaults[key]) next.delete(key);
    else next.set(key, filters[key]);
  }
  return next;
}

export function filterChips(
  filters: Record<string, string>,
  defaults: Record<string, string>,
  names: Record<string, string>,
  onChange: (key: string, value: string) => void,
  valueNames: Record<string, Record<string, string>> = {},
) {
  return Object.entries(filters)
    .filter(([key, value]) => value !== defaults[key])
    .map(([key, value]) => ({
      key,
      label: `${names[key] ?? key}: ${valueNames[key]?.[value] ?? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDateBR(value) : /^\d{4}-\d{2}$/.test(value) ? formatMonthBR(value) : value)}`,
      onClear: () => onChange(key, defaults[key] ?? ""),
    }));
}
