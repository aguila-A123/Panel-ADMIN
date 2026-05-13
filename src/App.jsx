import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@supabase/supabase-js";

const fallbackImage = "https://images.unsplash.com/photo-1523398002811-999ca8dec234?q=80&w=900&auto=format&fit=crop";
const DEFAULT_SIZES = { S: "", M: "", L: "", XL: "" };
const DEFAULT_SIZE_STOCKS = { S: "1", M: "1", L: "1", XL: "1" };
const PAYMENT_METHODS = ["Bizum", "PayPal", "Transferencias"];
const CLOUDINARY_CLOUD_NAME = "dqgvufybv";
const CLOUDINARY_UPLOAD_PRESET = "outlet_products";
const CLOUDINARY_FOLDER = "outlet-stock/products";

const SUPABASE_URL = "https://qpkdaubarqnutbunckeh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwa2RhdWJhcnFudXRidW5ja2VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NjAzMjAsImV4cCI6MjA5MzEzNjMyMH0.36MsbMngO6lOBzFvKNsMHxk_djEYpzKR3sdCxsT8ids";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PRODUCTS_TABLE = "products";
const SIZE_TABLE = "product_sizes";
const SIZE_PRODUCT_ID_COLUMN = "product_id";
const SIZE_NAME_COLUMN = "size";
const SIZE_PRICE_COLUMN = "price";
const SIZE_STOCK_COLUMN = "stock";

