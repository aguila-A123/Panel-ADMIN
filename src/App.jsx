import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@supabase/supabase-js";

const fallbackImage = "https://images.unsplash.com/photo-1523398002811-999ca8dec234?q=80&w=900&auto=format&fit=crop";
const DEFAULT_SIZES = { S: "", M: "", L: "", XL: "" };
const DEFAULT_SIZE_STOCKS = { S: "0", M: "0", L: "0", XL: "0" };
const PAYMENT_METHODS = ["Bizum", "PayPal", "Transferencias"];
const CLOUDINARY_CLOUD_NAME = "dqgvufybv";
const CLOUDINARY_UPLOAD_PRESET = "outlet_products";
const CLOUDINARY_FOLDER = "outlet-stock/products";
const CATEGORY_OPTIONS = ["Ropa", "Calzado", "Accesorios", "Bolsos", "Hogar", "Tecnología", "Otros"];

const SUPABASE_URL = "https://qpkdaubarqnutbunckeh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwa2RhdWJhcnFudXRidW5ja2VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NjAzMjAsImV4cCI6MjA5MzEzNjMyMH0.36MsbMngO6lOBzFvKNsMHxk_djEYpzKR3sdCxsT8ids";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PRODUCTS_TABLE = "products";
const SIZE_TABLE = "product_sizes";
const SIZE_PRODUCT_ID_COLUMN = "product_id";
const SIZE_NAME_COLUMN = "size";
const SIZE_PRICE_COLUMN = "price";
const SIZE_STOCK_COLUMN = "stock";
const CONFIRMED_ORDERS_TABLE = "confirmed_orders";
const DELETED_CONFIRMED_ORDERS_TABLE = "deleted_confirmed_orders";
const WORKER_STATUS_TABLE = "worker_status";
const WORKER_STATUS_ID = "nacex_worker";
const WORKER_DEAD_AFTER_SECONDS = 20;
const WORKER_CHECK_INTERVAL_MS = 10000;
const WORKER_LOCAL_TICK_MS = 1000;

function createEmptyProductForm() {
  return {
    title: "",
    description: "",
    price: "",
    stock: "0",
    category: "",
    categoryExtraEnabled: false,
    categoryExtra: "",
    useSizePricing: false,
    sizes: { ...DEFAULT_SIZES },
    sizeStocks: { ...DEFAULT_SIZE_STOCKS },
    imageFile: null,
    imagePreview: "",
    imageUrl: "",
  };
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function parseMoney(value) {
  const number = Number(String(value ?? "0").replace("€", "").replace(",", ".").trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizeStock(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function shortText(value, max = 25) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function getFirstName(name) {
  return String(name || "Cliente").trim().split(" ")[0] || "Cliente";
}

function getDisplayPrice(product) {
  if (product?.useSizePricing && product?.sizes) {
    const values = Object.values(product.sizes).map(Number).filter((value) => Number.isFinite(value) && value > 0);
    if (values.length > 0) return Math.min(...values).toFixed(2);
  }
  const number = Number(product?.price || 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function validateProduct(values) {
  const errors = {};
  if (!String(values.title || "").trim()) errors.title = "El título es obligatorio.";
  if (!String(values.description || "").trim()) errors.description = "La descripción es obligatoria.";
  if (!String(values.category || "").trim()) errors.category = "La categoría es obligatoria.";

  if (values.useSizePricing) {
    const hasValidSize = Object.values(values.sizes || {}).some((value) => Number(value) > 0);
    if (!hasValidSize) errors.sizes = "Agrega al menos un precio válido para una talla.";

    Object.entries(values.sizes || {}).forEach(([size, price]) => {
      if (Number(price) > 0) {
        const stock = String(values.sizeStocks?.[size] ?? "").trim();
        if (!stock) errors[`stock_${size}`] = `Agrega stock para la talla ${size}.`;
        else if (!Number.isInteger(Number(stock)) || Number(stock) < 0) errors[`stock_${size}`] = `El stock de ${size} debe ser 0 o mayor.`;
      }
    });
  } else {
    const price = String(values.price || "").trim();
    const stock = String(values.stock || "").trim();
    if (!price) errors.price = "El precio es obligatorio.";
    else if (Number.isNaN(Number(price)) || Number(price) <= 0) errors.price = "El precio debe ser mayor a 0.";
    if (!stock) errors.stock = "El stock es obligatorio.";
    else if (!Number.isInteger(Number(stock)) || Number(stock) < 0) errors.stock = "El stock debe ser 0 o mayor.";
  }
  return errors;
}

function normalizeImageUrl(url) {
  const value = String(url || "").trim();
  if (!value) return fallbackImage;
  if (value.includes("ibb.co/") && !value.includes("i.ibb.co/") && !/\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(value)) return fallbackImage;
  return value;
}

async function uploadImageToCloudinary(file) {
  if (!file) return "";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", CLOUDINARY_FOLDER);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: formData,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || "No se pudo subir la imagen a Cloudinary.");
  return result.secure_url || result.url || "";
}

function getSupabaseProductId(row) {
  return row.id || row["identificación"] || row.identificacion;
}

function getSupabaseProductIdColumn(row) {
  if (row.id) return "id";
  if (row["identificación"]) return "id";
  if (row.identificacion) return "identificacion";
  return "identificación";
}

function mapSupabaseProduct(row) {
  return {
    id: getSupabaseProductId(row),
    idColumn: getSupabaseProductIdColumn(row),
    title: row.title || row.titulo || row["título"] || "Producto sin título",
    price: String(row.price ?? row.precio ?? "0"),
    stock: String(row.stock ?? "1"),
    description: row.description || row.descripcion || row["descripción"] || "Sin descripción",
    image: normalizeImageUrl(row.image_url || row.url_de_la_imagen || row.imagen_url || row.image || row["URL de la imagen"]),
    status: row.status || row.estado || "Activo",
    category: row.category || row.categoria || row["categoría"] || "",
    categoryExtra: row.category_extra || row.categoria_extra || row["categoría extra"] || "",
    categoryExtraEnabled: Boolean(row.category_extra || row.categoria_extra || row["categoría extra"]),
    useSizePricing: false,
    sizes: null,
    sizeStocks: null,
    createdAt: row.created_at || row.creado_en || null,
  };
}

function mapSizeRowsToProduct(product, sizeRows) {
  const rows = Array.isArray(sizeRows) ? sizeRows.filter((row) => String(row[SIZE_PRODUCT_ID_COLUMN]) === String(product.id)) : [];
  if (rows.length === 0) return product;

  const sizes = { ...DEFAULT_SIZES };
  const sizeStocks = { ...DEFAULT_SIZE_STOCKS };
  rows.forEach((row) => {
    const size = String(row[SIZE_NAME_COLUMN] || "").toUpperCase();
    if (size) {
      sizes[size] = String(row[SIZE_PRICE_COLUMN] ?? "");
      sizeStocks[size] = String(row[SIZE_STOCK_COLUMN] ?? "1");
    }
  });

  return { ...product, useSizePricing: true, sizes, sizeStocks, price: getDisplayPrice({ useSizePricing: true, sizes }) };
}

function buildSizePayloads(productId, sizes, sizeStocks = DEFAULT_SIZE_STOCKS) {
  return Object.entries(sizes || {})
    .filter(([, price]) => Number(price) > 0)
    .map(([size, price]) => ({
      [SIZE_PRODUCT_ID_COLUMN]: productId,
      [SIZE_NAME_COLUMN]: size,
      [SIZE_PRICE_COLUMN]: Number(price),
      [SIZE_STOCK_COLUMN]: normalizeStock(sizeStocks?.[size], 0),
    }));
}

function productToSupabasePayload(product) {
  return {
    title: product.title,
    description: product.description,
    price: Number(product.price || 0),
    image_url: normalizeImageUrl(product.image),
    status: product.status || "Activo",
    category: String(product.category || "").trim(),
    category_extra: product.categoryExtraEnabled ? String(product.categoryExtra || "").trim() : "",
  };
}


async function deleteCloudinaryImageFromUrl(imageUrl) {
  const value = String(imageUrl || "").trim();
  if (!value || !value.includes("res.cloudinary.com")) return { skipped: true };

  const { data, error } = await supabase.functions.invoke("delete-cloudinary-image", {
    body: { imageUrl: value },
  });

  if (error) return { error };
  if (data?.ok === false) return { error: new Error(data?.error || "Cloudinary no pudo borrar la imagen.") };
  return { data };
}

async function loadSupabaseProducts() {
  const { data: productRows, error: productError } = await supabase.from(PRODUCTS_TABLE).select("*").order("created_at", { ascending: false });
  if (productError) return { data: null, error: productError };

  const { data: sizeRows, error: sizeError } = await supabase.from(SIZE_TABLE).select("*");
  if (sizeError) console.warn("No se pudieron cargar tallas:", sizeError);

  const products = Array.isArray(productRows) ? productRows.map(mapSupabaseProduct).map((product) => mapSizeRowsToProduct(product, sizeRows || [])) : [];
  return { data: products, error: null };
}

async function saveProductSizes(productId, sizes, sizeStocks = DEFAULT_SIZE_STOCKS) {
  const cleanProductId = String(productId || "").trim();
  if (!cleanProductId) return { data: null, error: new Error("No se encontró el ID del producto para guardar tallas.") };

  const payloads = buildSizePayloads(cleanProductId, sizes, sizeStocks);
  const { error: deleteError } = await supabase.from(SIZE_TABLE).delete().eq(SIZE_PRODUCT_ID_COLUMN, cleanProductId);
  if (deleteError) return { data: null, error: deleteError };
  if (payloads.length === 0) return { data: [], error: null };

  const { data, error } = await supabase.from(SIZE_TABLE).insert(payloads).select();
  return { data: error ? null : data, error };
}

function buildOrderHistory(orders) {
  return orders
    .flatMap((order) => {
      const firstName = getFirstName(order.customer);
      return [
        { id: `${order.id}-created`, orderId: order.id, date: order.createdAt || "Sin fecha", type: "Compra realizada", customer: order.customer, firstName, product: order.product, price: order.price, image: order.image, detail: `${order.customer} compró ${order.product} por ${order.price}`, status: "Compra" },
        { id: `${order.id}-paid`, orderId: order.id, date: order.approvedAt || order.createdAt || "Sin fecha", type: "Pago registrado", customer: order.customer, firstName, product: order.product, price: order.price, image: order.image, detail: `Pago registrado de ${order.customer} por ${order.product}`, status: "Aprobada" },
      ];
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}


function nowTime() {
  return new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function formatChatTime(value) {
  if (!value) return nowTime();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function getDateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: "Sin fecha", time: String(value || "--:--") };
  }
  return {
    date: date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

function getProfileName(profile, fallback = "Cliente") {
  return profile?.full_name || profile?.name || profile?.nombre || profile?.username || profile?.email?.split("@")[0] || fallback;
}

function normalizeChatMessage(message = {}) {
  return {
    id: message.id || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sender: message.sender || "customer",
    type: message.type || null,
    text: message.text || "",
    time: message.time || nowTime(),
    createdAt: message.createdAt || message.created_at || null,
    items: Array.isArray(message.items) ? message.items : undefined,
    buttons: Array.isArray(message.buttons) ? message.buttons : undefined,
    paymentCard: message.paymentCard || undefined,
    customerName: message.customerName || undefined,
    orderSignature: message.orderSignature || undefined,
    adminConfirmed: message.adminConfirmed === true || message.confirmedByAdmin === true || message.admin_confirmed === true,
  };
}

function chatMessageFromDb(row) {
  const raw = row?.content ?? row?.message ?? row?.text ?? row?.body ?? row?.metadata?.json ?? row;
  let parsed = null;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { parsed = { text: raw }; }
  } else if (raw && typeof raw === "object") parsed = raw;

  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const sender = parsed?.sender || metadata.sender || row?.sender || (row?.sender_id ? "customer" : "admin");
  return normalizeChatMessage({
    ...parsed,
    id: row?.id || parsed?.id,
    sender,
    type: parsed?.type || metadata.type || row?.type || null,
    text: parsed?.text || (typeof raw === "string" && raw.startsWith("{") ? "" : parsed?.text) || "",
    time: parsed?.time || formatChatTime(row?.created_at),
    createdAt: row?.created_at || parsed?.createdAt || metadata.createdAt || null,
    items: parsed?.items || metadata.items,
    buttons: parsed?.buttons || metadata.buttons,
    paymentCard: parsed?.paymentCard || metadata.paymentCard,
    customerName: parsed?.customerName || metadata.customerName,
    orderSignature: parsed?.orderSignature || metadata.orderSignature,
    adminConfirmed: parsed?.adminConfirmed === true || parsed?.confirmedByAdmin === true || parsed?.admin_confirmed === true || metadata.adminConfirmed === true || metadata.confirmedByAdmin === true || metadata.admin_confirmed === true,
  });
}

function normalizeOrderItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    id: item.id || item.cartId || `${item.name || "producto"}-${item.size || item.selectedSize || "unica"}`,
    name: item.name || "Producto sin nombre",
    size: item.size || item.selectedSize || "Única",
    qty: Math.max(1, Number(item.qty) || 1),
    price: Number(item.price) || 0,
    image: item.image || "",
  })).filter((item) => item.name);
}

function chatPreview(message) {
  if (!message) return "Sin mensajes todavía";
  if (message.type === "order") return "Pedido enviado desde el catálogo";
  if (message.type === "payment_confirmed" && message.adminConfirmed === true) return "Pago confirmado por OutletStock";
  if (message.type === "payment_confirmed") return "Cliente avisó que ya pagó";
  if (message.paymentCard) return "Datos de pago enviados";
  if (message.buttons?.length) return "Opciones de pago enviadas";
  return message.text || "Mensaje";
}

function isAdminPaymentConfirmation(message = {}) {
  return message.type === "payment_confirmed" && message.sender === "admin" && message.adminConfirmed === true;
}

function isCustomerPaymentNotice(message = {}) {
  return message.type === "payment_confirmed" && !isAdminPaymentConfirmation(message);
}


function buildOrderSummaries(messages = []) {
  const orders = [];
  let currentOrderKey = null;

  function makeOrderKey(message, index) {
    return message.orderSignature || `order-${index}-${message.id || index}`;
  }

  function getOrderByKey(key) {
    return orders.find((order) => order.key === key) || null;
  }

  messages.forEach((message, index) => {
    if (message.type === "order") {
      const items = normalizeOrderItems(message.items || []);
      if (!items.length) return;
      const key = makeOrderKey(message, orders.length);
      const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
      orders.push({
        key,
        number: orders.length + 1,
        messageId: message.id,
        orderSignature: message.orderSignature || key,
        items,
        total,
        time: message.time,
        createdAt: message.createdAt || null,
        approvedAt: null,
        paymentMethod: "Pendiente",
        customerPaymentReported: false,
        adminConfirmed: false,
      });
      currentOrderKey = key;
      return;
    }

    if (!orders.length) return;
    const targetKey = message.orderSignature || currentOrderKey || orders[orders.length - 1]?.key;
    const target = getOrderByKey(targetKey) || orders[orders.length - 1];
    if (!target) return;

    const method = message?.paymentCard?.title?.replace("Método de pago:", "").trim() || (message?.text?.match(/bizum|paypal|transferencia/i)?.[0]);
    if (method) target.paymentMethod = method;

    if (message.type === "payment_confirmed") {
      if (message.adminConfirmed === true) {
        target.adminConfirmed = true;
        target.approvedAt = message.createdAt || null;
      } else target.customerPaymentReported = true;
    }
  });

  return orders;
}

function getOrdersPackageState(orders = []) {
  if (orders.some((order) => order.customerPaymentReported && !order.adminConfirmed)) return "pending";
  if (orders.some((order) => order.adminConfirmed)) return "confirmed";
  return null;
}

function getConversationUnreadState(messages = []) {
  const last = messages[messages.length - 1];
  return Boolean(last && last.sender !== "admin");
}


function buildConfirmedOrdersFromData(conversations = [], rawMessages = [], profilesById = {}) {
  const messagesByConversation = {};
  (rawMessages || []).forEach((row) => {
    const cid = row.conversation_id;
    if (!cid) return;
    messagesByConversation[cid] = [...(messagesByConversation[cid] || []), chatMessageFromDb(row)];
  });

  return (conversations || [])
    .flatMap((conversation) => {
      const cid = conversation.id;
      const customerId = conversation.customer_id || conversation.user_id;
      const profile = profilesById[customerId] || {};
      const customerName = getProfileName(profile, "Cliente");
      const summaries = buildOrderSummaries(messagesByConversation[cid] || []);
      return summaries
        .filter((order) => order.adminConfirmed)
        .map((order) => {
          const images = order.items.map((item) => item.image).filter(Boolean);
          const first = order.items[0] || {};
          return {
            id: `${cid}-${order.orderSignature || order.key}`,
            conversationId: cid,
            orderKey: order.key,
            orderNumber: order.number,
            customer: customerName,
            customerId,
            phone: profile.phone || profile.telefono || profile.phone_number || "Sin teléfono",
            address: profile.shipping_address || profile.address || profile.direccion || "Sin dirección",
            city: profile.city || profile.ciudad || "Sin ciudad",
            postalCode: profile.postal_code || profile.codigo_postal || profile.zip || "Sin código postal",
            items: order.items,
            images,
            image: images[0] || fallbackImage,
            product: order.items.length === 1 ? first.name : `${order.items.length} productos`,
            size: order.items.length === 1 ? first.size : "Varias",
            method: order.paymentMethod || "Pendiente",
            total: order.total,
            price: `€ ${order.total.toFixed(2)}`,
            createdAt: order.createdAt || conversation.created_at || null,
            approvedAt: order.approvedAt || order.createdAt || conversation.created_at || null,
            status: "Pagada",
          };
        });
    })
    .sort((a, b) => String(b.approvedAt || b.createdAt).localeCompare(String(a.approvedAt || a.createdAt)));
}


function normalizeConfirmedOrderRow(row = {}) {
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const items = normalizeOrderItems(rawItems);
  const rawImages = Array.isArray(row.images) ? row.images : [];
  const images = rawImages.length ? rawImages : items.map((item) => item.image).filter(Boolean);
  const total = Number(row.total ?? row.amount ?? 0);
  return {
    id: row.id,
    conversationId: row.conversation_id || row.conversationId || null,
    orderKey: row.order_key || row.orderKey || row.id,
    orderNumber: row.order_number || row.orderNumber || 1,
    customer: row.customer_name || row.customer || "Cliente",
    customerId: row.customer_id || row.customerId || null,
    phone: row.phone || row.telefono || "Sin teléfono",
    address: row.address || row.shipping_address || "Sin dirección",
    city: row.city || row.ciudad || "Sin ciudad",
    postalCode: row.postal_code || row.postalCode || row.codigo_postal || "Sin código postal",
    items,
    images,
    image: images[0] || fallbackImage,
    product: row.product || (items.length === 1 ? items[0]?.name : `${items.length} productos`),
    size: row.size || (items.length === 1 ? items[0]?.size : "Varias"),
    method: row.method || row.payment_method || "Pendiente",
    total,
    price: row.price || `€ ${total.toFixed(2)}`,
    createdAt: row.created_at_order || row.createdAt || row.created_at || null,
    approvedAt: row.approved_at || row.approvedAt || row.created_at || null,
    status: row.status || "Pagada",
  };
}

function confirmedOrderToPayload(order, selectedConversation, customerId, customerName, profile = {}) {
  const items = normalizeOrderItems(order?.items || []);
  const images = items.map((item) => item.image).filter(Boolean);
  const total = Number(order?.total || items.reduce((sum, item) => sum + item.price * item.qty, 0));
  const key = order?.orderSignature || order?.key || `order-${Date.now()}`;
  const conversationId = selectedConversation?.id || null;
  return {
    id: `${conversationId || "chat"}-${key}`,
    conversation_id: conversationId,
    order_key: key,
    order_number: order?.number || 1,
    customer_id: customerId || null,
    customer_name: customerName || "Cliente",
    phone: profile?.phone || profile?.telefono || profile?.phone_number || "Sin teléfono",
    address: profile?.shipping_address || profile?.address || profile?.direccion || "Sin dirección",
    city: profile?.city || profile?.ciudad || "Sin ciudad",
    postal_code: profile?.postal_code || profile?.codigo_postal || profile?.zip || "Sin código postal",
    items,
    images,
    product: items.length === 1 ? items[0]?.name : `${items.length} productos`,
    size: items.length === 1 ? items[0]?.size : "Varias",
    method: order?.paymentMethod || "Pendiente",
    total,
    price: `€ ${total.toFixed(2)}`,
    created_at_order: order?.createdAt || selectedConversation?.created_at || null,
    approved_at: new Date().toISOString(),
    status: "Pagada",
  };
}

async function saveConfirmedOrderToSupabase(order, selectedConversation, customerId, customerName, profile = {}) {
  const payload = confirmedOrderToPayload(order, selectedConversation, customerId, customerName, profile);

  // Si este pedido fue eliminado antes desde Pedidos/Pagos/Historial, quitamos esa marca
  // para que una nueva confirmación vuelva a aparecer inmediatamente y también tras refrescar.
  const { error: restoreError } = await supabase
    .from(DELETED_CONFIRMED_ORDERS_TABLE)
    .delete()
    .eq("order_id", payload.id);
  if (restoreError) console.warn("No se pudo reactivar el pedido confirmado:", restoreError);

  const { data, error } = await supabase
    .from(CONFIRMED_ORDERS_TABLE)
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  return { data, error, payload };
}

async function loadDeletedConfirmedOrderIds() {
  const { data, error } = await supabase
    .from(DELETED_CONFIRMED_ORDERS_TABLE)
    .select("order_id");
  if (error) {
    console.warn("Deleted confirmed orders fallback:", error);
    return new Set();
  }
  return new Set((data || []).map((row) => row.order_id).filter(Boolean));
}

function filterDeletedConfirmedOrders(orders = [], deletedIds = new Set()) {
  if (!deletedIds?.size) return orders;
  return orders.filter((order) => !deletedIds.has(order.id));
}

async function markConfirmedOrdersAsDeleted(orderIds = []) {
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : [orderIds]).filter(Boolean))];
  if (!ids.length) return { error: null };
  const payload = ids.map((id) => ({ order_id: id, deleted_at: new Date().toISOString() }));
  return supabase.from(DELETED_CONFIRMED_ORDERS_TABLE).upsert(payload, { onConflict: "order_id" });
}

async function loadConfirmedOrdersFromSupabase() {
  const deletedIds = await loadDeletedConfirmedOrderIds();

  const { data: savedRows, error: savedError } = await supabase
    .from(CONFIRMED_ORDERS_TABLE)
    .select("*")
    .order("approved_at", { ascending: false });

  if (savedError) console.warn("Confirmed orders table fallback:", savedError);

  const savedOrders = !savedError ? (savedRows || []).map(normalizeConfirmedOrderRow) : [];

  const { data: conversations, error: conversationsError } = await supabase
    .from("conversations")
    .select("*")
    .order("created_at", { ascending: false });
  if (conversationsError) {
    if (savedOrders.length) return { data: filterDeletedConfirmedOrders(savedOrders, deletedIds), error: null };
    return { data: [], error: conversationsError };
  }

  const conversationRows = Array.isArray(conversations) ? conversations : [];
  const conversationIds = conversationRows.map((row) => row.id).filter(Boolean);
  if (!conversationIds.length) return { data: filterDeletedConfirmedOrders(savedOrders, deletedIds), error: null };

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("*")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: true });
  if (messagesError) {
    if (savedOrders.length) return { data: filterDeletedConfirmedOrders(savedOrders, deletedIds), error: null };
    return { data: [], error: messagesError };
  }

  const customerIds = [...new Set(conversationRows.map((row) => row.customer_id || row.user_id).filter(Boolean))];
  let profilesById = {};
  if (customerIds.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("*")
      .in("id", customerIds);
    if (!profilesError) (profiles || []).forEach((profile) => { profilesById[profile.id] = profile; });
    else console.warn("Profiles fallback for confirmed orders:", profilesError);
  }

  const legacyOrders = buildConfirmedOrdersFromData(conversationRows, messages || [], profilesById);
  const merged = new Map();
  legacyOrders.forEach((order) => merged.set(order.id, order));
  savedOrders.forEach((order) => merged.set(order.id, order));

  return {
    data: filterDeletedConfirmedOrders([...merged.values()], deletedIds)
      .sort((a, b) => String(b.approvedAt || b.createdAt).localeCompare(String(a.approvedAt || a.createdAt))),
    error: null,
  };
}

