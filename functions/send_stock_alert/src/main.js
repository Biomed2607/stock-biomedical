import nodemailer from 'nodemailer';

export default async ({ req, res, log, error }) => {
  try {
    log('Function send_stock_alert démarrée');

    log(`SMTP_HOST=${process.env.SMTP_HOST || 'NON DEFINI'}`);
    log(`SMTP_PORT=${process.env.SMTP_PORT || 'NON DEFINI'}`);
    log(`SMTP_SECURE=${process.env.SMTP_SECURE || 'NON DEFINI'}`);
    log(`SMTP_USER=${process.env.SMTP_USER ? 'DEFINI' : 'NON DEFINI'}`);
    log(`SMTP_FROM=${process.env.SMTP_FROM || 'NON DEFINI'}`);
    log(`SMTP_REPLY_TO=${process.env.SMTP_REPLY_TO || 'NON DEFINI'}`);

    const payload = JSON.parse(req.body || '{}');

    const to = payload.to || 'alpha.balde@ramsaysante.fr';
    const status = payload.status || 'Alerte stock';
    const movementType = payload.movementType || 'MOUVEMENT';
    const item = payload.item || {};

    if (!item.itemCode || !item.itemName) {
      return res.json({
        ok: false,
        message: 'Payload incomplet.'
      }, 400);
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },

      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });

    log('Test connexion SMTP...');

    await transporter.verify();

    log('Connexion SMTP OK');

    const subject = `[Stock biomédical] ${status} — ${item.itemCode}`;

    const text = `
Bonjour,

Une alerte de stock a été détectée.

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
- Seuil d’alerte : ${item.alertThreshold}

Fournisseur :
- Nom : ${item.supplierName || '-'}
- Email : ${item.supplierEmail || '-'}

Merci de vérifier le besoin de réapprovisionnement.

Cordialement,
Application Stock Biomédical
`.trim();

    const info = await transporter.sendMail({
      from: `"Stock Biomédical" <${process.env.SMTP_FROM}>`,
      to,
      replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_FROM,
      subject,
      text
    });

    log(`Email envoyé : ${info.messageId}`);

    return res.json({
      ok: true,
      message: 'Alerte email envoyée.',
      messageId: info.messageId
    });

  } catch (err) {
    error(`Erreur Function : ${err.message}`);

    return res.json({
      ok: false,
      message: err.message
    }, 500);
  }
};
