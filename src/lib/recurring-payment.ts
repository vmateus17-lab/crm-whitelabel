import type { ClientRecurringService, RecurringBillingCycle } from "./recurring-services";
import { RECURRING_SERVICE_OPTIONS } from "./recurring-services.ts";

export interface PaymentDraft {
  client_id?: string | null;
  description?: string;
  amount?: number;
  due_date?: string;
  status?: "pendente" | "pago" | "atrasado";
  paid_at?: string | null;
  contract_url?: string | null;
}

export interface RecurringPaymentSelection {
  enabled: boolean;
  service_name: string;
  recurring_service_id: string | null;
  due_day?: number;
  billing_cycle?: RecurringBillingCycle;
  due_month?: number;
}

export interface RecurringPaymentServiceOption {
  key: string;
  service_name: string;
  recurring_service_id: string | null;
  recurring?: ClientRecurringService;
}

export function recurringPaymentServiceOptions(
  items: ClientRecurringService[],
): RecurringPaymentServiceOption[] {
  const existing = items.filter((item) => item.id);
  const names = new Set(existing.map((item) => item.service_name.trim().toLowerCase()));
  return [
    ...existing.map((item) => ({
      key: `existing:${item.id}`,
      service_name: item.service_name,
      recurring_service_id: item.id!,
      recurring: item,
    })),
    ...RECURRING_SERVICE_OPTIONS.filter((name) => !names.has(name.toLowerCase())).map((name) => ({
      key: `new:${name}`,
      service_name: name,
      recurring_service_id: null,
    })),
  ];
}

export function isValidPaymentDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value.startsWith("0000-")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validatePaymentDraft(
  form: PaymentDraft,
  recurring: RecurringPaymentSelection,
): string | null {
  const description = form.description?.trim() ?? "";
  if (!description || description.length > 500)
    return "Informe uma descrição de até 500 caracteres.";
  if (!isValidPaymentDate(form.due_date)) return "Selecione uma data de vencimento válida.";
  if (
    !Number.isFinite(form.amount) ||
    Number(form.amount) < 0 ||
    Number(form.amount) > 9999999999.99
  ) {
    return "Informe um valor válido para o lançamento.";
  }
  if (form.status && !["pendente", "pago", "atrasado"].includes(form.status)) {
    return "Selecione um status válido.";
  }
  if (form.status === "pago" && form.paid_at && !isValidPaymentDate(form.paid_at)) {
    return "Informe uma data de pagamento válida.";
  }
  if (!recurring.enabled) return null;
  if (!form.client_id) return "Selecione um cliente para o valor recorrente.";
  if (!recurring.service_name.trim() || recurring.service_name.trim().length > 120) {
    return "Selecione um serviço para o valor recorrente.";
  }
  if (Number(form.amount) <= 0) return "O valor recorrente deve ser maior que zero.";
  if (Number(Number(form.amount).toFixed(2)) !== form.amount) {
    return "O valor recorrente deve ter até duas casas decimais.";
  }
  if (
    recurring.due_day !== undefined &&
    (!Number.isInteger(recurring.due_day) || recurring.due_day < 1 || recurring.due_day > 31)
  ) {
    return "O dia de vencimento deve ficar entre 1 e 31.";
  }
  if (recurring.billing_cycle && !["monthly", "annual"].includes(recurring.billing_cycle))
    return "Selecione uma periodicidade válida.";
  if (
    recurring.billing_cycle === "annual" &&
    (!Number.isInteger(recurring.due_month) ||
      Number(recurring.due_month) < 1 ||
      Number(recurring.due_month) > 12)
  )
    return "Selecione o mês de vencimento da recorrência anual.";
  return null;
}

export function buildRecurringPaymentArgs(
  form: PaymentDraft,
  recurring: RecurringPaymentSelection,
) {
  const error = validatePaymentDraft(form, recurring);
  if (error) throw new Error(error);
  if (!recurring.enabled) throw new Error("Selecione a opção valor recorrente.");
  return {
    p_payment: {
      client_id: form.client_id!,
      description: form.description!.trim(),
      amount: form.amount!,
      due_date: form.due_date!,
      status: form.status ?? "pendente",
      paid_at: form.status === "pago" ? (form.paid_at ?? null) : null,
      contract_url: form.contract_url?.trim() || null,
      ...(recurring.due_day === undefined ? {} : { recurring_due_day: recurring.due_day }),
      recurring_cycle: recurring.billing_cycle ?? "monthly",
      recurring_due_month: recurring.billing_cycle === "annual" ? recurring.due_month! : null,
    },
    p_service_name: recurring.service_name.trim(),
    p_recurring_service_id: recurring.recurring_service_id,
  };
}
