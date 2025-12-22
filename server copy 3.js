require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { enviarCorreosCompra } = require("./emailService");

// 🧠 Memoria temporal para correos, indexada por buy_order (ORD-...)
const pendingEmailOrders = {};

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
// NECESARIO para leer token_ws que viene en form-urlencoded desde Webpay
app.use(express.urlencoded({ extended: true }));

// Logger simple
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

// 🔐 Config Webpay desde .env
const WEBPAY_BASE_URL = process.env.WEBPAY_BASE_URL;
const WEBPAY_COMMERCE_CODE = process.env.WEBPAY_COMMERCE_CODE;
const WEBPAY_API_KEY = process.env.WEBPAY_API_KEY;
const FRONTEND_RETURN_URL = process.env.FRONTEND_RETURN_URL; // debe ser https://TU-BACKEND/api/webpay/retorno

console.log("DEBUG WEBPAY CONFIG:", {
  WEBPAY_BASE_URL,
  WEBPAY_COMMERCE_CODE,
  FRONTEND_RETURN_URL,
  API_KEY_LENGTH: WEBPAY_API_KEY ? WEBPAY_API_KEY.length : null,
});

// Endpoint test
app.get("/", (req, res) => {
  res.send(`<h1>✅ Backend Solucenter funcionando</h1>`);
});

/**
 * POST /api/cart/checkout
 * Recibe items + customer, calcula total y crea transacción en Webpay.
 * Guarda datos de la compra en memoria usando buy_order (ORD-xxxxx).
 */
app.post("/api/cart/checkout", async (req, res) => {
  try {
    const { items, customer } = req.body;

    // 🧾 Validación de datos del cliente
    if (!customer || !customer.email || !customer.name) {
      return res.status(400).json({
        ok: false,
        message: "Faltan datos del cliente (nombre o correo).",
      });
    }

    // 🧾 Validación de items del carrito
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "El carrito está vacío o el formato es inválido.",
      });
    }

    let total = 0;
    const detailedItems = [];

    for (const item of items) {
      const { id, name, price, quantity } = item;

      const unitPrice = Number(price);
      const qty = Number(quantity);

      if (!id || !name) {
        return res.status(400).json({
          ok: false,
          message: "Falta id o nombre en uno de los productos del carrito.",
        });
      }

      if (isNaN(unitPrice) || unitPrice <= 0) {
        return res.status(400).json({
          ok: false,
          message: `Precio inválido para el producto: ${name}`,
        });
      }

      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({
          ok: false,
          message: `Cantidad inválida para el producto: ${name}`,
        });
      }

      const lineTotal = unitPrice * qty;
      total += lineTotal;

      detailedItems.push({
        id,
        name,
        unitPrice,
        quantity: qty,
        lineTotal,
      });
    }

    // 🔢 Crear un ID de compra simple (ORD-<timestamp>)
    const buyOrder = `ORD-${Date.now()}`;
    const sessionId = `sess-${Date.now()}`;
    const amount = total;
    const returnUrl = FRONTEND_RETURN_URL;

    console.log("📤 Creando transacción Webpay con:", {
      buy_order: buyOrder,
      session_id: sessionId,
      amount,
      return_url: returnUrl,
    });

    // 🌐 Crear transacción en Webpay (sandbox)
    const webpayResponse = await axios.post(
      `${WEBPAY_BASE_URL}/transactions`,
      {
        buy_order: buyOrder,
        session_id: sessionId,
        amount,
        return_url: returnUrl,
      },
      {
        headers: {
          "Tbk-Api-Key-Id": WEBPAY_COMMERCE_CODE,
          "Tbk-Api-Key-Secret": WEBPAY_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const { token, url } = webpayResponse.data;
    console.log("✅ Transacción Webpay creada:", webpayResponse.data);

    // 🧾 Guardar datos de la compra asociados al buy_order (ORD-...)
    pendingEmailOrders[buyOrder] = {
      orderId: buyOrder,
      total: amount,
      items: detailedItems,
      customer: {
        name: customer.name,
        rut: customer.rut || "",
        email: customer.email,
        phone: customer.phone || "",
        address: customer.address || "",
        comuna: customer.comuna || "",
        notes: customer.notes || "",
      },
    };

    console.log(
      "📧 Datos de compra guardados temporalmente para correo..., 📧 Purchase data temporarily stored for email..."
    );
    console.log(
      "🧠 Claves actuales en pendingEmailOrders:",
      Object.keys(pendingEmailOrders)
    );

    return res.json({
      ok: true,
      message: "Carrito validado y Webpay inicializado.",
      webpayUrl: `${url}?token_ws=${token}`,
      buyOrder,
      amount,
      items: detailedItems,
      customer,
    });
  } catch (error) {
    console.error(
      "❌ Error creando transacción Webpay:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      ok: false,
      message: "Error al crear la transacción en Webpay.",
      error: error.response?.data || error.message,
    });
  }
});

/**
 * ♻️ /api/webpay/retorno
 * Usamos app.all() para aceptar GET o POST
 */
