
-- Enums
CREATE TYPE public.lead_stage AS ENUM ('novo', 'contatado', 'proposta', 'negociacao', 'ganho', 'perdido');
CREATE TYPE public.client_status AS ENUM ('ativo', 'pausado', 'ex_cliente');
CREATE TYPE public.payment_status AS ENUM ('pendente', 'pago', 'atrasado');

-- Leads
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  company TEXT,
  contact TEXT,
  whatsapp TEXT,
  stage public.lead_stage NOT NULL DEFAULT 'novo',
  estimated_value NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  last_contact_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clients
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  company TEXT,
  contact TEXT,
  whatsapp TEXT,
  status public.client_status NOT NULL DEFAULT 'ativo',
  services TEXT[] NOT NULL DEFAULT '{}',
  whatsapp_log TEXT,
  folder_links TEXT[] NOT NULL DEFAULT '{}',
  monthly_value NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payments
CREATE TABLE public.payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  paid_at DATE,
  status public.payment_status NOT NULL DEFAULT 'pendente',
  contract_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notes
CREATE TABLE public.notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Todos
CREATE TABLE public.todos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

-- Policies: owner-only access
CREATE POLICY "owner_select" ON public.leads FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_insert" ON public.leads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update" ON public.leads FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_delete" ON public.leads FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "owner_select" ON public.clients FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_insert" ON public.clients FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update" ON public.clients FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_delete" ON public.clients FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "owner_select" ON public.payments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_insert" ON public.payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update" ON public.payments FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_delete" ON public.payments FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "owner_select" ON public.notes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_insert" ON public.notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update" ON public.notes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_delete" ON public.notes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "owner_select" ON public.todos FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_insert" ON public.todos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update" ON public.todos FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_delete" ON public.todos FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_notes_updated BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes
CREATE INDEX idx_leads_user ON public.leads(user_id);
CREATE INDEX idx_clients_user ON public.clients(user_id);
CREATE INDEX idx_payments_user ON public.payments(user_id);
CREATE INDEX idx_payments_client ON public.payments(client_id);
CREATE INDEX idx_notes_user ON public.notes(user_id);
CREATE INDEX idx_todos_user ON public.todos(user_id);
