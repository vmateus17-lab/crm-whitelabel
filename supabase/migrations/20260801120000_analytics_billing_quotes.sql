-- Analytics history, selective recurring billing, won-lead conversion and quotes.
-- This migration is additive and preserves every existing production record.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS converted_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS reference_month DATE,
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL;

ALTER TABLE public.task_cards
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_type_check CHECK (
    payment_type IN ('monthly', 'initial_sale', 'one_off', 'other')
  ) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_monthly_unique
  ON public.payments(user_id, client_id, reference_month)
  WHERE payment_type = 'monthly' AND client_id IS NOT NULL AND reference_month IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_initial_sale_unique
  ON public.payments(user_id, lead_id)
  WHERE payment_type = 'initial_sale' AND lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_reference_month
  ON public.payments(user_id, reference_month);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at
  ON public.payments(user_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_leads_closed_at
  ON public.leads(user_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_task_cards_completed_at
  ON public.task_cards(user_id, completed_at);

CREATE TABLE IF NOT EXISTS public.lead_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_stage public.lead_stage,
  to_stage public.lead_stage NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_metric_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status public.client_status NOT NULL,
  monthly_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_stage_history_user_date
  ON public.lead_stage_history(user_id, entered_at);
CREATE INDEX IF NOT EXISTS idx_lead_stage_history_lead
  ON public.lead_stage_history(lead_id, entered_at);
CREATE INDEX IF NOT EXISTS idx_client_metric_history_user_date
  ON public.client_metric_history(user_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_client_metric_history_client
  ON public.client_metric_history(client_id, recorded_at);

ALTER TABLE public.lead_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_metric_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_stage_history_owner_select ON public.lead_stage_history
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY client_metric_history_owner_select ON public.client_metric_history
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.record_lead_stage_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_stage_history(user_id, lead_id, from_stage, to_stage, entered_at)
    VALUES (
      NEW.user_id,
      NEW.id,
      NULL,
      NEW.stage,
      CASE
        WHEN NEW.stage IN ('ganho', 'perdido') THEN COALESCE(NEW.closed_at, now())
        ELSE now()
      END
    );
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.lead_stage_history(user_id, lead_id, from_stage, to_stage, entered_at)
    VALUES (
      NEW.user_id,
      NEW.id,
      OLD.stage,
      NEW.stage,
      CASE
        WHEN NEW.stage IN ('ganho', 'perdido') THEN COALESCE(NEW.closed_at, now())
        ELSE now()
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lead_stage_history
AFTER INSERT OR UPDATE OF stage ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.record_lead_stage_history();

CREATE OR REPLACE FUNCTION public.record_client_metric_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.client_metric_history(user_id, client_id, status, monthly_value, recorded_at)
    VALUES (NEW.user_id, NEW.id, NEW.status, COALESCE(NEW.monthly_value, 0), now());
  ELSIF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.monthly_value IS DISTINCT FROM OLD.monthly_value THEN
    INSERT INTO public.client_metric_history(user_id, client_id, status, monthly_value, recorded_at)
    VALUES (NEW.user_id, NEW.id, NEW.status, COALESCE(NEW.monthly_value, 0), now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_client_metric_history
AFTER INSERT OR UPDATE OF status, monthly_value ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.record_client_metric_history();

CREATE OR REPLACE FUNCTION public.set_client_status_changed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_client_status_changed_at
BEFORE UPDATE OF status ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.set_client_status_changed_at();

CREATE OR REPLACE FUNCTION public.set_task_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.completed IS TRUE AND (TG_OP = 'INSERT' OR OLD.completed IS FALSE) THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  ELSIF NEW.completed IS FALSE THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_completed_at
BEFORE INSERT OR UPDATE OF completed ON public.task_cards
FOR EACH ROW EXECUTE FUNCTION public.set_task_completed_at();

CREATE TABLE IF NOT EXISTS public.business_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL DEFAULT '',
  legal_name TEXT,
  document TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  address TEXT,
  logo_path TEXT,
  accent_color TEXT NOT NULL DEFAULT '#171717',
  footer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_profiles_size_check CHECK (
    char_length(business_name) <= 200
    AND char_length(COALESCE(legal_name, '')) <= 200
    AND char_length(COALESCE(document, '')) <= 40
    AND char_length(COALESCE(email, '')) <= 320
    AND char_length(COALESCE(phone, '')) <= 40
    AND char_length(COALESCE(website, '')) <= 2048
    AND char_length(COALESCE(address, '')) <= 1000
    AND char_length(COALESCE(logo_path, '')) <= 2048
    AND accent_color ~ '^#[0-9A-Fa-f]{6}$'
    AND char_length(COALESCE(footer_notes, '')) <= 2000
  )
);

CREATE TABLE IF NOT EXISTS public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  quote_number INTEGER NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  recipient_name TEXT NOT NULL,
  recipient_company TEXT,
  recipient_email TEXT,
  recipient_phone TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  payment_terms TEXT,
  delivery_terms TEXT,
  scope TEXT,
  notes TEXT,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  pdf_path TEXT,
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quotes_user_number_unique UNIQUE(user_id, quote_number),
  CONSTRAINT quotes_status_check CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  CONSTRAINT quotes_values_check CHECK (subtotal >= 0 AND discount >= 0 AND total >= 0),
  CONSTRAINT quotes_size_check CHECK (
    char_length(recipient_name) <= 200
    AND char_length(COALESCE(recipient_company, '')) <= 200
    AND char_length(COALESCE(recipient_email, '')) <= 320
    AND char_length(COALESCE(recipient_phone, '')) <= 40
    AND char_length(COALESCE(payment_terms, '')) <= 2000
    AND char_length(COALESCE(delivery_terms, '')) <= 2000
    AND char_length(COALESCE(scope, '')) <= 10000
    AND char_length(COALESCE(notes, '')) <= 5000
    AND char_length(COALESCE(pdf_path, '')) <= 2048
  )
);

CREATE TABLE IF NOT EXISTS public.quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quote_items_values_check CHECK (quantity > 0 AND unit_price >= 0),
  CONSTRAINT quote_items_size_check CHECK (char_length(description) BETWEEN 1 AND 500)
);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_user_created ON public.quotes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_lead ON public.quotes(lead_id);
CREATE INDEX IF NOT EXISTS idx_quotes_client ON public.quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON public.quote_items(quote_id, position);

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_profiles_owner_select ON public.business_profiles
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY business_profiles_owner_insert ON public.business_profiles
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY business_profiles_owner_update ON public.business_profiles
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY quotes_owner_select ON public.quotes
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY quotes_owner_insert ON public.quotes
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY quotes_owner_update ON public.quotes
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY quotes_owner_delete ON public.quotes
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY quote_items_owner_select ON public.quote_items
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY quote_items_owner_insert ON public.quote_items
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.quotes
      WHERE quotes.id = quote_items.quote_id
        AND quotes.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY quote_items_owner_update ON public.quote_items
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.quotes
      WHERE quotes.id = quote_items.quote_id
        AND quotes.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY quote_items_owner_delete ON public.quote_items
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.assign_quote_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.quote_number IS NULL OR NEW.quote_number <= 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text));
    SELECT COALESCE(MAX(q.quote_number), 0) + 1
      INTO NEW.quote_number
      FROM public.quotes q
      WHERE q.user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quotes_number
