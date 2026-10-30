import { useId, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { formatBRL } from "@/lib/auth";
import { PAYMENT_DATE_BASIS_LABELS, type PaymentDateBasis } from "@/lib/payment-metrics";
import type { ReportChartsData } from "@/lib/report-charts";

function ChartCard({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Card data-slot="report-chart" className="min-w-0 border-border p-4 shadow-none sm:p-5">
      <div className="mb-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="h-64 w-full" role="img" aria-label={title}>
        {empty ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 text-center text-sm text-muted-foreground">
            Sem dados para o recorte exibido.
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

export function FinancialReportChart({
  data,
  basis,
}: {
  data: ReportChartsData;
  basis: PaymentDateBasis;
}) {
  const gradientId = useId();
  return (
    <ChartCard
      title="Evolução financeira"
      description={`Recebido por ${PAYMENT_DATE_BASIS_LABELS[basis].toLowerCase()}. Atraso atual agrupado pelo ${PAYMENT_DATE_BASIS_LABELS[basis === "paid" ? "due" : basis].toLowerCase()}, não saldo histórico. ${data.caption}`}
      empty={!data.financial.some((row) => row.recebido || row.atrasado)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.financial} margin={{ left: 4, right: 12 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.18} />
              <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickFormatter={(value) =>
              value >= 1000
                ? `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
                : `R$ ${value}`
            }
          />
          <Tooltip
            formatter={(value, name) => [
              formatBRL(Number(value ?? 0)),
              name === "recebido" ? "Recebido" : "Em atraso agora",
            ]}
          />
          <Legend formatter={(value) => (value === "recebido" ? "Recebido" : "Em atraso agora")} />
          <Area
            type="monotone"
            dataKey="recebido"
            stroke="var(--foreground)"
            fill={`url(#${gradientId})`}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Area
            type="monotone"
            dataKey="atrasado"
            stroke="#e11d48"
            fill="transparent"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CommercialReportCharts({ data }: { data: ReportChartsData }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Distribuição do pipeline"
        description="Etapas atuais dos leads criados no período. Não representa o pipeline de meses passados."
        empty={!data.pipeline.some((row) => row.quantidade)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data.pipeline} margin={{ left: 0, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
            <XAxis
              type="number"
              domain={[0, "dataMax"]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              fontSize={12}
            />
            <YAxis
              type="category"
              dataKey="etapa"
              width={110}
              interval={0}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickFormatter={(value) =>
                String(value).length > 18 ? `${String(value).slice(0, 17)}…` : String(value)
              }
            />
            <Tooltip />
            <Bar dataKey="quantidade" name="Leads" fill="var(--foreground)" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard
        title="Aquisição e encerramentos"
        description={`Criações e ganhos pela data de cada evento. Um ganho pode ser de um lead criado antes do período. ${data.caption}`}
        empty={!data.acquisition.some((row) => row.criados || row.ganhos)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.acquisition} margin={{ left: -20, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
            <Tooltip
              formatter={(value, name) => [
                Number(value ?? 0),
                name === "criados" ? "Criados" : "Encerramentos ganhos",
              ]}
            />
            <Legend
              formatter={(value) => (value === "criados" ? "Criados" : "Encerramentos ganhos")}
            />
            <Line type="monotone" dataKey="criados" stroke="#737373" strokeWidth={2} />
            <Line type="monotone" dataKey="ganhos" stroke="var(--foreground)" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
