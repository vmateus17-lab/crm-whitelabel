-- Migration: Adicionar suporte a anexos em leads e tarefas + lixeira para tarefas
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.task_cards ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.task_cards ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_task_cards_deleted ON public.task_cards(deleted_at);
