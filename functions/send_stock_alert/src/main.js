export default async ({ req, res, log, error }) => {
  try {
    log('Function send_stock_alert démarrée avec Resend API');

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.ALERT_FROM_EMAIL || 'onboarding@resend.dev';
    const defaultToEmail = process.env.ALERT_TO_EMAIL || 'alpha.balde@ramsaysante.fr';

    if (!resendApiKey) {
      return res.json({
        ok: false,
        message: 'RESEND_API_KEY manquante.'
      }, 500);
    }

    let payload = {};

    if (typeof req.body === 'string') {
      payload = JSON.parse(req.body || '{}');
    } else if (typeof req.body === 'object' && req.body !== null) {
      payload = req.body;
    } else {
      payload = {};
    }

    log(`Payload reçu : ${JSON.stringify(payload)}`);

    const to = payload.to || defaultToEmail;
    const status = payload.status || 'Alerte stock';
    const movementType = payload.movementType || 'MOUVEMENT';
    const item = payload.item || {};

    if (!item.itemCode || !item.itemName) {
      return res.json({
        ok: false,
        message: 'Payload incomplet : itemCode et itemName sont obligatoires.',
        received: payload
      }, 400);
    }

    const subject = `[Stock biomédical] ${status} — ${item.itemCode}`;

    const html = `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
        <h2 style="color:#0f766e;">Alerte stock biomédical</h2>

        <p>Une alerte de stock a été détectée.</p>

        <p><strong>Statut :</strong> ${status}</p>
        <p><strong>Type de mouvement :</strong> ${movementType}</p>

        <h3>Consommable</h3>
        <ul>
          <li><strong>Référence :</strong> ${item.itemCode}</li>
          <li><strong>Désignation :</strong> ${item.itemName}</li>
          <li><strong>Famille :</strong> ${item.equipmentFamily || '-'}</li>
          <li><strong>Type :</strong> ${item.consumableType || '-'}</li>
          <li><strong>Catégorie :</strong> ${item.category || '-'}</li>
          <li><strong>Emplacement :</strong> ${item.storageLocation || '-'}</li>
          <li><strong>QR code :</strong> ${item.barcodeValue || '-'}</li>
        </ul>

        <h3>Stock</h3>
        <ul>
          <li><strong>Ancienne quantité :</strong> ${item.oldQuantity ?? '-'}</li>
          <li><strong>Nouvelle quantité :</strong> ${item.newQuantity ?? '-'}</li>
          <li><strong>Quantité actuelle :</strong> ${item.stockQuantity ?? '-'}</li>
          <li><strong>Seuil d’alerte :</strong> ${item.alertThreshold ?? '-'}</li>
        </ul>

        <h3>Fournisseur</h3>
        <ul>
          <li><strong>Nom :</strong> ${item.supplierName || '-'}</li>
          <li><strong>Email :</strong> ${item.supplierEmail || '-'}</li>
        </ul>

        <p>Merci de vérifier le besoin de réapprovisionnement ou de demande de devis.</p>

        <p style="color:#64748b;">Application Stock Biomédical</p>
      </div>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `Stock Biomédical <${fromEmail}>`,
        to: [to],
        subject,
        html
      })
    });

    const result = await response.json();

    if (!response.ok) {
      error(`Erreur Resend : ${JSON.stringify(result)}`);

      return res.json({
        ok: false,
        message: 'Erreur Resend.',
        error: result
      }, 500);
    }

    log(`Email Resend envoyé : ${result.id}`);

    return res.json({
      ok: true,
      message: 'Alerte email envoyée avec Resend.',
      id: result.id
    });

  } catch (err) {
    error(`Erreur Function : ${err.message}`);

    return res.json({
      ok: false,
      message: err.message
    }, 500);
  }
};
