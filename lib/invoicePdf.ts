import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type InvoicePdfIssuer = {
  fiscalName: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  email: string;
  iban: string;
};

export type InvoicePdfClient = {
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
};

export type InvoicePdfLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  vat: number;
  withholding: number;
};

export type InvoicePdfData = {
  number: string;
  issueDate: string;
  notes: string;
  paymentMethod: string;
  issuer: InvoicePdfIssuer;
  client: InvoicePdfClient;
  lines: InvoicePdfLine[];
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 108;
const RIGHT = 54;
const RIGHT_X = PAGE_WIDTH - RIGHT;
const DARK = rgb(0.055, 0.075, 0.12);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.72, 0.75, 0.79);

function money(value: number) {
  const rounded = Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(rounded).replace(/\u00a0/g, " ") + " €";
}

function pdfText(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...");
}

function dateDisplay(value: string) {
  const [year, month, day] = String(value || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function filePart(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function companyTaxLabel(name: string) {
  return /\b(S\.?L\.?U?|S\.?A\.?U?|SOCIEDAD|SLU|SL|SA)\b/i.test(name) ? "CIF" : "NIF";
}

function lineBase(line: InvoicePdfLine) {
  return Math.round((Number(line.quantity || 0) * Number(line.unitPrice || 0) + Number.EPSILON) * 100) / 100;
}

function totals(lines: InvoicePdfLine[]) {
  return lines.reduce(
    (acc, line) => {
      const base = lineBase(line);
      acc.base += base;
      acc.vat += base * (Number(line.vat || 0) / 100);
      acc.withholding += base * (Number(line.withholding || 0) / 100);
      return acc;
    },
    { base: 0, vat: 0, withholding: 0 }
  );
}

function groupTax(lines: InvoicePdfLine[], field: "vat" | "withholding") {
  const groups = new Map<number, number>();
  for (const line of lines) {
    const rate = Number(line[field] || 0);
    if (field === "withholding" && rate === 0) continue;
    const amount = lineBase(line) * (rate / 100);
    groups.set(rate, (groups.get(rate) || 0) + amount);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function rightText(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = DARK) {
  const safe = pdfText(text);
  const width = font.widthOfTextAtSize(safe, size);
  page.drawText(safe, { x: RIGHT_X - width, y, size, font, color });
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      rows.push(current);
      current = word;
    }
  }

  if (current) rows.push(current);
  return rows.length ? rows : [""];
}

function drawWrapped(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  maxWidth: number,
  lineHeight: number,
  color = DARK
) {
  const rows = wrap(font, text, size, maxWidth);
  rows.forEach((row, index) => {
    page.drawText(row, { x, y: y - index * lineHeight, size, font, color });
  });
  return y - rows.length * lineHeight;
}

function drawConceptHeader(page: PDFPage, bold: PDFFont, y = 525) {
  page.drawText("CONCEPTO", { x: LEFT, y, size: 10.5, font: bold, color: DARK });
  page.drawLine({
    start: { x: LEFT, y: y - 18 },
    end: { x: RIGHT_X, y: y - 18 },
    thickness: 0.65,
    color: LINE
  });
  return y - 54;
}

function drawContinuationHeader(page: PDFPage, number: string, bold: PDFFont) {
  rightText(page, `FACTURA ${number}`, PAGE_HEIGHT - 70, bold, 10.5);
  return drawConceptHeader(page, bold, PAGE_HEIGHT - 118);
}

function drawHeader(
  page: PDFPage,
  data: InvoicePdfData,
  regular: PDFFont,
  bold: PDFFont
) {
  let leftY = PAGE_HEIGHT - 94;
  page.drawText("FACTURA A", { x: LEFT, y: leftY, size: 8.5, font: bold, color: MUTED });
  leftY -= 23;
  leftY = drawWrapped(page, data.client.name, LEFT, leftY, bold, 12.5, 245, 15) - 3;
  leftY = drawWrapped(page, data.client.address, LEFT, leftY, regular, 10.5, 245, 14);
  const clientCity = [data.client.postalCode, data.client.city].filter(Boolean).join(" ");
  const clientLocation = data.client.province
    ? `${clientCity}${clientCity ? " " : ""}(${data.client.province})`
    : clientCity;
  leftY = drawWrapped(page, clientLocation, LEFT, leftY, regular, 10.5, 245, 14);
  page.drawText(
    pdfText(`${companyTaxLabel(data.client.name)}: ${data.client.taxId}`),
    { x: LEFT, y: leftY, size: 10.5, font: regular, color: DARK }
  );

  let rightY = PAGE_HEIGHT - 94;
  rightText(page, data.issuer.fiscalName, rightY, bold, 12.5);
  rightY -= 23;
  rightText(page, data.issuer.address, rightY, regular, 10.5);
  rightY -= 14;
  const issuerCity = [data.issuer.postalCode, data.issuer.city, data.issuer.province]
    .filter(Boolean)
    .join(" ");
  rightText(page, issuerCity, rightY, regular, 10.5);
  rightY -= 14;
  rightText(page, `NIF: ${data.issuer.taxId}`, rightY, regular, 10.5);
  if (data.issuer.email) {
    rightY -= 17;
    rightText(page, data.issuer.email, rightY, regular, 10.5, MUTED);
  }

  rightText(page, dateDisplay(data.issueDate), PAGE_HEIGHT - 192, bold, 10.5);
  rightText(page, `FACTURA ${data.number}`, PAGE_HEIGHT - 211, bold, 11.5);

  return drawConceptHeader(page, bold);
}

function ensurePageForSummary(
  pdfDoc: PDFDocument,
  currentPage: PDFPage,
  currentY: number,
  data: InvoicePdfData,
  regular: PDFFont,
  bold: PDFFont
) {
  if (currentY >= 330) return { page: currentPage, y: Math.min(390, currentY - 36) };

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  rightText(page, `FACTURA ${data.number}`, PAGE_HEIGHT - 70, bold, 10.5);
  page.drawText("RESUMEN", { x: LEFT, y: PAGE_HEIGHT - 118, size: 10.5, font: bold, color: DARK });
  page.drawLine({
    start: { x: LEFT, y: PAGE_HEIGHT - 136 },
    end: { x: RIGHT_X, y: PAGE_HEIGHT - 136 },
    thickness: 0.65,
    color: LINE
  });
  return { page, y: PAGE_HEIGHT - 185 };
}

function drawSummaryAndFooter(
  page: PDFPage,
  y: number,
  data: InvoicePdfData,
  regular: PDFFont,
  bold: PDFFont
) {
  const summary = totals(data.lines);
  const vatGroups = groupTax(data.lines, "vat");
  const withholdingGroups = groupTax(data.lines, "withholding");

  page.drawText("Base imponible", { x: LEFT + 18, y, size: 10, font: regular, color: MUTED });
  rightText(page, money(summary.base), y, regular, 10);

  let rowY = y - 29;
  for (const [rate, amount] of vatGroups) {
    page.drawText(pdfText(`+   ${rate}% IVA`), { x: LEFT + 18, y: rowY, size: 10.5, font: bold, color: DARK });
    rightText(page, money(amount), rowY, regular, 10);
    rowY -= 28;
  }

  for (const [rate, amount] of withholdingGroups) {
    page.drawText(pdfText(`-   ${rate}% IRPF`), { x: LEFT + 18, y: rowY, size: 10.5, font: bold, color: DARK });
    rightText(page, money(amount), rowY, regular, 10);
    rowY -= 28;
  }

  const lineY = rowY - 18;
  page.drawLine({
    start: { x: LEFT, y: lineY },
    end: { x: RIGHT_X, y: lineY },
    thickness: 0.65,
    color: LINE
  });

  const totalY = lineY - 38;
  page.drawText("TOTAL", { x: LEFT + 36, y: totalY, size: 12.5, font: bold, color: DARK });
  rightText(
    page,
    money(summary.base + summary.vat - summary.withholding),
    totalY,
    bold,
    12.5
  );

  let notesY = totalY - 68;
  if (data.notes.trim()) {
    page.drawText("OBSERVACIONES", { x: LEFT, y: notesY, size: 8.5, font: bold, color: MUTED });
    notesY -= 24;
    drawWrapped(page, data.notes, LEFT, notesY, regular, 10.5, RIGHT_X - LEFT, 14);
  }

  const footerLineY = 126;
  page.drawLine({
    start: { x: LEFT, y: footerLineY },
    end: { x: RIGHT_X, y: footerLineY },
    thickness: 0.45,
    color: rgb(0.82, 0.84, 0.87)
  });

  page.drawText(pdfText(`Pago: ${data.paymentMethod}`), {
    x: LEFT,
    y: footerLineY - 27,
    size: 10,
    font: bold,
    color: DARK
  });

  if (data.issuer.iban) {
    rightText(page, `IBAN: ${data.issuer.iban}`, footerLineY - 27, bold, 10);
  }
}

export async function buildInvoicePdf(data: InvoicePdfData) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setProducer("Facturas");
  pdfDoc.setCreator("Facturas");

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let conceptY = drawHeader(page, data, regular, bold);

  const amountColumnWidth = 100;
  const conceptWidth = RIGHT_X - LEFT - amountColumnWidth - 16;

  for (let index = 0; index < data.lines.length; index += 1) {
    const line = data.lines[index];
    const description = line.description.trim() || "Concepto";
    const rows = wrap(regular, description, 10.5, conceptWidth);
    const requiredHeight = Math.max(28, rows.length * 14 + 10);

    if (conceptY - requiredHeight < 345) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      conceptY = drawContinuationHeader(page, data.number, bold);
    }

    rows.forEach((row, rowIndex) => {
      page.drawText(row, {
        x: LEFT,
        y: conceptY - rowIndex * 14,
        size: 10.5,
        font: regular,
        color: DARK
      });
    });

    rightText(page, money(lineBase(line)), conceptY, bold, 10.5);
    conceptY -= requiredHeight;
  }

  const summaryPlacement = ensurePageForSummary(
    pdfDoc,
    page,
    conceptY,
    data,
    regular,
    bold
  );
  page = summaryPlacement.page;
  drawSummaryAndFooter(page, summaryPlacement.y, data, regular, bold);

  const filename = [
    data.issueDate.split("-").join("_"),
    filePart(data.number),
    filePart(data.client.name)
  ].filter(Boolean).join("_") + ".pdf";

  pdfDoc.setTitle(filename.replace(/\.pdf$/i, ""));

  const bytes = await pdfDoc.save();
  return { bytes, filename };
}

export async function downloadInvoicePdf(data: InvoicePdfData) {
  const { bytes, filename } = await buildInvoicePdf(data);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
