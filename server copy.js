require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// 🔐 Config Webpay desde .env
const WEBPAY_BASE_URL = process.env.WEBPAY_BASE_URL;
const WEBPAY_COMMERCE_CODE = process.env.WEBPAY_COMMERCE_CODE;
const WEBPAY_API_KEY = process.env.WEBPAY_API_KEY;
const FRONTEND_RETURN_URL = process.env.FRONTEND_RETURN_URL;
// ❌ Ya no usamos FRONTEND_FINAL_URL en la API REST
// const FRONTEND_FINAL_URL = process.env.FRONTEND_FINAL_URL;

console.log("DEBUG WEBPAY CONFIG:", {
  WEBPAY_BASE_URL,
  WEBPAY_COMMERCE_CODE,
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
  // agrega más productos que uses en el frontend
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
  res.json({ ok: true, message: "✅ Backend Solucenter funcionando" });
});

/**
 * 🛒 POST /api/cart/checkout
 * Recibe items, recalcula precios, genera orderId, guarda la orden
 * y crea la transacción en Webpay (sandbox).
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
      const product = findProductById(item.id);
      const quantity = Number(item.quantity) || 0;

      if (!product) {
        return res.status(400).json({
          ok: false,
          message: `Producto no encontrado en catálogo: ${item.id}`,
        });
      }

      if (quantity <= 0) {
        return res.status(400).json({
          ok: false,
          message: `Cantidad inválida para el producto: ${product.name}`,
        });
      }

      const lineTotal = product.price * quantity;
      total += lineTotal;

      detailedItems.push({
        id: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity,
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
      status: "PENDING_PAYMENT", // luego cambia a PAID, FAILED, etc.
      createdAt: new Date().toISOString(),
      webpayToken: null,
    };

    orders.push(newOrder);

    // 🌐 Crear transacción en Webpay (sandbox)
    const buyOrder = orderId;
    const sessionId = `sess-${Date.now()}`;
    const amount = total; // CLP entero
    const returnUrl = FRONTEND_RETURN_URL;

    const webpayResponse = await axios.post(
      `${WEBPAY_BASE_URL}/transactions`,
      {
        buy_order: buyOrder,
        session_id: sessionId,
        amount,
        return_url: returnUrl, // ✅ SOLO ESTE URL
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

    // Guardar token en la orden
    newOrder.webpayToken = token;

    // Responder al frontend con la orden + URL de Webpay lista
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
