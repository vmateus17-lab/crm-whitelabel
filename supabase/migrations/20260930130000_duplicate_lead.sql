-- Apply in the Supabase SQL Editor before publishing the new Pipeline UI.
-- The source lead is never updated. Lead and labels are created in one transaction.
BEGIN;

CREATE OR REPLACE FUNCTION public.duplicate_lead(p_lead_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  source_lead public.leads%ROWTYPE;
  new_lead_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO source_lead
  FROM public.leads
  WHERE id = p_lead_id
    AND user_id = current_user_id
    AND deleted_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead não encontrado ou sem permissão.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.leads (
    user_id, name, company, contact, whatsapp, estimated_value, notes,
    services, source, stage, created_at, updated_at, attachments,
    contacted_at, proposal_sent_at, negotiation_at, closed_at, last_contact_at,
    loss_reason, loss_reason_details, follow_up_at, follow_up_has_time,
    reminder_offsets_minutes, converted_client_id, deleted_at
  ) VALUES (
    current_user_id, source_lead.name, source_lead.company, source_lead.contact,
    source_lead.whatsapp, source_lead.estimated_value, source_lead.notes,
    source_lead.services, source_lead.source, 'novo', clock_timestamp(),
    clock_timestamp(), '[]'::jsonb,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, '{}'::integer[], NULL, NULL
  )
  RETURNING id INTO new_lead_id;

  INSERT INTO public.lead_label_assignments (lead_id, label_id)
  SELECT DISTINCT new_lead_id, assignment.label_id
  FROM public.lead_label_assignments AS assignment
  JOIN public.lead_labels AS label ON label.id = assignment.label_id
  WHERE assignment.lead_id = source_lead.id
    AND label.user_id = current_user_id;

  RETURN new_lead_id;
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_lead(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_lead(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
