-- Keep attachment trash operations functional after the activity history feature was removed.

CREATE OR REPLACE FUNCTION public.trash_attachment(
  p_owner_type text,
  p_owner_id uuid,
  p_attachment jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_trash_id uuid;
  v_owner_exists boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_owner_type NOT IN ('lead', 'task') THEN
    RAISE EXCEPTION 'Invalid attachment owner type';
  END IF;
  IF jsonb_typeof(p_attachment) <> 'object' OR NOT (p_attachment ? 'path') OR NOT (p_attachment ? 'name') THEN
    RAISE EXCEPTION 'Invalid attachment metadata';
  END IF;

  IF p_owner_type = 'lead' THEN
    UPDATE public.leads
    SET attachments = COALESCE((
      SELECT jsonb_agg(item)
      FROM jsonb_array_elements(leads.attachments) AS item
      WHERE item->>'path' IS DISTINCT FROM p_attachment->>'path'
    ), '[]'::jsonb)
    WHERE id = p_owner_id AND user_id = v_user_id;
    v_owner_exists := FOUND;
  ELSE
    UPDATE public.task_cards
    SET attachments = COALESCE((
      SELECT jsonb_agg(item)
      FROM jsonb_array_elements(task_cards.attachments) AS item
      WHERE item->>'path' IS DISTINCT FROM p_attachment->>'path'
    ), '[]'::jsonb)
    WHERE id = p_owner_id AND user_id = v_user_id;
    v_owner_exists := FOUND;
  END IF;

  IF NOT v_owner_exists THEN
    RAISE EXCEPTION 'Attachment owner not found';
  END IF;

  INSERT INTO public.trashed_attachments (user_id, owner_type, owner_id, attachment)
  VALUES (v_user_id, p_owner_type, p_owner_id, p_attachment)
  ON CONFLICT (user_id, (attachment->>'path'))
  DO UPDATE SET deleted_at = now(), owner_type = EXCLUDED.owner_type, owner_id = EXCLUDED.owner_id
  RETURNING id INTO v_trash_id;

  RETURN v_trash_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_trashed_attachment(p_trash_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.trashed_attachments%ROWTYPE;
  v_owner_exists boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_item
  FROM public.trashed_attachments
  WHERE id = p_trash_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trashed attachment not found';
  END IF;

  IF v_item.owner_type = 'lead' THEN
    UPDATE public.leads
    SET attachments = CASE
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(leads.attachments) AS item
        WHERE item->>'path' = v_item.attachment->>'path'
      ) THEN leads.attachments
      ELSE leads.attachments || jsonb_build_array(v_item.attachment)
    END
    WHERE id = v_item.owner_id AND user_id = v_user_id;
    v_owner_exists := FOUND;
  ELSE
    UPDATE public.task_cards
    SET attachments = CASE
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(task_cards.attachments) AS item
        WHERE item->>'path' = v_item.attachment->>'path'
      ) THEN task_cards.attachments
      ELSE task_cards.attachments || jsonb_build_array(v_item.attachment)
    END
    WHERE id = v_item.owner_id AND user_id = v_user_id;
    v_owner_exists := FOUND;
  END IF;

  IF NOT v_owner_exists THEN
    RAISE EXCEPTION 'Original record no longer exists';
  END IF;

  DELETE FROM public.trashed_attachments
  WHERE id = v_item.id AND user_id = v_user_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trash_attachment(text, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_trashed_attachment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_attachment(text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_trashed_attachment(uuid) TO authenticated;
