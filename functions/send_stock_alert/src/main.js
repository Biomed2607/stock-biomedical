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
    }

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

    const isRupture = status === 'Rupture';

    const title = isRupture
      ? 'Rupture de stock détectée'
      : 'Stock bas détecté';

    const subject = `[Stock biomédical] ${status} — ${item.itemCode}`;

    const plainText = `
${isRupture ? 'Une rupture de stock a été détectée' : 'Un stock bas a été détecté'} pour le consommable suivant :

Référence : ${item.itemCode || '-'}
Désignation : ${item.itemName || '-'}
Catégorie : ${item.category || '-'}
Emplacement : ${item.storageLocation || '-'}

Stock actuel : ${item.stockQuantity ?? item.newQuantity ?? '-'}
Seuil d’alerte : ${item.alertThreshold ?? '-'}

Fournisseur : ${item.supplierName || '-'}
Email : ${item.supplierEmail || '-'}

Merci de vérifier le besoin de réapprovisionnement.

Demande de devis à envoyer au fournisseur

Bonjour,

Pouvez-vous nous transmettre un devis pour le(s) consommable(s) suivant(s) :

Référence : ${item.itemCode || '-'}
Désignation : ${item.itemName || '-'}
Quantité souhaitée : [à compléter]

Adresse de livraison :
Hôpital privé Drôme Ardèche - Clinique Pasteur - Ramsay Santé
Service biomédical
294 Bd Charles de Gaulle
07500 Guilherand-Granges
`.trim();

    const html = `
      <div style="font-family: Arial, sans-serif; color: #102033; line-height: 1.6;">
        <h2 style="color:#0f766e;">${title}</h2>

        <p>
          ${isRupture ? 'Une rupture de stock a été détectée' : 'Un stock bas a été détecté'}
          pour le consommable suivant :
        </p>

        <table style="border-collapse: collapse; width: 100%; max-width: 720px;">
          <tr>
            <td style="padding: 6px 0;"><strong>Référence :</strong></td>
            <td>${item.itemCode || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0;"><strong>Désignation :</strong></td>
            <td>${item.itemName || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0;"><strong>Catégorie :</strong></td>
            <td>${item.category || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0;"><strong>Emplacement :</strong></td>
            <td>${item.storageLocation || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0;"><strong>Stock actuel :</strong></td>
            <td>${item.stockQuantity ?? item.newQuantity ?? '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0;"><strong>Seuil d’alerte :</strong></td>
            <td>${item.alertThreshold ?? '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0;"><strong>Fournisseur :</strong></td>
            <td>${item.supplierName || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0;"><strong>Email :</strong></td>
            <td>${item.supplierEmail || '-'}</td>
          </tr>
        </table>

        <p>Merci de vérifier le besoin de réapprovisionnement.</p>

        <hr style="border:none; border-top:1px solid #d9e8e1; margin:24px 0;" />

        <h3 style="color:#0f766e;">Demande de devis à envoyer au fournisseur</h3>

        <p>Bonjour,</p>

        <p>
          Pouvez-vous nous transmettre un devis pour le(s) consommable(s) suivant(s) :
        </p>

        <p>
          <strong>Référence :</strong> ${item.itemCode || '-'}<br />
          <strong>Désignation :</strong> ${item.itemName || '-'}<br />
          <strong>Quantité souhaitée :</strong> [à compléter]
        </p>

        <p>
          <strong>Adresse de livraison :</strong><br />
          Hôpital privé Drôme Ardèche - Clinique Pasteur - Ramsay Santé<br />
          Service biomédical<br />
          294 Bd Charles de Gaulle<br />
          07500 Guilherand-Granges
        </p>
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
        html,
        text: plainText
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
