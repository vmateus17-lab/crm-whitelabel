import { createFileRoute } from "@tanstack/react-router";
import {
  Component,
  type ComponentType,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { FilterBar, FilterSelect } from "@/components/FilterBar";
import { useListFilters } from "@/lib/list-filters";
import { filterChips } from "@/lib/filter-utils";
import { formatDateTimeBR } from "@/lib/date-format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pin, PinOff, Plus, Trash2, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import "react-quill-new/dist/quill.snow.css";
import { sanitizeRichText } from "@/lib/security";

interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
  className?: string;
}

type ReactQuillComponent = ComponentType<{
  theme: string;
  modules: typeof QUILL_MODULES;
  value: string;
  onChange: (content: string) => void;
  className?: string;
}>;

let reactQuillPromise: Promise<ReactQuillComponent> | null = null;

function loadReactQuill() {
  if (!reactQuillPromise) {
    reactQuillPromise = import("react-quill-new").then(
      (module) => module.default as unknown as ReactQuillComponent,
    );
  }
  return reactQuillPromise!;
}

export const Route = createFileRoute("/_authenticated/notas")({
  component: NotasPage,
  head: () => ({ meta: [{ title: "CRM | Notas" }] }),
});

interface Note {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  updated_at: string;
  deleted_at: string | null;
}

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["clean"],
  ],
};

const MAX_NOTE_TITLE_LENGTH = 200;
const MAX_NOTE_CONTENT_LENGTH = 100_000;
const EDITOR_LOAD_TIMEOUT_MS = 15_000;
const NOTE_FILTERS = { search: "", pinned: "all" };

class EditorErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function CompatibleNoteEditor({ value, onChange, className }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor || editor.innerHTML === value) return;
    editor.innerHTML = value;
  }, [value]);

  return (
    <div className="flex flex-1 flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Editor em modo de compatibilidade para esta nota.
      </p>
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        className={`${className ?? ""} min-h-48 rounded-md border border-input bg-background p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`}
        dangerouslySetInnerHTML={{ __html: value }}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
      />
    </div>
  );
}

function RichTextEditor({ value, onChange, className }: RichTextEditorProps) {
  const [Editor, setEditor] = useState<ReactQuillComponent | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;

    const timeout = window.setTimeout(() => {
      if (active) setLoadError(true);
    }, EDITOR_LOAD_TIMEOUT_MS);

    loadReactQuill()
      .then((QuillEditor) => {
        window.clearTimeout(timeout);
        if (!active) return;
        setEditor(() => QuillEditor);
        setLoadError(false);
      })
      .catch(() => {
        window.clearTimeout(timeout);
        reactQuillPromise = null;
        if (active) setLoadError(true);
      });

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [retryToken]);

  if (Editor) {
    return (
      <Editor
        theme="snow"
        modules={QUILL_MODULES}
        value={value}
        onChange={onChange}
        className={className}
      />
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">Não foi possível carregar o editor.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setLoadError(false);
            setRetryToken((current) => current + 1);
          }}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
      Carregando editor...
    </div>
  );
}

function NotasPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [trashNotes, setTrashNotes] = useState<Note[]>([]);
  const views = useListFilters(NOTE_FILTERS, "notes", user?.id, { pinned: ["all", "yes", "no"] });
  const { filters } = views;
  const search = filters.search;
  const setSearch = (value: string) => views.setFilter("search", value);

  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("notes")
      .select("*")
      .is("deleted_at", null)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });

    const originalNotes = (data ?? []) as Note[];
    const sanitizedNotes = originalNotes.map((note) => ({
      ...note,
      content: sanitizeRichText(String(note.content ?? "").slice(0, MAX_NOTE_CONTENT_LENGTH)),
    }));
    setNotes(sanitizedNotes);

    await Promise.all(
      sanitizedNotes
        .filter((note, index) => note.content !== originalNotes[index].content)
        .map((note) => supabase.from("notes").update({ content: note.content }).eq("id", note.id)),
    );
  };

  const loadTrash = async () => {
    const { data } = await supabase
      .from("notes")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    setTrashNotes(
      ((data ?? []) as Note[]).map((note) => ({
        ...note,
        content: sanitizeRichText(String(note.content ?? "").slice(0, MAX_NOTE_CONTENT_LENGTH)),
      })),
    );
  };

  const loadOnMount = useEffectEvent(load);
  const loadTrashWhenOpened = useEffectEvent(loadTrash);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOnMount(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!trashOpen) return;
    const timer = window.setTimeout(() => void loadTrashWhenOpened(), 0);
    return () => window.clearTimeout(timer);
  }, [trashOpen]);

  const addNote = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("notes")
      .insert({ user_id: user.id, title: "", content: "" })
      .select()
      .single();
    if (error) {
      toast.error("Erro ao criar nota: " + error.message);
      return;
    }
    if (data) {
      setNotes((prev) => [data as Note, ...prev]);
      setEditingNote(data as Note);
    }
  };

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const saveNoteContent = (content: string) => {
    if (!editingNote) return;
    const safeContent = sanitizeRichText(content.slice(0, MAX_NOTE_CONTENT_LENGTH));
    if (safeContent === editingNote.content) return;
    const updated = { ...editingNote, content: safeContent };
    setEditingNote(updated);
    setNotes((prev) =>
      prev.map((n) => (n.id === editingNote.id ? { ...n, content: safeContent } : n)),
    );

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(async () => {
      await supabase.from("notes").update({ content: safeContent }).eq("id", editingNote.id);
    }, 1000);
  };

  const saveNoteTitle = (title: string) => {
    if (!editingNote) return;
    const safeTitle = title.slice(0, MAX_NOTE_TITLE_LENGTH);
    const updated = { ...editingNote, title: safeTitle };
    setEditingNote(updated);
    setNotes((prev) => prev.map((n) => (n.id === editingNote.id ? { ...n, title: safeTitle } : n)));

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(async () => {
      await supabase.from("notes").update({ title: safeTitle }).eq("id", editingNote.id);
    }, 1000);
  };

  const togglePin = async (n: Note) => {
    await supabase.from("notes").update({ pinned: !n.pinned }).eq("id", n.id);
    load();
  };

  const moveToTrash = async (id: string) => {
    await supabase.from("notes").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    toast.success("Nota movida para a lixeira", {
      action: {
        label: "Desfazer",
        onClick: () => {
          void supabase
            .from("notes")
            .update({ deleted_at: null })
            .eq("id", id)
            .then(() => load());
        },
      },
    });
  };

  const restoreNote = async (id: string) => {
    await supabase.from("notes").update({ deleted_at: null }).eq("id", id);
    setTrashNotes((prev) => prev.filter((n) => n.id !== id));
    load();
    toast.success("Nota restaurada");
  };

  const deletePermanently = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta nota definitivamente?")) return;
    await supabase.from("notes").delete().eq("id", id);
    setTrashNotes((prev) => prev.filter((n) => n.id !== id));
    toast.success("Nota excluída permanentemente");
  };

  const emptyTrash = async () => {
    if (!confirm("Tem certeza que deseja esvaziar a lixeira? Isso não pode ser desfeito.")) return;
    for (const n of trashNotes) {
      await supabase.from("notes").delete().eq("id", n.id);
    }
    setTrashNotes([]);
    toast.success("Lixeira esvaziada");
  };

  const filtered = notes.filter((n) => {
    if (filters.pinned === "yes" && !n.pinned) return false;
    if (filters.pinned === "no" && n.pinned) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
  });

  return (
    <div className="page-shell">
      <FilterBar
        title="Notas"
        description="Bloco rico para anotações e planejamento"
        search={{ value: search, onChange: setSearch, placeholder: "Buscar nas notas..." }}
        viewState={views}
        onReset={views.resetFilters}
        resultCount={filtered.length}
        resultLabel="notas"
        activeFilters={filterChips(
          filters,
          NOTE_FILTERS,
          { search: "Busca", pinned: "Notas" },
          (key, value) => views.setFilter(key as keyof typeof filters, value),
          { pinned: { yes: "Fixadas", no: "Não fixadas" } },
        )}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setTrashOpen(true)}>
              <Trash2 className="h-4 w-4 mr-2" /> Lixeira
            </Button>
            <Button size="sm" onClick={addNote}>
              <Plus className="h-4 w-4 mr-2" /> Nova nota
            </Button>
          </div>
        }
      >
        <FilterSelect
          label="Notas"
          value={filters.pinned}
          onChange={(value) => views.setFilter("pinned", value)}
          options={[
            { value: "all", label: "Todas" },
            { value: "yes", label: "Fixadas" },
            { value: "no", label: "Não fixadas" },
          ]}
        />
      </FilterBar>

      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center text-sm text-muted-foreground">
          <p>{notes.length === 0 ? "Nenhuma nota ainda." : "Nenhuma nota corresponde à busca."}</p>
          <Button
            className="mt-4"
            variant="outline"
            size="sm"
            onClick={notes.length === 0 ? addNote : views.resetFilters}
          >
            {notes.length === 0 ? "Criar primeira nota" : "Limpar busca"}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((n) => (
          <Card
            key={n.id}
            className="p-4 border-border shadow-none group hover:border-foreground/20 transition-colors flex flex-col h-56 cursor-pointer relative overflow-hidden"
            onClick={() => setEditingNote(n)}
            role="button"
            tabIndex={0}
            aria-label={`Editar nota ${n.title || "sem título"}`}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setEditingNote(n);
              }
            }}
          >
            <div className="flex items-center justify-between mb-2 shrink-0">
              <span className="text-xs text-muted-foreground">
                {formatDateTimeBR(n.updated_at)}
              </span>
              <div className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePin(n);
                  }}
                  className="touch-target text-muted-foreground hover:text-foreground"
                  aria-label={
                    n.pinned ? `Desafixar ${n.title || "nota"}` : `Fixar ${n.title || "nota"}`
                  }
                >
                  {n.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveToTrash(n.id);
                  }}
                  className="touch-target text-muted-foreground hover:text-destructive"
                  aria-label={`Excluir ${n.title || "nota"}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {n.pinned && <Pin className="h-3 w-3 text-foreground" />}
            </div>

            {n.title && <h3 className="text-sm font-semibold mb-1 truncate shrink-0">{n.title}</h3>}

            <div
              className="flex-1 overflow-hidden text-sm prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{
                __html:
                  sanitizeRichText(n.content) ||
                  "<span class='text-muted-foreground italic'>Nota vazia...</span>",
              }}
            />

            {/* Fade overlay at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-card to-transparent pointer-events-none" />
          </Card>
        ))}
      </div>

      {/* Editor Modal */}
      <Dialog open={!!editingNote} onOpenChange={(open) => !open && setEditingNote(null)}>
        <DialogContent className="flex h-[80dvh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader className="shrink-0">
            <DialogTitle className="sr-only">Editar Nota</DialogTitle>
            <Input
              placeholder="Título da nota (opcional)"
              value={editingNote?.title ?? ""}
              onChange={(e) => saveNoteTitle(e.target.value)}
              maxLength={MAX_NOTE_TITLE_LENGTH}
              className="text-lg font-semibold border-none shadow-none px-0 h-auto focus-visible:ring-0 placeholder:text-muted-foreground/50"
            />
          </DialogHeader>
          <div className="flex-1 min-h-0 flex flex-col quill-custom-container">
            {editingNote && (
              <EditorErrorBoundary
                key={editingNote.id}
                fallback={
                  <CompatibleNoteEditor
                    value={editingNote.content}
                    onChange={saveNoteContent}
                    className="flex-1 overflow-y-auto"
                  />
                }
              >
                <RichTextEditor
                  value={editingNote.content}
                  onChange={saveNoteContent}
                  className="flex-1 flex flex-col overflow-hidden"
                />
              </EditorErrorBoundary>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Trash Modal */}
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="flex max-h-[80dvh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex justify-between items-center pr-6">
              <span>Lixeira de Notas</span>
              {trashNotes.length > 0 && (
                <Button variant="destructive" size="sm" onClick={emptyTrash}>
                  <XCircle className="h-4 w-4 mr-2" /> Esvaziar lixeira
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 mt-4 pr-2">
            {trashNotes.length === 0 ? (
              <p className="text-center text-muted-foreground py-10">A lixeira está vazia.</p>
            ) : (
              trashNotes.map((n) => (
                <div
                  key={n.id}
                  className="border border-border rounded-lg p-3 bg-muted/30 flex items-start justify-between gap-4"
                >
                  <div className="flex-1 overflow-hidden">
                    {n.title && (
                      <div className="text-sm font-semibold truncate mb-1">{n.title}</div>
                    )}
                    <div
                      className="text-sm line-clamp-2 prose prose-sm dark:prose-invert"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeRichText(n.content) || "<i>Sem conteúdo</i>",
                      }}
                    />
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => restoreNote(n.id)}>
                      <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restaurar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => deletePermanently(n.id)}
                    >
                      Excluir
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
