/**
 * Sales challan -> PDF.
 *
 * Rendered server-side so the document is the same for everyone: the same
 * layout, the same rounding, and the same frozen line-item snapshot the API
 * already returns. A client-side renderer would put the definition of the
 * document somewhere other than the data that produces it.
 *
 * The whole file is built in memory and returned as one Buffer rather than
 * piped straight to the response. A challan is a few kilobytes, so the memory
 * is irrelevant, and the alternative is worse: once bytes are streamed the
 * status line is already sent, so a failure halfway through renders as a 200
 * with a truncated, unopenable PDF. Buffering keeps a render error a 500.
 *
 * Everything written here is ASCII. PDFKit's built-in fonts use WinAnsi
 * encoding, which has no rupee sign, so amounts are labelled "INR" rather than
 * carrying a glyph that would silently render as garbage.
 */
import PDFDocument from 'pdfkit';
import type { Challan, ChallanItem } from '../repositories/challan.repository';

/** A4 in points, with a margin wide enough to survive a printer's dead zone. */
const MARGIN = 50;
const PAGE_WIDTH = 595.28;
const PAGE_BOTTOM = 792 - MARGIN;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;

/** Column x-offsets for the line-item table. Numeric columns are right-aligned. */
const COL = {
  index: { x: MARGIN, width: 24 },
  sku: { x: MARGIN + 26, width: 92 },
  product: { x: MARGIN + 120, width: 176 },
  quantity: { x: MARGIN + 298, width: 46 },
  unitPrice: { x: MARGIN + 346, width: 74 },
  amount: { x: MARGIN + 422, width: 73 },
} as const;

const DECIMAL = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** The API returns money as a decimal string; it must not go through a float on the way here. */
function money(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `INR ${DECIMAL.format(amount)}` : `INR ${value}`;
}

/**
 * Instants are rendered in UTC and say so.
 *
 * A document produced on a server has no viewer whose timezone it could use,
 * and a printed timestamp that silently means "wherever the server happened to
 * be" is worse than one that names its zone.
 */
function instant(value: string | null): string {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return `${date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`;
}

/** The filename a browser will save. Challan numbers are already CH-YYYY-NNNNNN. */
export function pdfFilename(challan: Challan): string {
  return `${challan.challanNumber}.pdf`;
}

function horizontalRule(doc: PDFKit.PDFDocument, y: number): void {
  doc.moveTo(MARGIN, y).lineTo(CONTENT_RIGHT, y).lineWidth(0.5).strokeColor('#999999').stroke();
}

function drawHeader(doc: PDFKit.PDFDocument, challan: Challan): void {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#000000');
  doc.text('SALES CHALLAN', MARGIN, MARGIN);

  doc.font('Helvetica').fontSize(9).fillColor('#555555');
  doc.text('Mini ERP + CRM - Operations Portal', MARGIN, MARGIN + 24);

  doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000');
  doc.text(challan.challanNumber, MARGIN, MARGIN, { width: CONTENT_RIGHT - MARGIN, align: 'right' });

  doc.font('Helvetica-Bold').fontSize(10).fillColor(statusColour(challan.status));
  doc.text(challan.status, MARGIN, MARGIN + 20, {
    width: CONTENT_RIGHT - MARGIN,
    align: 'right',
  });

  horizontalRule(doc, MARGIN + 44);
}

function statusColour(status: Challan['status']): string {
  if (status === 'CONFIRMED') return '#177245';
  if (status === 'CANCELLED') return '#B00020';
  return '#8A6100';
}

/**
 * A draft has not dispatched anything and a cancelled challan never did, so
 * neither is evidence of a delivery. Saying so on the document matters more
 * than it looks: a PDF outlives the screen it was downloaded from, and a
 * printed draft is otherwise indistinguishable from a real one.
 */
function drawStatusNotice(doc: PDFKit.PDFDocument, challan: Challan, y: number): number {
  if (challan.status === 'CONFIRMED') return y;

  const message =
    challan.status === 'DRAFT'
      ? 'DRAFT - not confirmed. No goods have been dispatched and no stock has been deducted.'
      : 'CANCELLED - this challan was cancelled and does not represent a delivery.';

  doc.rect(MARGIN, y, CONTENT_RIGHT - MARGIN, 22).fillColor('#F4F0E6').fill();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(statusColour(challan.status));
  doc.text(message, MARGIN + 8, y + 7, { width: CONTENT_RIGHT - MARGIN - 16 });

  return y + 34;
}

function drawParties(doc: PDFKit.PDFDocument, challan: Challan, startY: number): number {
  const columnWidth = (CONTENT_RIGHT - MARGIN) / 2 - 10;
  const rightX = MARGIN + columnWidth + 20;

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#555555');
  doc.text('BILL TO', MARGIN, startY);
  doc.text('DOCUMENT', rightX, startY);

  let leftY = startY + 14;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000');
  doc.text(challan.customer.businessName, MARGIN, leftY, { width: columnWidth });
  leftY = doc.y + 2;

  doc.font('Helvetica').fontSize(9).fillColor('#333333');
  doc.text(`Contact: ${challan.customer.name}`, MARGIN, leftY, { width: columnWidth });
  doc.text(`Mobile: ${challan.customer.mobile}`, { width: columnWidth });
  if (challan.customer.gstNumber) {
    doc.text(`GSTIN: ${challan.customer.gstNumber}`, { width: columnWidth });
  }
  const leftBottom = doc.y;

  doc.font('Helvetica').fontSize(9).fillColor('#333333');
  doc.text(`Raised: ${instant(challan.createdAt)}`, rightX, startY + 14, { width: columnWidth });
  if (challan.createdBy) doc.text(`By: ${challan.createdBy.name}`, { width: columnWidth });
  if (challan.confirmedAt) {
    doc.text(`Confirmed: ${instant(challan.confirmedAt)}`, { width: columnWidth });
    if (challan.confirmedBy) {
      doc.text(`By: ${challan.confirmedBy.name}`, { width: columnWidth });
    }
  }
  if (challan.cancelledAt) {
    doc.text(`Cancelled: ${instant(challan.cancelledAt)}`, { width: columnWidth });
    if (challan.cancelledBy) {
      doc.text(`By: ${challan.cancelledBy.name}`, { width: columnWidth });
    }
  }

  return Math.max(leftBottom, doc.y) + 20;
}

