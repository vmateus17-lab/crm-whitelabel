import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatBRL, handleBRLInputChange, numberToBRLInput } from "@/lib/auth";
import {
  type ClientRecurringService,
  RECURRING_SERVICE_OPTIONS,
  recurringTotals,
  recurringCycle,
  RECURRING_MONTH_LABELS,
} from "@/lib/recurring-services";

interface RecurringServicesEditorProps {
  items: ClientRecurringService[];
  onChange: (items: ClientRecurringService[]) => void;
}

export function RecurringServicesEditor({ items, onChange }: RecurringServicesEditorProps) {
  const updateItem = (index: number, patch: Partial<ClientRecurringService>) => {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    onChange([
      ...items,
      {
        service_name: "Outro",
        amount: 0,
        due_day: 10,
        active: true,
        position: items.length,
        billing_cycle: "monthly",
        due_month: null,
      },
    ]);
  };

  const totals = recurringTotals(items);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>Valores recorrentes</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Defina cobranças mensais ou anuais, cada uma com seu próprio vencimento.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          <Plus className="mr-1.5 h-4 w-4" /> Adicionar
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
          Nenhum valor recorrente cadastrado.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={item.id ?? `new-${index}`} className="rounded-xl border bg-muted/15 p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:items-end">
                <div className="col-span-2 sm:col-span-3">
                  <Label>Serviço</Label>
                  <Select
                    value={item.service_name}
                    onValueChange={(service_name) => updateItem(index, { service_name })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECURRING_SERVICE_OPTIONS.map((service) => (
                        <SelectItem key={service} value={service}>
                          {service}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Periodicidade</Label>
                  <Select
                    value={recurringCycle(item)}
                    onValueChange={(value) =>
                      updateItem(index, {
                        billing_cycle: value as "monthly" | "annual",
                        due_month:
                          value === "annual" ? (item.due_month ?? new Date().getMonth() + 1) : null,
                      })
                    }
                  >
                    <SelectTrigger aria-label={`Periodicidade de ${item.service_name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Mensal</SelectItem>
                      <SelectItem value="annual">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Valor {recurringCycle(item) === "annual" ? "anual" : "mensal"} (R$)</Label>
                  <Input
                    inputMode="numeric"
                    value={numberToBRLInput(item.amount)}
                    onChange={(event) => {
                      const { numeric } = handleBRLInputChange(event.target.value);
                      updateItem(index, { amount: numeric });
                    }}
                  />
                </div>
                <div>
                  <Label>Vencimento</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    value={item.due_day}
                    onChange={(event) =>
                      updateItem(index, {
                        due_day: Math.min(
                          31,
                          Math.max(1, Math.trunc(Number(event.target.value)) || 1),
                        ),
                      })
                    }
                    aria-label="Dia do vencimento"
                  />
                </div>
                {recurringCycle(item) === "annual" && (
                  <div className="col-span-2 sm:col-span-3">
                    <Label>Mês do vencimento anual</Label>
                    <Select
                      value={item.due_month ? String(item.due_month) : ""}
                      onValueChange={(value) => updateItem(index, { due_month: Number(value) })}
                    >
                      <SelectTrigger aria-label={`Mês anual de ${item.service_name}`}>
                        <SelectValue placeholder="Selecione o mês" />
                      </SelectTrigger>
                      <SelectContent>
                        {RECURRING_MONTH_LABELS.map((month, monthIndex) => (
                          <SelectItem key={month} value={String(monthIndex + 1)}>
                            {month}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      O valor é cobrado uma vez por ano. Dias 29–31 usam o último dia válido de
                      meses curtos.
                    </p>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between border-t pt-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={item.active}
                    onCheckedChange={(active) => updateItem(index, { active })}
                    aria-label={`Recorrência ${item.active ? "ativa" : "inativa"}`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {item.active ? "Ativo para próximas faturas" : "Inativo"}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label={`Remover recorrência de ${item.service_name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-lg bg-muted/50 px-3 py-3 text-sm">
        <div className="flex justify-between gap-3">
          <span>Cobranças mensais ativas</span>
          <strong className="tabular-nums">{formatBRL(totals.monthly)}/mês</strong>
        </div>
        <div className="flex justify-between gap-3">
          <span>Cobranças anuais ativas</span>
          <strong className="tabular-nums">{formatBRL(totals.annual)}/ano</strong>
        </div>
        <div className="flex justify-between gap-3 border-t pt-2">
          <span>Equivalente mensal</span>
          <strong className="tabular-nums">{formatBRL(totals.monthlyEquivalent)}</strong>
        </div>
      </div>
    </div>
  );
}
