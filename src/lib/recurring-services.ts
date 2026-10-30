export type RecurringBillingCycle = "monthly" | "annual";

export interface ClientRecurringService {
  id?: string;
  client_id?: string;
  service_name: string;
  amount: number;
  due_day: number;
  active: boolean;
  position?: number;
  billing_cycle?: RecurringBillingCycle;
  due_month?: number | null;
}

export const RECURRING_SERVICE_OPTIONS = [
  "Tráfego Pago",
  "Sites/Landing Pages",
  "Social Media/Blogs",
  "Hospedagem",
  "Desenvolvimento",
  "Outro",
] as const;

export const RECURRING_MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export function recurringCycle(
  item: Pick<ClientRecurringService, "billing_cycle">,
): RecurringBillingCycle {
  return item.billing_cycle === "annual" ? "annual" : "monthly";
}

export function recurringTotals(items: ClientRecurringService[]) {
  const totals = items
    .filter((item) => item.active)
    .reduce(
      (total, item) => {
        const amount = Number(item.amount || 0);
        if (recurringCycle(item) === "annual") total.annual += amount;
        else total.monthly += amount;
        return total;
      },
      { monthly: 0, annual: 0 },
    );
  return { ...totals, monthlyEquivalent: totals.monthly + totals.annual / 12 };
}

/** Monthly-equivalent contract value. Dashboard MRR is monthly-only and calculated separately. */
export function recurringTotal(items: ClientRecurringService[]): number {
  return recurringTotals(items).monthlyEquivalent;
}

/** month follows the JavaScript convention: January=0. */
export function recurringIsDueInMonth(item: ClientRecurringService, month: number): boolean {
  return recurringCycle(item) === "monthly" || item.due_month === month + 1;
}

export function recurringIsBilledInPeriod(
  item: ClientRecurringService,
  paymentReferenceMonth: string | null | undefined,
  year: number,
  month: number,
  paymentBillingCycle: RecurringBillingCycle = "monthly",
): boolean {
  if (!paymentReferenceMonth) return false;
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  if (paymentReferenceMonth.startsWith(prefix)) return true;
  return (
    recurringCycle(item) === "annual" &&
    paymentBillingCycle === "annual" &&
    paymentReferenceMonth.startsWith(`${year}-`)
  );
}

export function recurringScheduleLabel(item: ClientRecurringService): string {
  if (recurringCycle(item) === "annual") {
    const month = RECURRING_MONTH_LABELS[(item.due_month ?? 1) - 1] ?? "Mês não definido";
    return `Anual · ${String(item.due_day).padStart(2, "0")} de ${month.toLowerCase()}`;
  }
  return `Mensal · dia ${item.due_day}`;
}

export function validateRecurringServices(items: ClientRecurringService[]): string | null {
  if (items.length > 50) return "Limite de 50 recorrências por cliente.";
  for (const item of items) {
    if (!item.service_name.trim() || item.service_name.trim().length > 120)
      return "Informe um serviço válido.";
    if (
      !Number.isFinite(item.amount) ||
      item.amount < 0 ||
      item.amount > 9999999999.99 ||
      Number(item.amount.toFixed(2)) !== item.amount
    )
      return "Informe um valor recorrente válido com até duas casas decimais.";
    if (!Number.isInteger(item.due_day) || item.due_day < 1 || item.due_day > 31)
      return "O dia de vencimento deve ficar entre 1 e 31.";
    if (item.billing_cycle && !["monthly", "annual"].includes(item.billing_cycle))
      return "Selecione uma periodicidade válida.";
    if (
      recurringCycle(item) === "annual" &&
      (!Number.isInteger(item.due_month) ||
        Number(item.due_month) < 1 ||
        Number(item.due_month) > 12)
    )
      return "Selecione o mês de vencimento da recorrência anual.";
  }
  return null;
}

export function buildClientRecurringItems(items: ClientRecurringService[]) {
  const error = validateRecurringServices(items);
  if (error) throw new Error(error);
  return items.map((item, position) => ({
    id: item.id,
    service_name: item.service_name.trim(),
    amount: item.amount,
    due_day: item.due_day,
    active: item.active,
    position,
    billing_cycle: recurringCycle(item),
    due_month: recurringCycle(item) === "annual" ? item.due_month! : null,
  }));
}

export function recurringDueDate(year: number, month: number, dueDay: number): string {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.min(Math.max(Math.trunc(dueDay), 1), lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}