function createEmptyProductForm() {
  return {
    title: "",
    description: "",
    price: "",
    stock: "1",
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
  };
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
        { id: `${order.id}-created`, date: order.createdAt || "Sin fecha", type: "Compra realizada", customer: order.customer, firstName, product: order.product, price: order.price, image: order.image, detail: `${order.customer} compró ${order.product} por ${order.price}`, status: "Compra" },
        { id: `${order.id}-paid`, date: order.approvedAt || order.createdAt || "Sin fecha", type: "Pago registrado", customer: order.customer, firstName, product: order.product, price: order.price, image: order.image, detail: `Pago registrado de ${order.customer} por ${order.product}`, status: "Aprobada" },
      ];
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export default function AdminCatalogPanel() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [orders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [viewingOrder, setViewingOrder] = useState(null);
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

  const filteredProducts = useMemo(() => {
    const query = normalizeText(productSearch);
    return products.filter((product) => normalizeText(`${product.title} ${product.description} ${product.price} ${product.status}`).includes(query));
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
    setProducts((current) => current.filter((product) => product.id !== id));
    if (editingProduct?.id === id) closeEditForm();

    const productToDelete = products.find((product) => product.id === id);
    const idColumn = productToDelete?.idColumn || "id";
    setSupabaseStatus("Eliminando producto en Supabase...");
    const { error } = await supabase.from(PRODUCTS_TABLE).delete().eq(idColumn, id);
    if (error) {
      setProducts(previousProducts);
      setSupabaseStatus(`No se pudo eliminar: ${error.message}`);
      console.warn("Supabase delete error:", error);
      return;
    }
    setSupabaseStatus("Producto eliminado de Supabase.");
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

  function goTo(section) {
    setActiveSection(section);
    setMobileMenuOpen(false);
    if (section === "products") setProductSearch("");
    if (section === "orders") setOrderSearch("");
    if (section === "history") setHistorySearch("");
  }

  const pageTitle = activeSection === "products" ? "Productos" : activeSection === "orders" ? "Pedidos" : activeSection === "history" ? "Historial" : activeSection === "payments" ? "Pagos" : "Gestión del catálogo";
  const pageDescription = activeSection === "products" ? "Revisa, busca y edita todos los productos publicados." : activeSection === "orders" ? "Revisa las ventas realizadas y abre el detalle de cada compra." : activeSection === "history" ? "Consulta el historial de compras con fecha, hora, cliente y producto." : activeSection === "payments" ? "Revisa el total ganado y el desglose por método de pago." : "Sube productos, revisa compras y administra tu catálogo desde una sola vista.";

  const navProps = {
    activeSection,
    sidebarOpen,
    setSidebarOpen,
    setActiveSection,
    goToProducts: () => goTo("products"),
    goToOrders: () => goTo("orders"),
    goToPayments: () => goTo("payments"),
    goToHistory: () => goTo("history"),
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

        <main className="flex-1 p-4 md:p-7 overflow-y-auto max-h-screen pb-24 md:pb-7">
          <PageHeader title={pageTitle} description={pageDescription} status={supabaseStatus} onOpenMobileMenu={() => setMobileMenuOpen(true)} />
          

          {activeSection === "products" ? (
            <ProductsPage products={products} filteredProducts={filteredProducts} productSearch={productSearch} setProductSearch={setProductSearch} onEdit={openEditForm} onDelete={deleteProduct} />
          ) : activeSection === "orders" ? (
            <OrdersPage approvedOrders={approvedOrders} selectedOrder={selectedOrder} openOrderDetail={(order) => { setSelectedOrder(order); setViewingOrder(order); }} />
          ) : activeSection === "history" ? (
            <HistoryPage orderHistory={orderHistory} historySearch={historySearch} setHistorySearch={setHistorySearch} />
          ) : activeSection === "payments" ? (
            <PaymentsPage orders={orders} totalSales={totalSales} paymentStats={paymentStats} />
          ) : (
            <DashboardPage products={products} orders={orders} totalSales={totalSales} productSearch={productSearch} setProductSearch={setProductSearch} filteredProducts={filteredProducts} visibleProducts={visibleProducts} form={form} setForm={setForm} errors={errors} addProduct={addProduct} handleImageUpload={handleImageUpload} removeSelectedImage={removeSelectedImage} deleteProduct={deleteProduct} openEditForm={openEditForm} orderSearch={orderSearch} setOrderSearch={setOrderSearch} filteredOrders={filteredOrders} visibleOrders={visibleOrders} selectedOrder={selectedOrder} openOrderDetail={(order) => { setSelectedOrder(order); setViewingOrder(order); }} goToProducts={() => goTo("products")} goToOrders={() => goTo("orders")} />
          )}
        </main>
      </div>

      <MobileBottomNav activeSection={activeSection} setActiveSection={setActiveSection} goToProducts={() => goTo("products")} goToOrders={() => goTo("orders")} goToPayments={() => goTo("payments")} goToHistory={() => goTo("history")} />
      {editingProduct && <EditProductModal editingProduct={editingProduct} editForm={editForm} setEditForm={setEditForm} editErrors={editErrors} onSaveEdit={saveEditedProduct} onCloseEdit={closeEditForm} />}
      {viewingOrder && <OrderDetailModal order={viewingOrder} onClose={() => setViewingOrder(null)} />}
    </div>
  );
}

function Sidebar(props) {
  return <aside className={`${props.sidebarOpen ? "w-72" : "w-20"} hidden md:flex transition-all duration-300 border-r border-white/10 bg-black/25 backdrop-blur-xl flex-col p-4`}><SidebarContent {...props} /></aside>;
}

function SidebarContent({ activeSection, sidebarOpen, setSidebarOpen, setActiveSection, goToProducts, goToOrders, goToPayments, goToHistory }) {
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
        <NavButton icon="chat" label="Chat soporte" collapsed={!sidebarOpen} />
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
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="xl:col-span-3 rounded-3xl bg-white/[0.06] border border-white/10 p-4 md:p-5 shadow-2xl">
          <div className="flex items-center gap-3 mb-5"><div className="p-3 rounded-2xl bg-cyan-400/10 text-cyan-300"><Icon name="upload" className="h-6 w-6" /></div><div><h3 className="text-xl font-black">Nuevo producto</h3><p className="text-sm text-slate-400">Organiza la información, tallas y stock antes de publicar.</p></div></div>
          <form onSubmit={addProduct} className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5 items-start"><ProductImagePicker form={form} setForm={setForm} handleImageUpload={handleImageUpload} removeSelectedImage={removeSelectedImage} /><div className="space-y-4"><ProductFormSections form={form} setForm={setForm} errors={errors} /><button className="w-full py-3 rounded-2xl bg-cyan-400 text-slate-950 font-black hover:scale-[1.01] transition flex items-center justify-center gap-2"><Icon name="send" className="h-5 w-5" /> Publicar en catálogo</button></div></form>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="xl:col-span-2 rounded-3xl bg-white/[0.06] border border-white/10 p-4 md:p-5 shadow-2xl"><div className="flex flex-col gap-4 mb-5"><div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-black">Productos publicados ({products.length})</h3><p className="text-sm text-slate-400">Vista compacta responsive.</p></div><button onClick={goToProducts} className="px-3 py-2 rounded-xl bg-cyan-400/10 text-cyan-300 border border-cyan-300/20 text-xs font-bold">Ver todos</button></div><SearchBox value={productSearch} onChange={setProductSearch} placeholder="Buscar producto..." /></div>{filteredProducts.length === 0 ? <EmptyBox text="No hay productos cargados desde Supabase o no coinciden con esa búsqueda." /> : <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-2 gap-3">{visibleProducts.map((product) => <ProductCard key={product.id} product={product} onDelete={deleteProduct} onEdit={openEditForm} />)}</div>}</motion.div>
      </section>
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-5 mt-5 pb-8"><div className="xl:col-span-2 rounded-3xl bg-white/[0.06] border border-white/10 p-5"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4"><div><h3 className="text-xl font-black">Compras recibidas ({orders.length})</h3><p className="text-sm text-slate-400">Aún no está conectado a tabla de pedidos.</p></div><SearchBox value={orderSearch} onChange={setOrderSearch} placeholder="Buscar pedido..." compact /></div>{filteredOrders.length === 0 ? <EmptyBox text="Todavía no hay pedidos conectados." /> : <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{visibleOrders.map((order) => <OrderCard key={order.id} order={order} isSelected={selectedOrder?.id === order.id} onClick={() => openOrderDetail(order)} />)}</div>}</div><div className="rounded-3xl bg-white/[0.06] border border-white/10 p-5"><h3 className="text-xl font-black mb-4">Acciones rápidas</h3><div className="space-y-3"><button onClick={goToProducts} className="w-full py-3 rounded-2xl bg-cyan-400/10 text-cyan-300 border border-cyan-300/20 font-bold">Ver productos</button><button onClick={goToOrders} className="w-full py-3 rounded-2xl bg-white/10 font-bold hover:bg-white/15 transition">Revisar pedidos</button></div></div></section>
    </>
  );
}

function ProductFormSections({ form, setForm, errors }) {
  const [activeTab, setActiveTab] = useState("info");
  const tabs = [{ key: "info", label: "Información" }, { key: "sizes", label: "Tallas y stock" }];
  return <div className="rounded-3xl bg-black/20 border border-white/10 overflow-hidden"><div className="grid grid-cols-2 gap-2 p-2 bg-black/20 border-b border-white/10">{tabs.map((tab) => <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={`${activeTab === tab.key ? "bg-cyan-400 text-slate-950" : "bg-white/5 text-slate-300 hover:bg-white/10"} rounded-2xl px-4 py-3 text-sm font-black transition`}>{tab.label}</button>)}</div><div className="p-4 space-y-4">{activeTab === "info" ? <><Field error={errors.title} label="Título del producto" value={form.title} onChange={(value) => setForm({ ...form, title: value })} placeholder="Ej: Camiseta" /><div><label className="text-sm text-slate-300">Descripción</label><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe el producto..." className="mt-2 w-full min-h-32 rounded-2xl bg-black/30 border border-white/10 px-4 py-3 outline-none focus:border-cyan-300/60 resize-none" />{errors.description && <p className="text-xs text-red-300 mt-2">{errors.description}</p>}</div></> : <SizePricingControl form={form} setForm={setForm} errors={errors} />}</div></div>;
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
      setForm({ ...form, useSizePricing: false, price: form.price || getDisplayPrice(form), stock: form.stock || "1", sizes: { ...DEFAULT_SIZES }, sizeStocks: { ...DEFAULT_SIZE_STOCKS } });
      return;
    }
    setForm({ ...form, useSizePricing: true, sizes: { ...DEFAULT_SIZES, ...(form.sizes || {}) }, sizeStocks: { ...DEFAULT_SIZE_STOCKS, ...(form.sizeStocks || {}) } });
  };
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3 rounded-3xl bg-white/[0.04] border border-white/10 p-4"><div><p className="text-sm text-slate-300 font-bold">Precios por talla</p><p className="text-xs text-slate-500">Activa precios y stock personalizados para S, M, L y XL.</p></div><button type="button" onClick={toggleSizePricing} className={`${form.useSizePricing ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-slate-300"} px-4 py-2 rounded-2xl text-xs font-black transition`}>{form.useSizePricing ? "Activado" : "Activar"}</button></div>{form.useSizePricing ? <div className="rounded-3xl bg-black/20 border border-white/10 p-4 overflow-x-auto"><div className="min-w-[420px]"><div className="grid grid-cols-4 gap-3 mb-3">{sizes.map((size) => <div key={size} className="text-center text-sm font-black text-cyan-300">{size}</div>)}</div><div className="grid grid-cols-4 gap-3">{sizes.map((size) => <div key={`price-${size}`}><label className="text-xs text-slate-400">Precio</label><input value={form.sizes?.[size] || ""} onChange={(event) => updateSize(size, event.target.value)} placeholder="€ 0.00" className="mt-2 w-full rounded-2xl bg-black/30 border border-white/10 px-3 py-3 outline-none focus:border-cyan-300/60 text-sm" /></div>)}</div><div className="grid grid-cols-4 gap-3 mt-3">{sizes.map((size) => <div key={`stock-${size}`}><label className="text-xs text-slate-400">Stock</label><input value={form.sizeStocks?.[size] || ""} onChange={(event) => updateSizeStock(size, event.target.value)} placeholder="Ej: 1" type="number" min="0" className="mt-2 w-full rounded-2xl bg-black/30 border border-white/10 px-3 py-3 outline-none focus:border-cyan-300/60 text-sm" />{errors[`stock_${size}`] && <p className="text-[10px] text-red-300 mt-2">{errors[`stock_${size}`]}</p>}</div>)}</div></div>{errors.sizes && <p className="text-xs text-red-300 mt-3">{errors.sizes}</p>}</div> : <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Field error={errors.price} label="Precio general" value={form.price} onChange={(value) => setForm({ ...form, price: value })} placeholder="Ej: 29.00" /><Field error={errors.stock} label="Stock general" value={form.stock} onChange={(value) => setForm({ ...form, stock: value })} placeholder="Ej: 1" /></div>}</div>;
}

function OrdersPage({ approvedOrders, selectedOrder, openOrderDetail }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const query = normalizeText(search);
    return approvedOrders.filter((order) => normalizeText(`${order.id} ${order.customer} ${order.address} ${order.method} ${order.price} ${order.size}`).includes(query));
  }, [approvedOrders, search]);
  return <section className="pb-8"><motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-5 shadow-2xl"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4"><div><h3 className="text-xl font-black">Ventas realizadas ({approvedOrders.length})</h3><p className="text-sm text-slate-400">Pendiente conectar tabla de pedidos.</p></div><div className="flex items-center gap-3"><SearchBox value={search} onChange={setSearch} placeholder="Buscar pedido..." compact /><span className="px-3 py-1 rounded-full bg-emerald-400/10 text-emerald-300 border border-emerald-300/20 text-xs font-bold">Pagadas</span></div></div>{filtered.length === 0 ? <EmptyBox text="No hay ventas conectadas todavía." /> : <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">{filtered.map((order) => <OrderCard key={order.id} order={order} isSelected={selectedOrder?.id === order.id} onClick={() => openOrderDetail(order)} />)}</div>}</motion.div></section>;
}

function PaymentsPage({ orders, totalSales, paymentStats }) {
  const latestPayments = orders.slice(0, 5);
  return <section className="pb-8 space-y-5"><motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-6 shadow-2xl overflow-hidden relative"><div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,.18),transparent_35%)]" /><div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5"><div><p className="text-cyan-300 text-sm font-bold">RESUMEN DE INGRESOS</p><h3 className="text-4xl md:text-5xl font-black mt-2">€ {totalSales.toFixed(2)}</h3><p className="text-slate-400 mt-2">Total ganado por ventas registradas.</p></div><div className="grid grid-cols-3 gap-3 w-full lg:w-auto"><MiniPay label="Ventas" value={orders.length} /><MiniPay label="Métodos" value={PAYMENT_METHODS.length} /><MiniPay label="Estado" value="OK" /></div></div></motion.div><section className="grid grid-cols-1 md:grid-cols-3 gap-4"><PaymentMethodCard method="Bizum" data={paymentStats.Bizum} icon="card" /><PaymentMethodCard method="PayPal" data={paymentStats.PayPal} icon="card" /><PaymentMethodCard method="Transferencias" data={paymentStats.Transferencias} icon="card" /></section><motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-5 shadow-2xl"><div className="flex items-center gap-3 mb-5"><div className="p-3 rounded-2xl bg-cyan-400/10 text-cyan-300"><Icon name="clock" className="h-5 w-5" /></div><div><h3 className="text-xl font-black">Últimos pagos</h3><p className="text-sm text-slate-400">Movimientos recientes por método de pago.</p></div></div>{latestPayments.length === 0 ? <EmptyBox text="No hay pagos conectados todavía." /> : <div className="space-y-3">{latestPayments.map((order) => <PaymentRow key={order.id} order={order} />)}</div>}</motion.div></section>;
}

function PaymentRow({ order }) {
  return <div className="rounded-2xl bg-black/25 border border-emerald-300/20 p-4 flex items-center gap-4"><img src={order.image} alt={order.product} className="h-14 w-14 rounded-2xl object-cover border border-white/10" /><div className="min-w-0 flex-1"><p className="font-black text-sm truncate">{order.customer}</p><p className="text-xs text-slate-400 truncate">{order.method} • {order.createdAt}</p></div><p className="text-cyan-300 font-black">{order.price}</p></div>;
}

function MiniPay({ label, value }) {
  return <div className="rounded-2xl bg-black/30 border border-white/10 p-4 text-center"><p className="text-xs text-slate-400">{label}</p><p className="text-lg font-black text-cyan-300 mt-1">{value}</p></div>;
}

function PaymentMethodCard({ method, data, icon }) {
  return <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-5 shadow-xl"><div className="flex items-center justify-between gap-3"><div className="p-3 rounded-2xl bg-emerald-400/10 text-emerald-300 border border-emerald-300/20"><Icon name={icon} className="h-6 w-6" /></div><span className="text-xs text-emerald-300 bg-emerald-400/10 border border-emerald-300/20 px-3 py-1 rounded-full">{data.count} ventas</span></div><h3 className="text-xl font-black mt-5">{method}</h3><p className="text-3xl font-black text-cyan-300 mt-2">€ {data.total.toFixed(2)}</p><p className="text-sm text-slate-400 mt-2">Total recibido vía {method}.</p></motion.div>;
}

function HistoryPage({ orderHistory, historySearch, setHistorySearch }) {
  return <section className="pb-8"><motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-5 shadow-2xl"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5"><div className="flex items-center gap-3"><div className="p-3 rounded-2xl bg-cyan-400/10 text-cyan-300"><Icon name="clock" className="h-5 w-5" /></div><div><h3 className="text-xl font-black">Historial de compras</h3><p className="text-sm text-slate-400">Fecha, hora, cliente, producto y movimiento registrado.</p></div></div><SearchBox value={historySearch} onChange={setHistorySearch} placeholder="Buscar historial..." compact /></div>{orderHistory.length === 0 ? <EmptyBox text="No hay historial conectado todavía." /> : <div className="space-y-3">{orderHistory.map((item) => <HistoryItem key={item.id} item={item} />)}</div>}</motion.div></section>;
}

function HistoryItem({ item }) {
  return <div className="rounded-2xl bg-black/25 border border-emerald-300/25 p-4 flex gap-4 shadow-lg shadow-emerald-400/10"><div className="relative h-14 w-14 rounded-2xl overflow-hidden border border-white/10 bg-black/30 shrink-0">{item.image ? <img src={item.image} alt={item.product || item.type} className="absolute inset-0 w-full h-full object-cover" /> : <div className="h-full w-full border bg-emerald-400/10 border-emerald-300/20 text-emerald-300 grid place-items-center"><Icon name="check" className="h-5 w-5" /></div>}</div><div className="min-w-0 flex-1"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1"><p className="font-black text-sm">{item.type} <span className="text-cyan-300">({item.firstName})</span></p><p className="text-xs text-cyan-300 font-bold">{item.date}</p></div><p className="text-sm text-slate-300 mt-1">{item.detail}</p><div className="flex flex-wrap gap-2 mt-2"><span className="text-xs text-slate-400">{item.product}</span><span className="text-xs text-cyan-300 font-bold">{item.price}</span></div></div></div>;
}

function ProductsPage({ products, filteredProducts, productSearch, setProductSearch, onEdit, onDelete }) {
  return <section className="pb-8"><motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] border border-white/10 p-4 md:p-5 shadow-2xl"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5"><div><h3 className="text-xl font-black">Todos los productos ({products.length})</h3><p className="text-sm text-slate-400">Aquí se muestran todos los productos cargados desde Supabase.</p></div><SearchBox value={productSearch} onChange={setProductSearch} placeholder="Buscar producto..." /></div>{filteredProducts.length === 0 ? <EmptyBox text="No se encontraron productos con esa búsqueda." /> : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">{filteredProducts.map((product) => <ProductCard key={product.id} product={product} onDelete={onDelete} onEdit={onEdit} />)}</div>}</motion.div></section>;
}

function OrderDetailModal({ order, onClose }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"><motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-3xl rounded-3xl bg-[#071120]/95 border border-white/10 shadow-2xl overflow-hidden"><div className="flex items-center justify-between gap-4 p-5 border-b border-white/10"><div><h3 className="text-2xl font-black">Detalle del pedido</h3><p className="text-sm text-slate-400">Información completa de la compra seleccionada.</p></div><button type="button" onClick={onClose} className="h-10 w-10 rounded-2xl bg-white/10 hover:bg-red-500/20 grid place-items-center text-slate-200" aria-label="Cerrar detalle">×</button></div><div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-5 p-5 items-stretch"><div className="space-y-4"><div className="rounded-3xl bg-black/30 border border-white/10 p-4"><div className="flex items-start justify-between gap-3 mb-3"><p className="text-xs text-cyan-300 font-bold">Nº {order.id}</p><span className="bg-emerald-400/20 text-emerald-200 border-emerald-300/30 text-[10px] px-2 py-1 rounded-full border">Pagada</span></div><h4 className="text-xl font-black leading-tight">{order.product}</h4><p className="text-3xl font-black text-cyan-300 mt-2">{order.price}</p></div><div className="rounded-3xl overflow-hidden border border-white/10 bg-black/30 aspect-square"><img src={order.image} alt={order.product} className="w-full h-full object-cover" /></div></div><div className="grid grid-cols-1 gap-3 content-start"><InfoRow label="Comprador" value={order.customer} /><InfoRow label="Dirección" value={order.address} /><InfoRow label="Talla" value={order.size || "No especificada"} /><InfoRow label="Método de pago" value={order.method} /><InfoRow label="Fecha de compra" value={order.createdAt || "Sin fecha"} /></div></div></motion.div></div>;
}

function EditProductModal({ editingProduct, editForm, setEditForm, editErrors, onSaveEdit, onCloseEdit }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"><motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl bg-[#071120]/95 border border-white/10 shadow-2xl"><div className="flex items-center justify-between gap-4 p-5 border-b border-white/10"><div><h3 className="text-2xl font-black">Editar producto</h3><p className="text-sm text-slate-400">Actualiza la información y guarda los cambios.</p></div><button type="button" onClick={onCloseEdit} className="h-10 w-10 rounded-2xl bg-white/10 hover:bg-red-500/20 grid place-items-center text-slate-200" aria-label="Cerrar editor">×</button></div><form onSubmit={onSaveEdit} className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-5 p-5"><div><p className="text-sm text-slate-300 mb-2">Vista del producto</p><div className="rounded-3xl overflow-hidden border border-white/10 bg-black/30 aspect-square"><img src={editForm.imageUrl || editForm.image || editingProduct.image} alt={editForm.title} className="w-full h-full object-cover" /></div><Field label="URL de imagen" value={editForm.imageUrl || editForm.image || ""} onChange={(value) => setEditForm({ ...editForm, imageUrl: value })} placeholder="https://i.ibb.co/.../imagen.jpg" /></div><div className="space-y-4"><ProductFormSections form={editForm} setForm={setEditForm} errors={editErrors} /><div className="grid grid-cols-2 gap-3 pt-2"><button className="py-3 rounded-2xl bg-cyan-400 text-slate-950 font-black">Actualizar</button><button type="button" onClick={onCloseEdit} className="py-3 rounded-2xl bg-white/10 font-bold">Cancelar</button></div></div></form></motion.div></div>;
}

function InfoRow({ label, value }) {
  return <div className="rounded-2xl bg-black/30 border border-white/10 p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-slate-200 font-semibold mt-1">{value}</p></div>;
}

function NavButton({ icon, label, active = false, collapsed = false, onClick }) {
  return <button onClick={onClick} className={`${active ? "bg-cyan-400/15 border-cyan-300/30 text-cyan-200" : "bg-white/[0.03] border-white/5 hover:bg-cyan-400/10 hover:border-cyan-300/20"} w-full flex items-center gap-3 px-3 py-3 rounded-2xl border transition`}><Icon name={icon} className="h-5 w-5 text-cyan-300" />{!collapsed && <span>{label}</span>}</button>;
}

function SearchBox({ value, onChange, placeholder, compact = false }) {
  return <div className="relative w-full md:w-auto"><Icon name="search" className={`${compact ? "h-4 w-4 top-3" : "h-5 w-5 top-3.5"} absolute left-3 text-slate-500`} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`${compact ? "pl-9 pr-3 py-2 text-sm rounded-xl" : "pl-10 pr-4 py-3 rounded-2xl"} w-full md:w-64 bg-black/30 border border-white/10 outline-none focus:border-cyan-300/60`} /></div>;
}

function EmptyBox({ text }) {
  return <div className="rounded-3xl border border-dashed border-white/15 p-8 text-center text-slate-400">{text}</div>;
}

function ProductCard({ product, onDelete, onEdit }) {
  return <div className="relative rounded-2xl overflow-hidden border border-white/10 group aspect-square bg-black/30"><img src={product.image} alt={product.title} onError={(event) => { event.currentTarget.src = fallbackImage; }} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-500" /><div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" /><div className="absolute bottom-0 p-3 w-full"><h4 className="font-black text-xs md:text-sm truncate">{product.title}</h4><div className="flex items-center justify-between gap-2 mt-1"><p className="text-cyan-300 font-bold text-xs md:text-sm">{product.useSizePricing ? "Desde " : ""}€ {getDisplayPrice(product)}</p><span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-300 border border-emerald-300/20">{product.status}</span></div></div><div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition"><button onClick={() => onEdit?.(product)} className="px-2 py-1.5 rounded-lg bg-black/60 border border-white/10 text-white text-[10px]">Editar</button><button aria-label={`Eliminar ${product.title}`} onClick={() => onDelete(product.id)} className="px-2 py-1.5 rounded-lg bg-red-500/20 text-red-300"><Icon name="trash" className="h-3.5 w-3.5" /></button></div></div>;
}

function OrderCard({ order, isSelected, onClick }) {
  return <button onClick={onClick} className={`${isSelected ? "border-cyan-300/50 ring-1 ring-cyan-300/30" : "border-white/10"} relative text-left rounded-2xl overflow-hidden bg-black/30 border aspect-square group`}><img src={order.image} alt={order.product} className="absolute inset-0 h-full w-full object-cover group-hover:scale-105 transition duration-500" /><div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" /><div className="absolute top-2 right-2"><span className="bg-emerald-400/20 text-emerald-200 border-emerald-300/30 text-[9px] px-2 py-0.5 rounded-full border">Aprobada</span></div><div className="absolute bottom-0 p-3 w-full space-y-1"><p className="text-[10px] text-cyan-300 font-bold">Nº {order.id}</p><p className="text-[10px] text-slate-300 truncate">👤 {order.customer}</p><p className="text-[10px] text-slate-300 truncate">📍 {shortText(order.address, 25)}</p><p className="text-[10px] text-slate-300 truncate">💳 {order.method}</p><p className="text-xs text-cyan-300 font-black">{order.price}</p></div></button>;
}

function MobileBottomNav({ activeSection, setActiveSection, goToProducts, goToOrders, goToPayments }) {
  const items = [{ key: "dashboard", label: "Inicio", icon: "home", action: () => setActiveSection("dashboard") }, { key: "products", label: "Productos", icon: "package", action: goToProducts }, { key: "orders", label: "Pedidos", icon: "bag", action: goToOrders }, { key: "payments", label: "Pagos", icon: "card", action: goToPayments }];
  return <nav className="fixed bottom-3 left-3 right-3 z-40 md:hidden rounded-3xl bg-[#071120]/95 border border-white/10 backdrop-blur-xl p-2 grid grid-cols-4 gap-1 shadow-2xl">{items.map((item) => <button key={item.key} onClick={item.action} className={`${activeSection === item.key ? "bg-cyan-400 text-slate-950" : "text-slate-300"} rounded-2xl py-2 text-[10px] font-bold flex flex-col items-center gap-1`}><Icon name={item.icon} className="h-4 w-4" />{item.label}</button>)}</nav>;
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
    chat: <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /></svg>,
    trash: <svg {...common}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>,
    eye: <svg {...common}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>,
    card: <svg {...common}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>,
    image: <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg>,
    send: <svg {...common}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>,
    menu: <svg {...common}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg>,
    check: <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" /></svg>,
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