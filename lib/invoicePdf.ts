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
  detail?: string;
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

type PdfDensity = {
  conceptSize: number;
  conceptLineHeight: number;
  detailSize: number;
  detailLineHeight: number;
  lineGap: number;
  minLineHeight: number;
  summaryRowStart: number;
  summaryRowStep: number;
  summarySeparatorGap: number;
  summaryTotalGap: number;
  notesGap: number;
  notesTextGap: number;
  noteSize: number;
  noteLineHeight: number;
  footerLineY: number;
  paymentSize: number;
  baseSize: number;
  taxSize: number;
  totalSize: number;
  summaryGap: number;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 108;
const RIGHT = 54;
const RIGHT_X = PAGE_WIDTH - RIGHT;
const DARK = rgb(0.055, 0.075, 0.12);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.72, 0.75, 0.79);

const NORMAL: PdfDensity = {
  conceptSize: 10.5,
  conceptLineHeight: 14,
  detailSize: 8.5,
  detailLineHeight: 11,
  lineGap: 10,
  minLineHeight: 28,
  summaryRowStart: 29,
  summaryRowStep: 28,
  summarySeparatorGap: 18,
  summaryTotalGap: 38,
  notesGap: 68,
  notesTextGap: 24,
  noteSize: 10.5,
  noteLineHeight: 14,
  footerLineY: 126,
  paymentSize: 10,
  baseSize: 10,
  taxSize: 10.5,
  totalSize: 12.5,
  summaryGap: 30
};

const COMPACT: PdfDensity = {
  conceptSize: 9.3,
  conceptLineHeight: 11.5,
  detailSize: 7.7,
  detailLineHeight: 9.2,
  lineGap: 6,
  minLineHeight: 22,
  summaryRowStart: 22,
  summaryRowStep: 20,
  summarySeparatorGap: 12,
  summaryTotalGap: 28,
  notesGap: 42,
  notesTextGap: 18,
  noteSize: 9,
  noteLineHeight: 10.5,
  footerLineY: 100,
  paymentSize: 9,
  baseSize: 9,
  taxSize: 9.3,
  totalSize: 11.5,
  summaryGap: 16
};

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

function conceptBlockHeight(
  line: InvoicePdfLine,
  regular: PDFFont,
  density: PdfDensity,
  conceptWidth: number
) {
  const concept = line.description.trim() || "Concepto";
  const conceptRows = wrap(regular, concept, density.conceptSize, conceptWidth);
  const detail = line.detail?.trim() || "";
  const detailRows = detail
    ? wrap(regular, detail, density.detailSize, conceptWidth)
    : [];

  return Math.max(
    density.minLineHeight,
    conceptRows.length * density.conceptLineHeight +
      (detailRows.length ? 3 + detailRows.length * density.detailLineHeight : 0) +
      density.lineGap
  );
}

function summaryMinimumY(data: InvoicePdfData, regular: PDFFont, density: PdfDensity) {
  const taxRows =
    groupTax(data.lines, "vat").length +
    groupTax(data.lines, "withholding").length;

  const totalDescent =
    density.summaryRowStart +
    taxRows * density.summaryRowStep +
    density.summarySeparatorGap +
    density.summaryTotalGap;

  const safeY = density.footerLineY + 18;
  if (!data.notes.trim()) return safeY + totalDescent;

  const noteRows = wrap(
    regular,
    data.notes,
    density.noteSize,
    RIGHT_X - LEFT
  ).length;

  return (
    safeY +
    totalDescent +
    density.notesGap +
    density.notesTextGap +
    Math.max(0, noteRows - 1) * density.noteLineHeight
  );
}

function estimateConceptEnd(
  data: InvoicePdfData,
  regular: PDFFont,
  density: PdfDensity,
  conceptWidth: number,
  startY: number
) {
  return data.lines.reduce(
    (y, line) => y - conceptBlockHeight(line, regular, density, conceptWidth),
    startY
  );
}

