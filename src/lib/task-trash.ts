import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type MutationResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

/** PostgREST may report no error even when RLS or a stale record affects zero rows. */
export function assertTrashMutation(result: MutationResult, id: string) {
  if (result.error) throw new Error(result.error.message);
  if (result.data?.id !== id) {
    throw new Error(
      "O item não está mais na lixeira ou você não tem permissão. Atualize e tente novamente.",
    );
  }
}

export async function restoreTrashedTask(
  client: SupabaseClient<Database>,
  id: string,
  userId: string,
) {
  if (!id || !userId) throw new Error("Sessão inválida. Entre novamente.");
  const result = await client
    .from("task_cards")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .select("id")
    .single();
  assertTrashMutation(result, id);
}

export async function deleteTrashedTask(
  client: SupabaseClient<Database>,
  id: string,
  userId: string,
) {
  if (!id || !userId) throw new Error("Sessão inválida. Entre novamente.");
  const result = await client
    .from("task_cards")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .select("id")
    .single();
  assertTrashMutation(result, id);
}
