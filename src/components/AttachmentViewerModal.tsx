import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { formatFileSize, getAttachmentPreviewUrl } from "@/lib/storage";

export interface AttachmentItem {
  name: string;
  url?: string;
  path: string;
  size?: number;
  type?: string;
}

interface AttachmentViewerModalProps {
  attachment: AttachmentItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AttachmentViewerModal({
  attachment,
  open,
  onOpenChange,
}: AttachmentViewerModalProps) {
  const accessKey = open && attachment ? `${attachment.path}:${attachment.url ?? ""}` : "";
  const [accessState, setAccessState] = useState<{
    key: string;
    url: string | null;
    error: string | null;
    local: boolean;
  }>({ key: "", url: null, error: null, local: false });

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (!attachment || !open)
      return () => {
        active = false;
      };

    void getAttachmentPreviewUrl(attachment.path, attachment.url, attachment.type)
      .then((preview) => {
        if (preview.revokeOnCleanup) objectUrl = preview.url;
        if (active)
          setAccessState({
            key: accessKey,
            url: preview.url,
            error: null,
            local: preview.revokeOnCleanup,
          });
        else if (preview.revokeOnCleanup) URL.revokeObjectURL(preview.url);
      })
      .catch(() => {
        if (active) {
          setAccessState({
            key: accessKey,
            url: null,
            error: "Não foi possível abrir este anexo com segurança.",
            local: false,
          });
        }
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accessKey, attachment, open]);

  if (!attachment) return null;

  const loading = accessState.key !== accessKey;
  const resolvedUrl = loading ? null : accessState.url;
  const loadError = loading ? null : accessState.error;
  const isLocalPreview = !loading && accessState.local;

  const isImage =
    attachment.type?.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif)$/i.test(attachment.name);

  const isPdf = attachment.type === "application/pdf" || /\.pdf$/i.test(attachment.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col overflow-hidden p-4 sm:max-w-4xl md:p-6">
        <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b border-border space-y-0">
          <div className="flex items-center gap-2 min-w-0 pr-4">
            {isImage ? (
              <ImageIcon className="h-5 w-5 text-blue-500 shrink-0" />
            ) : isPdf ? (
              <FileText className="h-5 w-5 text-rose-500 shrink-0" />
            ) : (
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold truncate" title={attachment.name}>
                {attachment.name}
              </DialogTitle>
              {attachment.size && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatFileSize(attachment.size)}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                download={attachment.name}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                  <Download className="h-3.5 w-3.5" /> Baixar
                </Button>
              </a>
            )}
            {resolvedUrl && (
              <a href={resolvedUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Abrir em nova aba">
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </a>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto py-4 flex items-center justify-center bg-muted/20 rounded-xl min-h-[300px]">
          {loading ? (
            <p className="text-sm text-muted-foreground">Gerando acesso seguro ao anexo...</p>
          ) : loadError || !resolvedUrl ? (
            <p className="text-sm text-destructive">{loadError ?? "Anexo indisponível."}</p>
          ) : isImage ? (
            <img
              src={resolvedUrl}
              alt={attachment.name}
              referrerPolicy="no-referrer"
              className="max-h-[70vh] max-w-full object-contain rounded-lg shadow-md"
            />
          ) : isPdf && isLocalPreview ? (
            <iframe
              src={`${resolvedUrl}#toolbar=1`}
              title={attachment.name}
              className="w-full h-[70vh] rounded-lg border border-border shadow-xs"
            />
          ) : isPdf ? (
            <div className="text-center p-8 space-y-3">
              <FileText className="h-12 w-12 text-rose-500 mx-auto" />
              <p className="text-sm text-muted-foreground">
                Este anexo antigo precisa ser aberto em uma nova aba.
              </p>
              <a href={resolvedUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="gap-2">
                  <ExternalLink className="h-4 w-4" /> Abrir PDF
                </Button>
              </a>
            </div>
          ) : (
            <div className="text-center p-8 space-y-3">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                Este tipo de arquivo não possui pré-visualização direta no navegador.
              </p>
              <a
                href={resolvedUrl}
                download={attachment.name}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="sm" className="gap-2">
                  <Download className="h-4 w-4" /> Fazer download do arquivo
                </Button>
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