BEFORE INSERT ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.assign_quote_number();

CREATE TRIGGER trg_business_profiles_updated
BEFORE UPDATE ON public.business_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_quotes_updated
BEFORE UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_quote_relations()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = NEW.lead_id AND l.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Lead inválido para este usuário';
  END IF;
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id = NEW.client_id AND c.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Cliente inválido para este usuário';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_quote_relations
BEFORE INSERT OR UPDATE OF lead_id, client_id, user_id ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.validate_quote_relations();

CREATE OR REPLACE FUNCTION public.generate_monthly_payments(
  p_client_ids UUID[],
  p_reference_month DATE,
  p_due_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  inserted_count INTEGER := 0;
  normalized_month DATE := date_trunc('month', p_reference_month)::date;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória';
  END IF;
  IF p_client_ids IS NULL OR cardinality(p_client_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF p_due_date < normalized_month OR p_due_date >= (normalized_month + INTERVAL '1 month')::date THEN
    RAISE EXCEPTION 'O vencimento deve estar dentro do mês de referência';
  END IF;

  INSERT INTO public.payments(
    user_id, client_id, description, amount, due_date, status, payment_type, reference_month
  )
  SELECT
    current_user_id,
    c.id,
    'Mensalidade ' || to_char(normalized_month, 'MM/YYYY') || ' - ' || c.name,
    c.monthly_value,
    p_due_date,
    'pendente'::public.payment_status,
    'monthly',
    normalized_month
  FROM public.clients c
  WHERE c.user_id = current_user_id
    AND c.id = ANY(p_client_ids)
    AND c.status = 'ativo'::public.client_status
    AND COALESCE(c.monthly_value, 0) > 0
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_won_lead(
  p_lead_id UUID,
  p_convert_client BOOLEAN DEFAULT TRUE,
  p_create_payment BOOLEAN DEFAULT TRUE,
  p_payment_amount NUMERIC DEFAULT 0,
  p_payment_description TEXT DEFAULT NULL,
  p_paid_at DATE DEFAULT CURRENT_DATE,
  p_monthly_value NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  target_lead public.leads%ROWTYPE;
  target_client_id UUID;
  target_payment_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória';
  END IF;

  SELECT * INTO target_lead
  FROM public.leads
  WHERE id = p_lead_id AND user_id = current_user_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead não encontrado';
  END IF;

  UPDATE public.leads
  SET stage = 'ganho'::public.lead_stage,
      closed_at = COALESCE(closed_at, now())
  WHERE id = target_lead.id;

  target_client_id := target_lead.converted_client_id;

  IF p_convert_client THEN
    IF target_client_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = target_client_id AND c.user_id = current_user_id
    ) THEN
      INSERT INTO public.clients(
        user_id, name, company, contact, whatsapp, status, services,
        monthly_value, notes, source
      ) VALUES (
        current_user_id, target_lead.name, target_lead.company,
        target_lead.contact, target_lead.whatsapp, 'ativo'::public.client_status,
        target_lead.services, GREATEST(COALESCE(p_monthly_value, 0), 0),
        target_lead.notes, target_lead.source
      ) RETURNING id INTO target_client_id;

      UPDATE public.leads
      SET converted_client_id = target_client_id
      WHERE id = target_lead.id;
    END IF;
  END IF;

  IF p_create_payment THEN
    IF COALESCE(p_payment_amount, 0) <= 0 THEN
      RAISE EXCEPTION 'Informe um valor de recebimento maior que zero';
    END IF;

    SELECT id INTO target_payment_id
    FROM public.payments
    WHERE user_id = current_user_id
      AND lead_id = target_lead.id
      AND payment_type = 'initial_sale'
    LIMIT 1;

    IF target_payment_id IS NULL THEN
      INSERT INTO public.payments(
        user_id, client_id, lead_id, description, amount, due_date,
        paid_at, status, payment_type, reference_month
      ) VALUES (
        current_user_id, target_client_id, target_lead.id,
        COALESCE(NULLIF(btrim(p_payment_description), ''), 'Venda - ' || target_lead.name),
        p_payment_amount, p_paid_at, p_paid_at, 'pago'::public.payment_status,
        'initial_sale', date_trunc('month', p_paid_at)::date
      ) RETURNING id INTO target_payment_id;
    ELSIF target_client_id IS NOT NULL THEN
      UPDATE public.payments
      SET client_id = COALESCE(client_id, target_client_id)
      WHERE id = target_payment_id AND user_id = current_user_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'lead_id', target_lead.id,
    'client_id', target_client_id,
    'payment_id', target_payment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_monthly_payments(UUID[], DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_monthly_payments(UUID[], DATE, DATE) TO authenticated;
REVOKE ALL ON FUNCTION public.close_won_lead(UUID, BOOLEAN, BOOLEAN, NUMERIC, TEXT, DATE, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_won_lead(UUID, BOOLEAN, BOOLEAN, NUMERIC, TEXT, DATE, NUMERIC) TO authenticated;
REVOKE ALL ON FUNCTION public.record_lead_stage_history() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_client_metric_history() FROM PUBLIC, anon;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('quote-pdfs', 'quote-pdfs', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY quote_pdfs_owner_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'quote-pdfs'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY quote_pdfs_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'quote-pdfs'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY quote_pdfs_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'quote-pdfs'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'quote-pdfs'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY quote_pdfs_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'quote-pdfs'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
