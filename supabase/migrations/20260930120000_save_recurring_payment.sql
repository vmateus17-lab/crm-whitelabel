-- Register the initial invoice and the client's recurrence in one transaction.
-- Requires 20260901120000_client_recurring_services.sql. Safe to run again.

BEGIN;

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
      AND reference_month = normalized_month
      AND payment_type = 'monthly'
  ) THEN
    RAISE EXCEPTION 'Este serviço já possui uma fatura nesta competência'
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
      user_id, client_id, service_name, amount, due_day, active, position
    ) VALUES (
      current_user_id, payment_client_id, normalized_service_name,
      payment_amount, payment_recurring_due_day, true, next_position
    ) RETURNING id INTO saved_service_id;
  ELSE
    UPDATE public.client_recurring_services
    SET amount = payment_amount,
        due_day = payment_recurring_due_day,
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
    paid_at, status, contract_url, payment_type, reference_month
  ) VALUES (
    current_user_id, payment_client_id, saved_service_id, payment_description,
    payment_amount, payment_due_date, payment_paid_at,
    payment_status_text::public.payment_status, payment_contract_url,
    'monthly', normalized_month
  ) RETURNING id INTO saved_payment_id;

  RETURN saved_payment_id;
EXCEPTION
  WHEN unique_violation THEN
    -- Re-raising rolls back recurrence edits and the initial invoice together.
    RAISE EXCEPTION 'Este serviço já possui uma fatura nesta competência'
      USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.save_recurring_payment(JSONB, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_recurring_payment(JSONB, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
