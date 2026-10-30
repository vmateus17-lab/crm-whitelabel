import { supabase } from "@/integrations/supabase/client";
import { isValidAttachmentPath, safeExternalUrl } from "@/lib/security";
import type { Json } from "@/integrations/supabase/types";

export const BUCKET_NAME = "crm-attachments";
export const FREE_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type AttachmentFolder = "leads" | "tasks";
export type AttachmentOwnerType = "lead" | "task";

export interface TrashableAttachment {
  name: string;
  path: string;
  size?: number;
  type?: string;
  url?: string;
}

interface AllowedAttachmentType {
  extensions: string[];
  mimeTypes: string[];
  matchesSignature: (bytes: Uint8Array) => boolean;
}

const ALLOWED_ATTACHMENT_TYPES: AllowedAttachmentType[] = [
  {
    extensions: ["jpg", "jpeg"],
    mimeTypes: ["image/jpeg"],
    matchesSignature: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    extensions: ["png"],
    mimeTypes: ["image/png"],
    matchesSignature: (bytes) =>
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
  {
    extensions: ["gif"],
    mimeTypes: ["image/gif"],
    matchesSignature: (bytes) => {
      const signature = String.fromCharCode(...bytes.slice(0, 6));
      return signature === "GIF87a" || signature === "GIF89a";
    },
  },
  {
    extensions: ["webp"],
    mimeTypes: ["image/webp"],
    matchesSignature: (bytes) =>
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP",
  },
  {
    extensions: ["pdf"],
    mimeTypes: ["application/pdf"],
    matchesSignature: (bytes) => String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-",
  },
  {
    extensions: ["doc"],
    mimeTypes: ["application/msword"],
    matchesSignature: (bytes) =>
      [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
        (value, index) => bytes[index] === value,
      ),
  },
  {
    extensions: ["docx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    matchesSignature: (bytes) =>
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
        (bytes[2] === 0x05 && bytes[3] === 0x06) ||
        (bytes[2] === 0x07 && bytes[3] === 0x08)),
  },
];

export interface StorageUsage {
  usedBytes: number;
  totalBytes: number;
  formattedUsed: string;
  formattedLimit: string;
  percentage: number;
  fileCount: number;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Calculates total storage used by listing files in the bucket for the logged-in user.
 */
export async function getStorageUsage(userId: string): Promise<StorageUsage> {
  let usedBytes = 0;
  let fileCount = 0;

  try {
    const { data: userFolders } = await supabase.storage
      .from(BUCKET_NAME)
      .list(userId, { limit: 100 });

    if (userFolders) {
      for (const item of userFolders) {
        if (item.metadata?.size) {
          usedBytes += item.metadata.size;
          fileCount += 1;
        } else {
          // If it's a subfolder, list contents
          const { data: subFiles } = await supabase.storage
            .from(BUCKET_NAME)
            .list(`${userId}/${item.name}`, { limit: 100 });
          if (subFiles) {
            for (const sub of subFiles) {
              if (sub.metadata?.size) {
                usedBytes += sub.metadata.size;
                fileCount += 1;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Erro ao calcular armazenamento:", err);
  }

  const percentage = Math.min(100, Number(((usedBytes / FREE_LIMIT_BYTES) * 100).toFixed(1)));

  return {
    usedBytes,
    totalBytes: FREE_LIMIT_BYTES,
    formattedUsed: formatFileSize(usedBytes),
    formattedLimit: "500 MB",
    percentage,
    fileCount,
  };
}

/**
 * Compresses an image in browser canvas to WebP format if it's JPEG or PNG.
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (
    !file.type.startsWith("image/") ||
    file.type.endsWith("gif") ||
    file.type.endsWith("svg+xml")
  ) {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        // Resize if larger than 1920px max dimension
        const MAX_DIM = 1920;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".webp"), {
                type: "image/webp",
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          "image/webp",
          0.82,
        );
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

async function validateAttachmentFile(
  file: File,
): Promise<{ extension: string; mimeType: string }> {
  if (file.size <= 0) {
    throw new Error("O arquivo está vazio.");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("O arquivo não pode exceder 5 MB.");
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const allowedType = ALLOWED_ATTACHMENT_TYPES.find((type) => type.extensions.includes(extension));
  if (!allowedType) {
    throw new Error("Tipo de arquivo não permitido. Use JPG, PNG, GIF, WebP, PDF, DOC ou DOCX.");
  }

  if (file.type && !allowedType.mimeTypes.includes(file.type.toLowerCase())) {
    throw new Error("O conteúdo do arquivo não corresponde à extensão informada.");
  }

  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!allowedType.matchesSignature(bytes)) {
    throw new Error("A assinatura do arquivo é inválida ou o arquivo está corrompido.");
  }

  return {
    extension,
    mimeType: allowedType.mimeTypes[0],
  };
}

/**
 * Uploads a file to Supabase Storage.
 */
export async function uploadAttachment(
  userId: string,
  folder: AttachmentFolder,
  file: File,
): Promise<{ path: string; name: string; size: number; type: string }> {
  await validateAttachmentFile(file);
  const processedFile = await compressImageIfNeeded(file);
  const { extension, mimeType } = await validateAttachmentFile(processedFile);

  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = `${userId}/${folder}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, processedFile, {
      cacheControl: "3600",
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  return {
    path: filePath,
    name: file.name,
    size: processedFile.size,
    type: mimeType,
  };
}

export async function getAttachmentAccessUrl(path: string, legacyUrl?: string): Promise<string> {
  if (isValidAttachmentPath(path)) {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(path, 5 * 60);
    if (error || !data?.signedUrl) {
      throw error ?? new Error("Não foi possível gerar o acesso temporário ao anexo.");
    }
    return data.signedUrl;
  }

  const safeLegacyUrl = safeExternalUrl(legacyUrl);
  if (safeLegacyUrl) return safeLegacyUrl;

  throw new Error("O caminho do anexo é inválido.");
}

export interface AttachmentPreviewUrl {
  url: string;
  revokeOnCleanup: boolean;
}

/**
 * Downloads a private attachment before previewing it. A local object URL is
 * not affected by the Storage response headers that Chrome blocks in iframes.
 */
export async function getAttachmentPreviewUrl(
  path: string,
  legacyUrl?: string,
  mimeType?: string,
): Promise<AttachmentPreviewUrl> {
  if (isValidAttachmentPath(path)) {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).download(path);
    if (error || !data) {
      throw error ?? new Error("Não foi possível baixar o anexo para visualização.");
    }
    const previewBlob =
      mimeType && data.type !== mimeType ? new Blob([data], { type: mimeType }) : data;
    return { url: URL.createObjectURL(previewBlob), revokeOnCleanup: true };
  }

  return {
    url: await getAttachmentAccessUrl(path, legacyUrl),
    revokeOnCleanup: false,
  };
}

export async function removeAttachmentObject(path: string): Promise<void> {
  if (!isValidAttachmentPath(path)) {
    throw new Error("O caminho do anexo é inválido.");
  }

  const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);
  if (error) throw error;
}

export async function moveAttachmentToTrash(
  ownerType: AttachmentOwnerType,
  ownerId: string,
  attachment: TrashableAttachment,
): Promise<void> {
  if (!isValidAttachmentPath(attachment.path)) {
    throw new Error("O caminho do anexo é inválido.");
  }

  const { error } = await supabase.rpc("trash_attachment", {
    p_owner_type: ownerType,
    p_owner_id: ownerId,
    p_attachment: attachment as unknown as Json,
  });
  if (error) throw error;
}

export async function openAttachmentInNewTab(path: string, legacyUrl?: string): Promise<void> {
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;

  try {
    const url = await getAttachmentAccessUrl(path, legacyUrl);
    if (popup) {
      popup.location.replace(url);
    } else {
      window.location.assign(url);
    }
  } catch (error) {
    popup?.close();
    throw error;
  }
}
