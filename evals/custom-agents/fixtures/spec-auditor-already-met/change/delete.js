export function deleteDocument(id) { removeDocument(id); emitAudit("document.deleted"); }
