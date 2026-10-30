-- Atomic and recoverable bulk actions for task columns.

CREATE OR REPLACE FUNCTION public.move_all_task_cards(
  p_source_column_id uuid,
  p_target_column_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_target_position integer;
  v_moved_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_source_column_id = p_target_column_id THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.task_columns
    WHERE id = p_source_column_id AND user_id = v_user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.task_columns
    WHERE id = p_target_column_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Task column not found';
  END IF;

  -- Serialize all ordering changes for this user's board.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':task-board', 0));

  SELECT COALESCE(max(position) + 1, 0)
  INTO v_target_position
  FROM public.task_cards
  WHERE user_id = v_user_id
    AND column_id = p_target_column_id
    AND deleted_at IS NULL;

  WITH ordered_source AS (
    SELECT
      id,
      row_number() OVER (ORDER BY position, created_at, id) - 1 AS offset_position
    FROM public.task_cards
    WHERE user_id = v_user_id
      AND column_id = p_source_column_id
      AND deleted_at IS NULL
  ),
  moved AS (
    UPDATE public.task_cards AS card
    SET
      column_id = p_target_column_id,
      position = v_target_position + ordered_source.offset_position
    FROM ordered_source
    WHERE card.id = ordered_source.id
    RETURNING card.id
  )
  SELECT count(*)::integer INTO v_moved_count FROM moved;

  RETURN v_moved_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.trash_all_task_cards(p_column_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_deleted_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.task_columns
    WHERE id = p_column_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Task column not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':task-board', 0));

  UPDATE public.task_cards
  SET deleted_at = clock_timestamp()
  WHERE user_id = v_user_id
    AND column_id = p_column_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_task_column_safely(p_column_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_fallback_column_id uuid;
  v_deleted_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.task_columns
    WHERE id = p_column_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Task column not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':task-board', 0));

  SELECT id
  INTO v_fallback_column_id
  FROM public.task_columns
  WHERE user_id = v_user_id
    AND id <> p_column_id
  ORDER BY position, created_at, id
  LIMIT 1;

  IF v_fallback_column_id IS NULL THEN
    RAISE EXCEPTION 'The last task column cannot be deleted';
  END IF;

  SELECT count(*)::integer
  INTO v_deleted_count
  FROM public.task_cards
  WHERE user_id = v_user_id
    AND column_id = p_column_id
    AND deleted_at IS NULL;

  -- Reassign even cards already in the trash before deleting the column. This
  -- prevents ON DELETE CASCADE from permanently removing recoverable tasks.
  UPDATE public.task_cards
  SET
    column_id = v_fallback_column_id,
    deleted_at = COALESCE(deleted_at, clock_timestamp())
  WHERE user_id = v_user_id
    AND column_id = p_column_id;

  DELETE FROM public.task_columns
  WHERE id = p_column_id
    AND user_id = v_user_id;

  RETURN v_deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.move_all_task_cards(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trash_all_task_cards(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_task_column_safely(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.move_all_task_cards(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trash_all_task_cards(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_task_column_safely(uuid) TO authenticated;