function drawTableHead(doc: PDFKit.PDFDocument, y: number): number {
  doc.rect(MARGIN, y, CONTENT_RIGHT - MARGIN, 18).fillColor('#EFEFEF').fill();

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#333333');
  doc.text('#', COL.index.x + 4, y + 6, { width: COL.index.width });
  doc.text('SKU', COL.sku.x, y + 6, { width: COL.sku.width });
  doc.text('PRODUCT', COL.product.x, y + 6, { width: COL.product.width });
  doc.text('QTY', COL.quantity.x, y + 6, { width: COL.quantity.width, align: 'right' });
  doc.text('UNIT PRICE', COL.unitPrice.x, y + 6, { width: COL.unitPrice.width, align: 'right' });
  doc.text('AMOUNT', COL.amount.x, y + 6, { width: COL.amount.width, align: 'right' });

  return y + 24;
}

function drawItemRow(
  doc: PDFKit.PDFDocument,
  item: ChallanItem,
  position: number,
  y: number,
): number {
  doc.font('Helvetica').fontSize(9).fillColor('#000000');

  // Written before the others so doc.y reflects a product name that wrapped
  // onto a second line, which is what sets the row height.
  doc.text(item.productName, COL.product.x, y, { width: COL.product.width });
  const rowBottom = doc.y;

  doc.text(String(position), COL.index.x + 4, y, { width: COL.index.width });
  doc.font('Helvetica').fontSize(8).fillColor('#555555');
  doc.text(item.productSku, COL.sku.x, y + 1, { width: COL.sku.width });

  doc.font('Helvetica').fontSize(9).fillColor('#000000');
  doc.text(String(item.quantity), COL.quantity.x, y, {
    width: COL.quantity.width,
    align: 'right',
  });
  doc.text(money(item.unitPrice), COL.unitPrice.x, y, {
    width: COL.unitPrice.width,
    align: 'right',
  });
  doc.text(money(item.lineTotal), COL.amount.x, y, { width: COL.amount.width, align: 'right' });

  return rowBottom + 8;
}

function drawTotals(doc: PDFKit.PDFDocument, challan: Challan, startY: number): number {
  let y = startY;
  horizontalRule(doc, y);
  y += 10;

  doc.font('Helvetica').fontSize(9).fillColor('#333333');
  doc.text('Total quantity', COL.unitPrice.x - 120, y, { width: 190, align: 'right' });
  doc.text(String(challan.totalQuantity), COL.amount.x, y, {
    width: COL.amount.width,
    align: 'right',
  });
  y += 16;

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000');
  doc.text('Total amount', COL.unitPrice.x - 120, y, { width: 190, align: 'right' });
  doc.text(money(challan.totalAmount), COL.amount.x, y, {
    width: COL.amount.width,
    align: 'right',
  });

  return y + 26;
}

/**
 * Builds the document.
 *
 * Rows are laid out by hand rather than with a table helper because the height
 * of a row depends on whether the product name wrapped, and the page break has
 * to repeat the header row - neither of which a fixed-height loop gets right.
 */
export function renderChallanPdf(challan: Challan): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      info: {
        Title: `Sales Challan ${challan.challanNumber}`,
        Author: 'Mini ERP + CRM',
        Subject: `Sales challan for ${challan.customer.businessName}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawHeader(doc, challan);

      let y = drawStatusNotice(doc, challan, MARGIN + 58);
      y = drawParties(doc, challan, y);
      y = drawTableHead(doc, y);

      challan.items.forEach((item, index) => {
        // Leave room for the row itself; the totals block gets its own check.
        if (y > PAGE_BOTTOM - 60) {
          doc.addPage();
          y = drawTableHead(doc, MARGIN);
        }
        y = drawItemRow(doc, item, index + 1, y);
      });

      if (y > PAGE_BOTTOM - 90) {
        doc.addPage();
        y = MARGIN;
      }
      y = drawTotals(doc, challan, y);

      if (challan.notes) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#555555');
        doc.text('NOTES', MARGIN, y);
        doc.font('Helvetica').fontSize(9).fillColor('#333333');
        doc.text(challan.notes, MARGIN, y + 13, { width: CONTENT_RIGHT - MARGIN });
        y = doc.y + 16;
      }

      doc.font('Helvetica').fontSize(7.5).fillColor('#777777');
      doc.text(
        `Generated ${instant(new Date().toISOString())}. Line items are the values recorded at the time of sale.`,
        MARGIN,
        Math.min(y, PAGE_BOTTOM - 12),
        { width: CONTENT_RIGHT - MARGIN },
      );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
