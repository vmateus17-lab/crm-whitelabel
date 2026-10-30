-- Individual reminders for task dates and lead follow-ups.

ALTER TABLE public.task_cards
  ADD COLUMN IF NOT EXISTS due_has_time boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_offsets_minutes integer[] NOT NULL DEFAULT '{}';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_has_time boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_offsets_minutes integer[] NOT NULL DEFAULT '{}';

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS notify_tasks boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_leads boolean NOT NULL DEFAULT true;

UPDATE public.user_settings
SET notify_tasks = COALESCE(notify_due_soon, true) OR COALESCE(notify_overdue, true)
WHERE notify_tasks IS DISTINCT FROM (COALESCE(notify_due_soon, true) OR COALESCE(notify_overdue, true));

ALTER TABLE public.task_cards
  DROP CONSTRAINT IF EXISTS task_cards_reminder_offsets_check;

ALTER TABLE public.task_cards
  ADD CONSTRAINT task_cards_reminder_offsets_check
  CHECK (
    reminder_offsets_minutes <@ ARRAY[1440, 720, 360, 60, 30, 0]
    AND cardinality(reminder_offsets_minutes) <= 6
  );

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_reminder_offsets_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_reminder_offsets_check
  CHECK (
    reminder_offsets_minutes <@ ARRAY[1440, 720, 360, 60, 30, 0]
    AND cardinality(reminder_offsets_minutes) <= 6
  );

CREATE INDEX IF NOT EXISTS idx_task_cards_pending_reminders
ON public.task_cards (due_date, user_id)
WHERE completed = false
  AND deleted_at IS NULL
  AND due_has_time
  AND cardinality(reminder_offsets_minutes) > 0;

CREATE INDEX IF NOT EXISTS idx_leads_pending_follow_up_reminders
ON public.leads (follow_up_at, user_id)
WHERE deleted_at IS NULL
  AND stage NOT IN ('ganho', 'perdido')
  AND follow_up_has_time
  AND cardinality(reminder_offsets_minutes) > 0;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'send-task-notifications-hourly';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'send-crm-reminders-every-minute';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$$;

SELECT cron.schedule(
  'send-crm-reminders-every-minute',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'push_function_url'
        LIMIT 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'push_cron_secret'
          LIMIT 1
        )
      ),
      body := jsonb_build_object('scheduled_at', now())
    );
  $cron$
);
