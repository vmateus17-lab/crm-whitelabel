export const BRAND_NAME_LIMIT = 12;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_DATA_LIMIT = 1_500_000;
export const DEFAULT_BRANDING = { name: "CRM", logo: null, revision: "default" } as Branding;

export interface Branding {
  name: string;
  logo: string | null;
  revision: string;
}

export function validateBrandName(value: string): string {
  const name = value.trim();
  if (!name || Array.from(name).length > BRAND_NAME_LIMIT || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error("Informe um nome de 1 a 12 caracteres, sem quebras de linha.");
  }
  return name;
}

export function validateLogoFile(type: string, size: number, width?: number, height?: number) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(type)) {
    throw new Error("Use uma imagem PNG, JPG ou WebP.");
  }
  if (size <= 0 || size > LOGO_MAX_BYTES) throw new Error("A imagem deve ter até 5 MB.");
  if (
    width !== undefined &&
    height !== undefined &&
    (width !== height || width < 32 || width > 8192)
  ) {
    throw new Error("Use uma imagem quadrada (1:1), entre 32 e 8192 pixels de lado.");
  }
}

export function isLogoDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= LOGO_DATA_LIMIT &&
    /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value)
  );
}

export function parseBranding(value: unknown): Branding {
  if (!value || typeof value !== "object") return DEFAULT_BRANDING;
  const row = value as Record<string, unknown>;
  try {
    return {
      name: validateBrandName(String(row.name ?? "")),
      logo: isLogoDataUrl(row.logo) ? row.logo : null,
      revision: typeof row.revision === "string" ? row.revision : "default",
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

// Re-encoding strips source metadata and produces one safe, fixed-size icon.
export async function prepareLogo(file: File): Promise<string> {
  validateLogoFile(file.type, file.size);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error("Não foi possível ler esta imagem.");
    });
    validateLogoFile(file.type, file.size, image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar o logo.");
    context.drawImage(image, 0, 0, 512, 512);
    const result = canvas.toDataURL("image/png");
    if (!isLogoDataUrl(result))
      throw new Error("A imagem é muito grande. Use um logo mais simples.");
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function brandingManifest(branding: Branding) {
  return {
    id: "/",
    name: branding.name,
    short_name: branding.name,
    description: "CRM para gestão de leads, clientes e financeiro.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: `/app-icon.png?v=${encodeURIComponent(branding.revision)}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