function drawSummaryAndFooter(
  page: PDFPage,
  y: number,
  data: InvoicePdfData,
  regular: PDFFont,
  bold: PDFFont,
  density: PdfDensity
) {
  const summary = totals(data.lines);
  const vatGroups = groupTax(data.lines, "vat");
  const withholdingGroups = groupTax(data.lines, "withholding");

  page.drawText("Base imponible", {
    x: LEFT + 18,
    y,
    size: density.baseSize,
    font: regular,
    color: MUTED
  });
  rightText(page, money(summary.base), y, regular, density.baseSize);

  let rowY = y - density.summaryRowStart;
  for (const [rate, amount] of vatGroups) {
    page.drawText(pdfText(`+   ${rate}% IVA`), {
      x: LEFT + 18,
      y: rowY,
      size: density.taxSize,
      font: bold,
      color: DARK
    });
    rightText(page, money(amount), rowY, regular, density.baseSize);
    rowY -= density.summaryRowStep;
  }

  for (const [rate, amount] of withholdingGroups) {
    page.drawText(pdfText(`-   ${rate}% IRPF`), {
      x: LEFT + 18,
      y: rowY,
      size: density.taxSize,
      font: bold,
      color: DARK
    });
    rightText(page, money(amount), rowY, regular, density.baseSize);
    rowY -= density.summaryRowStep;
  }

  const lineY = rowY - density.summarySeparatorGap;
  page.drawLine({
    start: { x: LEFT, y: lineY },
    end: { x: RIGHT_X, y: lineY },
    thickness: 0.65,
    color: LINE
  });

  const totalY = lineY - density.summaryTotalGap;
  page.drawText("TOTAL", {
    x: LEFT + 36,
    y: totalY,
    size: density.totalSize,
    font: bold,
    color: DARK
  });
  rightText(
    page,
    money(summary.base + summary.vat - summary.withholding),
    totalY,
    bold,
    density.totalSize
  );

  if (data.notes.trim()) {
    let notesY = totalY - density.notesGap;
    page.drawText("OBSERVACIONES", {
      x: LEFT,
      y: notesY,
      size: Math.max(7.7, density.noteSize - 2),
      font: bold,
      color: MUTED
    });
    notesY -= density.notesTextGap;
    drawWrapped(
      page,
      data.notes,
      LEFT,
      notesY,
      regular,
      density.noteSize,
      RIGHT_X - LEFT,
      density.noteLineHeight
    );
  }

  page.drawLine({
    start: { x: LEFT, y: density.footerLineY },
    end: { x: RIGHT_X, y: density.footerLineY },
    thickness: 0.45,
    color: rgb(0.82, 0.84, 0.87)
  });

  page.drawText(pdfText(`Pago: ${data.paymentMethod}`), {
    x: LEFT,
    y: density.footerLineY - 27,
    size: density.paymentSize,
    font: bold,
    color: DARK
  });

  if (data.issuer.iban) {
    rightText(
      page,
      `IBAN: ${data.issuer.iban}`,
      density.footerLineY - 27,
      bold,
      density.paymentSize
    );
  }
}

export async function buildInvoicePdf(data: InvoicePdfData) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setProducer("Facturas");
  pdfDoc.setCreator("Facturas");

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const amountColumnWidth = 100;
  const conceptWidth = RIGHT_X - LEFT - amountColumnWidth - 16;
  const firstConceptY = 471;

  const normalEnd = estimateConceptEnd(data, regular, NORMAL, conceptWidth, firstConceptY);
  const normalMinimumSummaryY = summaryMinimumY(data, regular, NORMAL);
  const normalFits =
    normalEnd - NORMAL.summaryGap >= normalMinimumSummaryY;

  const compactEnd = estimateConceptEnd(data, regular, COMPACT, conceptWidth, firstConceptY);
  const compactMinimumSummaryY = summaryMinimumY(data, regular, COMPACT);
  const compactFits =
    compactEnd - COMPACT.summaryGap >= compactMinimumSummaryY;

  const density = normalFits ? NORMAL : COMPACT;
  const fitsSinglePage = normalFits || compactFits;
  const minimumSummaryY = normalFits
    ? normalMinimumSummaryY
    : compactMinimumSummaryY;

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let conceptY = drawHeader(page, data, regular, bold);

  for (const line of data.lines) {
    const requiredHeight = conceptBlockHeight(line, regular, density, conceptWidth);

    if (!fitsSinglePage && conceptY - requiredHeight < 112) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      conceptY = drawContinuationHeader(page, data.number, bold);
    }

    const concept = line.description.trim() || "Concepto";
    const conceptRows = wrap(regular, concept, density.conceptSize, conceptWidth);

    conceptRows.forEach((row, rowIndex) => {
      page.drawText(row, {
        x: LEFT,
        y: conceptY - rowIndex * density.conceptLineHeight,
        size: density.conceptSize,
        font: regular,
        color: DARK
      });
    });

    rightText(page, money(lineBase(line)), conceptY, bold, density.conceptSize);

    const detail = line.detail?.trim() || "";
    if (detail) {
      const detailY =
        conceptY -
        conceptRows.length * density.conceptLineHeight -
        1;
      const detailRows = wrap(regular, detail, density.detailSize, conceptWidth);
      detailRows.forEach((row, rowIndex) => {
        page.drawText(row, {
          x: LEFT,
          y: detailY - rowIndex * density.detailLineHeight,
          size: density.detailSize,
          font: regular,
          color: MUTED
        });
      });
    }

    conceptY -= requiredHeight;
  }

  const summaryCanStay =
    conceptY - density.summaryGap >= minimumSummaryY;

  if (!summaryCanStay) {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    rightText(page, `FACTURA ${data.number}`, PAGE_HEIGHT - 70, bold, 10.5);
    page.drawText("RESUMEN", {
      x: LEFT,
      y: PAGE_HEIGHT - 118,
      size: 10.5,
      font: bold,
      color: DARK
    });
    page.drawLine({
      start: { x: LEFT, y: PAGE_HEIGHT - 136 },
      end: { x: RIGHT_X, y: PAGE_HEIGHT - 136 },
      thickness: 0.65,
      color: LINE
    });
    drawSummaryAndFooter(
      page,
      PAGE_HEIGHT - 185,
      data,
      regular,
      bold,
      density
    );
  } else {
    const preferredSummaryY = density === NORMAL ? 390 : 355;
    const summaryY = Math.min(
      preferredSummaryY,
      conceptY - density.summaryGap
    );
    drawSummaryAndFooter(
      page,
      summaryY,
      data,
      regular,
      bold,
      density
    );
  }

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
  const pdfBuffer = new Uint8Array(bytes).buffer;
  const blob = new Blob([pdfBuffer], { type: "application/pdf" });
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
