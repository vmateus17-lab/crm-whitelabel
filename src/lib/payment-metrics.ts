export interface PaymentMetricInput {
  amount: number | string | null;
  status: string;
  due_date: string | null;
  paid_at?: string | null;
  reference_month?: string | null;
  payment_type?: string;
  recurring_service_id?: string | null;
  recurring_billing_cycle?: "monthly" | "annual";
}

export function getPaymentKind(
  payment: Pick<
    PaymentMetricInput,
    "payment_type" | "recurring_service_id" | "recurring_billing_cycle"
  >,
) {
  if (payment.recurring_service_id || payment.payment_type === "monthly") {
    return payment.recurring_billing_cycle === "annual" ? "annual" : "monthly";
  }
  return ["initial_sale", "one_off", "other"].includes(payment.payment_type ?? "")
    ? payment.payment_type!
    : "other";
}

export type PaymentDateBasis = "due" | "paid" | "reference";

export const PAYMENT_DATE_BASIS_LABELS: Record<PaymentDateBasis, string> = {
  due: "Vencimento",
  paid: "Recebimento",
  reference: "Competência",
};

export function getPaymentDate(
  payment: Pick<PaymentMetricInput, "due_date" | "paid_at" | "reference_month">,
  basis: PaymentDateBasis = "due",
) {
  const value =
    basis === "paid"
      ? payment.paid_at
      : basis === "reference"
        ? payment.reference_month
        : payment.due_date;
  // Competência não é inferida do vencimento: a ausência deve continuar explícita.
  return value?.slice(0, 10) || null;
}

export function isPaymentInRange(
  payment: Pick<PaymentMetricInput, "due_date" | "paid_at" | "reference_month">,
  from: string,
  to: string,
  basis: PaymentDateBasis = "due",
) {
  const date = getPaymentDate(payment, basis);
  return Boolean(date && (!from || date >= from) && (!to || date <= to));
}

export function getEffectivePaymentStatus(
  payment: Pick<PaymentMetricInput, "status" | "due_date">,
  today: string,
) {
  if (payment.status === "pago") return "pago";
  if (payment.due_date && payment.due_date.slice(0, 10) < today) return "atrasado";
  // Uma data futura editada deixa de ser atraso mesmo se o status persistido for antigo.
  return payment.status === "atrasado" ? "pendente" : payment.status;
}

export function isPaidPayment(payment: Pick<PaymentMetricInput, "status">) {
  return payment.status === "pago";
}

export function isPaymentDueInMonth(
  payment: Pick<PaymentMetricInput, "due_date">,
  monthKey: string,
) {
  return Boolean(payment.due_date?.slice(0, 7) === monthKey);
}

export function isPaymentDueInRange(
  payment: Pick<PaymentMetricInput, "due_date">,
  from: string,
  to: string,
) {
  const dueDate = payment.due_date?.slice(0, 10);
  return Boolean(dueDate && dueDate >= from && dueDate <= to);
}

export function isPendingPaymentDueToday(
  payment: Pick<PaymentMetricInput, "status" | "due_date">,
  today: string,
) {
  return payment.status === "pendente" && payment.due_date?.slice(0, 10) === today;
}

export function sumPaymentAmounts(payments: Array<Pick<PaymentMetricInput, "amount">>) {
  return payments.reduce((total, payment) => total + Number(payment.amount ?? 0), 0);
}
