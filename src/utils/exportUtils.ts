import { format } from 'date-fns';

export const exportToCSV = (data: Record<string, any>[], filename: string) => {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const val = row[h];
      const str = val === null || val === undefined ? '' : String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(','))
  ];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  downloadBlob(blob, `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`);
};

export const exportToPDF = (title: string, data: Record<string, any>[], columns: string[]) => {
  const html = `
    <!DOCTYPE html><html><head><title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
      h1 { color: #0070ba; font-size: 24px; margin-bottom: 8px; }
      .date { color: #666; margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th { background: #0070ba; color: white; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; }
      td { padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
      tr:nth-child(even) { background: #f9f9f9; }
      .footer { margin-top: 32px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 16px; }
      .summary { margin: 16px 0; padding: 12px; background: #f0f7ff; border-radius: 6px; }
    </style></head><body>
    <h1>${title}</h1>
    <div class="date">Generated: ${format(new Date(), 'MMMM d, yyyy HH:mm')}</div>
    <div class="summary"><strong>Total Records:</strong> ${data.length}</div>
    <table><thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${data.map(row => `<tr>${columns.map(c => `<td>${row[c] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <div class="footer">BMaGlassPay Statement — Confidential</div>
    </body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (w) setTimeout(() => { w.print(); URL.revokeObjectURL(url); }, 500);
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
