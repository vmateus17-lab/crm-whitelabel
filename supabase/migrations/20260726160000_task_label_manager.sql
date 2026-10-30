-- Managed labels for task cards, mirroring the Pipeline label model.

CREATE TABLE IF NOT EXISTS public.task_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  color text NOT NULL DEFAULT 'blue'
    CHECK (color IN ('green', 'yellow', 'orange', 'red', 'purple', 'blue', 'cyan', 'pink', 'lime', 'slate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.task_label_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.task_cards(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES public.task_labels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, label_id)
);

DROP TRIGGER IF EXISTS set_task_labels_updated_at ON public.task_labels;
CREATE TRIGGER set_task_labels_updated_at
BEFORE UPDATE ON public.task_labels
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.task_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_label_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.task_labels, public.task_label_assignments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_labels, public.task_label_assignments TO authenticated;

DROP POLICY IF EXISTS task_labels_owner_select ON public.task_labels;
DROP POLICY IF EXISTS task_labels_owner_insert ON public.task_labels;
DROP POLICY IF EXISTS task_labels_owner_update ON public.task_labels;
DROP POLICY IF EXISTS task_labels_owner_delete ON public.task_labels;

CREATE POLICY task_labels_owner_select ON public.task_labels
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY task_labels_owner_insert ON public.task_labels
FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY task_labels_owner_update ON public.task_labels
FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY task_labels_owner_delete ON public.task_labels
FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS task_label_assignments_owner_select ON public.task_label_assignments;
DROP POLICY IF EXISTS task_label_assignments_owner_insert ON public.task_label_assignments;
DROP POLICY IF EXISTS task_label_assignments_owner_update ON public.task_label_assignments;
DROP POLICY IF EXISTS task_label_assignments_owner_delete ON public.task_label_assignments;

CREATE POLICY task_label_assignments_owner_select ON public.task_label_assignments
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.task_cards
    JOIN public.task_labels ON task_labels.id = task_label_assignments.label_id
    WHERE task_cards.id = task_label_assignments.task_id
      AND task_cards.user_id = (SELECT auth.uid())
      AND task_labels.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY task_label_assignments_owner_insert ON public.task_label_assignments
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.task_cards
    JOIN public.task_labels ON task_labels.id = task_label_assignments.label_id
    WHERE task_cards.id = task_label_assignments.task_id
      AND task_cards.user_id = (SELECT auth.uid())
      AND task_labels.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY task_label_assignments_owner_update ON public.task_label_assignments
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.task_cards
    JOIN public.task_labels ON task_labels.id = task_label_assignments.label_id
    WHERE task_cards.id = task_label_assignments.task_id
      AND task_cards.user_id = (SELECT auth.uid())
      AND task_labels.user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.task_cards
    JOIN public.task_labels ON task_labels.id = task_label_assignments.label_id
    WHERE task_cards.id = task_label_assignments.task_id
      AND task_cards.user_id = (SELECT auth.uid())
      AND task_labels.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY task_label_assignments_owner_delete ON public.task_label_assignments
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.task_cards
    JOIN public.task_labels ON task_labels.id = task_label_assignments.label_id
    WHERE task_cards.id = task_label_assignments.task_id
      AND task_cards.user_id = (SELECT auth.uid())
      AND task_labels.user_id = (SELECT auth.uid())
  )
);

-- Preserve the free-form tags that already exist on task cards.
INSERT INTO public.task_labels (user_id, name, color)
SELECT DISTINCT task_cards.user_id, btrim(existing_label), 'blue'
FROM public.task_cards
CROSS JOIN LATERAL unnest(COALESCE(task_cards.labels, ARRAY[]::text[])) AS existing_label
WHERE btrim(existing_label) <> ''
ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO public.task_label_assignments (task_id, label_id)
SELECT task_cards.id, task_labels.id
FROM public.task_cards
CROSS JOIN LATERAL unnest(COALESCE(task_cards.labels, ARRAY[]::text[])) AS existing_label
JOIN public.task_labels
  ON task_labels.user_id = task_cards.user_id
 AND task_labels.name = btrim(existing_label)
WHERE btrim(existing_label) <> ''
ON CONFLICT (task_id, label_id) DO NOTHING;
