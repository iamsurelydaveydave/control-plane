import PDFDocument from "pdfkit";
import { TAuditLog } from "../resources/audit-log/audit.log.model";

// =============================================================================
// Types
// =============================================================================

export type TPDFTableColumn = {
  key: string;
  label: string;
  width?: number;
};

export type TPDFTableOptions = {
  title: string;
  columns: TPDFTableColumn[];
  rows: Record<string, any>[];
  footer?: string;
};

export type TAuditLogPDFOptions = {
  title?: string;
  dateRange?: { from: Date; to: Date };
  filters?: Record<string, string>;
};

// =============================================================================
// Constants
// =============================================================================

const COLORS = {
  primary: "#1a1a2e",
  secondary: "#16213e",
  accent: "#0f3460",
  text: "#333333",
  lightGray: "#f5f5f5",
  mediumGray: "#cccccc",
  darkGray: "#666666",
  white: "#ffffff",
  success: "#22c55e",
  error: "#ef4444",
};

const FONTS = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
};

const PAGE = {
  margin: 50,
  width: 612, // Letter size
  height: 792,
  contentWidth: 512, // 612 - 50 - 50
};

const ROWS_PER_PAGE = 30;

// =============================================================================
// Service
// =============================================================================

export function usePDFService() {
  /**
   * Generate an audit log PDF report
   */
  async function generateAuditLogPDF(
    logs: TAuditLog[],
    options?: TAuditLogPDFOptions
  ): Promise<Buffer> {
    const title = options?.title || "Control Plane - Audit Log Report";

    // Define columns for audit log table
    const columns: TPDFTableColumn[] = [
      { key: "timestamp", label: "Timestamp", width: 90 },
      { key: "user", label: "User", width: 90 },
      { key: "action", label: "Action", width: 60 },
      { key: "resource", label: "Resource", width: 65 },
      { key: "details", label: "Details", width: 120 },
      { key: "ip", label: "IP Address", width: 85 },
    ];

    // Transform logs into row data
    const rows = logs.map((log) => ({
      timestamp: formatTimestamp(log.createdAt),
      user: log.userEmail || "System",
      action: log.action,
      resource: `${log.resource}${log.resourceId ? `\n(${truncate(log.resourceId, 20)})` : ""}`,
      details: formatDetails(log),
      ip: log.ip || "-",
      success: log.success,
    }));

    return generateTablePDF({
      title,
      columns,
      rows,
      footer: options?.dateRange
        ? `Report Period: ${formatDate(options.dateRange.from)} - ${formatDate(options.dateRange.to)}`
        : undefined,
    });
  }

  /**
   * Generate a generic table PDF
   */
  async function generateTablePDF(options: TPDFTableOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "LETTER",
          margin: PAGE.margin,
          bufferPages: true,
        });

        const chunks: Buffer[] = [];
        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        let currentPage = 1;
        let yPosition = PAGE.margin;

        // Draw header on first page
        yPosition = drawHeader(doc, options.title, yPosition);

        // Calculate column widths
        const totalSpecifiedWidth = options.columns.reduce(
          (sum, col) => sum + (col.width || 0),
          0
        );
        const unspecifiedCols = options.columns.filter((col) => !col.width).length;
        const remainingWidth = PAGE.contentWidth - totalSpecifiedWidth;
        const defaultColWidth =
          unspecifiedCols > 0 ? remainingWidth / unspecifiedCols : 80;

        const columnWidths = options.columns.map(
          (col) => col.width || defaultColWidth
        );

        // Draw table header
        yPosition = drawTableHeader(doc, options.columns, columnWidths, yPosition);

        // Draw rows with pagination
        for (let i = 0; i < options.rows.length; i++) {
          const row = options.rows[i];

          // Check if we need a new page
          const rowHeight = calculateRowHeight(doc, row, options.columns, columnWidths);
          if (yPosition + rowHeight > PAGE.height - PAGE.margin - 40) {
            // Add page number to current page
            drawPageNumber(doc, currentPage, getTotalPages(options.rows.length));

            // Start new page
            doc.addPage();
            currentPage++;
            yPosition = PAGE.margin;

            // Draw header on new page
            yPosition = drawHeader(doc, options.title, yPosition, true);
            yPosition = drawTableHeader(doc, options.columns, columnWidths, yPosition);
          }

          // Draw row
          yPosition = drawTableRow(
            doc,
            row,
            options.columns,
            columnWidths,
            yPosition,
            i % 2 === 0
          );
        }

        // Draw footer on last page
        if (options.footer) {
          drawFooter(doc, options.footer);
        }

        // Add page number to last page
        drawPageNumber(doc, currentPage, getTotalPages(options.rows.length));

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  return {
    generateAuditLogPDF,
    generateTablePDF,
  };
}

// =============================================================================
// Drawing Helpers
// =============================================================================

function drawHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  yPosition: number,
  isContinuation = false
): number {
  const headerHeight = isContinuation ? 40 : 70;

  // Header background
  doc
    .rect(PAGE.margin, yPosition, PAGE.contentWidth, headerHeight)
    .fill(COLORS.primary);

  // Title
  doc
    .font(FONTS.bold)
    .fontSize(isContinuation ? 14 : 18)
    .fillColor(COLORS.white)
    .text(title, PAGE.margin + 15, yPosition + (isContinuation ? 12 : 15), {
      width: PAGE.contentWidth - 30,
    });

  // Subtitle with generation timestamp (only on first page)
  if (!isContinuation) {
    doc
      .font(FONTS.regular)
      .fontSize(10)
      .fillColor(COLORS.mediumGray)
      .text(
        `Generated: ${new Date().toLocaleString()}`,
        PAGE.margin + 15,
        yPosition + 40,
        { width: PAGE.contentWidth - 30 }
      );
  }

  return yPosition + headerHeight + 15;
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  columns: TPDFTableColumn[],
  columnWidths: number[],
  yPosition: number
): number {
  const headerHeight = 25;

  // Header background
  doc
    .rect(PAGE.margin, yPosition, PAGE.contentWidth, headerHeight)
    .fill(COLORS.accent);

  // Column headers
  let xPosition = PAGE.margin;
  doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.white);

  columns.forEach((col, index) => {
    doc.text(col.label, xPosition + 5, yPosition + 8, {
      width: columnWidths[index] - 10,
      align: "left",
    });
    xPosition += columnWidths[index];
  });

  return yPosition + headerHeight;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  row: Record<string, any>,
  columns: TPDFTableColumn[],
  columnWidths: number[],
  yPosition: number,
  isEvenRow: boolean
): number {
  const rowHeight = calculateRowHeight(doc, row, columns, columnWidths);

  // Row background (alternating)
  if (isEvenRow) {
    doc
      .rect(PAGE.margin, yPosition, PAGE.contentWidth, rowHeight)
      .fill(COLORS.lightGray);
  }

  // Cell borders
  doc
    .rect(PAGE.margin, yPosition, PAGE.contentWidth, rowHeight)
    .stroke(COLORS.mediumGray);

  // Cell content
  let xPosition = PAGE.margin;
  doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);

  columns.forEach((col, index) => {
    let value = row[col.key];

    // Handle special formatting
    if (col.key === "action" && row.success !== undefined) {
      // Color-code the action based on success status
      doc.fillColor(row.success ? COLORS.text : COLORS.error);
    }

    if (value === undefined || value === null) {
      value = "-";
    } else if (typeof value === "object") {
      value = JSON.stringify(value);
    }

    doc.text(String(value), xPosition + 5, yPosition + 6, {
      width: columnWidths[index] - 10,
      height: rowHeight - 12,
      align: "left",
      lineBreak: true,
    });

    // Reset color
    doc.fillColor(COLORS.text);

    // Draw vertical cell separator
    if (index < columns.length - 1) {
      doc
        .moveTo(xPosition + columnWidths[index], yPosition)
        .lineTo(xPosition + columnWidths[index], yPosition + rowHeight)
        .stroke(COLORS.mediumGray);
    }

    xPosition += columnWidths[index];
  });

  return yPosition + rowHeight;
}

function calculateRowHeight(
  doc: PDFKit.PDFDocument,
  row: Record<string, any>,
  columns: TPDFTableColumn[],
  columnWidths: number[]
): number {
  let maxHeight = 20; // Minimum row height

  doc.font(FONTS.regular).fontSize(8);

  columns.forEach((col, index) => {
    let value = row[col.key];
    if (value === undefined || value === null) {
      value = "-";
    } else if (typeof value === "object") {
      value = JSON.stringify(value);
    }

    const textHeight = doc.heightOfString(String(value), {
      width: columnWidths[index] - 10,
    });

    maxHeight = Math.max(maxHeight, textHeight + 12);
  });

  return Math.min(maxHeight, 60); // Cap max height
}

function drawPageNumber(
  doc: PDFKit.PDFDocument,
  currentPage: number,
  totalPages: number
): void {
  doc
    .font(FONTS.regular)
    .fontSize(9)
    .fillColor(COLORS.darkGray)
    .text(
      `Page ${currentPage} of ${totalPages}`,
      PAGE.margin,
      PAGE.height - 30,
      {
        width: PAGE.contentWidth,
        align: "center",
      }
    );
}

function drawFooter(doc: PDFKit.PDFDocument, footer: string): void {
  doc
    .font(FONTS.regular)
    .fontSize(9)
    .fillColor(COLORS.darkGray)
    .text(footer, PAGE.margin, PAGE.height - 50, {
      width: PAGE.contentWidth,
      align: "center",
    });
}

function getTotalPages(rowCount: number): number {
  return Math.max(1, Math.ceil(rowCount / ROWS_PER_PAGE));
}

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatTimestamp(date: Date): string {
  return date.toISOString().replace("T", "\n").slice(0, 19);
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatDetails(log: TAuditLog): string {
  const parts: string[] = [];

  if (log.resourceName) {
    parts.push(log.resourceName);
  }

  if (!log.success && log.errorMessage) {
    parts.push(`Error: ${truncate(log.errorMessage, 40)}`);
  }

  if (log.details) {
    const detailsStr = Object.entries(log.details)
      .filter(([key]) => !["method", "path", "statusCode"].includes(key))
      .map(([key, value]) => `${key}: ${truncate(String(value), 20)}`)
      .slice(0, 2)
      .join(", ");

    if (detailsStr) {
      parts.push(detailsStr);
    }
  }

  return parts.join("\n") || "-";
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}
