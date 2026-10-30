-- Multiple recurring services per client and invoice snapshots per recurrence.

CREATE TABLE IF NOT EXISTS public.client_recurring_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  due_day SMALLINT NOT NULL DEFAULT 10,
  active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_recurring_services_name_check
    CHECK (char_length(btrim(service_name)) BETWEEN 1 AND 120),
  CONSTRAINT client_recurring_services_amount_check CHECK (amount >= 0),
  CONSTRAINT client_recurring_services_due_day_check CHECK (due_day BETWEEN 1 AND 31)
);

CREATE INDEX IF NOT EXISTS idx_client_recurring_services_client
  ON public.client_recurring_services(user_id, client_id, position, created_at);

CREATE INDEX IF NOT EXISTS idx_client_recurring_services_active
  ON public.client_recurring_services(user_id, active)
  WHERE active = true;

ALTER TABLE public.client_recurring_services ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.client_recurring_services FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_recurring_services TO authenticated;

DROP POLICY IF EXISTS client_recurring_services_owner_select ON public.client_recurring_services;
DROP POLICY IF EXISTS client_recurring_services_owner_insert ON public.client_recurring_services;
DROP POLICY IF EXISTS client_recurring_services_owner_update ON public.client_recurring_services;
DROP POLICY IF EXISTS client_recurring_services_owner_delete ON public.client_recurring_services;

CREATE POLICY client_recurring_services_owner_select
  ON public.client_recurring_services FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY client_recurring_services_owner_insert
  ON public.client_recurring_services FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = client_recurring_services.client_id
        AND clients.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY client_recurring_services_owner_update
  ON public.client_recurring_services FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = client_recurring_services.client_id
        AND clients.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY client_recurring_services_owner_delete
  ON public.client_recurring_services FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP TRIGGER IF EXISTS set_client_recurring_services_updated_at
  ON public.client_recurring_services;
