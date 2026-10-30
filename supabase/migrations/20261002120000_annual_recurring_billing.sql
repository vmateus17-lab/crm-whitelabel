-- Annual recurring billing. Apply after the September recurring-service migrations.
-- Existing rows stay monthly; existing invoices and client totals are not rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.client_recurring_services
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS due_month SMALLINT;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS recurring_billing_cycle TEXT NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.client_recurring_services'::regclass AND conname='recurring_billing_cycle_check') THEN
    ALTER TABLE public.client_recurring_services ADD CONSTRAINT recurring_billing_cycle_check
      CHECK (billing_cycle IN ('monthly','annual') AND
        ((billing_cycle='monthly' AND due_month IS NULL) OR (billing_cycle='annual' AND due_month BETWEEN 1 AND 12 AND due_month IS NOT NULL))) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND conname='payment_recurring_cycle_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payment_recurring_cycle_check CHECK (recurring_billing_cycle IN ('monthly','annual')) NOT VALID;
  END IF;
END;
$$;

-- Invoice cycle is a snapshot: changing a recurrence's month never erases
-- the annual invoice already registered for that service and year.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_recurring_annual_unique
  ON public.payments(user_id, recurring_service_id, (extract(year FROM reference_month)))
  WHERE payment_type='monthly' AND recurring_billing_cycle='annual'
    AND recurring_service_id IS NOT NULL AND reference_month IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_client_monthly_value()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public
AS $$
DECLARE target_client_id UUID;
BEGIN
  target_client_id := CASE WHEN TG_OP='DELETE' THEN OLD.client_id ELSE NEW.client_id END;
  UPDATE public.clients client
  SET monthly_value=COALESCE((
    SELECT SUM(CASE WHEN recurring.billing_cycle='annual' THEN recurring.amount/12 ELSE recurring.amount END)
    FROM public.client_recurring_services recurring
    WHERE recurring.client_id=target_client_id AND recurring.active=true
  ),0)
  WHERE client.id=target_client_id;

  IF TG_OP='UPDATE' AND OLD.client_id IS DISTINCT FROM NEW.client_id THEN
    UPDATE public.clients client SET monthly_value=COALESCE((
      SELECT SUM(CASE WHEN recurring.billing_cycle='annual' THEN recurring.amount/12 ELSE recurring.amount END)
      FROM public.client_recurring_services recurring
      WHERE recurring.client_id=OLD.client_id AND recurring.active=true
    ),0) WHERE client.id=OLD.client_id;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- The existing synchronization trigger already fires on amount updates.
-- The wrapper always updates amount too, so billing-cycle edits synchronize MRR.
CREATE OR REPLACE TRIGGER trg_sync_client_monthly_value
AFTER INSERT OR UPDATE OF amount, active, client_id, billing_cycle OR DELETE
ON public.client_recurring_services
FOR EACH ROW EXECUTE FUNCTION public.sync_client_monthly_value();

