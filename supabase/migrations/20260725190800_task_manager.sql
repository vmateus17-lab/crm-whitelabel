-- Tabelas para o Gerenciador de Tarefas estilo Trello (Kanban de Tarefas)

-- Colunas do Kanban de Tarefas
CREATE TABLE IF NOT EXISTS public.task_columns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cards / Tarefas do Kanban
CREATE TABLE IF NOT EXISTS public.task_cards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  column_id UUID NOT NULL REFERENCES public.task_columns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'media',
  completed BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  labels TEXT[] NOT NULL DEFAULT '{}',
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ativar Row Level Security (RLS)
ALTER TABLE public.task_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_cards ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para task_columns
CREATE POLICY "owner_select" ON public.task_columns FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_insert" ON public.task_columns FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update" ON public.task_columns FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_delete" ON public.task_columns FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Políticas de RLS para task_cards
CREATE POLICY "owner_select" ON public.task_cards FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_insert" ON public.task_cards FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update" ON public.task_cards FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_delete" ON public.task_cards FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Triggers de updated_at
CREATE TRIGGER trg_task_columns_updated BEFORE UPDATE ON public.task_columns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_task_cards_updated BEFORE UPDATE ON public.task_cards FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Índices
CREATE INDEX IF NOT EXISTS idx_task_columns_user ON public.task_columns(user_id);
CREATE INDEX IF NOT EXISTS idx_task_cards_user ON public.task_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_task_cards_column ON public.task_cards(column_id);
CREATE INDEX IF NOT EXISTS idx_task_cards_client ON public.task_cards(client_id);
