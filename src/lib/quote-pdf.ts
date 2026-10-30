import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

export interface QuotePdfProfile {
  business_name: string;
  legal_name?: string | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  logo_path?: string | null;
  logo_bytes?: Uint8Array | null;
  accent_color?: string | null;
  footer_notes?: string | null;
}

export interface QuotePdfItem {
  description: string;
  quantity: number;
  unit_price: number;
}

export interface QuotePdfData {
  quote_number: number;
  recipient_name: string;
  recipient_company?: string | null;
  recipient_email?: string | null;
  recipient_phone?: string | null;
  issue_date: string;
  valid_until?: string | null;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  scope?: string | null;
  notes?: string | null;
  subtotal: number;
  discount: number;
  total: number;
  items: QuotePdfItem[];
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

function cleanText(value: string) {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, "-")
    .replace(/[^\u0020-\u007E\u00A0-\u00FF\n\r\t]/g, "");
}

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function dateBR(value?: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function hexToRgb(hex?: string | null) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex! : "#171717";
  return rgb(
    Number.parseInt(safe.slice(1, 3), 16) / 255,
    Number.parseInt(safe.slice(3, 5), 16) / 255,
    Number.parseInt(safe.slice(5, 7), 16) / 255,
  );
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const paragraphs = cleanText(text).split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export async function createQuotePdf(profile: QuotePdfProfile, quote: QuotePdfData) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let logoImage: PDFImage | null = null;
  if (profile.logo_bytes?.length) {
    try {
      logoImage = await document.embedPng(profile.logo_bytes);
    } catch {
      try {
        logoImage = await document.embedJpg(profile.logo_bytes);
      } catch {
        logoImage = null;
      }
    }
  }
  const accent = hexToRgb(profile.accent_color);
  const muted = rgb(0.4, 0.4, 0.4);
  const border = rgb(0.88, 0.88, 0.88);
  const softBackground = rgb(0.97, 0.97, 0.97);
  let page!: PDFPage;
  let y!: number;

  const addPage = () => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 8, color: accent });
    const headerTop = PAGE_HEIGHT - MARGIN + 3;
    let headerBottom = headerTop - 20;
    if (logoImage) {
      const scale = Math.min(112 / logoImage.width, 38 / logoImage.height);
      const logoWidth = logoImage.width * scale;
      const logoHeight = logoImage.height * scale;
      headerBottom = headerTop - logoHeight;
      page.drawImage(logoImage, {
        x: MARGIN,
        y: headerBottom,
        width: logoWidth,
        height: logoHeight,
      });
    } else {
      page.drawText(cleanText(profile.business_name || "Empresa"), {
        x: MARGIN,
        y: headerTop - 12,
        size: 10,
        font: bold,
        color: muted,
      });
    }
    const quoteCode = `ORC-${quote.issue_date.slice(0, 4)}-${String(quote.quote_number).padStart(4, "0")}`;
    page.drawText(quoteCode, {
      x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(quoteCode, 10),
      y: headerTop - 12,
      size: 10,
      font: bold,
      color: muted,
    });
    y = headerBottom - 26;
  };

  const ensureSpace = (height: number) => {
    if (y - height < 58) addPage();
  };

  const drawWrapped = (
    text: string,
    options?: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      width?: number;
      gapAfter?: number;
    },
  ) => {
    const size = options?.size ?? 10;
    const selectedFont = options?.font ?? regular;
    const lines = wrapText(text, selectedFont, size, options?.width ?? PAGE_WIDTH - MARGIN * 2);
    ensureSpace(lines.length * (size + 4));
    lines.forEach((line) => {
      page.drawText(line, {
        x: MARGIN,
        y,
        size,
        font: selectedFont,
        color: options?.color ?? rgb(0.12, 0.12, 0.12),
      });
      y -= size + 4;
    });
    y -= options?.gapAfter ?? 4;
  };

  addPage();
  page.drawText("ORÇAMENTO", { x: MARGIN, y, size: 26, font: bold, color: accent });
  y -= 42;

  const businessDetails = [
    profile.legal_name,
    profile.document,
    profile.email,
    profile.phone,
    profile.website,
    profile.address,
  ]
    .filter(Boolean)
    .join("  |  ");
  if (businessDetails) drawWrapped(businessDetails, { size: 9, color: muted, gapAfter: 14 });

  const detailsTop = y;
  const detailsHeight = 108;
  page.drawRectangle({
    x: MARGIN,
    y: detailsTop - detailsHeight,
    width: PAGE_WIDTH - MARGIN * 2,
    height: detailsHeight,
    color: softBackground,
  });
  page.drawText("PREPARADO PARA", {
    x: MARGIN + 12,
    y: detailsTop - 18,
    size: 8,
    font: bold,
    color: muted,
  });
  page.drawText("EMISSÃO E VALIDADE", {
    x: 360,
    y: detailsTop - 18,
    size: 8,
    font: bold,
    color: muted,
  });
  const recipientLines = wrapText(quote.recipient_name, bold, 14, 270).slice(0, 2);
  recipientLines.forEach((line, index) =>
    page.drawText(line, { x: MARGIN + 12, y: detailsTop - 39 - index * 15, size: 14, font: bold }),
  );
  page.drawText(dateBR(quote.issue_date), { x: 360, y: detailsTop - 39, size: 11, font: bold });
  page.drawText(`Válido até ${dateBR(quote.valid_until)}`, {
    x: 360,
    y: detailsTop - 57,
    size: 9,
    font: regular,
    color: muted,
  });
  const recipientSecondaryY = detailsTop - 58 - Math.max(0, recipientLines.length - 1) * 15;
  if (quote.recipient_company)
    page.drawText(cleanText(quote.recipient_company).slice(0, 55), {
      x: MARGIN + 12,
      y: recipientSecondaryY,
      size: 9,
      font: regular,
      color: muted,
    });
  const recipientContact = [quote.recipient_email, quote.recipient_phone]
    .filter(Boolean)
    .join("  |  ");
  const recipientContactY = recipientSecondaryY - (quote.recipient_company ? 17 : 0);
  if (recipientContact)
    page.drawText(cleanText(recipientContact).slice(0, 64), {
      x: MARGIN + 12,
      y: recipientContactY,
      size: 8,
      font: regular,
      color: muted,
    });
  y = detailsTop - detailsHeight - 22;

  const drawRightAligned = (
    text: string,
    right: number,
    baseline: number,
    size: number,
    selectedFont: PDFFont,
    color = rgb(0.12, 0.12, 0.12),
  ) => {
    page.drawText(cleanText(text), {
      x: right - selectedFont.widthOfTextAtSize(cleanText(text), size),
      y: baseline,
      size,
      font: selectedFont,
      color,
    });
  };
  const drawTableHeader = () => {
    page.drawRectangle({
      x: MARGIN,
      y: y - 23,
      width: PAGE_WIDTH - MARGIN * 2,
      height: 27,
      color: accent,
    });
    page.drawText("DESCRIÇÃO", {
      x: MARGIN + 10,
      y: y - 13,
      size: 8,
      font: bold,
      color: rgb(1, 1, 1),
    });
    drawRightAligned("QTD.", 365, y - 13, 8, bold, rgb(1, 1, 1));
    drawRightAligned("UNITÁRIO", 450, y - 13, 8, bold, rgb(1, 1, 1));
    drawRightAligned("TOTAL", PAGE_WIDTH - MARGIN - 10, y - 13, 8, bold, rgb(1, 1, 1));
    y -= 34;
  };
  drawTableHeader();

  for (const item of quote.items) {
    const descriptionLines = wrapText(item.description, regular, 9, 260);
    const contentHeight = Math.max(12, descriptionLines.length * 12);
    const separatorGap = 5;
    const nextRowGap = 15;
    const rowHeight = contentHeight + separatorGap + nextRowGap;
    if (y - rowHeight < 58) {
      addPage();
      drawTableHeader();
    }
    descriptionLines.forEach((line, index) =>
      page.drawText(line, { x: MARGIN + 10, y: y - index * 12, size: 9, font: regular }),
    );
    drawRightAligned(String(item.quantity).replace(".", ","), 365, y, 9, regular);
    drawRightAligned(brl(item.unit_price), 450, y, 9, regular);
    drawRightAligned(brl(item.quantity * item.unit_price), PAGE_WIDTH - MARGIN - 10, y, 9, regular);
    const separatorY = y - contentHeight - separatorGap;
    page.drawLine({
      start: { x: MARGIN, y: separatorY },
      end: { x: PAGE_WIDTH - MARGIN, y: separatorY },
      thickness: 0.7,
      color: border,
    });
    y = separatorY - nextRowGap;
  }

  ensureSpace(90);
  y -= 8;
  const totalsX = 375;
  const totalsRight = PAGE_WIDTH - MARGIN - 10;
  page.drawText("Subtotal", { x: totalsX, y, size: 10, font: regular, color: muted });
  drawRightAligned(brl(quote.subtotal), totalsRight, y, 10, regular);
  y -= 20;
  page.drawText("Desconto", { x: totalsX, y, size: 10, font: regular, color: muted });
  drawRightAligned(brl(quote.discount), totalsRight, y, 10, regular);
  y -= 25;
  page.drawText("TOTAL", { x: totalsX, y, size: 12, font: bold, color: accent });
  drawRightAligned(brl(quote.total), totalsRight, y, 12, bold, accent);
  y -= 38;

  const sections = [
    ["ESCOPO", quote.scope],
    ["CONDIÇÕES DE PAGAMENTO", quote.payment_terms],
    ["PRAZO / ENTREGA", quote.delivery_terms],
    ["OBSERVAÇÕES", quote.notes],
  ] as const;
  for (const [title, value] of sections) {
    if (!value?.trim()) continue;
    ensureSpace(60);
    drawWrapped(title, { size: 9, font: bold, color: accent, gapAfter: 2 });
    drawWrapped(value, { size: 10, gapAfter: 12 });
  }

  if (profile.footer_notes?.trim()) {
    ensureSpace(45);
    drawWrapped(profile.footer_notes, { size: 8, color: muted });
  }

  const pages = document.getPages();
  pages.forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: MARGIN, y: 42 },
      end: { x: PAGE_WIDTH - MARGIN, y: 42 },
      thickness: 0.7,
      color: border,
    });
    currentPage.drawText(
      `${cleanText(profile.business_name || "Empresa")}  |  Página ${index + 1} de ${pages.length}`,
      { x: MARGIN, y: 27, size: 8, font: regular, color: muted },
    );
  });

  return document.save();
}
