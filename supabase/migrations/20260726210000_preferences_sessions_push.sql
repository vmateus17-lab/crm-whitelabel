-- Neutral preferences, real Supabase session visibility, and standards-based Web Push.

ALTER TABLE public.user_settings
  DROP COLUMN IF EXISTS date_format,
  DROP COLUMN IF EXISTS notify_activity_summary;

DROP TRIGGER IF EXISTS audit_leads_trash_changes ON public.leads;
DROP TRIGGER IF EXISTS audit_tasks_trash_changes ON public.task_cards;
DROP FUNCTION IF EXISTS public.audit_crm_trash_changes();
DROP TABLE IF EXISTS public.activity_logs;

CREATE TABLE IF NOT EXISTS public.device_sessions (
  session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name text NOT NULL CHECK (char_length(device_name) BETWEEN 1 AND 120),
  browser text NOT NULL CHECK (char_length(browser) BETWEEN 1 AND 80),
  operating_system text NOT NULL CHECK (char_length(operating_system) BETWEEN 1 AND 80),
  device_type text NOT NULL CHECK (device_type IN ('desktop', 'mobile', 'tablet')),
  user_agent text NOT NULL CHECK (char_length(user_agent) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user_seen
ON public.device_sessions (user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.device_sessions(session_id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (char_length(endpoint) BETWEEN 20 AND 2048),
  p256dh text NOT NULL CHECK (char_length(p256dh) BETWEEN 20 AND 512),
  auth_key text NOT NULL CHECK (char_length(auth_key) BETWEEN 8 AND 256),
  device_name text NOT NULL CHECK (char_length(device_name) BETWEEN 1 AND 120),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_active
ON public.web_push_subscriptions (user_id, active);

CREATE TABLE IF NOT EXISTS public.push_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.web_push_subscriptions(id) ON DELETE CASCADE,
  notification_key text NOT NULL CHECK (char_length(notification_key) BETWEEN 1 AND 120),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, notification_key)
);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_user_date
ON public.push_notification_deliveries (user_id, delivered_at DESC);

DROP TRIGGER IF EXISTS set_web_push_subscriptions_updated_at ON public.web_push_subscriptions;
CREATE TRIGGER set_web_push_subscriptions_updated_at
BEFORE UPDATE ON public.web_push_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.device_sessions, public.web_push_subscriptions, public.push_notification_deliveries
FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_device_session(
  p_session_id uuid,
  p_device_name text,
  p_browser text,
  p_operating_system text,
  p_device_type text,
  p_user_agent text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_session_id uuid := NULLIF(auth.jwt()->>'session_id', '')::uuid;
BEGIN
  IF v_user_id IS NULL OR v_current_session_id IS NULL OR p_session_id <> v_current_session_id THEN
    RAISE EXCEPTION 'Invalid current session';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions
    WHERE id = p_session_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF p_device_type NOT IN ('desktop', 'mobile', 'tablet') THEN
    RAISE EXCEPTION 'Invalid device type';
  END IF;

  INSERT INTO public.device_sessions (
    session_id,
    user_id,
    device_name,
    browser,
    operating_system,
    device_type,
    user_agent,
    last_seen_at
  )
  VALUES (
    p_session_id,
    v_user_id,
    left(trim(p_device_name), 120),
    left(trim(p_browser), 80),
    left(trim(p_operating_system), 80),
    p_device_type,
    left(trim(p_user_agent), 1000),
    now()
  )
  ON CONFLICT (session_id) DO UPDATE
  SET
    device_name = EXCLUDED.device_name,
    browser = EXCLUDED.browser,
    operating_system = EXCLUDED.operating_system,
    device_type = EXCLUDED.device_type,
    user_agent = EXCLUDED.user_agent,
    last_seen_at = now()
  WHERE device_sessions.user_id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_user_sessions()
RETURNS TABLE (
  session_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  refreshed_at timestamp,
  user_agent text,
  device_name text,
  browser text,
  operating_system text,
  device_type text,
  last_seen_at timestamptz,
  is_current boolean,
  push_enabled boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog
AS $$
  SELECT
    sessions.id,
    sessions.created_at,
    sessions.updated_at,
    sessions.refreshed_at,
    COALESCE(devices.user_agent, sessions.user_agent),
    devices.device_name,
    devices.browser,
    devices.operating_system,
    devices.device_type,
    devices.last_seen_at,
    sessions.id = NULLIF(auth.jwt()->>'session_id', '')::uuid,
    EXISTS (
      SELECT 1
      FROM public.web_push_subscriptions subscriptions
      WHERE subscriptions.session_id = sessions.id
        AND subscriptions.active
    )
  FROM auth.sessions sessions
  LEFT JOIN public.device_sessions devices ON devices.session_id = sessions.id
  WHERE sessions.user_id = auth.uid()
  ORDER BY COALESCE(devices.last_seen_at, sessions.refreshed_at::timestamptz, sessions.updated_at, sessions.created_at) DESC;
$$;

CREATE OR REPLACE FUNCTION public.revoke_user_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_session_id uuid := NULLIF(auth.jwt()->>'session_id', '')::uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_session_id = v_current_session_id THEN
    RAISE EXCEPTION 'Use sign out to close the current session';
  END IF;

  DELETE FROM auth.sessions
  WHERE id = p_session_id AND user_id = v_user_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_web_push_subscription(
  p_session_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth_key text,
  p_device_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_session_id uuid := NULLIF(auth.jwt()->>'session_id', '')::uuid;
  v_subscription_id uuid;
BEGIN
  IF v_user_id IS NULL OR v_current_session_id IS NULL OR p_session_id <> v_current_session_id THEN
    RAISE EXCEPTION 'Invalid current session';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.device_sessions
    WHERE session_id = p_session_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Register the device session first';
  END IF;

  INSERT INTO public.web_push_subscriptions (
    user_id,
    session_id,
    endpoint,
    p256dh,
    auth_key,
    device_name,
    active
  )
  VALUES (
    v_user_id,
    p_session_id,
    left(trim(p_endpoint), 2048),
    left(trim(p_p256dh), 512),
    left(trim(p_auth_key), 256),
    left(trim(p_device_name), 120),
    true
  )
  ON CONFLICT (endpoint) DO UPDATE
  SET
    session_id = EXCLUDED.session_id,
    p256dh = EXCLUDED.p256dh,
    auth_key = EXCLUDED.auth_key,
    device_name = EXCLUDED.device_name,
    active = true
  WHERE web_push_subscriptions.user_id = v_user_id
  RETURNING id INTO v_subscription_id;

  IF v_subscription_id IS NULL THEN
    RAISE EXCEPTION 'Subscription belongs to another user';
  END IF;
  RETURN v_subscription_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_web_push_subscription(p_endpoint text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  DELETE FROM public.web_push_subscriptions
  WHERE endpoint = p_endpoint AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_device_session(uuid, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_user_sessions() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_user_session(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_web_push_subscription(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_web_push_subscription(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.register_device_session(uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_web_push_subscription(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_web_push_subscription(text) TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'send-task-notifications-hourly';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$$;

SELECT cron.schedule(
  'send-task-notifications-hourly',
  '0 * * * *',
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
