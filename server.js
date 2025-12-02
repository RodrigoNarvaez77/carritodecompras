require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

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
const FRONTEND_RETURN_URL = process.env.FRONTEND_RETURN_URL; // debe ser http://localhost:4000/api/webpay/retorno

console.log("DEBUG WEBPAY CONFIG:", {
  WEBPAY_BASE_URL,
  WEBPAY_COMMERCE_CODE,
  FRONTEND_RETURN_URL,
  API_KEY_LENGTH: WEBPAY_API_KEY ? WEBPAY_API_KEY.length : null,
});

// 🛒 Catálogo simple de productos
const PRODUCTS = [
  {
    id: "cemento-polpaico-25kg",
    name: "Cemento Polpaico 25 kg",
    price: 5990,
  },
  {
    id: "PL. ZINCALUM AC 0.35 X 3.66 MT",
    name: "PL. ZINCALUM AC 0.35 X 3.66 MT",
    price: 19990,
  },
];

// 🧠 "Base de datos" en memoria (para empezar)
let orders = [];
let lastOrderId = 0;

// Helper para buscar producto
function findProductById(id) {
  return PRODUCTS.find((p) => p.id === id);
}

// Endpoint test
app.get("/", (req, res) => {
  res.send(`<h1>✅ Backend Solucenter funcionando</h1>`);
});

/**
 * POST /api/cart/checkout
 * Recibe items, recalcula precios, genera orderId, guarda la orden
 * y crea la transacción en Webpay (sandbox).
 * POST /api/cart/checkout
 * Ahora toma los productos y precios que vienen desde el frontend (carrito).
 * Espera un body como:
 * {
 *   "items": [
 *     { "id": "cemento-polpaico-25kg", "name": "Cemento Polpaico 25 kg", "price": 5990, "quantity": 2 },
 *     { "id": "PL. ZINCALUM AC 0.35 X 3.66 MT", "name": "PL. ZINCALUM AC 0.35 X 3.66 MT", "price": 19990, "quantity": 1 }
 *   ]
 * }
 */
app.post("/api/cart/checkout", async (req, res) => {
  try {
    const { items } = req.body;

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

    // 🔢 Generar orderId simple (incremental)
    lastOrderId += 1;
    const orderId = `ORD-${lastOrderId.toString().padStart(5, "0")}`;

    // 💾 Guardar orden en memoria
    const newOrder = {
      orderId,
      items: detailedItems,
      total,
      currency: "CLP",
      status: "PENDING_PAYMENT",
      createdAt: new Date().toISOString(),
      webpayToken: null,
    };

    orders.push(newOrder);

    // 🌐 Crear transacción en Webpay (sandbox)
    const buyOrder = orderId;
    const sessionId = `sess-${Date.now()}`;
    const amount = total;
    const returnUrl = FRONTEND_RETURN_URL;

    console.log("📤 Creando transacción Webpay con:", {
      buy_order: buyOrder,
      session_id: sessionId,
      amount,
      return_url: returnUrl,
    });

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

    newOrder.webpayToken = token;

    return res.json({
      ok: true,
      message: "Carrito validado, orden creada y Webpay inicializado.",
      order: newOrder,
      webpayUrl: `${url}?token_ws=${token}`,
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

    // PROTEGER req.body
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
    const order = orders.find((o) => o.orderId === buyOrderFromWebpay);

    if (!order) {
      console.error(
        "⚠️ No se encontró la orden local para:",
        buyOrderFromWebpay
      );
    } else {
      order.status = status === "AUTHORIZED" ? "PAID" : "FAILED";
    }

    if (status === "AUTHORIZED") {
      return res.send(`
        <h1>✅ Pago autorizado</h1>
        <p>Orden: ${buyOrderFromWebpay}</p>
        <p>Monto: ${data.amount}</p>
        <p>Estado: ${status}</p>
        <p>Puedes cerrar esta ventana.</p>
      `);
    } else {
      return res.send(`
        <h1>❌ Pago no autorizado</h1>
        <p>Orden: ${buyOrderFromWebpay}</p>
        <p>Estado: ${status}</p>
        <p>Puedes cerrar esta ventana.</p>
      `);
    }
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

/**
 * 🔍 GET /api/orders/:orderId
 * Permite consultar una orden por ID (para debug / pruebas)
 */
app.get("/api/orders/:orderId", (req, res) => {
  const { orderId } = req.params;
  const order = orders.find((o) => o.orderId === orderId);

  if (!order) {
    return res.status(404).json({
      ok: false,
      message: "Orden no encontrada",
    });
  }

  return res.json({
    ok: true,
    order,
  });
});

app.listen(PORT, () => {
  console.log(
    `🚀 Backend Solucenter escuchando en http://localhost:${PORT} ..., 🚀 Solucenter backend listening on http://localhost:${PORT} ...`
  );
});
