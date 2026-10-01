// Workspace QA · bagian 4 · pembantu XML bersama penulis XLSX/DOCX.
export const xmlEsc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// XML 1.0 melarang kontrol selain \t \n \r — satu saja membuat Word/Excel menolak seluruh berkas.
export const xmlClean = (s: string): string => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
