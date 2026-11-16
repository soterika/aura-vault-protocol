export interface PdfTransaction {
  hash: string;
  date: string;
  type: "deposit" | "withdraw" | "harvest";
  amount: string;
  status: "confirmed" | "pending" | "failed";
}

function pdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function displayAmount(amount: string): string {
  if (!/^\d+$/.test(amount)) return amount;
  const raw = BigInt(amount);
  const whole = raw / 10_000_000n;
  const fraction = (raw % 10_000_000n).toString().padStart(7, "0");
  return `${whole}.${fraction}`;
}

/** Create a compact, multi-page PDF using built-in Helvetica (no server or fonts). */
export function downloadTransactionPdf(args: {
  transactions: PdfTransaction[];
  address: string;
  dateRange: string;
  generatedAt?: Date;
}): void {
  const generatedAt = args.generatedAt ?? new Date();
  const deposits = args.transactions.filter((tx) => tx.type === "deposit").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const withdrawals = args.transactions.filter((tx) => tx.type === "withdraw").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const yieldEarned = args.transactions.filter((tx) => tx.type === "harvest").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const rowsPerPage = 34;
  const pages = Math.max(1, Math.ceil(args.transactions.length / rowsPerPage));
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const kids: string[] = [];

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const pageNumber = pageIndex + 1;
    const pageObject = objects.length + 1;
    const contentObject = pageObject + 1;
    kids.push(`${pageObject} 0 R`);
    const lines = [
      ["Aura Vault Protocol — Transaction History", 18, 748],
      [`Wallet: ${args.address || "Not connected"}`, 10, 724],
      [`Date range: ${args.dateRange || "All dates"}`, 10, 708],
      [`Generated: ${generatedAt.toLocaleString()}`, 10, 692],
      [`Deposited: ${deposits.toFixed(7)}    Withdrawn: ${withdrawals.toFixed(7)}    Net yield: ${yieldEarned.toFixed(7)}`, 10, 668],
      ["Date                         Type       Amount          Status       Transaction hash", 9, 642],
    ] as Array<[string, number, number]>;
    const pageRows = args.transactions.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    pageRows.forEach((tx, index) => {
      const parsedDate = new Date(tx.date);
      const date = Number.isNaN(parsedDate.getTime()) ? tx.date.slice(0, 19) : parsedDate.toISOString().replace("T", " ").slice(0, 19);
      const hash = tx.hash.length > 20 ? `${tx.hash.slice(0, 10)}...${tx.hash.slice(-7)}` : tx.hash;
      lines.push([`${date.padEnd(21)} ${tx.type.padEnd(10)} ${displayAmount(tx.amount).padStart(14)} ${tx.status.padEnd(12)} ${hash}`, 8, 622 - index * 15]);
    });
    lines.push([`Page ${pageNumber} of ${pages}`, 9, 36]);
    const stream = lines.map(([text, size, y]) => `BT /F1 ${size} Tf 1 0 0 1 40 ${y} Tm (${pdfText(text)}) Tj ET`).join("\n");
    const streamBytes = new TextEncoder().encode(stream).length;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
      `<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;

  let document = "%PDF-1.4\n% Aura Vault transaction report\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(document).length);
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(document).length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const blob = new Blob([document], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `aura-history-${args.address || "wallet"}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
