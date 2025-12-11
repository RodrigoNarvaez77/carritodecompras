// emailService.js
const axios = require("axios");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "Solucenter <onboarding@resend.dev>";

const INTERNAL_EMAILS = (
  process.env.PURCHASE_INTERNAL_EMAILS ||
  "landingpagesolucenter@gmail.com,rodrigo.narvaez@solucenter.cl"
)
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

async function enviarCorreosCompra(order, webpayData) {
  if (!RESEND_API_KEY) {
    console.error("❌ Falta RESEND_API_KEY para enviar correos");
    return;
  }

  const to = [order.customer?.email, ...INTERNAL_EMAILS].filter(Boolean);

  console.log("📬 Enviando correos vía Resend:", to);

  const itemsHtml = order.items
    .map(
      (item) => `
      <tr>
        <td style="padding:6px 8px;">${item.quantity} × ${item.name}</td>
        <td style="padding:6px 8px; text-align:right;">$${item.lineTotal}</td>
      </tr>
    `
    )
    .join("");

  const html = `
    <div style="font-family:Arial; padding:16px; color:#222;">
      <h2>Gracias por tu compra, ${order.customer?.name} 🙌</h2>
      <p><strong>Orden:</strong> ${order.orderId}</p>
      <p><strong>Monto pagado:</strong> $${order.total}</p>
      <p><strong>Estado Webpay:</strong> ${webpayData.status}</p>
      <hr />
      <h3>Detalle de la compra</h3>
      <table style="width:100%; border-collapse:collapse;">
        ${itemsHtml}
      </table>
      <hr />
      <p style="font-size:12px; color:#666;">
        Este correo fue enviado automáticamente por Solucenter.
      </p>
    </div>
  `;

  await axios.post(
    "https://api.resend.com/emails",
    {
      from: RESEND_FROM_EMAIL,
      to,
      subject: `Compra en Solucenter - Orden ${order.orderId}`,
      html,
    },
    {
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
}

module.exports = { enviarCorreosCompra };
