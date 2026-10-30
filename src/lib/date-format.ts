const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDateBR(value?: string | Date | null): string {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return "—";
    return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "—";
}

export function formatMonthBR(value?: string | null): string {
  const match = value?.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[2]) > 12) return "—";
  return `${match[2]}/${match[1]}`;
}

export function formatDateTimeBR(value?: string | Date | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : "—";
}

export function formatTimeBR(value?: string | Date | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isFinite(date.getTime()) ? timeFormatter.format(date) : "—";
}