function ChatSupportPage() {
  const [conversations, setConversations] = useState([]);
  const [profilesById, setProfilesById] = useState({});
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState("");
  const [orderPanelOpen, setOrderPanelOpen] = useState(false);
  const [orderPanelSelectedKey, setOrderPanelSelectedKey] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  async function loadConversations() {
    setLoading(true);
    const { data, error } = await supabase.from("conversations").select("*").order("created_at", { ascending: false });
    if (error) {
      setWarning(`No se pudieron cargar las conversaciones: ${error.message}`);
      setLoading(false);
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    setConversations(rows);
    setSelectedConversationId((current) => current);

    const customerIds = [...new Set(rows.map((row) => row.customer_id || row.user_id).filter(Boolean))];
    if (customerIds.length) {
      const profilesResult = await supabase.from("profiles").select("*").in("id", customerIds);
      if (!profilesResult.error) {
        const map = {};
        (profilesResult.data || []).forEach((profile) => { map[profile.id] = profile; });
        setProfilesById(map);
      }
    }

    if (rows.length) await loadMessages(rows.map((row) => row.id));
    setLoading(false);
  }

  async function loadMessages(conversationIds) {
    const ids = Array.isArray(conversationIds) ? conversationIds.filter(Boolean) : [conversationIds].filter(Boolean);
    if (!ids.length) return;
    const { data, error } = await supabase.from("messages").select("*").in("conversation_id", ids).order("created_at", { ascending: true });
    if (error) {
      setWarning(`No se pudieron cargar los mensajes: ${error.message}`);
      return;
    }
    setMessagesByConversation((current) => {
      const next = { ...current };
      ids.forEach((id) => { next[id] = []; });
      (data || []).forEach((row) => {
        const cid = row.conversation_id;
        next[cid] = [...(next[cid] || []), chatMessageFromDb(row)];
      });
      return next;
    });
  }

  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    const channel = supabase
      .channel("admin-chat-support-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadConversations())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new;
        setMessagesByConversation((current) => ({
          ...current,
          [row.conversation_id]: [...(current[row.conversation_id] || []), chatMessageFromDb(row)],
        }));
        setConversations((current) => current.map((conversation) => conversation.id === row.conversation_id ? { ...conversation, last_message_at: row.created_at } : conversation));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    function handleEsc(event) {
      if (event.key === "Escape") {
        if (deleteConfirmOpen) setDeleteConfirmOpen(false);
        else if (orderPanelOpen && orderPanelSelectedKey) setOrderPanelSelectedKey(null);
        else if (orderPanelOpen) setOrderPanelOpen(false);
        else setSelectedConversationId(null);
      }
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [orderPanelOpen, orderPanelSelectedKey, deleteConfirmOpen]);

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId) || null;
  const selectedMessages = selectedConversation ? messagesByConversation[selectedConversation.id] || [] : [];
  const customerId = selectedConversation?.customer_id || selectedConversation?.user_id;
  const customerName = getProfileName(profilesById[customerId], selectedMessages.find((message) => message.customerName)?.customerName || "Cliente");
  const orderSummaries = buildOrderSummaries(selectedMessages);
  const selectedOrderSummary = orderPanelSelectedKey ? orderSummaries.find((order) => order.key === orderPanelSelectedKey) || null : null;
  const packageState = getOrdersPackageState(orderSummaries);

  function getConversationPackageState(messages = []) {
    return getOrdersPackageState(buildOrderSummaries(messages));
  }

  function closeCurrentChat() {
    setOrderPanelOpen(false);
    setOrderPanelSelectedKey(null);
    setDeleteConfirmOpen(false);
    setSelectedConversationId(null);
  }

  async function deleteCurrentConversation() {
    if (!selectedConversation) return;
    const conversationId = selectedConversation.id;
    setDeleteConfirmOpen(false);
    setOrderPanelOpen(false);
    setOrderPanelSelectedKey(null);

    const { data, error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", conversationId)
      .select("id");

    if (error) {
      setWarning(`No se pudo cerrar el chat: ${error.message}`);
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      setWarning("No se pudo cerrar el chat. Revisa que el panel tenga permiso para cerrar conversaciones.");
      await loadConversations();
      return;
    }

    setSelectedConversationId(null);
    setMessagesByConversation((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
  }

  async function confirmPaymentFromAdmin(orderToConfirm) {
    if (!selectedConversation || !orderToConfirm || orderToConfirm.adminConfirmed) return;
    const message = normalizeChatMessage({
      sender: "admin",
      type: "payment_confirmed",
      adminConfirmed: true,
      text: `Pago confirmado por OutletStock para el Pedido Nº ${orderToConfirm.number}.`,
      orderSignature: orderToConfirm.orderSignature || orderToConfirm.key,
      orderNumber: orderToConfirm.number,
      time: nowTime(),
    });
    const { error } = await supabase.from("messages").insert({
      conversation_id: selectedConversation.id,
      sender_id: customerId,
      body: JSON.stringify(message),
    });
    if (error) {
      setWarning(`No se pudo confirmar el pago: ${error.message}`);
      return;
    }

    const profile = profilesById[customerId] || {};
    const saved = await saveConfirmedOrderToSupabase(orderToConfirm, selectedConversation, customerId, customerName, profile);
    if (saved.error) {
      setWarning(`El pago fue confirmado, pero no se pudo guardar el pedido: ${saved.error.message}`);
      return;
    }
    window.dispatchEvent(new CustomEvent("confirmed-orders-refresh"));
    setOrderPanelSelectedKey(null);
  }

  async function sendAdminMessage() {
    const clean = draft.trim();
    if (!clean || !selectedConversation) return;
    setDraft("");
    const message = normalizeChatMessage({ sender: "admin", text: clean, time: nowTime() });
    const { error } = await supabase.from("messages").insert({
      conversation_id: selectedConversation.id,
      sender_id: customerId,
      body: JSON.stringify(message),
    });
    if (error) setWarning(`No se pudo enviar el mensaje: ${error.message}`);
  }

  return (
    <section className="h-screen min-h-0 overflow-hidden border-l border-cyan-500/10 bg-[#020817]/70 shadow-2xl shadow-cyan-500/10">
      <div className="grid h-full grid-cols-1 md:grid-cols-[340px_1fr]">
        <aside className="min-h-0 border-r border-cyan-500/10 bg-[#050b16]/80">
          <div className="border-b border-cyan-500/10 p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-400 text-[#020817]"><Icon name="chat" /></div>
              <div><h2 className="font-black">Chat soporte</h2><p className="text-xs text-cyan-100/70">Conversaciones del catálogo</p></div>
            </div>
          </div>
          <div className="chat-scroll h-[calc(100%-78px)] overflow-y-auto p-2">
            {loading ? <p className="p-4 text-sm text-slate-400">Cargando conversaciones...</p> : conversations.length === 0 ? <p className="p-4 text-sm text-slate-400">Aún no hay clientes escribiendo.</p> : conversations.map((conversation) => {
              const cid = conversation.id;
              const clientId = conversation.customer_id || conversation.user_id;
              const msgs = messagesByConversation[cid] || [];
              const last = msgs[msgs.length - 1];
              const name = getProfileName(profilesById[clientId], msgs.find((message) => message.customerName)?.customerName || "Cliente");
              const listPackageState = getConversationPackageState(msgs);
              return <button key={cid} onClick={() => setSelectedConversationId(cid)} className={`${selectedConversationId === cid ? "border-cyan-400/40 bg-cyan-400/10" : "border-transparent hover:bg-white/[0.04]"} mb-2 w-full rounded-2xl border p-3 text-left transition`}>
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-400/30 to-blue-500/20 text-sm font-black text-cyan-100">{name.slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><p className="truncate text-sm font-black text-white">{name}</p>{listPackageState && <PackageStatusIcon state={listPackageState} size="sm" />}</div><span className="text-[10px] text-cyan-100/55">{last?.time || formatChatTime(conversation.created_at)}</span></div><p className="truncate text-xs text-slate-400">{chatPreview(last)}</p></div>
                </div>
              </button>;
            })}
          </div>
        </aside>

        <main className="relative flex min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(0,224,255,0.10),transparent_35%),linear-gradient(135deg,#020817,#031525,#020617)]">
          {selectedConversation ? <>
            <header className="border-b border-cyan-500/10 bg-[#020817]/90 p-4 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative grid h-12 w-12 place-items-center rounded-2xl border border-cyan-400/20 bg-[#050b16]"><span className="font-black text-cyan-100">{customerName.slice(0,1).toUpperCase()}</span><span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-cyan-400 ring-2 ring-[#020817]" /></div>
                  <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><p className="truncate font-black">{customerName}</p>{packageState && <PackageStatusIcon state={packageState} />}</div><p className="truncate text-xs text-cyan-200/80">En línea · responde como OutletStock</p></div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => { setOrderPanelOpen(true); setOrderPanelSelectedKey(null); }} title="Ver pedidos" className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-100 transition hover:bg-cyan-400/20"><Icon name="receipt" /></button>
                  <button onClick={() => setDeleteConfirmOpen(true)} title="Cerrar/eliminar chat" className="grid h-11 w-11 place-items-center rounded-2xl border border-red-400/25 bg-red-400/10 text-red-100 transition hover:bg-red-400/20"><Icon name="trash" /></button>
                  <button onClick={closeCurrentChat} title="Cerrar chat" className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-cyan-100 transition hover:bg-white/10"><Icon name="close" /></button>
                </div>
              </div>
            </header>
            <div className="chat-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5">
              <div className="mx-auto mb-4 flex w-fit items-center gap-2 rounded-full border border-cyan-500/10 bg-cyan-400/10 px-4 py-2 text-xs font-bold text-cyan-100">Chat seguro con Outlet Stock</div>
              {warning && <div className="mx-auto max-w-xl rounded-2xl border border-yellow-300/20 bg-yellow-300/10 p-3 text-xs text-yellow-100">{warning}</div>}
              {selectedMessages.map((message, index) => <AdminMessageBubble key={message.id || index} message={message} customerName={customerName} />)}
            </div>
            {orderPanelOpen && <OrderSummaryPanel customerName={customerName} orders={orderSummaries} selectedOrder={selectedOrderSummary} selectedOrderKey={orderPanelSelectedKey} onSelectOrder={setOrderPanelSelectedKey} onBack={() => setOrderPanelSelectedKey(null)} onClose={() => { setOrderPanelOpen(false); setOrderPanelSelectedKey(null); }} onConfirm={confirmPaymentFromAdmin} />}
            {deleteConfirmOpen && <DeleteConversationConfirm customerName={customerName} onCancel={() => setDeleteConfirmOpen(false)} onConfirm={deleteCurrentConversation} />}
            <footer className="border-t border-cyan-500/10 bg-[#020817]/90 p-3 backdrop-blur-xl">
              <div className="flex items-end gap-3 rounded-3xl border border-cyan-500/10 bg-[#081320] p-2 shadow-xl shadow-cyan-500/10">
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendAdminMessage(); } }} rows={1} placeholder="Escribe como OutletStock..." className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-1 py-3 text-sm text-white outline-none placeholder:text-zinc-500" />
                <button onClick={sendAdminMessage} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-400 text-[#020817] shadow-lg shadow-cyan-500/20 transition active:scale-95"><Icon name="send" /></button>
              </div>
            </footer>
          </> : <div className="grid h-full place-items-center p-6 text-center text-slate-400">Dale click a un chat para abrirlo.</div>}
        </main>
      </div>
      <style>{`.chat-scroll{scrollbar-width:none;-ms-overflow-style:none}.chat-scroll::-webkit-scrollbar{display:none}`}</style>
    </section>
  );
}

function DeleteConversationConfirm({ customerName, onCancel, onConfirm }) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/65 p-4 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-sm rounded-3xl border border-red-400/25 bg-[#061223] p-5 text-center shadow-2xl shadow-red-500/20">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-red-300/30 bg-red-400/10 text-red-100"><Icon name="trash" /></div>
        <h4 className="text-lg font-black text-white">Cerrar chat</h4>
        <p className="mt-2 text-sm leading-relaxed text-cyan-100/75">¿De verdad deseas cerrar y eliminar el chat de <span className="font-black text-cyan-100">{customerName}</span>? Esta acción cerrará la conversación y ya no aparecerá en el panel.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={onCancel} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-cyan-100 transition hover:bg-white/10">No</button>
          <button onClick={onConfirm} className="rounded-2xl bg-red-400 px-4 py-3 text-sm font-black text-[#020817] shadow-lg shadow-red-500/20 transition active:scale-95">Sí, cerrar</button>
        </div>
      </motion.div>
    </div>
  );
}

function PackageStatusIcon({ state, size = "md" }) {
  const pending = state === "pending";
  const boxSize = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4.5 w-4.5";
  return (
    <span title={pending ? "Pago por confirmar" : "Pago confirmado"} className={`${boxSize} grid shrink-0 place-items-center rounded-xl border ${pending ? "border-emerald-300/60 bg-emerald-400/20 text-emerald-200 shadow-[0_0_18px_rgba(52,211,153,.75)]" : "border-amber-300/45 bg-amber-500/15 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,.25)]"}`}>
      <Icon name={pending ? "bagGlow" : "boxDone"} className={iconSize} />
    </span>
  );
}

function OrderSummaryPanel({ customerName, orders = [], selectedOrder, selectedOrderKey, onSelectOrder, onBack, onClose, onConfirm }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const singleOrder = orders.length === 1 ? orders[0] : null;
  const displayOrder = selectedOrder || singleOrder;
  const showingDetail = Boolean(displayOrder);
  const canGoBackToList = Boolean(selectedOrderKey && selectedOrder && orders.length > 1);

  function handleConfirmClick() {
    if (!displayOrder || displayOrder.adminConfirmed || !displayOrder.items.length) return;
    setConfirmOpen(true);
  }

  function handleConfirmYes() {
    setConfirmOpen(false);
    onConfirm(displayOrder);
  }

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-full justify-end bg-[#020817]/45 backdrop-blur-sm">
      <motion.aside initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 80, opacity: 0 }} className="chat-scroll h-full w-full max-w-md overflow-y-auto border-l border-cyan-400/20 bg-[#04101f] p-4 shadow-2xl shadow-cyan-500/20">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">Resumen de pedido</p>
            <h3 className="mt-1 text-2xl font-black text-white">{showingDetail ? `Pedido Nº ${displayOrder.number}` : customerName}</h3>
          </div>
          <button onClick={canGoBackToList ? onBack : onClose} title={canGoBackToList ? "Volver" : "Cerrar"} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5 text-cyan-100 transition hover:bg-white/10"><Icon name="close" /></button>
        </div>

        {!orders.length ? (
          <div className="rounded-3xl border border-yellow-300/20 bg-yellow-300/10 p-4 text-sm text-yellow-100">Este chat todavía no tiene un pedido detectado.</div>
        ) : !showingDetail ? (
          <div className="space-y-3">
            <p className="text-sm text-cyan-100/70">Selecciona un pedido para ver el detalle.</p>
            {orders.map((order) => {
              const state = order.customerPaymentReported && !order.adminConfirmed ? "pending" : order.adminConfirmed ? "confirmed" : null;
              return (
                <button key={order.key} onClick={() => onSelectOrder(order.key)} className="flex w-full items-center justify-between gap-3 rounded-3xl border border-cyan-400/15 bg-[#020817]/70 p-4 text-left transition hover:border-cyan-300/40 hover:bg-cyan-400/10">
                  <div className="min-w-0">
                    <p className="font-black text-white">Pedido Nº {order.number}</p>
                    <p className="mt-1 text-xs text-cyan-100/60">{order.items.length} producto{order.items.length === 1 ? "" : "s"} · {order.paymentMethod}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-black text-cyan-100">€ {order.total.toFixed(2)}</span>
                    {state ? <PackageStatusIcon state={state} /> : <span className="h-8 w-8 rounded-xl border border-white/10 bg-white/5" />}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {displayOrder.items.map((item) => <div key={`${item.id}-${item.size}`} className="flex gap-3 rounded-3xl border border-cyan-400/15 bg-[#020817]/70 p-3">
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-cyan-950/60">{item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : <span className="text-xs font-black text-cyan-100">OS</span>}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black text-white">{item.name}</p>
                  <p className="mt-1 text-xs text-cyan-100/70">Talla {item.size} · Cant. {item.qty}</p>
                  <p className="mt-2 text-sm font-black text-cyan-100">€ {(item.price * item.qty).toFixed(2)}</p>
                </div>
              </div>)}
              <div className="rounded-3xl border border-cyan-400/15 bg-cyan-400/10 p-4">
                <div className="flex justify-between text-lg font-black"><span>Total</span><span>€ {displayOrder.total.toFixed(2)}</span></div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 rounded-3xl border border-cyan-400/15 bg-[#020817]/70 p-4">
              <div className="flex items-center justify-between gap-3"><span className="text-sm text-cyan-100/70">Método de pago</span><span className="rounded-full bg-cyan-400/10 px-3 py-1 text-sm font-black text-cyan-100">{displayOrder.paymentMethod}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="text-sm text-cyan-100/70">Estado</span><span className={`rounded-full px-3 py-1 text-sm font-black ${displayOrder.adminConfirmed || displayOrder.customerPaymentReported ? "bg-emerald-400/15 text-emerald-200" : "bg-yellow-300/10 text-yellow-100"}`}>{displayOrder.adminConfirmed || displayOrder.customerPaymentReported ? "Pagado" : "Pendiente"}</span></div>
            </div>

            <button onClick={handleConfirmClick} disabled={displayOrder.adminConfirmed || !displayOrder.items.length} className="mt-4 w-full rounded-3xl bg-cyan-400 px-5 py-4 text-sm font-black text-[#020817] shadow-lg shadow-cyan-500/20 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">{displayOrder.adminConfirmed ? "Pago confirmado" : "Pago ya confirmado"}</button>
          </>
        )}

        {confirmOpen && displayOrder && (
          <div className="fixed inset-0 z-40 grid place-items-center bg-black/65 p-4 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-sm rounded-3xl border border-cyan-400/20 bg-[#061223] p-5 text-center shadow-2xl shadow-cyan-500/20">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-yellow-300/30 bg-yellow-300/10 text-yellow-100"><Icon name="receipt" /></div>
              <h4 className="text-lg font-black text-white">Confirmar pago</h4>
              <p className="mt-2 text-sm leading-relaxed text-cyan-100/75">¿Está seguro que recibió el dinero del <span className="font-black text-cyan-100">Pedido Nº {displayOrder.number}</span> en el método de pago: <span className="font-black text-cyan-100">{displayOrder.paymentMethod}</span>?</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <button onClick={() => setConfirmOpen(false)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-cyan-100 transition hover:bg-white/10">No</button>
                <button onClick={handleConfirmYes} className="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-black text-[#020817] shadow-lg shadow-cyan-500/20 transition active:scale-95">Sí</button>
              </div>
            </motion.div>
          </div>
        )}
      </motion.aside>
    </div>
  );
}

function AdminMessageBubble({ message, customerName }) {
  const mine = message.sender === "admin";
  if (message.type === "order") {
    const items = normalizeOrderItems(message.items || []);
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start"><div className="w-full max-w-[88%] rounded-3xl rounded-bl-md border border-cyan-400/30 bg-cyan-400/15 p-3 text-white shadow-lg shadow-cyan-500/10 md:max-w-[72%]"><p className="mb-3 text-sm font-black">Pedido enviado por {customerName}</p>{items.map((item) => <div key={`${item.id}-${item.size}`} className="mb-2 flex gap-3 rounded-2xl bg-[#020817]/45 p-2"><div className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl bg-cyan-950/60">{item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : <span className="text-[8px] font-black">OS</span>}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{item.name}</p><p className="text-[11px] text-cyan-100/75">Talla {item.size} · Cant. {item.qty}</p></div><p className="text-xs font-black">€ {(item.price * item.qty).toFixed(2)}</p></div>)}<div className="mt-3 flex justify-between rounded-2xl bg-[#020817]/60 p-3 text-sm font-black"><span>Total</span><span>€ {total.toFixed(2)}</span></div><p className="mt-2 text-right text-[10px] text-cyan-100/70">{message.time}</p></div></motion.div>;
  }
  if (message.type === "payment_confirmed") return <div className={`mx-auto w-fit rounded-2xl border px-4 py-3 text-sm font-black ${message.adminConfirmed === true ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-100" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"}`}>{message.adminConfirmed === true ? "Pago confirmado por OutletStock" : `${customerName} avisó que ya pagó`} · {message.time}</div>;
  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`${mine ? "rounded-br-md border-cyan-400/30 bg-cyan-400/15 text-white shadow-cyan-500/10" : "rounded-bl-md border-white/10 bg-[#0b1727] text-zinc-100 shadow-black/20"} max-w-[82%] rounded-3xl border px-4 py-3 shadow-lg`}><p className="mb-1 text-[11px] font-black text-cyan-100/70">{mine ? "OutletStock" : customerName}</p>{message.text && <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>}{message.paymentCard && <div className="mt-3 rounded-2xl border border-cyan-400/20 bg-[#020817]/70 p-3 text-xs text-cyan-100">Datos de pago enviados</div>}{message.buttons?.length ? <div className="mt-3 flex flex-wrap gap-2">{message.buttons.map((button) => <span key={button} className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs font-black text-cyan-100">{button}</span>)}</div> : null}<p className={`mt-2 text-[10px] ${mine ? "text-right text-cyan-100/80" : "text-zinc-400"}`}>{message.time}</p></div></motion.div>;
}

export default function AdminCatalogPanel() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [viewingOrder, setViewingOrder] = useState(null);
  const [orderDeleteFlow, setOrderDeleteFlow] = useState(null);
  const [productSearch, setProductSearch] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [supabaseStatus, setSupabaseStatus] = useState("Conectando con Supabase...");
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState(createEmptyProductForm);
  const [errors, setErrors] = useState({});
  const [editingProduct, setEditingProduct] = useState(null);
  const [editForm, setEditForm] = useState(createEmptyProductForm);
  const [editErrors, setEditErrors] = useState({});

  useEffect(() => {
    let mounted = true;
    async function loadProducts() {
      setSupabaseStatus(reloadKey > 0 ? "Sincronizando con Supabase..." : "Conectando con Supabase...");
      const result = await loadSupabaseProducts();
      if (!mounted) return;
      if (result.error) {
        setProducts([]);
        setSupabaseStatus(`No se pudo leer Supabase: ${result.error.message || "error desconocido"}`);
        console.warn("Supabase products error:", result.error);
        return;
      }
      setProducts(result.data || []);
      setSupabaseStatus(result.data?.length ? `Supabase conectado: ${result.data.length} producto(s) cargado(s).` : "Supabase conectado. No hay productos todavía.");
    }
    loadProducts();
    return () => {
      mounted = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    const channel = supabase
      .channel("products-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: PRODUCTS_TABLE }, () => setReloadKey((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: SIZE_TABLE }, () => setReloadKey((value) => value + 1))
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadConfirmedOrders() {
      const result = await loadConfirmedOrdersFromSupabase();
      if (!mounted) return;
      if (result.error) {
        console.warn("Confirmed orders error:", result.error);
        setOrders([]);
        return;
      }
      setOrders(result.data || []);
    }
    loadConfirmedOrders();
    window.addEventListener("confirmed-orders-refresh", loadConfirmedOrders);
    window.addEventListener("focus", loadConfirmedOrders);

    // Realtime principal: actualiza Pedidos/Pagos/Historial cuando otro dispositivo
    // confirma, elimina o modifica pedidos confirmados.
    const channel = supabase
      .channel(`confirmed-orders-realtime-${Math.random().toString(16).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: CONFIRMED_ORDERS_TABLE }, () => loadConfirmedOrders())
      .on("postgres_changes", { event: "*", schema: "public", table: DELETED_CONFIRMED_ORDERS_TABLE }, () => loadConfirmedOrders())
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => loadConfirmedOrders())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadConfirmedOrders())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadConfirmedOrders())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") loadConfirmedOrders();
      });

    // Respaldo suave: si el navegador o la red pierde un evento realtime,
    // se sincroniza solo cada pocos segundos sin necesitar F5.
    const syncInterval = window.setInterval(loadConfirmedOrders, 4000);
    const handleVisibilityChange = () => {
      if (!document.hidden) loadConfirmedOrders();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mounted = false;
      window.removeEventListener("confirmed-orders-refresh", loadConfirmedOrders);
      window.removeEventListener("focus", loadConfirmedOrders);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(syncInterval);
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredProducts = useMemo(() => {
    const query = normalizeText(productSearch);
    return products.filter((product) => normalizeText(`${product.title} ${product.description} ${product.price} ${product.status} ${product.category} ${product.categoryExtra}`).includes(query));
  }, [products, productSearch]);

  const visibleProducts = useMemo(() => filteredProducts.slice(0, 4), [filteredProducts]);
  const filteredOrders = useMemo(() => {
    const query = normalizeText(orderSearch);
    return orders.filter((order) => normalizeText(`${order.id} ${order.customer} ${order.address} ${order.product} ${order.price} ${order.method} ${order.size}`).includes(query));
  }, [orders, orderSearch]);
  const visibleOrders = useMemo(() => filteredOrders.slice(0, 4), [filteredOrders]);
  const totalSales = useMemo(() => orders.reduce((acc, order) => acc + parseMoney(order.price), 0), [orders]);
  const paymentStats = useMemo(() => {
    const base = { Bizum: { total: 0, count: 0 }, PayPal: { total: 0, count: 0 }, Transferencias: { total: 0, count: 0 } };
    orders.forEach((order) => {
      const method = base[order.method] ? order.method : "Transferencias";
      base[method].total += parseMoney(order.price);
      base[method].count += 1;
    });
    return base;
  }, [orders]);
  const orderHistory = useMemo(() => {
    const query = normalizeText(historySearch);
    return buildOrderHistory(orders).filter((item) => normalizeText(`${item.date} ${item.type} ${item.customer} ${item.firstName} ${item.product} ${item.price} ${item.detail} ${item.status}`).includes(query));
  }, [orders, historySearch]);
  const approvedOrders = useMemo(() => orders.slice(0, 8), [orders]);

  function handleImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setForm((current) => ({ ...current, imageFile: file, imagePreview: URL.createObjectURL(file), imageUrl: "" }));
  }

  function removeSelectedImage() {
    setForm((current) => ({ ...current, imageFile: null, imagePreview: "", imageUrl: "" }));
  }

  async function addProduct(event) {
    event.preventDefault();
    const validation = validateProduct(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    let imageUrl = form.imageUrl || "";
    try {
      if (form.imageFile) {
        setSupabaseStatus("Subiendo imagen a Cloudinary...");
        imageUrl = await uploadImageToCloudinary(form.imageFile);
      }
    } catch (uploadError) {
      setSupabaseStatus(`No se pudo subir la imagen: ${uploadError.message}`);
      console.warn("Cloudinary upload error:", uploadError);
      return;
    }

    const newProduct = {
      title: form.title.trim(),
      description: form.description.trim(),
      price: form.useSizePricing ? getDisplayPrice(form) : Number(form.price).toFixed(2),
      stock: form.useSizePricing ? null : normalizeStock(form.stock, 0),
      useSizePricing: form.useSizePricing,
      sizes: form.useSizePricing ? { ...form.sizes } : null,
      sizeStocks: form.useSizePricing ? { ...form.sizeStocks } : null,
      category: form.category.trim(),
      categoryExtraEnabled: Boolean(form.categoryExtraEnabled),
      categoryExtra: form.categoryExtraEnabled ? form.categoryExtra.trim() : "",
      image: imageUrl || fallbackImage,
      status: "Activo",
    };

    setSupabaseStatus("Guardando producto en Supabase...");
    const { data, error } = await supabase.from(PRODUCTS_TABLE).insert(productToSupabasePayload(newProduct)).select().single();
    if (error) {
      setSupabaseStatus(`No se pudo guardar en Supabase: ${error.message}`);
      alert(`La imagen sí se subió a Cloudinary, pero Supabase rechazó el producto: ${error.message}`);
      console.warn("Supabase insert error:", error);
      return;
    }

    const savedProduct = mapSupabaseProduct(data);
    if (newProduct.useSizePricing) {
      const sizeResult = await saveProductSizes(savedProduct.id, newProduct.sizes, newProduct.sizeStocks);
      if (sizeResult.error) console.warn("Supabase sizes insert error:", sizeResult.error);
    }

    setForm(createEmptyProductForm());
    setErrors({});
    setReloadKey((value) => value + 1);
    setSupabaseStatus("Producto guardado en Supabase con imagen.");
  }

  async function deleteProduct(id) {
    const previousProducts = products;
    const productToDelete = products.find((product) => product.id === id);
    const idColumn = productToDelete?.idColumn || "id";
    const imageUrl = productToDelete?.image;

    setProducts((current) => current.filter((product) => product.id !== id));
    if (editingProduct?.id === id) closeEditForm();

    setSupabaseStatus("Eliminando producto e imagen...");

    const imageResult = await deleteCloudinaryImageFromUrl(imageUrl);
    if (imageResult.error) {
      console.warn("Cloudinary delete warning:", imageResult.error);
    }

    const { error } = await supabase.from(PRODUCTS_TABLE).delete().eq(idColumn, id);
    if (error) {
      setProducts(previousProducts);
      setSupabaseStatus(`No se pudo eliminar: ${error.message}`);
      console.warn("Supabase delete error:", error);
      return;
    }

    if (imageResult.error) {
      setSupabaseStatus("Producto eliminado. La imagen no se pudo borrar automáticamente; revisa que la función esté desplegada.");
      return;
    }

    setSupabaseStatus("Producto eliminado junto con su imagen.");
  }

  function openEditForm(product) {
    setEditingProduct(product);
    setEditForm({
      title: product.title,
      description: product.description,
      price: product.useSizePricing ? "" : getDisplayPrice(product),
      stock: String(product.stock ?? "1"),
      image: product.image,
      imageUrl: product.image,
      imagePreview: "",
      imageFile: null,
      category: product.category || "",
      categoryExtraEnabled: Boolean(product.categoryExtra),
      categoryExtra: product.categoryExtra || "",
      useSizePricing: Boolean(product.useSizePricing),
      sizes: product.useSizePricing ? { ...DEFAULT_SIZES, ...(product.sizes || {}) } : { ...DEFAULT_SIZES },
      sizeStocks: product.useSizePricing ? { ...DEFAULT_SIZE_STOCKS, ...(product.sizeStocks || {}) } : { ...DEFAULT_SIZE_STOCKS },
    });
    setEditErrors({});
  }

  function closeEditForm() {
    setEditingProduct(null);
    setEditForm(createEmptyProductForm());
    setEditErrors({});
  }

  async function saveEditedProduct(event) {
    event.preventDefault();
    if (!editingProduct) return;

    const validation = validateProduct(editForm);
    setEditErrors(validation);
    if (Object.keys(validation).length > 0) return;

    let imageUrl = editForm.imageUrl || editForm.image || editingProduct.image;
    try {
      if (editForm.imageFile) {
        setSupabaseStatus("Subiendo nueva imagen a Cloudinary...");
        imageUrl = await uploadImageToCloudinary(editForm.imageFile);
      }
    } catch (uploadError) {
      setSupabaseStatus(`No se pudo subir la imagen: ${uploadError.message}`);
      console.warn("Cloudinary upload error:", uploadError);
      return;
    }

    const updatedProduct = {
      ...editingProduct,
      title: editForm.title.trim(),
      description: editForm.description.trim(),
      price: editForm.useSizePricing ? getDisplayPrice(editForm) : Number(editForm.price).toFixed(2),
      stock: editForm.useSizePricing ? null : normalizeStock(editForm.stock, 0),
      useSizePricing: editForm.useSizePricing,
      sizes: editForm.useSizePricing ? { ...editForm.sizes } : null,
      sizeStocks: editForm.useSizePricing ? { ...editForm.sizeStocks } : null,
      category: editForm.category.trim(),
      categoryExtraEnabled: Boolean(editForm.categoryExtraEnabled),
      categoryExtra: editForm.categoryExtraEnabled ? editForm.categoryExtra.trim() : "",
      image: imageUrl,
      status: editingProduct.status || "Activo",
    };

    const previousProducts = products;
    setProducts((current) => current.map((product) => (product.id === editingProduct.id ? updatedProduct : product)));
    closeEditForm();

    setSupabaseStatus("Actualizando producto en Supabase...");
    const idColumn = editingProduct.idColumn || "id";
    const { data: updatedRows, error } = await supabase.from(PRODUCTS_TABLE).update(productToSupabasePayload(updatedProduct)).eq(idColumn, editingProduct.id).select();
    if (error || !updatedRows?.length) {
      setProducts(previousProducts);
      setSupabaseStatus(error ? `No se pudo actualizar en Supabase: ${error.message}` : `No se actualizó ninguna fila en Supabase. Revisa si el ID real es ${idColumn}.`);
      if (error) alert(`La imagen sí se subió a Cloudinary, pero Supabase rechazó la actualización: ${error.message}`);
      if (error) console.warn("Supabase update error:", error);
      return;
    }

    const sizeResult = await saveProductSizes(editingProduct.id, updatedProduct.useSizePricing ? updatedProduct.sizes : {}, updatedProduct.useSizePricing ? updatedProduct.sizeStocks : {});
    if (sizeResult.error) {
      setProducts(previousProducts);
      setSupabaseStatus(`Producto actualizado, pero fallaron las tallas: ${sizeResult.error.message}`);
      console.warn("Supabase sizes update error:", sizeResult.error);
      return;
    }

    setReloadKey((value) => value + 1);
    setSupabaseStatus("Producto actualizado en Supabase con imagen.");
  }


  function openOrderDeleteFlow(source) {
    if (!orders.length) return;
    setOrderDeleteFlow({ source, mode: source === "history" ? "confirm-all" : "picker", order: null });
  }

  function closeOrderDeleteFlow() {
    setOrderDeleteFlow(null);
  }

  async function deleteConfirmedOrderById(orderId) {
    if (!orderId) return;
    const previousOrders = orders;
    setOrders((current) => current.filter((order) => order.id !== orderId));
    if (viewingOrder?.id === orderId) setViewingOrder(null);
    if (selectedOrder?.id === orderId) setSelectedOrder(null);
    setOrderDeleteFlow(null);

    const tombstoneResult = await markConfirmedOrdersAsDeleted([orderId]);
    if (tombstoneResult.error) {
      setOrders(previousOrders);
      setSupabaseStatus(`No se pudo eliminar el pedido: ${tombstoneResult.error.message}`);
      return;
    }

    const { error } = await supabase.from(CONFIRMED_ORDERS_TABLE).delete().eq("id", orderId);
    if (error) {
      setOrders(previousOrders);
      setSupabaseStatus(`No se pudo eliminar el pedido: ${error.message}`);
      return;
    }
    setSupabaseStatus("Pedido eliminado permanentemente del registro.");
  }

  async function deleteAllConfirmedOrders() {
    const previousOrders = orders;
    setOrders([]);
    setViewingOrder(null);
    setSelectedOrder(null);
    setOrderDeleteFlow(null);

    const ids = previousOrders.map((order) => order.id).filter(Boolean);
    if (!ids.length) return;

    const tombstoneResult = await markConfirmedOrdersAsDeleted(ids);
    if (tombstoneResult.error) {
      setOrders(previousOrders);
      setSupabaseStatus(`No se pudo eliminar el registro: ${tombstoneResult.error.message}`);
      return;
    }

    const { error } = await supabase.from(CONFIRMED_ORDERS_TABLE).delete().in("id", ids);
    if (error) {
      setOrders(previousOrders);
      setSupabaseStatus(`No se pudo eliminar el registro: ${error.message}`);
      return;
    }
    setSupabaseStatus("Registro eliminado permanentemente.");
  }

  function goTo(section) {
    setActiveSection(section);
    setMobileMenuOpen(false);
    if (section === "products") setProductSearch("");
    if (section === "orders") setOrderSearch("");
    if (section === "history") setHistorySearch("");
  }

  const pageTitle = activeSection === "products" ? "Productos" : activeSection === "orders" ? "Pedidos" : activeSection === "history" ? "Historial" : activeSection === "payments" ? "Pagos" : activeSection === "chat" ? "Chat soporte" : "Gestión del catálogo";
  const pageDescription = activeSection === "products" ? "Revisa, busca y edita todos los productos publicados." : activeSection === "orders" ? "Revisa las ventas realizadas y abre el detalle de cada compra." : activeSection === "history" ? "Consulta el historial de compras con fecha, hora, cliente y producto." : activeSection === "payments" ? "Revisa el total ganado y el desglose por método de pago." : activeSection === "chat" ? "Responde a tus clientes en tiempo real como OutletStock." : "Sube productos, revisa compras y administra tu catálogo desde una sola vista.";

  const navProps = {
    activeSection,
    sidebarOpen,
    setSidebarOpen,
    setActiveSection,
    goToProducts: () => goTo("products"),
    goToOrders: () => goTo("orders"),
    goToPayments: () => goTo("payments"),
    goToHistory: () => goTo("history"),
    goToChat: () => goTo("chat"),
  };

  return (
    <div className="min-h-screen bg-[#050914] text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,#123b78_0,transparent_32%),radial-gradient(circle_at_bottom_right,#0d8cff33_0,transparent_30%)]" />
      <div className="relative z-10 flex min-h-screen">
        <Sidebar {...navProps} />

        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden bg-black/65 backdrop-blur-md" onClick={() => setMobileMenuOpen(false)}>
            <aside className="w-72 h-full bg-[#071120] border-r border-white/10 p-4" onClick={(event) => event.stopPropagation()}>
              <SidebarContent {...navProps} sidebarOpen setActiveSection={(section) => goTo(section)} />
            </aside>
          </div>
        )}

        <main className={activeSection === "chat" ? "flex-1 overflow-hidden max-h-screen" : "flex-1 p-4 md:p-7 overflow-y-auto max-h-screen pb-24 md:pb-7"}>
          {activeSection !== "chat" && <PageHeader title={pageTitle} description={pageDescription} status={supabaseStatus} onOpenMobileMenu={() => setMobileMenuOpen(true)} />}
          

          {activeSection === "products" ? (
            <ProductsPage products={products} filteredProducts={filteredProducts} productSearch={productSearch} setProductSearch={setProductSearch} onEdit={openEditForm} onDelete={deleteProduct} />
          ) : activeSection === "orders" ? (
            <OrdersPage approvedOrders={approvedOrders} selectedOrder={selectedOrder} openOrderDetail={(order) => { setSelectedOrder(order); setViewingOrder(order); }} onDeleteRequest={() => openOrderDeleteFlow("orders")} />
          ) : activeSection === "history" ? (
            <HistoryPage orderHistory={orderHistory} historySearch={historySearch} setHistorySearch={setHistorySearch} onDeleteRequest={() => openOrderDeleteFlow("history")} />
          ) : activeSection === "payments" ? (
            <PaymentsPage orders={orders} totalSales={totalSales} paymentStats={paymentStats} onDeleteRequest={() => openOrderDeleteFlow("payments")} />
          ) : activeSection === "chat" ? (
            <ChatSupportPage />
          ) : (
            <DashboardPage products={products} orders={orders} totalSales={totalSales} productSearch={productSearch} setProductSearch={setProductSearch} filteredProducts={filteredProducts} visibleProducts={visibleProducts} form={form} setForm={setForm} errors={errors} addProduct={addProduct} handleImageUpload={handleImageUpload} removeSelectedImage={removeSelectedImage} deleteProduct={deleteProduct} openEditForm={openEditForm} orderSearch={orderSearch} setOrderSearch={setOrderSearch} filteredOrders={filteredOrders} visibleOrders={visibleOrders} selectedOrder={selectedOrder} openOrderDetail={(order) => { setSelectedOrder(order); setViewingOrder(order); }} goToProducts={() => goTo("products")} goToOrders={() => goTo("orders")} />
          )}
        </main>
      </div>

      <MobileBottomNav activeSection={activeSection} setActiveSection={setActiveSection} goToProducts={() => goTo("products")} goToOrders={() => goTo("orders")} goToPayments={() => goTo("payments")} goToHistory={() => goTo("history")} />
      {editingProduct && <EditProductModal editingProduct={editingProduct} editForm={editForm} setEditForm={setEditForm} editErrors={editErrors} onSaveEdit={saveEditedProduct} onCloseEdit={closeEditForm} />}
      {viewingOrder && <OrderDetailModal order={viewingOrder} onClose={() => setViewingOrder(null)} />}
      {orderDeleteFlow && <OrderDeleteModal flow={orderDeleteFlow} orders={orders} onCancel={closeOrderDeleteFlow} onSelectOrder={(order) => setOrderDeleteFlow((current) => ({ ...(current || {}), mode: "confirm-one", order }))} onSelectAll={() => setOrderDeleteFlow((current) => ({ ...(current || {}), mode: "confirm-all", order: null }))} onConfirmOne={(order) => deleteConfirmedOrderById(order.id)} onConfirmAll={deleteAllConfirmedOrders} />}
      <WorkerStatusWidget />
    </div>
  );
}


function formatWorkerRelativeTime(value) {
  if (!value) return "sin señal";
  const date = new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return "sin señal";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 5) return "ahora";
  if (diffSeconds < 60) return `hace ${diffSeconds}s`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `hace ${diffHours} h`;
}

function WorkerStatusWidget() {
  const [worker, setWorker] = useState({ state: "checking", lastSeen: null, error: "" });
  const [nowTick, setNowTick] = useState(Date.now());

  async function checkWorkerStatus() {
    const { data, error } = await supabase
      .from(WORKER_STATUS_TABLE)
      .select("id,name,status,last_seen,last_error,updated_at")
      .eq("id", WORKER_STATUS_ID)
      .maybeSingle();

    if (error) {
      setWorker({ state: "unavailable", lastSeen: null, error: "No se pudo leer el monitor" });
      return;
    }

    if (!data?.last_seen) {
      setWorker({ state: "ready", lastSeen: null, error: "Sin señal del worker" });
      return;
    }

    setWorker({
      state: "ready",
      lastSeen: data.last_seen,
      error: data.last_error || "",
    });
  }

  useEffect(() => {
    checkWorkerStatus();

    // Optimizado para 24/7:
    // - Supabase se consulta cada 10s.
    // - El contador visual se actualiza localmente cada 1s sin llamar a Supabase.
    // - Si pasan más de 20s sin last_seen nuevo, se declara inactivo localmente.
    const supabaseInterval = window.setInterval(checkWorkerStatus, WORKER_CHECK_INTERVAL_MS);
    const localTickInterval = window.setInterval(() => setNowTick(Date.now()), WORKER_LOCAL_TICK_MS);

    return () => {
      window.clearInterval(supabaseInterval);
      window.clearInterval(localTickInterval);
    };
  }, []);

  const lastSeenTime = worker.lastSeen ? new Date(worker.lastSeen).getTime() : NaN;
  const diffSeconds = Number.isFinite(lastSeenTime) ? (nowTick - lastSeenTime) / 1000 : 9999;
  const isChecking = worker.state === "checking";
  const isUnavailable = worker.state === "unavailable";
  const isActive = !isChecking && !isUnavailable && !!worker.lastSeen && diffSeconds <= WORKER_DEAD_AFTER_SECONDS;
  const statusText = isChecking ? "Comprobando..." : isActive ? "Automático activo" : isUnavailable ? "Monitor no disponible" : "Automático inactivo";
  const dotClass = isChecking ? "bg-yellow-300 shadow-[0_0_18px_rgba(253,224,71,.75)]" : isActive ? "bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,.85)]" : "bg-red-400 shadow-[0_0_18px_rgba(248,113,113,.75)]";
  const borderClass = isActive ? "border-emerald-300/25 shadow-emerald-500/10" : isChecking ? "border-yellow-300/25 shadow-yellow-500/10" : "border-red-300/25 shadow-red-500/10";

  function handleActivateClick() {
    alert("Para activarlo, abre nacex_worker.exe en el PC donde está la impresora. Si pasan más de 20 segundos sin señal del worker, este aviso se pondrá Inactivo automáticamente.");
  }

  return (
    <div className={`fixed left-4 bottom-24 md:bottom-4 z-50 w-[260px] rounded-3xl border ${borderClass} bg-[#061223]/95 p-3 text-white shadow-2xl backdrop-blur-xl`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${dotClass}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-200/80">Servicio de etiquetas</p>
          <p className="mt-1 text-sm font-black text-white">{statusText}</p>
          <p className="mt-1 text-[11px] text-slate-400">Última señal: {formatWorkerRelativeTime(worker.lastSeen)}</p>
          {worker.error && <p className="mt-1 truncate text-[10px] text-yellow-100/80" title={worker.error}>{worker.error}</p>}
          {!isActive && !isChecking && (
            <button type="button" onClick={handleActivateClick} className="mt-3 w-full rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-black text-cyan-100 transition hover:bg-cyan-400/20">
              Activar automático
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Sidebar(props) {
  return <aside className={`${props.sidebarOpen ? "w-72" : "w-20"} hidden md:flex transition-all duration-300 border-r border-white/10 bg-black/25 backdrop-blur-xl flex-col p-4`}><SidebarContent {...props} /></aside>;
}


function ChatNavIndicators({ collapsed = false }) {
  const [unreadChats, setUnreadChats] = useState(0);
  const [hasPendingPayment, setHasPendingPayment] = useState(false);

  async function refreshIndicators() {
    const { data: conversationsData } = await supabase.from("conversations").select("id");
    const conversationIds = (conversationsData || []).map((row) => row.id).filter(Boolean);
    if (!conversationIds.length) {
      setUnreadChats(0);
      setHasPendingPayment(false);
      return;
    }

    const { data: messageRows } = await supabase.from("messages").select("*").in("conversation_id", conversationIds).order("created_at", { ascending: true });
    const grouped = {};
    (messageRows || []).forEach((row) => {
      const cid = row.conversation_id;
      grouped[cid] = [...(grouped[cid] || []), chatMessageFromDb(row)];
    });

    const unread = Object.values(grouped).filter((messages) => getConversationUnreadState(messages)).length;
    const pending = Object.values(grouped).some((messages) => getOrdersPackageState(buildOrderSummaries(messages)) === "pending");
    setUnreadChats(unread);
    setHasPendingPayment(pending);
  }

  useEffect(() => {
    refreshIndicators();
    const channel = supabase
      .channel("admin-chat-nav-indicators")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, refreshIndicators)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, refreshIndicators)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  if (!unreadChats && !hasPendingPayment) return null;
  return (
    <span className={`${collapsed ? "absolute -right-1 -top-1" : "ml-auto"} flex items-center gap-1`}>
      {hasPendingPayment && <span title="Pagos por revisar" className="grid h-6 w-6 animate-pulse place-items-center rounded-xl border border-emerald-300/60 bg-emerald-400/20 text-emerald-200 shadow-[0_0_16px_rgba(52,211,153,.8)]"><Icon name="bagGlow" className="h-3.5 w-3.5" /></span>}
      {unreadChats > 0 && <span title={`${unreadChats} chat(s) con mensaje nuevo`} className="grid h-5 min-w-5 place-items-center rounded-full bg-cyan-400 px-1.5 text-[10px] font-black text-[#020817] shadow-lg shadow-cyan-500/30">{unreadChats}</span>}
    </span>
  );
}

function SidebarContent({ activeSection, sidebarOpen, setSidebarOpen, setActiveSection, goToProducts, goToOrders, goToPayments, goToHistory, goToChat }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-8">
        <button onClick={() => setActiveSection("dashboard")} className="flex items-center gap-3 text-left">
          <div className="h-11 w-11 rounded-2xl bg-cyan-400/15 border border-cyan-300/30 grid place-items-center shadow-[0_0_24px_rgba(34,211,238,.25)]"><Icon name="bag" className="h-6 w-6 text-cyan-300" /></div>
          {sidebarOpen && <div><h1 className="font-black tracking-wide">OUTLET STOCK ADMIN</h1><p className="text-xs text-slate-400">Panel de catálogo</p></div>}
        </button>
        <button aria-label="Cambiar tamaño del menú" onClick={() => setSidebarOpen(!sidebarOpen)} className="hidden md:block p-2 rounded-xl hover:bg-white/10"><Icon name="menu" className="h-5 w-5" /></button>
      </div>
      <nav className="space-y-2 text-sm">
        <NavButton icon="home" label="Inicio" active={activeSection === "dashboard"} collapsed={!sidebarOpen} onClick={() => setActiveSection("dashboard")} />
        <NavButton icon="package" label="Productos" active={activeSection === "products"} collapsed={!sidebarOpen} onClick={goToProducts} />
        <NavButton icon="bag" label="Pedidos" active={activeSection === "orders"} collapsed={!sidebarOpen} onClick={goToOrders} />
        <NavButton icon="chat" label="Chat soporte" active={activeSection === "chat"} collapsed={!sidebarOpen} onClick={goToChat} extra={<ChatNavIndicators collapsed={!sidebarOpen} />} />
        <NavButton icon="card" label="Pagos" active={activeSection === "payments"} collapsed={!sidebarOpen} onClick={goToPayments} />
        <NavButton icon="clock" label="Historial" active={activeSection === "history"} collapsed={!sidebarOpen} onClick={goToHistory} />
      </nav>
    </>
  );
}

function PageHeader({ title, description, status, onOpenMobileMenu }) {
  return <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6"><div className="flex items-start gap-3"><button onClick={onOpenMobileMenu} className="md:hidden h-11 w-11 rounded-2xl bg-white/10 border border-white/10 grid place-items-center shrink-0"><Icon name="menu" className="h-5 w-5" /></button><div><p className="text-cyan-300 text-sm font-semibold">[#Outlet_Stock] ➣ PANEL ADMIN</p><h2 className="text-3xl md:text-4xl font-black mt-1">{title}</h2><p className="text-slate-400 mt-2">{description}</p></div></div><button onClick={() => window.open("https://outletstock.app", "_blank")} className="px-4 py-3 rounded-2xl bg-cyan-400 text-slate-950 font-bold flex items-center gap-2"><Icon name="eye" className="h-5 w-5" /> Ver catálogo</button></header>;
}

function StatusBanner({ text }) {
  const lower = String(text || "").toLowerCase();
  const isError = lower.includes("no se pudo") || lower.includes("error");
  const isSuccess = lower.includes("guardado") || lower.includes("actualizado") || lower.includes("eliminado");
  const style = isError ? "border-red-400/30 bg-red-500/10 text-red-200" : isSuccess ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200" : "border-cyan-300/30 bg-cyan-400/10 text-cyan-200";
  return <div className={`mb-5 rounded-2xl border px-4 py-3 text-sm font-semibold ${style}`}>{text}</div>;
}

function DashboardPage(props) {
  const { products, orders, totalSales, productSearch, setProductSearch, filteredProducts, visibleProducts, form, setForm, errors, addProduct, handleImageUpload, removeSelectedImage, deleteProduct, openEditForm, orderSearch, setOrderSearch, filteredOrders, visibleOrders, selectedOrder, openOrderDetail, goToProducts, goToOrders } = props;
  return (
    <>
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-6"><Stat title="Productos activos" value={products.length} icon={<Icon name="package" className="h-6 w-6" />} /><Stat title="Pedidos recibidos" value={orders.length} icon={<Icon name="bag" className="h-6 w-6" />} /><Stat title="Ventas" value={`€ ${totalSales.toFixed(2)}`} icon={<Icon name="card" className="h-6 w-6" />} /></section>
      <section className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="xl:col-span-3 min-w-0 overflow-hidden rounded-3xl bg-white/[0.06] border border-white/10 p-4 md:p-5 shadow-2xl">
          <div className="flex items-center gap-3 mb-5"><div className="p-3 rounded-2xl bg-cyan-400/10 text-cyan-300"><Icon name="upload" className="h-6 w-6" /></div><div><h3 className="text-xl font-black">Nuevo producto</h3><p className="text-sm text-slate-400">Organiza la información, tallas y stock antes de publicar.</p></div></div>
          <form onSubmit={addProduct} className="grid min-w-0 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-5 items-start"><ProductImagePicker form={form} setForm={setForm} handleImageUpload={handleImageUpload} removeSelectedImage={removeSelectedImage} /><div className="min-w-0 space-y-4"><ProductFormSections form={form} setForm={setForm} errors={errors} /><button className="w-full py-3 rounded-2xl bg-cyan-400 text-slate-950 font-black hover:scale-[1.01] transition flex items-center justify-center gap-2"><Icon name="send" className="h-5 w-5" /> Publicar en catálogo</button></div></form>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="xl:col-span-2 rounded-3xl bg-white/[0.06] border border-white/10 p-4 md:p-5 shadow-2xl"><div className="flex flex-col gap-4 mb-5"><div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-black">Productos publicados ({products.length})</h3><p className="text-sm text-slate-400">Vista compacta responsive.</p></div><button onClick={goToProducts} className="px-3 py-2 rounded-xl bg-cyan-400/10 text-cyan-300 border border-cyan-300/20 text-xs font-bold">Ver todos</button></div><SearchBox value={productSearch} onChange={setProductSearch} placeholder="Buscar producto..." /></div>{filteredProducts.length === 0 ? <EmptyBox text="No hay productos cargados desde Supabase o no coinciden con esa búsqueda." /> : <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-2 gap-3">{visibleProducts.map((product) => <ProductCard key={product.id} product={product} onDelete={deleteProduct} onEdit={openEditForm} />)}</div>}</motion.div>
      </section>
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-5 mt-5 pb-8"><div className="xl:col-span-2 rounded-3xl bg-white/[0.06] border border-white/10 p-5"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4"><div><h3 className="text-xl font-black">Compras recibidas ({orders.length})</h3><p className="text-sm text-slate-400">Pedidos confirmados por el admin desde el chat.</p></div><SearchBox value={orderSearch} onChange={setOrderSearch} placeholder="Buscar pedido..." compact /></div>{filteredOrders.length === 0 ? <EmptyBox text="Aún no hay pedidos pagados confirmados." /> : <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{visibleOrders.map((order) => <OrderCard key={order.id} order={order} isSelected={selectedOrder?.id === order.id} onClick={() => openOrderDetail(order)} />)}</div>}</div><div className="rounded-3xl bg-white/[0.06] border border-white/10 p-5"><h3 className="text-xl font-black mb-4">Acciones rápidas</h3><div className="space-y-3"><button onClick={goToProducts} className="w-full py-3 rounded-2xl bg-cyan-400/10 text-cyan-300 border border-cyan-300/20 font-bold">Ver productos</button><button onClick={goToOrders} className="w-full py-3 rounded-2xl bg-white/10 font-bold hover:bg-white/15 transition">Revisar pedidos</button></div></div></section>
    </>
  );
}

function ProductFormSections({ form, setForm, errors }) {
  const [activeTab, setActiveTab] = useState("info");
  const tabs = [{ key: "info", label: "Información" }, { key: "sizes", label: "Tallas y stock" }, { key: "category", label: "Categoría" }];
  return <div className="max-w-full rounded-3xl bg-black/20 border border-white/10 overflow-hidden"><div className="grid grid-cols-3 gap-2 p-2 bg-black/20 border-b border-white/10">{tabs.map((tab) => <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={`${activeTab === tab.key ? "bg-cyan-400 text-slate-950" : "bg-white/5 text-slate-300 hover:bg-white/10"} rounded-2xl px-3 py-3 text-xs sm:text-sm font-black transition`}>{tab.label}</button>)}</div><div className="p-4 space-y-4">{activeTab === "info" ? <><Field error={errors.title} label="Título del producto" value={form.title} onChange={(value) => setForm({ ...form, title: value })} placeholder="Ej: Camiseta" /><div><label className="text-sm text-slate-300">Descripción</label><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe el producto..." className="mt-2 w-full min-h-32 rounded-2xl bg-black/30 border border-white/10 px-4 py-3 outline-none focus:border-cyan-300/60 resize-none" />{errors.description && <p className="text-xs text-red-300 mt-2">{errors.description}</p>}</div></> : activeTab === "sizes" ? <SizePricingControl form={form} setForm={setForm} errors={errors} /> : <CategoryControl form={form} setForm={setForm} errors={errors} />}</div></div>;
}

function CategoryControl({ form, setForm, errors }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedCategory = form.category || "";
  const selectCategory = (category) => {
    setForm({ ...form, category });
    setPickerOpen(false);
  };

  return <div className="space-y-4"><div className="rounded-3xl bg-white/[0.04] border border-white/10 p-4"><div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div><p className="text-sm text-slate-300 font-bold">Categoría del producto</p><p className="text-xs text-slate-500">Este campo es obligatorio para publicar la prenda.</p></div><button type="button" onClick={() => setPickerOpen((value) => !value)} className="px-4 py-2.5 rounded-2xl bg-cyan-400 text-slate-950 text-xs font-black transition hover:scale-[1.01]">{selectedCategory ? `Cambiar: ${selectedCategory}` : "Escoger categoría"}</button></div>{errors.category && <p className="text-xs text-red-300 mt-3">{errors.category}</p>}{pickerOpen && <div className="mt-4 rounded-3xl border border-cyan-300/20 bg-black/30 p-3"><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300 mb-3">Escoge una categoría</p><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{CATEGORY_OPTIONS.map((category) => <button key={category} type="button" onClick={() => selectCategory(category)} className={`${selectedCategory === category ? "bg-cyan-400 text-slate-950" : "bg-white/5 text-slate-300 hover:bg-white/10"} rounded-2xl px-3 py-2.5 text-xs font-black transition`}>{category}</button>)}</div></div>}</div><div className="rounded-3xl bg-white/[0.04] border border-white/10 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm text-slate-300 font-bold">Agregar algo más</p><p className="text-xs text-slate-500">Actívalo si quieres guardar un detalle extra dentro de la categoría.</p></div><button type="button" onClick={() => setForm({ ...form, categoryExtraEnabled: !form.categoryExtraEnabled, categoryExtra: form.categoryExtraEnabled ? "" : form.categoryExtra })} className={`${form.categoryExtraEnabled ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-slate-300"} px-4 py-2 rounded-2xl text-xs font-black transition`}>{form.categoryExtraEnabled ? "Activado" : "Activar"}</button></div>{form.categoryExtraEnabled && <div className="mt-4"><Field label="Detalle extra de categoría" value={form.categoryExtra} onChange={(value) => setForm({ ...form, categoryExtra: value })} placeholder="Ej: Mujer, Hombre, Niños, Verano..." /></div>}</div></div>;
}

function ProductImagePicker({ form, setForm, handleImageUpload, removeSelectedImage }) {
  const preview = form.imageUrl || form.imagePreview;
  return <div><p className="text-sm text-slate-300 mb-2">Imagen del producto</p><div className="relative h-[260px] lg:min-h-[310px] rounded-3xl border border-dashed border-cyan-300/30 bg-black/30 overflow-hidden flex items-center justify-center group">{preview ? <img src={preview} alt="Vista previa del producto" className="absolute inset-0 h-full w-full object-cover" /> : <div className="text-center px-5"><div className="mx-auto h-16 w-16 rounded-3xl bg-cyan-400/10 border border-cyan-300/20 grid place-items-center text-cyan-300 mb-4"><Icon name="image" className="h-8 w-8" /></div><p className="font-bold">Agrega una imagen</p><p className="text-xs text-slate-400 mt-2">Se subirá a Cloudinary al publicar.</p></div>}<div className="absolute inset-x-4 bottom-4 flex gap-2"><label className="flex-1 cursor-pointer py-3 rounded-2xl bg-cyan-400 text-slate-950 font-black text-sm text-center hover:scale-[1.01] transition">Preview local<input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" /></label>{preview && <button type="button" onClick={removeSelectedImage} className="px-4 rounded-2xl bg-black/70 border border-white/10 text-white hover:bg-red-500/20" aria-label="Quitar imagen seleccionada"><Icon name="trash" className="h-5 w-5" /></button>}</div></div></div>;
}

function SizePricingControl({ form, setForm, errors }) {
  const sizes = ["S", "M", "L", "XL"];
  const updateSize = (size, value) => setForm({ ...form, sizes: { ...form.sizes, [size]: value } });
  const updateSizeStock = (size, value) => setForm({ ...form, sizeStocks: { ...form.sizeStocks, [size]: value } });
  const toggleSizePricing = () => {
    if (form.useSizePricing) {
      setForm({ ...form, useSizePricing: false, price: form.price || getDisplayPrice(form), stock: form.stock || "0", sizes: { ...DEFAULT_SIZES }, sizeStocks: { ...DEFAULT_SIZE_STOCKS } });
      return;
    }
    setForm({ ...form, useSizePricing: true, sizes: { ...DEFAULT_SIZES, ...(form.sizes || {}) }, sizeStocks: { ...DEFAULT_SIZE_STOCKS, ...(form.sizeStocks || {}) } });
  };
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3 rounded-3xl bg-white/[0.04] border border-white/10 p-4"><div><p className="text-sm text-slate-300 font-bold">Precios por talla</p><p className="text-xs text-slate-500">Activa precios y stock personalizados para S, M, L y XL.</p></div><button type="button" onClick={toggleSizePricing} className={`${form.useSizePricing ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-slate-300"} px-4 py-2 rounded-2xl text-xs font-black transition`}>{form.useSizePricing ? "Activado" : "Activar"}</button></div>{form.useSizePricing ? <div className="w-full max-w-full rounded-3xl bg-black/20 border border-white/10 p-4 overflow-x-auto overscroll-x-contain"><div className="min-w-[520px] max-w-none pr-2"><div className="grid grid-cols-4 gap-2 mb-3">{sizes.map((size) => <div key={size} className="text-center text-sm font-black text-cyan-300">{size}</div>)}</div><div className="grid grid-cols-4 gap-2">{sizes.map((size) => <div key={`price-${size}`} className="w-28"><label className="text-xs text-slate-400">Precio</label><input value={form.sizes?.[size] || ""} onChange={(event) => updateSize(size, event.target.value)} placeholder="€ 0.00" className="mt-2 w-full rounded-2xl bg-black/30 border border-white/10 px-3 py-2.5 text-center outline-none focus:border-cyan-300/60 text-sm" /></div>)}</div><div className="grid grid-cols-4 gap-2 mt-3">{sizes.map((size) => <div key={`stock-${size}`} className="w-28"><label className="text-xs text-slate-400">Stock</label><input value={form.sizeStocks?.[size] || ""} onChange={(event) => updateSizeStock(size, event.target.value)} placeholder="Ej: 0" type="number" min="0" className="mt-2 w-full rounded-2xl bg-black/30 border border-white/10 px-3 py-2.5 text-center outline-none focus:border-cyan-300/60 text-sm" />{errors[`stock_${size}`] && <p className="text-[10px] text-red-300 mt-2">{errors[`stock_${size}`]}</p>}</div>)}</div></div>{errors.sizes && <p className="text-xs text-red-300 mt-3">{errors.sizes}</p>}</div> : <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Field error={errors.price} label="Precio general" value={form.price} onChange={(value) => setForm({ ...form, price: value })} placeholder="Ej: 29.00" /><Field error={errors.stock} label="Stock general" value={form.stock} onChange={(value) => setForm({ ...form, stock: value })} placeholder="Ej: 0" /></div>}</div>;
}

function OrdersPage({ approvedOrders, selectedOrder, openOrderDetail, onDeleteRequest }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const query = normalizeText(search);
    return approvedOrders.filter((order) => normalizeText(`${order.id} ${order.customer} ${order.phone} ${order.address} ${order.city} ${order.postalCode} ${order.method} ${order.price} ${order.items?.map((item) => `${item.name} ${item.size}`).join(" ")}`).includes(query));
  }, [approvedOrders, search]);
  return <section className="pb-8"><motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-5 shadow-2xl"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4"><div><h3 className="text-xl font-black">Pedidos pagados ({approvedOrders.length})</h3><p className="text-sm text-slate-400">Pedidos confirmados por el admin desde el chat.</p></div><div className="flex flex-wrap items-center gap-3"><SearchBox value={search} onChange={setSearch} placeholder="Buscar pedido..." compact /><span className="px-3 py-1 rounded-full bg-emerald-400/10 text-emerald-300 border border-emerald-300/20 text-xs font-bold">Pagadas</span><button type="button" onClick={onDeleteRequest} disabled={!approvedOrders.length} className="inline-flex items-center gap-2 rounded-xl border border-red-300/25 bg-red-500/10 px-3 py-2 text-xs font-black text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"><Icon name="trash" className="h-4 w-4" />Eliminar</button></div></div>{filtered.length === 0 ? <EmptyBox text="Aún no hay pedidos pagados confirmados." /> : <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">{filtered.map((order) => <OrderCard key={order.id} order={order} isSelected={selectedOrder?.id === order.id} onClick={() => openOrderDetail(order)} />)}</div>}</motion.div></section>;
}

function PaymentsPage({ orders, totalSales, paymentStats, onDeleteRequest }) {
  const latestPayments = orders.slice(0, 5);
  return <section className="pb-8 space-y-5"><motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-6 shadow-2xl overflow-hidden relative"><div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,.18),transparent_35%)]" /><div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5"><div><p className="text-cyan-300 text-sm font-bold">RESUMEN DE INGRESOS</p><h3 className="text-4xl md:text-5xl font-black mt-2">€ {totalSales.toFixed(2)}</h3><p className="text-slate-400 mt-2">Total ganado por ventas registradas.</p></div><div className="grid grid-cols-3 gap-3 w-full lg:w-auto"><MiniPay label="Ventas" value={orders.length} /><MiniPay label="Métodos" value={PAYMENT_METHODS.length} /><MiniPay label="Estado" value="OK" /></div></div></motion.div><section className="grid grid-cols-1 md:grid-cols-3 gap-4"><PaymentMethodCard method="Bizum" data={paymentStats.Bizum} icon="card" /><PaymentMethodCard method="PayPal" data={paymentStats.PayPal} icon="card" /><PaymentMethodCard method="Transferencias" data={paymentStats.Transferencias} icon="card" /></section><motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-5 shadow-2xl"><div className="flex items-center gap-3 mb-5"><div className="p-3 rounded-2xl bg-cyan-400/10 text-cyan-300"><Icon name="clock" className="h-5 w-5" /></div><div><h3 className="text-xl font-black">Últimos pagos</h3><p className="text-sm text-slate-400">Movimientos recientes por método de pago.</p></div><button type="button" onClick={onDeleteRequest} disabled={!orders.length} className="ml-auto inline-flex items-center gap-2 rounded-xl border border-red-300/25 bg-red-500/10 px-3 py-2 text-xs font-black text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"><Icon name="trash" className="h-4 w-4" />Eliminar</button></div>{latestPayments.length === 0 ? <EmptyBox text="No hay pagos conectados todavía." /> : <div className="space-y-3">{latestPayments.map((order) => <PaymentRow key={order.id} order={order} />)}</div>}</motion.div></section>;
}

function DateTimeInline({ value, compact = false }) {
  const parts = getDateParts(value);
  return (
    <span className={`inline-flex ${compact ? "flex-col items-start gap-1" : "flex-wrap items-center gap-2"} text-cyan-100/85`}>
      <span className="inline-flex items-center gap-1.5"><Icon name="calendar" className="h-3.5 w-3.5 text-cyan-300" />{parts.date}</span>
      {!compact && <span className="text-cyan-300/45">-</span>}
      <span className="inline-flex items-center gap-1.5"><Icon name="clock" className="h-3.5 w-3.5 text-cyan-300" />{parts.time}</span>
    </span>
  );
}

function PaymentRow({ order }) {
  return <div className="rounded-2xl bg-black/25 border border-emerald-300/20 p-4 flex items-center gap-4"><img src={order.image} alt={order.product} className="h-14 w-14 rounded-2xl object-cover border border-white/10" /><div className="min-w-0 flex-1"><p className="font-black text-sm truncate">{order.customer}</p><p className="text-xs text-slate-400 truncate">{order.method} • <DateTimeInline value={order.approvedAt || order.createdAt} /></p></div><p className="text-cyan-300 font-black">{order.price}</p></div>;
}

function MiniPay({ label, value }) {
  return <div className="rounded-2xl bg-black/30 border border-white/10 p-4 text-center"><p className="text-xs text-slate-400">{label}</p><p className="text-lg font-black text-cyan-300 mt-1">{value}</p></div>;
}

function PaymentMethodCard({ method, data, icon }) {
  return <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-5 shadow-xl"><div className="flex items-center justify-between gap-3"><div className="p-3 rounded-2xl bg-emerald-400/10 text-emerald-300 border border-emerald-300/20"><Icon name={icon} className="h-6 w-6" /></div><span className="text-xs text-emerald-300 bg-emerald-400/10 border border-emerald-300/20 px-3 py-1 rounded-full">{data.count} ventas</span></div><h3 className="text-xl font-black mt-5">{method}</h3><p className="text-3xl font-black text-cyan-300 mt-2">€ {data.total.toFixed(2)}</p><p className="text-sm text-slate-400 mt-2">Total recibido vía {method}.</p></motion.div>;
}

function HistoryPage({ orderHistory, historySearch, setHistorySearch, onDeleteRequest }) {
  return <section className="pb-8"><motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-5 shadow-2xl"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5"><div className="flex items-center gap-3"><div className="p-3 rounded-2xl bg-cyan-400/10 text-cyan-300"><Icon name="clock" className="h-5 w-5" /></div><div><h3 className="text-xl font-black">Historial de compras</h3><p className="text-sm text-slate-400">Fecha, hora, cliente, producto y movimiento registrado.</p></div></div><div className="flex flex-wrap items-center gap-3"><SearchBox value={historySearch} onChange={setHistorySearch} placeholder="Buscar historial..." compact /><button type="button" onClick={onDeleteRequest} disabled={!orderHistory.length} className="inline-flex items-center gap-2 rounded-xl border border-red-300/25 bg-red-500/10 px-3 py-2 text-xs font-black text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"><Icon name="trash" className="h-4 w-4" />Eliminar historial</button></div></div>{orderHistory.length === 0 ? <EmptyBox text="No hay historial conectado todavía." /> : <div className="space-y-3">{orderHistory.map((item) => <HistoryItem key={item.id} item={item} />)}</div>}</motion.div></section>;
}

function HistoryItem({ item }) {
  return <div className="rounded-2xl bg-black/25 border border-emerald-300/25 p-4 flex gap-4 shadow-lg shadow-emerald-400/10"><div className="relative h-14 w-14 rounded-2xl overflow-hidden border border-white/10 bg-black/30 shrink-0">{item.image ? <img src={item.image} alt={item.product || item.type} className="absolute inset-0 w-full h-full object-cover" /> : <div className="h-full w-full border bg-emerald-400/10 border-emerald-300/20 text-emerald-300 grid place-items-center"><Icon name="check" className="h-5 w-5" /></div>}</div><div className="min-w-0 flex-1"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1"><p className="font-black text-sm">{item.type} <span className="text-cyan-300">({item.firstName})</span></p><p className="text-xs text-cyan-300 font-bold">{item.date}</p></div><p className="text-sm text-slate-300 mt-1">{item.detail}</p><div className="flex flex-wrap gap-2 mt-2"><span className="text-xs text-slate-400">{item.product}</span><span className="text-xs text-cyan-300 font-bold">{item.price}</span></div></div></div>;
}

function ProductsPage({ products, filteredProducts, productSearch, setProductSearch, onEdit, onDelete }) {
  return <section className="pb-8"><motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-4 md:p-5 shadow-2xl"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5"><div><h3 className="text-xl font-black">Todos los productos ({products.length})</h3><p className="text-sm text-slate-400">Aquí se muestran todos los productos cargados desde Supabase.</p></div><SearchBox value={productSearch} onChange={setProductSearch} placeholder="Buscar producto..." /></div>{filteredProducts.length === 0 ? <EmptyBox text="No se encontraron productos con esa búsqueda." /> : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">{filteredProducts.map((product) => <ProductCard key={product.id} product={product} onDelete={onDelete} onEdit={onEdit} />)}</div>}</motion.div></section>;
}


function OrderDeleteModal({ flow, orders = [], onCancel, onSelectOrder, onSelectAll, onConfirmOne, onConfirmAll }) {
  const sourceLabel = flow?.source === "payments" ? "pagos" : flow?.source === "history" ? "historial" : "pedidos";
  const title = flow?.mode === "picker" ? `Eliminar ${sourceLabel}` : flow?.mode === "confirm-all" ? "Confirmar eliminación" : "Confirmar pedido";
  const message = flow?.mode === "confirm-all"
    ? `¿Seguro que deseas eliminar todo el registro de ${sourceLabel}? Esta acción no cerrará chats ni borrará productos.`
    : flow?.mode === "confirm-one" && flow.order
      ? `¿Seguro que deseas eliminar el Pedido Nº ${flow.order.orderNumber || flow.order.id} de ${flow.order.customer}?`
      : "Selecciona qué compra quieres eliminar.";

  return <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-md"><motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-lg rounded-3xl border border-cyan-400/20 bg-[#071120] p-5 shadow-2xl shadow-cyan-500/20">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">OutletStock</p><h3 className="mt-1 text-2xl font-black text-white">{title}</h3><p className="mt-2 text-sm leading-relaxed text-cyan-100/70">{message}</p></div><button type="button" onClick={onCancel} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 text-cyan-100 hover:bg-white/10"><Icon name="close" /></button></div>

    {flow?.mode === "picker" ? <div className="mt-5 space-y-3">
      <button type="button" onClick={onSelectAll} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-red-300/25 bg-red-500/10 p-4 text-left text-red-100 transition hover:bg-red-500/20"><span className="font-black">Eliminar todo</span><Icon name="trash" className="h-5 w-5" /></button>
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1 chat-scroll">{orders.map((order) => <button type="button" key={order.id} onClick={() => onSelectOrder(order)} className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-3 text-left transition hover:border-cyan-300/30 hover:bg-cyan-400/10"><img src={order.image} alt={order.product} className="h-12 w-12 rounded-xl object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-white">Pedido Nº {order.orderNumber || order.id} · {order.customer}</p><p className="truncate text-xs text-slate-400">{order.product} · {order.method}</p></div><span className="text-sm font-black text-cyan-300">{order.price}</span></button>)}</div>
    </div> : <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={onCancel} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-cyan-100 hover:bg-white/10">No</button><button type="button" onClick={() => flow?.mode === "confirm-all" ? onConfirmAll() : onConfirmOne(flow.order)} className="rounded-2xl bg-red-400 px-4 py-3 text-sm font-black text-[#19080a] shadow-lg shadow-red-500/20 active:scale-95">Sí, eliminar</button></div>}
  </motion.div></div>;
}

function OrderDetailModal({ order, onClose }) {
  const items = Array.isArray(order.items) ? order.items : [];
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"><motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl bg-[#071120]/95 border border-white/10 shadow-2xl overflow-hidden"><div className="flex items-center justify-between gap-4 p-5 border-b border-white/10"><div><p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">Boleta de venta</p><h3 className="text-2xl font-black">Pedido Nº {order.orderNumber || order.id}</h3><p className="text-sm text-slate-400">Pedido confirmado y listo para preparar envío.</p></div><button type="button" onClick={onClose} className="h-10 w-10 rounded-2xl bg-white/10 hover:bg-red-500/20 grid place-items-center text-slate-200" aria-label="Cerrar detalle">×</button></div><div className="p-5 space-y-5"><section className="rounded-3xl border border-cyan-400/15 bg-black/25 p-4"><div className="flex items-start justify-between gap-3 mb-4"><div><p className="text-xs text-cyan-300 font-bold">Cliente</p><h4 className="text-xl font-black leading-tight">{order.customer}</h4></div><span className="bg-emerald-400/20 text-emerald-200 border-emerald-300/30 text-[10px] px-2 py-1 rounded-full border">Pagada</span></div><div className="space-y-3">{items.map((item) => <div key={`${item.id}-${item.size}`} className="flex gap-3 rounded-2xl border border-white/10 bg-[#020817]/60 p-3"><div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-cyan-950/50">{item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-xs font-black text-cyan-100">OS</div>}</div><div className="min-w-0 flex-1"><p className="truncate font-black text-white">{item.name}</p><p className="mt-1 text-xs text-cyan-100/70">Talla {item.size} · Cant. {item.qty}</p></div><p className="text-sm font-black text-cyan-100">€ {(item.price * item.qty).toFixed(2)}</p></div>)}</div><div className="mt-4 flex items-center justify-between rounded-2xl bg-cyan-400/10 border border-cyan-400/15 p-4 text-xl font-black"><span>Total</span><span>€ {Number(order.total || 0).toFixed(2)}</span></div><div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3"><InfoRow label="Método de pago" value={order.method} /><InfoRow label="Fecha" value={<DateTimeInline value={order.approvedAt || order.createdAt} />} /></div></section><div className="border-t border-white/10" /><section><div className="mb-3"><p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">Etiqueta de envío</p><p className="text-sm text-slate-400">Datos del perfil registrado del cliente.</p></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><InfoRow label="Nombre" value={order.customer} /><InfoRow label="Número" value={order.phone} /><InfoRow label="Dirección" value={order.address} /><InfoRow label="Código postal" value={order.postalCode} /><InfoRow label="Ciudad" value={order.city} /></div></section></div></motion.div></div>;
}

function EditProductModal({ editingProduct, editForm, setEditForm, editErrors, onSaveEdit, onCloseEdit }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"><motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl bg-[#071120]/95 border border-white/10 shadow-2xl"><div className="flex items-center justify-between gap-4 p-5 border-b border-white/10"><div><h3 className="text-2xl font-black">Editar producto</h3><p className="text-sm text-slate-400">Actualiza la información y guarda los cambios.</p></div><button type="button" onClick={onCloseEdit} className="h-10 w-10 rounded-2xl bg-white/10 hover:bg-red-500/20 grid place-items-center text-slate-200" aria-label="Cerrar editor">×</button></div><form onSubmit={onSaveEdit} className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-5 p-5"><div><p className="text-sm text-slate-300 mb-2">Vista del producto</p><div className="rounded-3xl overflow-hidden border border-white/10 bg-black/30 aspect-square"><img src={editForm.imageUrl || editForm.image || editingProduct.image} alt={editForm.title} className="w-full h-full object-cover" /></div><Field label="URL de imagen" value={editForm.imageUrl || editForm.image || ""} onChange={(value) => setEditForm({ ...editForm, imageUrl: value })} placeholder="https://i.ibb.co/.../imagen.jpg" /></div><div className="min-w-0 space-y-4"><ProductFormSections form={editForm} setForm={setEditForm} errors={editErrors} /><div className="grid grid-cols-2 gap-3 pt-2"><button className="py-3 rounded-2xl bg-cyan-400 text-slate-950 font-black">Actualizar</button><button type="button" onClick={onCloseEdit} className="py-3 rounded-2xl bg-white/10 font-bold">Cancelar</button></div></div></form></motion.div></div>;
}

function InfoRow({ label, value }) {
  return <div className="rounded-2xl bg-black/30 border border-white/10 p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-slate-200 font-semibold mt-1">{value}</p></div>;
}

function NavButton({ icon, label, active = false, collapsed = false, onClick, extra = null }) {
  return <button onClick={onClick} className={`${active ? "bg-cyan-400/15 border-cyan-300/30 text-cyan-200" : "bg-white/[0.03] border-white/5 hover:bg-cyan-400/10 hover:border-cyan-300/20"} relative w-full flex items-center gap-3 px-3 py-3 rounded-2xl border transition`}><Icon name={icon} className="h-5 w-5 text-cyan-300" />{!collapsed && <span>{label}</span>}{extra}</button>;
}

function SearchBox({ value, onChange, placeholder, compact = false }) {
  return <div className="relative w-full md:w-auto"><Icon name="search" className={`${compact ? "h-4 w-4 top-3" : "h-5 w-5 top-3.5"} absolute left-3 text-slate-500`} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`${compact ? "pl-9 pr-3 py-2 text-sm rounded-xl" : "pl-10 pr-4 py-3 rounded-2xl"} w-full md:w-64 bg-black/30 border border-white/10 outline-none focus:border-cyan-300/60`} /></div>;
}

function EmptyBox({ text }) {
  return <div className="rounded-3xl border border-dashed border-white/15 p-8 text-center text-slate-400">{text}</div>;
}

function ProductCard({ product, onDelete, onEdit }) {
  return <div className="relative rounded-2xl overflow-hidden border border-white/10 group aspect-square bg-black/30"><img src={product.image} alt={product.title} onError={(event) => { event.currentTarget.src = fallbackImage; }} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-500" /><div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" /><div className="absolute bottom-0 p-3 w-full">{product.category && <p className="mb-1 w-fit rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-black text-cyan-200 truncate max-w-full">{product.category}{product.categoryExtra ? ` · ${product.categoryExtra}` : ""}</p>}<h4 className="font-black text-xs md:text-sm truncate">{product.title}</h4><div className="flex items-center justify-between gap-2 mt-1"><p className="text-cyan-300 font-bold text-xs md:text-sm">{product.useSizePricing ? "Desde " : ""}€ {getDisplayPrice(product)}</p><span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-300 border border-emerald-300/20">{product.status}</span></div></div><div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition"><button onClick={() => onEdit?.(product)} className="px-2 py-1.5 rounded-lg bg-black/60 border border-white/10 text-white text-[10px]">Editar</button><button aria-label={`Eliminar ${product.title}`} onClick={() => onDelete(product.id)} className="px-2 py-1.5 rounded-lg bg-red-500/20 text-red-300"><Icon name="trash" className="h-3.5 w-3.5" /></button></div></div>;
}

function OrderCard({ order, isSelected, onClick }) {
  const images = Array.isArray(order.images) && order.images.length ? order.images : (order.image ? [order.image] : []);
  const visibleImages = images.slice(0, 4);
  return <button onClick={onClick} className={`${isSelected ? "border-cyan-300/50 ring-1 ring-cyan-300/30" : "border-white/10"} relative text-left rounded-2xl overflow-hidden bg-black/30 border aspect-square group`}>
    <div className={`absolute inset-0 grid ${visibleImages.length > 1 ? "grid-cols-2 grid-rows-2" : "grid-cols-1"}`}>{visibleImages.length ? visibleImages.map((image, index) => <div key={`${image}-${index}`} className="relative overflow-hidden bg-black/30"><img src={image} alt={`${order.product}-${index + 1}`} className="absolute inset-0 h-full w-full object-cover group-hover:scale-105 transition duration-500" />{index === 3 && images.length > 4 ? <div className="absolute inset-0 grid place-items-center bg-black/60 text-lg font-black">+{images.length - 4}</div> : null}</div>) : <div className="grid place-items-center bg-cyan-950/40 text-cyan-100 font-black">OS</div>}</div>
    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-transparent" />
    <div className="absolute top-2 right-2"><span className="bg-emerald-400/20 text-emerald-200 border-emerald-300/30 text-[9px] px-2 py-0.5 rounded-full border">Pagada</span></div>
    <div className="absolute bottom-0 p-3 w-full space-y-1"><p className="text-[10px] text-cyan-300 font-bold">Pedido Nº {order.orderNumber || order.id}</p><p className="text-[10px] text-slate-300 truncate">👤 {order.customer}</p><p className="text-[10px] text-slate-300 truncate">📍 {shortText(order.address, 25)}</p><p className="text-[10px] text-slate-300 truncate">💳 {order.method}</p><p className="text-[10px] font-semibold text-cyan-100/90"><DateTimeInline value={order.approvedAt || order.createdAt} compact /></p><p className="text-xs text-cyan-300 font-black">{order.price}</p></div>
  </button>;
}

function MobileBottomNav({ activeSection, setActiveSection, goToProducts, goToOrders, goToPayments }) {
  const items = [{ key: "dashboard", label: "Inicio", icon: "home", action: () => setActiveSection("dashboard") }, { key: "products", label: "Productos", icon: "package", action: goToProducts }, { key: "orders", label: "Pedidos", icon: "bag", action: goToOrders }, { key: "chat", label: "Chat", icon: "chat", action: () => setActiveSection("chat") }, { key: "payments", label: "Pagos", icon: "card", action: goToPayments }];
  return <nav className="fixed bottom-3 left-3 right-3 z-40 md:hidden rounded-3xl bg-[#071120]/95 border border-white/10 backdrop-blur-xl p-2 grid grid-cols-5 gap-1 shadow-2xl">{items.map((item) => <button key={item.key} onClick={item.action} className={`${activeSection === item.key ? "bg-cyan-400 text-slate-950" : "text-slate-300"} rounded-2xl py-2 text-[10px] font-bold flex flex-col items-center gap-1`}><Icon name={item.icon} className="h-4 w-4" />{item.label}</button>)}</nav>;
}

function Stat({ title, value, icon }) {
  return <div className="rounded-3xl bg-white/[0.06] border border-white/10 p-4 md:p-5 shadow-xl"><div className="flex items-center justify-between"><div><p className="text-xs md:text-sm text-slate-400">{title}</p><h3 className="text-2xl md:text-3xl font-black mt-1">{value}</h3></div><div className="p-3 rounded-2xl bg-cyan-400/10 text-cyan-300">{icon}</div></div></div>;
}

function Field({ label, value, onChange, placeholder, icon, error }) {
  return <div><label className="text-sm text-slate-300">{label}</label><div className="relative mt-2">{icon && <div className="absolute left-3 top-3.5 text-slate-500">{icon}</div>}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`${icon ? "pl-10" : "pl-4"} pr-4 py-3 w-full rounded-2xl bg-black/30 border ${error ? "border-red-400/60" : "border-white/10"} outline-none focus:border-cyan-300/60`} /></div>{error && <p className="text-xs text-red-300 mt-2">{error}</p>}</div>;
}

function Icon({ name, className = "h-5 w-5" }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
  const icons = {
    search: <svg {...common}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>,
    home: <svg {...common}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10.5V20h14v-9.5" /><path d="M9 20v-6h6v6" /></svg>,
    upload: <svg {...common}><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M20 16.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5" /></svg>,
    package: <svg {...common}><path d="M16.5 9.4 7.5 4.2" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.3 7 12 12l8.7-5" /><path d="M12 22V12" /><path d="M19 12h-4" /><path d="M17 10v4" /></svg>,
    bag: <svg {...common}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>,
    bagGlow: <svg {...common}><path d="M6 7h12l1 14H5L6 7Z" /><path d="M9 7a3 3 0 0 1 6 0" /><path d="M9 12h6" /></svg>,
    boxDone: <svg {...common}><path d="M16.5 9.4 7.5 4.2" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.3 7 12 12l8.7-5" /><path d="M12 22V12" /></svg>,
    chat: <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /></svg>,
    trash: <svg {...common}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>,
    eye: <svg {...common}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>,
    card: <svg {...common}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>,
    receipt: <svg {...common}><path d="M4 3h16v18l-2-1-2 1-2-1-2 1-2-1-2 1-2-1-2 1V3Z" /><path d="M8 7h8" /><path d="M8 11h8" /><path d="M8 15h5" /></svg>,
    close: <svg {...common}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>,
    image: <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg>,
    send: <svg {...common}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>,
    menu: <svg {...common}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg>,
    check: <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" /></svg>,
    calendar: <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></svg>,
    clock: <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>,
  };
  return icons[name] || icons.package;
}

export function runPanelTests() {
  const valid = { title: "Producto", description: "Detalle", price: "10", stock: "1" };
  const invalidEmpty = { title: "", description: "", price: "" };
  const invalidPrice = { title: "Producto", description: "Detalle", price: "0", stock: "1" };
  const invalidNegativePrice = { title: "Producto", description: "Detalle", price: "-5", stock: "1" };
  const invalidTextPrice = { title: "Producto", description: "Detalle", price: "abc", stock: "1" };
  const validSizes = { title: "Camiseta", description: "Detalle", price: "", stock: "1", useSizePricing: true, sizes: { S: "19.90", M: "22.90", L: "", XL: "" }, sizeStocks: { S: "2", M: "1", L: "0", XL: "0" } };
  const invalidSizes = { title: "Camiseta", description: "Detalle", price: "", stock: "1", useSizePricing: true, sizes: { S: "", M: "", L: "", XL: "" }, sizeStocks: { ...DEFAULT_SIZE_STOCKS } };
  console.assert(Object.keys(validateProduct(valid)).length === 0, "Producto válido no debe tener errores");
  console.assert(Object.keys(validateProduct(invalidEmpty)).length === 3, "Producto vacío debe tener 3 errores");
  console.assert(validateProduct(invalidPrice).price === "El precio debe ser mayor a 0.", "Precio 0 debe ser inválido");
  console.assert(validateProduct(invalidNegativePrice).price === "El precio debe ser mayor a 0.", "Precio negativo debe ser inválido");
  console.assert(validateProduct(invalidTextPrice).price === "El precio debe ser mayor a 0.", "Precio texto debe ser inválido");
  console.assert(Object.keys(validateProduct(validSizes)).length === 0, "Precios por talla válidos no deben tener errores");
  console.assert(validateProduct(invalidSizes).sizes === "Agrega al menos un precio válido para una talla.", "Debe exigir al menos una talla con precio");
  console.assert(getDisplayPrice({ useSizePricing: true, sizes: { S: "29.90", M: "24.90", L: "34.90" } }) === "24.90", "Debe mostrar el precio menor como Desde");
  console.assert(parseMoney("€ 49.90") === 49.9, "Debe convertir precios con €");
  console.assert(parseMoney(undefined) === 0, "Precio indefinido no debe romper totalSales");
  const sizePayloads = buildSizePayloads("product-1", { S: "10", M: "", L: "15", XL: "0" }, { S: "3", M: "0", L: "2", XL: "0" });
  console.assert(sizePayloads.length === 2, "Debe crear filas solo para tallas con precio válido");
  console.assert(sizePayloads[0].product_id === "product-1", "Debe asociar product_id");
  console.assert(sizePayloads[0].stock === 3, "Cada talla debe guardar su stock personalizado");
  console.assert(SIZE_TABLE === "product_sizes", "Debe usar la tabla product_sizes");
  console.assert(SIZE_NAME_COLUMN === "size", "Debe usar columna size");
  console.assert(SIZE_STOCK_COLUMN === "stock", "Debe usar columna stock");
  console.assert(CLOUDINARY_CLOUD_NAME === "dqgvufybv", "Debe usar el cloud name correcto de Cloudinary");
  console.assert(CLOUDINARY_UPLOAD_PRESET === "outlet_products", "Debe usar el upload preset correcto");
  const payloadTest = productToSupabasePayload({ title: "A", description: "B", price: "10", stock: "5", image: "https://x.com/a.jpg", status: "Activo" });
  console.assert(payloadTest.image_url === "https://x.com/a.jpg", "Debe guardar la URL en image_url");
  console.assert(!Object.prototype.hasOwnProperty.call(payloadTest, "stock"), "No debe guardar stock en products si la tabla no tiene esa columna");
  return "tests-ok";
}