app.all("/api/webpay/retorno", async (req, res) => {
  try {
    console.log("📥 Llegó retorno Webpay. method:", req.method);
    console.log("Body recibido:", req.body);
    console.log("Query recibido:", req.query);

    const body = req.body || {};
    const tokenWs = body.token_ws || req.query.token_ws;

    if (!tokenWs) {
      console.error("❌ No llegó token_ws en el retorno de Webpay");
      return res
        .status(400)
        .send(
          "<h1>❌ Error</h1><p>Falta token_ws en la respuesta de Webpay</p>"
        );
    }

    console.log("🔑 token_ws recibido desde Webpay:", tokenWs);

    // 🔁 Confirmar transacción con Webpay
    const confirmResponse = await axios.put(
      `${WEBPAY_BASE_URL}/transactions/${tokenWs}`,
      {},
      {
        headers: {
          "Tbk-Api-Key-Id": WEBPAY_COMMERCE_CODE,
          "Tbk-Api-Key-Secret": WEBPAY_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const data = confirmResponse.data;
    console.log("✅ Respuesta de confirmación Webpay:", data);

    const { buy_order: buyOrderFromWebpay, status } = data;

    console.log(
      "🧠 Claves actuales en pendingEmailOrders:",
      Object.keys(pendingEmailOrders)
    );
    console.log(
      "🧠 Buscando datos de compra por buy_order:",
      buyOrderFromWebpay
    );

    if (status === "AUTHORIZED") {
      const orderForEmail = pendingEmailOrders[buyOrderFromWebpay];

      if (orderForEmail) {
        console.log(
          "📧 Disparando envío de correos en segundo plano..., 📧 Triggering email sending in background..."
        );

        // 🚀 NO BLOQUEA la respuesta, corre paralelo
        enviarCorreosCompra(orderForEmail, data)
          .then(() => {
            console.log(
              "✅ Correos enviados correctamente..., ✅ Emails successfully sent..."
            );
          })
          .catch((err) => {
            console.error(
              "⚠️ Error al enviar correos..., ⚠️ Error sending emails...",
              err.message || err
            );
          })
          .finally(() => {
            delete pendingEmailOrders[buyOrderFromWebpay];
            console.log(
              "🧹 Orden eliminada de memoria..., 🧹 Order removed from memory..."
            );
          });
      } else {
        console.warn(
          "⚠️ No se encontraron datos en memoria para enviar correos (buy_order):",
          buyOrderFromWebpay
        );
      }

      // 🎉 RESPUESTA INMEDIATA AL USUARIO
      return res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <title>Pago exitoso</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background: #f4f7f9;
              margin: 0;
              padding: 40px;
              text-align: center;
            }
            .box {
              background: #ffffff;
              padding: 30px;
              max-width: 450px;
              margin: 40px auto;
              border-radius: 14px;
              box-shadow: 0 4px 18px rgba(0,0,0,0.12);
            }
            h1 { color: #16a34a; font-size: 28px; }
            p { color: #374151; font-size: 16px; margin: 6px 0; }
            .icon { font-size: 52px; margin-bottom: 12px; }
            .success { color: #16a34a; }
          </style>
        </head>
        <body>
          <div class="box">
            <div class="icon success">✔️</div>
            <h1>Pago autorizado</h1>
            <p><strong>Orden:</strong> ${buyOrderFromWebpay}</p>
            <p><strong>Monto:</strong> $${data.amount}</p>
            <p><strong>Estado:</strong> ${status}</p>
            <p>Gracias por tu compra 😊</p>
            <p>Puedes cerrar esta ventana.</p>
          </div>
        </body>
        </html>
      `);
    }

    // ❌ Pago fallido
    return res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>Pago fallido</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #f8f3f3;
            margin: 0;
            padding: 40px;
            text-align: center;
          }
          .box {
            background: #ffffff;
            padding: 30px;
            max-width: 450px;
            margin: 40px auto;
            border-radius: 14px;
            box-shadow: 0 4px 18px rgba(0,0,0,0.12);
          }
          h1 { color: #dc2626; font-size: 28px; }
          p { color: #444; font-size: 16px; margin: 6px 0; }
          .icon { font-size: 52px; margin-bottom: 12px; }
          .fail { color: #dc2626; }
        </style>
      </head>
      <body>
        <div class="box">
          <div class="icon fail">❌</div>
          <h1>Pago no autorizado</h1>
          <p><strong>Orden:</strong> ${buyOrderFromWebpay}</p>
          <p><strong>Estado:</strong> ${status}</p>
          <p>No se pudo completar la transacción.</p>
          <p>Puedes cerrar esta ventana.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error(
      "❌ Error al confirmar transacción Webpay:",
      error.response?.data || error.message
    );

    return res
      .status(500)
      .send(
        "<h1>❌ Error al confirmar la transacción en Webpay</h1><p>Revisa la consola del backend.</p>"
      );
  }
});

// Endpoint para probar correos sin Webpay
app.get("/api/test-email", async (req, res) => {
  try {
    const fakeOrder = {
      orderId: "TEST-00001",
      total: 12345,
      items: [
        {
          name: "Producto de prueba",
          quantity: 2,
          unitPrice: 5000,
          lineTotal: 10000,
        },
      ],
      customer: {
        name: "Cliente Prueba",
        rut: "11.111.111-1",
        email: "landingpagesolucenter@gmail.com",
        phone: "+56 9 1234 5678",
        address: "Dirección de prueba",
        comuna: "Curanilahue",
        notes: "Solo test",
      },
    };

    const fakeWebpayData = { status: "AUTHORIZED" };

    await enviarCorreosCompra(fakeOrder, fakeWebpayData);

    res.json({ ok: true, message: "Correo de prueba enviado" });
  } catch (err) {
    console.error("❌ Error en /api/test-email:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(
    `🚀 Backend Solucenter escuchando en http://localhost:${PORT} ..., 🚀 Solucenter backend listening on http://localhost:${PORT} ...`
  );
});