CREATE TRIGGER set_client_recurring_services_updated_at
BEFORE UPDATE ON public.client_recurring_services
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Preserve every existing recurring value as an editable "Outro" item.
INSERT INTO public.client_recurring_services(
  user_id, client_id, service_name, amount, due_day, active, position
)
SELECT c.user_id, c.id, 'Outro', c.monthly_value, 10, true, 0
FROM public.clients c
WHERE COALESCE(c.monthly_value, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.client_recurring_services recurring
    WHERE recurring.client_id = c.id
  );

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS recurring_service_id UUID
  REFERENCES public.client_recurring_services(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_recurring_service
  ON public.payments(recurring_service_id, reference_month);

-- Associate historical monthly invoices with the safely migrated legacy item.
UPDATE public.payments payment
SET recurring_service_id = recurring.id
FROM public.client_recurring_services recurring
WHERE payment.recurring_service_id IS NULL
  AND payment.payment_type = 'monthly'
  AND payment.client_id = recurring.client_id
  AND payment.user_id = recurring.user_id
  AND recurring.service_name = 'Outro'
  AND recurring.position = 0;

DROP INDEX IF EXISTS public.idx_payments_monthly_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_recurring_month_unique
  ON public.payments(user_id, recurring_service_id, reference_month)
  WHERE payment_type = 'monthly'
    AND recurring_service_id IS NOT NULL
    AND reference_month IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_client_monthly_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_client_id UUID;
BEGIN
  target_client_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.client_id ELSE NEW.client_id END;

  UPDATE public.clients client
  SET monthly_value = COALESCE((
    SELECT SUM(recurring.amount)
    FROM public.client_recurring_services recurring
    WHERE recurring.client_id = target_client_id
      AND recurring.active = true
  ), 0)
  WHERE client.id = target_client_id;

  IF TG_OP = 'UPDATE' AND OLD.client_id IS DISTINCT FROM NEW.client_id THEN
    UPDATE public.clients client
    SET monthly_value = COALESCE((
      SELECT SUM(recurring.amount)
      FROM public.client_recurring_services recurring
      WHERE recurring.client_id = OLD.client_id
        AND recurring.active = true
    ), 0)
    WHERE client.id = OLD.client_id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_client_monthly_value
  ON public.client_recurring_services;
CREATE TRIGGER trg_sync_client_monthly_value
AFTER INSERT OR UPDATE OF amount, active, client_id OR DELETE
ON public.client_recurring_services
FOR EACH ROW EXECUTE FUNCTION public.sync_client_monthly_value();

-- Keep lead conversion compatible: a positive legacy value becomes "Outro".
CREATE OR REPLACE FUNCTION public.create_default_recurring_service_for_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(NEW.monthly_value, 0) > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.client_recurring_services recurring
       WHERE recurring.client_id = NEW.id
     ) THEN
    INSERT INTO public.client_recurring_services(
      user_id, client_id, service_name, amount, due_day, active, position
    ) VALUES (
      NEW.user_id, NEW.id, 'Outro', NEW.monthly_value, 10, true, 0
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_default_recurring_service_for_client ON public.clients;
CREATE TRIGGER trg_create_default_recurring_service_for_client
AFTER INSERT ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.create_default_recurring_service_for_client();

CREATE OR REPLACE FUNCTION public.replace_client_recurring_services(
  p_client_id UUID,
  p_items JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  item JSONB;
  item_id UUID;
  item_name TEXT;
  item_amount NUMERIC(12,2);
  item_due_day INTEGER;
  item_active BOOLEAN;
  item_position INTEGER := 0;
  saved_count INTEGER := 0;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = p_client_id AND user_id = current_user_id
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'A lista de recorrências é inválida';
  END IF;
  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Limite de 50 recorrências por cliente';
  END IF;

  DELETE FROM public.client_recurring_services recurring
  WHERE recurring.client_id = p_client_id
    AND recurring.user_id = current_user_id
    AND recurring.id NOT IN (
      SELECT (value->>'id')::UUID
      FROM jsonb_array_elements(p_items)
      WHERE NULLIF(value->>'id', '') IS NOT NULL
    );

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    item_id := NULLIF(item->>'id', '')::UUID;
    item_name := btrim(COALESCE(item->>'service_name', ''));
    item_amount := COALESCE((item->>'amount')::NUMERIC, 0);
    item_due_day := COALESCE((item->>'due_day')::INTEGER, 10);
    item_active := COALESCE((item->>'active')::BOOLEAN, true);

    IF char_length(item_name) < 1 OR char_length(item_name) > 120 THEN
      RAISE EXCEPTION 'Informe um serviço válido';
    END IF;
    IF item_amount < 0 THEN
      RAISE EXCEPTION 'O valor recorrente não pode ser negativo';
    END IF;
    IF item_due_day < 1 OR item_due_day > 31 THEN
      RAISE EXCEPTION 'O vencimento deve ficar entre os dias 1 e 31';
    END IF;

    IF item_id IS NULL THEN
      INSERT INTO public.client_recurring_services(
        user_id, client_id, service_name, amount, due_day, active, position
      ) VALUES (
        current_user_id, p_client_id, item_name, item_amount,
        item_due_day, item_active, item_position
      );
    ELSE
      UPDATE public.client_recurring_services
      SET service_name = item_name,
          amount = item_amount,
          due_day = item_due_day,
          active = item_active,
          position = item_position
      WHERE id = item_id
        AND client_id = p_client_id
        AND user_id = current_user_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Recorrência não encontrada';
      END IF;
    END IF;
    item_position := item_position + 1;
    saved_count := saved_count + 1;
  END LOOP;
  RETURN saved_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_client_with_recurring_services(
  p_client_id UUID,
  p_client JSONB,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  saved_client_id UUID := p_client_id;
  client_name TEXT := btrim(COALESCE(p_client->>'name', ''));
  client_services TEXT[];
  client_folder_links TEXT[];
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória';
  END IF;
  IF char_length(client_name) < 1 OR char_length(client_name) > 200 THEN
    RAISE EXCEPTION 'Informe um nome de cliente válido';
  END IF;

  SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
  INTO client_services
  FROM jsonb_array_elements_text(COALESCE(p_client->'services', '[]'::JSONB));

  SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
  INTO client_folder_links
  FROM jsonb_array_elements_text(COALESCE(p_client->'folder_links', '[]'::JSONB));

  IF saved_client_id IS NULL THEN
    INSERT INTO public.clients(
      user_id, name, company, contact, whatsapp, status, services,
      whatsapp_log, folder_links, monthly_value, notes, source
    ) VALUES (
      current_user_id,
      client_name,
      NULLIF(p_client->>'company', ''),
      NULLIF(p_client->>'contact', ''),
      NULLIF(p_client->>'whatsapp', ''),
      COALESCE(NULLIF(p_client->>'status', ''), 'ativo')::public.client_status,
      client_services,
      NULLIF(p_client->>'whatsapp_log', ''),
      client_folder_links,
      0,
      NULLIF(p_client->>'notes', ''),
      NULLIF(p_client->>'source', '')
    )
    RETURNING id INTO saved_client_id;
  ELSE
    UPDATE public.clients
    SET name = client_name,
        company = NULLIF(p_client->>'company', ''),
        contact = NULLIF(p_client->>'contact', ''),
        whatsapp = NULLIF(p_client->>'whatsapp', ''),
        status = COALESCE(NULLIF(p_client->>'status', ''), 'ativo')::public.client_status,
        services = client_services,
        whatsapp_log = NULLIF(p_client->>'whatsapp_log', ''),
        folder_links = client_folder_links,
        notes = NULLIF(p_client->>'notes', ''),
        source = NULLIF(p_client->>'source', '')
    WHERE id = saved_client_id AND user_id = current_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente não encontrado';
    END IF;
  END IF;

  PERFORM public.replace_client_recurring_services(saved_client_id, p_items);
  RETURN saved_client_id;
END;
$$;

DROP FUNCTION IF EXISTS public.generate_monthly_payments(UUID[], DATE, DATE);
CREATE OR REPLACE FUNCTION public.generate_monthly_payments(
  p_items JSONB,
  p_reference_month DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  normalized_month DATE := date_trunc('month', p_reference_month)::date;
  inserted_count INTEGER := 0;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN 0;
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'Limite de 500 faturas por geração';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) item
    WHERE NULLIF(item->>'recurring_service_id', '') IS NULL
      OR NULLIF(item->>'amount', '') IS NULL
      OR NULLIF(item->>'due_date', '') IS NULL
      OR (item->>'amount')::NUMERIC < 0
  ) THEN
    RAISE EXCEPTION 'Valor ou vencimento inválido';
  END IF;

  INSERT INTO public.payments(
    user_id, client_id, recurring_service_id, description, amount, due_date,
    status, payment_type, reference_month
  )
  SELECT
    current_user_id,
    recurring.client_id,
    recurring.id,
    client.name || ' | Mensalidade ' || recurring.service_name,
    (item->>'amount')::NUMERIC,
    (item->>'due_date')::DATE,
    'pendente'::public.payment_status,
    'monthly',
    normalized_month
  FROM jsonb_array_elements(p_items) item
  JOIN public.client_recurring_services recurring
    ON recurring.id = (item->>'recurring_service_id')::UUID
   AND recurring.user_id = current_user_id
   AND recurring.active = true
  JOIN public.clients client
    ON client.id = recurring.client_id
   AND client.user_id = current_user_id
   AND client.status = 'ativo'::public.client_status
  WHERE (item->>'amount')::NUMERIC >= 0
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_client_monthly_value() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_default_recurring_service_for_client() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.replace_client_recurring_services(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_client_with_recurring_services(UUID, JSONB, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_monthly_payments(JSONB, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_client_recurring_services(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_client_with_recurring_services(UUID, JSONB, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_monthly_payments(JSONB, DATE) TO authenticated;
