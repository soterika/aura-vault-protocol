/** Parse a one-column CSV of Stellar wallet addresses, including quoted rows. */
export function parseAddressCsv(input: string): string[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (char === "\n" || char === "\r" || char === ",")) {
      row.push(field.trim());
      field = "";
      if (char === "\n" || char === "\r") {
        rows.push(row);
        row = [];
        if (char === "\r" && input[i + 1] === "\n") i += 1;
      }
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  row.push(field.trim());
  rows.push(row);

  const addresses = rows
    .map((cells) => cells[0] ?? "")
    .filter(Boolean)
    .filter((value) => !/^address(es)?$/i.test(value));
  if (addresses.length > 100) throw new Error("Import up to 100 addresses at a time.");
  return [...new Set(addresses)];
}
