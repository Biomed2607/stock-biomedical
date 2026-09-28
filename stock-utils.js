export function describeAlertError(message = '') {
  const text = String(message || 'Le service d’envoi n’a pas répondu.');
  if (/only send testing emails|resend\.dev/i.test(text)) return 'Resend est en mode test : un domaine expéditeur vérifié est nécessaire pour envoyer vers la boîte du pôle. Configurer ALERT_FROM_EMAIL dans Appwrite. ' + text;
  if (/RESEND_API_KEY/i.test(text)) return 'La clé d’envoi manque dans la configuration Appwrite (RESEND_API_KEY).';
  if (/not authorized|unauthorized|missing scope|permission|not permitted/i.test(text)) return 'Accès à la fonction d’alerte refusé. Vérifier les permissions Appwrite. ' + text;
  return text;
}

export function inspectAlertExecution(execution = {}) {
  const executionId = execution.$id || '';
  let body;
  try { body = JSON.parse(execution.responseBody || '{}'); } catch (_) { body = {}; }
  const code = Number(execution.responseStatusCode || 0);
  const detail = body?.error?.message || body?.message;
  if (execution.status === 'completed' && code >= 200 && code < 300 && body.ok === true && body.id) {
    return { state: 'accepted', id: body.id, executionId };
  }
  if (execution.status === 'failed' || code >= 400 || body.ok === false) {
    return { state: 'failed', executionId, message: describeAlertError(detail || `Échec de la fonction Appwrite (${execution.status || 'inconnu'}, HTTP ${code}). Consulter son journal d’exécution.`) };
  }
  return { state: 'unconfirmed', executionId, message: describeAlertError(detail || `Exécution ${execution.status || 'sans statut'}, sans confirmation du fournisseur email. Vérifiez le journal avant de relancer.`) };
}

export function findMatchingItems(items, value) {
  const code = String(value || '').trim().toLowerCase();
  if (!code) return [];
  if (code.startsWith('bioid:')) return items.filter(item => `bioid:${item.$id}`.toLowerCase() === code);
  // Never silently choose the first result when legacy labels or supplier references are duplicated.
  return items.filter(item => [item.barcodeValue, item.internalCode, item.itemCode]
    .some(value => String(value || '').trim().toLowerCase() === code));
}
