-- Keep task ordering independent per column and make priority optional.

ALTER TABLE public.task_cards
  ALTER COLUMN priority DROP NOT NULL,
  ALTER COLUMN priority DROP DEFAULT,
  ALTER COLUMN position DROP DEFAULT;

ALTER TABLE public.task_cards
  DROP CONSTRAINT IF EXISTS task_cards_priority_check;

ALTER TABLE public.task_cards
  ADD CONSTRAINT task_cards_priority_check
  CHECK (priority IS NULL OR priority IN ('baixa', 'media', 'alta', 'urgente'));

-- Normalize only active cards, preserving the current order inside each column.
WITH ranked_cards AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, column_id
      ORDER BY position, created_at, id
    ) - 1 AS normalized_position
  FROM public.task_cards
  WHERE deleted_at IS NULL
)
UPDATE public.task_cards
SET position = ranked_cards.normalized_position
FROM ranked_cards
WHERE task_cards.id = ranked_cards.id
  AND task_cards.position IS DISTINCT FROM ranked_cards.normalized_position;

CREATE OR REPLACE FUNCTION public.set_task_card_insert_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL OR NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Serialize inserts/restores only for this column, never across the whole Kanban.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.column_id::text, 0));

  SELECT COALESCE(max(task_cards.position) + 1, 0)
  INTO NEW.position
  FROM public.task_cards
  WHERE task_cards.column_id = NEW.column_id
    AND task_cards.deleted_at IS NULL;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_task_card_insert_position() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_task_card_insert_position() TO authenticated;

DROP TRIGGER IF EXISTS set_task_card_insert_position ON public.task_cards;
CREATE TRIGGER set_task_card_insert_position
BEFORE INSERT OR UPDATE OF deleted_at ON public.task_cards
FOR EACH ROW EXECUTE FUNCTION public.set_task_card_insert_position();

CREATE INDEX IF NOT EXISTS idx_task_cards_active_column_position
ON public.task_cards (user_id, column_id, position, created_at, id)
WHERE deleted_at IS NULL;