CREATE OR REPLACE FUNCTION public.save_client_with_billing_cycles(
  p_client_id UUID, p_client JSONB, p_items JSONB
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  saved_client_id UUID;
  item JSONB;
  item_cycle TEXT;
  item_month INTEGER;
  item_amount NUMERIC;
  item_position INTEGER := 0;
BEGIN
  IF current_user_id IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória' USING ERRCODE='28000'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>50 THEN
    RAISE EXCEPTION 'Informe até 50 recorrências válidas' USING ERRCODE='22023';
  END IF;
  IF p_client_id IS NOT NULL THEN
    PERFORM 1 FROM public.clients WHERE id=p_client_id AND user_id=current_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado' USING ERRCODE='42501'; END IF;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      item_amount := COALESCE(NULLIF(item->>'amount','')::NUMERIC,0);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Valor recorrente inválido' USING ERRCODE='22023';
    END;
    IF item_amount::TEXT IN ('NaN','Infinity','-Infinity') OR item_amount<0
      OR item_amount>9999999999.99 OR round(item_amount,2)<>item_amount THEN
      RAISE EXCEPTION 'Informe valores recorrentes válidos com até duas casas decimais' USING ERRCODE='22023';
    END IF;
    item_cycle := COALESCE(NULLIF(item->>'billing_cycle',''),'monthly');
    IF item_cycle NOT IN ('monthly','annual') THEN
      RAISE EXCEPTION 'Periodicidade inválida' USING ERRCODE='22023';
    END IF;
    IF item_cycle='annual' THEN
      IF COALESCE(item->>'due_month','') !~ '^[0-9]{1,2}$' THEN
        RAISE EXCEPTION 'Selecione o mês de vencimento anual entre 1 e 12' USING ERRCODE='22023';
      END IF;
      IF (item->>'due_month')::INTEGER NOT BETWEEN 1 AND 12 THEN
        RAISE EXCEPTION 'Selecione o mês de vencimento anual entre 1 e 12' USING ERRCODE='22023';
      END IF;
    END IF;
  END LOOP;

  -- Reuse the existing client-save validation/ownership and removal workflow.
  -- The outer function makes the legacy save and cycle updates one transaction.
  saved_client_id := public.save_client_with_recurring_services(p_client_id,p_client,p_items);
  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    item_cycle := COALESCE(NULLIF(item->>'billing_cycle',''),'monthly');
    item_month := CASE WHEN item_cycle='annual' THEN (item->>'due_month')::INTEGER ELSE NULL END;
    UPDATE public.client_recurring_services
    SET billing_cycle=item_cycle, due_month=item_month, amount=COALESCE(NULLIF(item->>'amount','')::NUMERIC,0)
    WHERE client_id=saved_client_id AND user_id=current_user_id AND position=item_position;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recorrência não encontrada' USING ERRCODE='42501'; END IF;
    item_position := item_position+1;
  END LOOP;
  RETURN saved_client_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_recurring_payment(
  p_payment JSONB,
  p_service_name TEXT,
  p_recurring_service_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  payment_client_id UUID;
  payment_description TEXT;
  payment_amount NUMERIC;
  payment_due_date DATE;
  payment_recurring_due_day INTEGER;
  payment_cycle TEXT := COALESCE(NULLIF(p_payment->>'recurring_cycle',''),'monthly');
  payment_due_month INTEGER;
  payment_paid_at DATE;
  payment_status_text TEXT;
  payment_contract_url TEXT;
  normalized_service_name TEXT := btrim(COALESCE(p_service_name, ''));
  normalized_month DATE;
  saved_service_id UUID := p_recurring_service_id;
  saved_payment_id UUID;
  matching_service_ids UUID[];
  existing_service_name TEXT;
  service_count INTEGER;
  next_position INTEGER;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória' USING ERRCODE = '28000';
  END IF;
  IF p_payment IS NULL OR jsonb_typeof(p_payment) <> 'object' THEN
    RAISE EXCEPTION 'Os dados do lançamento são inválidos' USING ERRCODE = '22023';
  END IF;
  IF char_length(normalized_service_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Selecione um serviço válido' USING ERRCODE = '22023';
  END IF;

  payment_description := btrim(COALESCE(p_payment->>'description', ''));
  payment_status_text := COALESCE(NULLIF(p_payment->>'status', ''), 'pendente');
  payment_contract_url := NULLIF(btrim(COALESCE(p_payment->>'contract_url', '')), '');

  IF char_length(payment_description) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Informe uma descrição de até 500 caracteres' USING ERRCODE = '22023';
  END IF;
  IF payment_status_text NOT IN ('pendente', 'pago', 'atrasado') THEN
    RAISE EXCEPTION 'O status do lançamento é inválido' USING ERRCODE = '22023';
  END IF;
  IF payment_contract_url IS NOT NULL AND (
    char_length(payment_contract_url) > 2048
    OR payment_contract_url !~* '^https://[^/[:space:]]+([/?#][^[:space:]]*)?$'
  ) THEN
    RAISE EXCEPTION 'Informe um endereço HTTPS válido para o contrato' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_payment->>'due_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR (
      NULLIF(p_payment->>'paid_at', '') IS NOT NULL
      AND p_payment->>'paid_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ) THEN
    RAISE EXCEPTION 'Informe datas válidas no formato AAAA-MM-DD' USING ERRCODE = '22023';
  END IF;

  BEGIN
    payment_client_id := NULLIF(p_payment->>'client_id', '')::UUID;
    payment_amount := NULLIF(p_payment->>'amount', '')::NUMERIC;
    payment_due_date := (p_payment->>'due_date')::DATE;
    payment_paid_at := NULLIF(p_payment->>'paid_at', '')::DATE;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Cliente, valor ou data inválidos' USING ERRCODE = '22023';
  END;

  IF payment_client_id IS NULL THEN
    RAISE EXCEPTION 'Selecione um cliente para o valor recorrente' USING ERRCODE = '22023';
  END IF;
  IF payment_amount IS NULL
    OR payment_amount::TEXT IN ('NaN', 'Infinity', '-Infinity')
    OR payment_amount <= 0 OR payment_amount > 9999999999.99
    OR round(payment_amount, 2) <> payment_amount THEN
    RAISE EXCEPTION 'Informe um valor recorrente positivo com até duas casas decimais'
      USING ERRCODE = '22023';
  END IF;
  IF payment_status_text = 'pago' THEN
    payment_paid_at := COALESCE(payment_paid_at, CURRENT_DATE);
  ELSE
    payment_paid_at := NULL;
  END IF;
  normalized_month := date_trunc('month', payment_due_date)::DATE;

  -- The monthly due day is independent of this invoice's date. For example,
  -- a day-31 recurrence has an April invoice on day 30 but remains day 31.
  IF NULLIF(p_payment->>'recurring_due_day', '') IS NOT NULL THEN
    IF p_payment->>'recurring_due_day' !~ '^[0-9]{1,2}$' THEN
      RAISE EXCEPTION 'O dia mensal do vencimento deve ser um inteiro entre 1 e 31'
        USING ERRCODE = '22023';
    END IF;
    payment_recurring_due_day := (p_payment->>'recurring_due_day')::INTEGER;
  ELSE
    payment_recurring_due_day := extract(day FROM payment_due_date)::INTEGER;
  END IF;
  IF payment_recurring_due_day NOT BETWEEN 1 AND 31 THEN
    RAISE EXCEPTION 'O dia mensal do vencimento deve ficar entre 1 e 31'
      USING ERRCODE = '22023';
  END IF;

  IF payment_cycle NOT IN ('monthly','annual') THEN
    RAISE EXCEPTION 'Periodicidade inválida' USING ERRCODE='22023';
  END IF;
  IF payment_cycle='annual' THEN
    IF COALESCE(p_payment->>'recurring_due_month','') !~ '^[0-9]{1,2}$' THEN
      RAISE EXCEPTION 'Selecione o mês de vencimento anual entre 1 e 12' USING ERRCODE='22023';
    END IF;
    payment_due_month := (p_payment->>'recurring_due_month')::INTEGER;
    IF payment_due_month NOT BETWEEN 1 AND 12 THEN
      RAISE EXCEPTION 'Selecione o mês de vencimento anual entre 1 e 12' USING ERRCODE='22023';
    END IF;
  END IF;

  -- Serialize calls for the same client, including the lookup-before-insert path.
  PERFORM 1 FROM public.clients
  WHERE id = payment_client_id AND user_id = current_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado' USING ERRCODE = '42501';
  END IF;

  IF saved_service_id IS NOT NULL THEN
    SELECT recurring.service_name INTO existing_service_name
    FROM public.client_recurring_services recurring
    WHERE recurring.id = saved_service_id
      AND recurring.client_id = payment_client_id
      AND recurring.user_id = current_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recorrência não encontrada para este cliente' USING ERRCODE = '42501';
    END IF;
    IF lower(btrim(existing_service_name)) <> lower(normalized_service_name) THEN
      RAISE EXCEPTION 'O serviço selecionado não corresponde à recorrência'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT array_agg(recurring.id) INTO matching_service_ids
    FROM public.client_recurring_services recurring
    WHERE recurring.client_id = payment_client_id
      AND recurring.user_id = current_user_id
      AND lower(btrim(recurring.service_name)) = lower(normalized_service_name);

    IF COALESCE(cardinality(matching_service_ids), 0) > 1 THEN
      RAISE EXCEPTION 'Há mais de uma recorrência deste serviço. Selecione a recorrência desejada'
        USING ERRCODE = '22023';
    END IF;
    saved_service_id := matching_service_ids[1];
  END IF;

  -- Fail before touching the recurrence when the competence is already billed.
  -- The unique index also protects against concurrent invoice generation.
  IF saved_service_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.payments
    WHERE user_id = current_user_id
      AND recurring_service_id = saved_service_id
      AND payment_type = 'monthly'
      AND (
        reference_month=normalized_month OR
        (payment_cycle='annual' AND recurring_billing_cycle='annual'
          AND extract(year FROM reference_month)=extract(year FROM normalized_month))
      )
  ) THEN
    RAISE EXCEPTION 'Este serviço já possui uma fatura nesta competência ou ano'
      USING ERRCODE = '23505';
  END IF;

  IF saved_service_id IS NULL THEN
    SELECT count(*), COALESCE(max(recurring.position), -1) + 1
    INTO service_count, next_position
    FROM public.client_recurring_services recurring
    WHERE recurring.client_id = payment_client_id;
    IF service_count >= 50 THEN
      RAISE EXCEPTION 'Limite de 50 recorrências por cliente' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.client_recurring_services(
      user_id, client_id, service_name, amount, due_day, active, position, billing_cycle, due_month
    ) VALUES (
      current_user_id, payment_client_id, normalized_service_name,
      payment_amount, payment_recurring_due_day, true, next_position, payment_cycle, payment_due_month
    ) RETURNING id INTO saved_service_id;
  ELSE
    UPDATE public.client_recurring_services
    SET amount = payment_amount,
        due_day = payment_recurring_due_day,
        billing_cycle = payment_cycle,
        due_month = payment_due_month,
        active = true
    WHERE id = saved_service_id
      AND client_id = payment_client_id
      AND user_id = current_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recorrência não encontrada para este cliente' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.payments(
    user_id, client_id, recurring_service_id, description, amount, due_date,
    paid_at, status, contract_url, payment_type, reference_month, recurring_billing_cycle
  ) VALUES (
    current_user_id, payment_client_id, saved_service_id, payment_description,
    payment_amount, payment_due_date, payment_paid_at,
    payment_status_text::public.payment_status, payment_contract_url,
    'monthly', normalized_month, payment_cycle
  ) RETURNING id INTO saved_payment_id;

  RETURN saved_payment_id;
EXCEPTION
  WHEN unique_violation THEN
    -- Re-raising rolls back recurrence edits and the initial invoice together.
    RAISE EXCEPTION 'Este serviço já possui uma fatura nesta competência ou ano'
      USING ERRCODE = '23505';
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_monthly_payments(
  p_items JSONB, p_reference_month DATE
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  normalized_month DATE := date_trunc('month',p_reference_month)::DATE;
  inserted_count INTEGER := 0;
  item JSONB;
  item_amount NUMERIC;
  item_due_date DATE;
BEGIN
  IF current_user_id IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória' USING ERRCODE='28000'; END IF;
  IF normalized_month IS NULL THEN RAISE EXCEPTION 'Competência inválida' USING ERRCODE='22023'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'Faturas inválidas' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_items)=0 THEN RETURN 0; END IF;
  IF jsonb_array_length(p_items)>500 THEN RAISE EXCEPTION 'Limite de 500 faturas por geração' USING ERRCODE='22023'; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF NULLIF(item->>'recurring_service_id','') IS NULL OR
       COALESCE(item->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Recorrência ou vencimento inválidos' USING ERRCODE='22023';
    END IF;
    BEGIN
      PERFORM (item->>'recurring_service_id')::UUID;
      item_amount := NULLIF(item->>'amount','')::NUMERIC;
      item_due_date := (item->>'due_date')::DATE;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Valor ou vencimento inválidos' USING ERRCODE='22023';
    END;
    IF item_amount IS NULL OR item_amount::TEXT IN ('NaN','Infinity','-Infinity') OR
       item_amount<0 OR item_amount>9999999999.99 OR round(item_amount,2)<>item_amount THEN
      RAISE EXCEPTION 'Informe valores válidos com até duas casas decimais' USING ERRCODE='22023';
    END IF;
  END LOOP;

  INSERT INTO public.payments(
    user_id, client_id, recurring_service_id, description, amount, due_date,
    status, payment_type, reference_month, recurring_billing_cycle
  )
  SELECT current_user_id, recurring.client_id, recurring.id,
    client.name || CASE WHEN recurring.billing_cycle='annual' THEN ' | Anuidade ' ELSE ' | Mensalidade ' END || recurring.service_name,
    (billing_item.payload->>'amount')::NUMERIC, (billing_item.payload->>'due_date')::DATE,
    'pendente'::public.payment_status, 'monthly', normalized_month, recurring.billing_cycle
  FROM jsonb_array_elements(p_items) AS billing_item(payload)
  JOIN public.client_recurring_services recurring
    ON recurring.id=(billing_item.payload->>'recurring_service_id')::UUID
    AND recurring.user_id=current_user_id AND recurring.active=true
  JOIN public.clients client
    ON client.id=recurring.client_id AND client.user_id=current_user_id
    AND client.status='ativo'::public.client_status
  WHERE (
    recurring.billing_cycle='monthly'
    OR (
      recurring.billing_cycle='annual'
      AND recurring.due_month=extract(month FROM normalized_month)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments paid
        WHERE paid.user_id=current_user_id AND paid.recurring_service_id=recurring.id
          AND paid.payment_type='monthly' AND paid.recurring_billing_cycle='annual'
          AND extract(year FROM paid.reference_month)=extract(year FROM normalized_month)
      )
    )
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_client_monthly_value() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_client_with_billing_cycles(UUID,JSONB,JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_recurring_payment(JSONB,TEXT,UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_monthly_payments(JSONB,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_client_with_billing_cycles(UUID,JSONB,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_recurring_payment(JSONB,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_monthly_payments(JSONB,DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
