// emailService.js
const nodemailer = require("nodemailer");

const EMAIL_HOST = process.env.EMAIL_HOST || "smtp.gmail.com";
const EMAIL_PORT = process.env.EMAIL_PORT || 587;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const COMPANY_EMAIL =
  process.env.COMPANY_EMAIL || "landingpagesolucenter@gmail.com";

// Transporter usando SMTP de Gmail
const transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: EMAIL_PORT,
  secure: false,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

// Armar HTML del correo de compra
function buildOrderHtml(order, webpayData) {
  const itemsHtml = (order.items || [])
    .map(
      (item) => `
      <tr>
        <td>${item.name}</td>
        <td style="text-align:center;">${item.quantity}</td>
        <td style="text-align:right;">$${item.unitPrice}</td>
        <td style="text-align:right;">$${item.lineTotal}</td>
      </tr>
    `
    )
    .join("");

  return `
    <h2>✅ Compra aprobada</h2>
    <p><strong>Orden:</strong> ${order.orderId}</p>
    <p><strong>Monto:</strong> $${order.total}</p>
    <p><strong>Estado Webpay:</strong> ${webpayData.status}</p>

    <h3>Datos del cliente</h3>
    <p><strong>Nombre:</strong> ${order.customer?.name || "-"}</p>
    <p><strong>RUT:</strong> ${order.customer?.rut || "-"}</p>
    <p><strong>Correo:</strong> ${order.customer?.email || "-"}</p>
    <p><strong>Teléfono:</strong> ${order.customer?.phone || "-"}</p>
    <p><strong>Dirección:</strong> ${order.customer?.address || "-"}</p>
    <p><strong>Comuna:</strong> ${order.customer?.comuna || "-"}</p>
    <p><strong>Comentario despacho:</strong> ${order.customer?.notes || "-"}</p>

    <h3>Detalle de productos</h3>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; max-width:600px;">
      <thead>
        <tr>
          <th style="text-align:left;">Producto</th>
          <th style="text-align:center;">Cant.</th>
          <th style="text-align:right;">Precio</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml || "<tr><td colspan='4'>Sin detalle disponible</td></tr>"}
      </tbody>
    </table>
  `;
}

// Enviar correo a empresa + cliente
async function enviarCorreosCompra(order, webpayData) {
  if (!order || !order.customer?.email) {
    console.error(
      "⚠️ No se puede enviar correo: falta información del cliente o de la orden"
    );
    return;
  }

  const html = buildOrderHtml(order, webpayData);

  const mailOptions = {
    from: `"Solucenter" <${EMAIL_USER}>`,
    to: [COMPANY_EMAIL, order.customer.email], // empresa + cliente
    subject: `Compra #${order.orderId} - Pago aprobado`,
    html,
  };

  console.log("📧 Enviando correos de compra a:", mailOptions.to);
  await transporter.sendMail(mailOptions);
  console.log("✅ Correos enviados correctamente");
}

module.exports = {
  enviarCorreosCompra,
};
