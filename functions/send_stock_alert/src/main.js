import { Resend } from 'resend';

export default async ({ req, res, log, error }) => {
  try {
    log('Function send_stock_alert démarrée avec Resend');

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.ALERT_FROM_EMAIL || 'onboarding@resend.dev';
    const defaultToEmail = process.env.ALERT_TO_EMAIL || 'alpha.balde@ramsaysante.fr';

    if (!resendApiKey) {
      return res.json({
        ok: false,
        message: 'RESEND_API_KEY manquante.'
      }, 500);
    }

    const payload = JSON.parse(req.body || '{}');

    const to = payload.to || defaultToEmail;
    const status = payload.status || 'Alerte stock';
    const movementType = payload.movementType || 'MOUVEMENT';
    const item = payload.item || {};

    if (!item.itemCode || !item.itemName) {
      return res.json({
        ok: false,
        message: 'Payload incomplet : itemCode et itemName sont obligatoires.'
      }, 400);
    }

    const resend = new Resend(resendApiKey);

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
          <li><strong>Ancienne quantité :</strong> ${item.oldQuantity}</li>
          <li><strong>Nouvelle quantité :</strong> ${item.newQuantity}</li>
          <li><strong>Quantité actuelle :</strong> ${item.stockQuantity}</li>
          <li><strong>Seuil d’alerte :</strong> ${item.alertThreshold}</li>
        </ul>

        <h3>Fournisseur</h3>
        <ul>
          <li><strong>Nom :</strong> ${item.supplierName || '-'}</li>
          <li><strong>Email :</strong> ${item.supplierEmail || '-'}</li>
        </ul>

        <p>
          Merci de vérifier le besoin de réapprovisionnement ou de demande de devis.
        </p>

        <p style="color:#64748b;">
          Application Stock Biomédical
        </p>
      </div>
    `;

    const text = `
Alerte stock biomédical

Statut : ${status}
Type de mouvement : ${movementType}

Consommable :
- Référence : ${item.itemCode}
- Désignation : ${item.itemName}
- Famille : ${item.equipmentFamily || '-'}
- Type : ${item.consumableType || '-'}
- Catégorie : ${item.category || '-'}
- Emplacement : ${item.storageLocation || '-'}
- QR code : ${item.barcodeValue || '-'}

Stock :
- Ancienne quantité : ${item.oldQuantity}
- Nouvelle quantité : ${item.newQuantity}
- Quantité actuelle : ${item.stockQuantity}
- Seuil d’alerte : ${item.alertThreshold}

Fournisseur :
- Nom : ${item.supplierName || '-'}
- Email : ${item.supplierEmail || '-'}

Merci de vérifier le besoin de réapprovisionnement.
`.trim();

    const result = await resend.emails.send({
      from: `Stock Biomédical <${fromEmail}>`,
      to,
      subject,
      html,
      text
    });

    if (result.error) {
      error(`Erreur Resend : ${JSON.stringify(result.error)}`);

      return res.json({
        ok: false,
        message: 'Erreur Resend.',
        error: result.error
      }, 500);
    }

    log(`Email Resend envoyé : ${result.data?.id || 'id inconnu'}`);

    return res.json({
      ok: true,
      message: 'Alerte email envoyée avec Resend.',
      id: result.data?.id || null
    });

  } catch (err) {
    error(`Erreur Function : ${err.message}`);

    return res.json({
      ok: false,
      message: err.message
    }, 500);
  }
};
