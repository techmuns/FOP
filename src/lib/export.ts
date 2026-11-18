export type Row = Record<string, string | number | null>;

/**
 * Write rows to a client-side .xlsx download. SheetJS is heavy, so it's loaded on demand
 * (first Export click) to keep the initial bundle small. Column order = key order of the first row.
 */
export async function downloadXlsx(rows: Row[], filename: string, opts?: { sheetName?: string; colWidths?: number[] }) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  if (opts?.colWidths) ws['!cols'] = opts.colWidths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts?.sheetName ?? 'Sheet1');
  XLSX.writeFile(wb, filename);
}

export const stamp = () => new Date().toISOString().slice(0, 10);
