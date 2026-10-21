(() => {
  const CART_KEY = "marketplace_umb_carrito";
  const WISH_KEY = "marketplace_umb_wishlist";
  const ORDERS_KEY = "marketplace_umb_pedidos";
  const money = (n) => "$" + Number(n || 0).toLocaleString("es-CO");
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const cart = read(CART_KEY, []);
  const orders = read(ORDERS_KEY, []);
  const productImage = (p) => p.imagen || "marketplace/imagen-principal.jpg";

  function renderCart() {
    const list = document.getElementById("pagina-carrito-lista");
    if (!list) return;
    const current = read(CART_KEY, []);
    list.innerHTML = "";
    if (!current.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">🛍️</div><h2>Tu carrito está vacío</h2><p>Explora los emprendimientos y encuentra algo que te guste.</p><a class="boton boton-primario" href="index.html#catalogo">Explorar productos</a></div>';
    } else {
      current.forEach((item, index) => {
        const row = document.createElement("article");
        row.className = "cart-row";
        const img = document.createElement("img"); img.src = productImage(item); img.alt = item.nombre || "Producto";
        const info = document.createElement("div");
        const title = document.createElement("h3"); title.textContent = item.nombre;
        const store = document.createElement("p"); store.className = "muted"; store.textContent = item.tienda || "Marketplace UMB";
        const price = document.createElement("strong"); price.textContent = money(item.precio);
        const controls = document.createElement("div"); controls.className = "cart-controls";
        const qty = document.createElement("input"); qty.type = "number"; qty.min = "1"; qty.max = String(Math.max(1, Number(item.stock || 99))); qty.value = String(item.cantidad || 1); qty.setAttribute("aria-label", `Cantidad de ${item.nombre}`);
        qty.addEventListener("change", () => { const next = Math.max(1, Math.min(Number(qty.max), Number(qty.value) || 1)); current[index].cantidad = next; write(CART_KEY,current); renderCart(); });
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; remove.textContent = "Eliminar";
        remove.addEventListener("click", () => { current.splice(index,1); write(CART_KEY,current); renderCart(); });
        controls.append(qty,remove); info.append(title,store,price,controls); row.append(img,info); list.appendChild(row);
      });
    }
    const subtotal = current.reduce((sum,item) => sum + Number(item.precio || 0) * Number(item.cantidad || 1), 0);
    const shipping = subtotal > 0 ? 8000 : 0;
    const sub = document.getElementById("pagina-subtotal"); const ship = document.getElementById("pagina-envio"); const total = document.getElementById("pagina-total");
    if (sub) sub.textContent = money(subtotal); if (ship) ship.textContent = money(shipping); if (total) total.textContent = money(subtotal+shipping);
    const count = document.getElementById("pagina-cantidad-items"); if (count) count.textContent = String(current.reduce((sum,item)=>sum+Number(item.cantidad||1),0));
  }

  function renderOrders() {
    const list = document.getElementById("lista-pedidos");
    if (!list) return;
    const userEmail = window.__marketplaceEmail || "";
    const own = orders.filter(o => !o.email || !userEmail || o.email === userEmail);
    if (!own.length) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><h2>Aún no tienes pedidos</h2><p>Cuando realices una compra, aquí podrás consultar su resumen.</p><a class="boton boton-primario" href="index.html#catalogo">Ver catálogo</a></div>'; return; }
    list.innerHTML = own.map(o => `<article class="order-card"><div><span class="status-pill">${o.estado || "Confirmado"}</span><h3>Pedido ${o.id}</h3><p class="muted">${new Date(o.fecha).toLocaleString("es-CO")}</p><p>${o.items.map(i => `${escapeHtml(i.nombre)} × ${Number(i.cantidad||1)}`).join(" · ")}</p></div><strong>${money(o.total)}</strong></article>`).join("");
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  async function initAccount() {
    if (!document.getElementById("cuenta-email")) return;
    const session = await window.marketplaceAuth?.obtenerSesion();
    if (!session) { window.location.href = `login.html?redirect=${encodeURIComponent(window.location.href)}`; return; }
    const user = session.user;
    window.__marketplaceEmail = user.email || "";
    const name = user.user_metadata?.nombre || user.user_metadata?.full_name || user.email;
    document.getElementById("cuenta-nombre").textContent = name;
    document.getElementById("cuenta-email").textContent = user.email || "";
    const role = document.getElementById("cuenta-rol"); if (role) role.textContent = user.user_metadata?.rol === "vendedor" ? "Vendedor" : "Comprador";
    renderOrders();
    const wishes = read(WISH_KEY, []); const wishList = document.getElementById("wishlist-cuenta");
    if (wishList) wishList.innerHTML = wishes.length ? `<p>Tienes ${wishes.length} producto(s) guardado(s) en tu lista de deseos.</p>` : "<p>Aún no tienes favoritos guardados.</p>";
  }

  async function initCheckout() {
    const form = document.getElementById("form-checkout-pagina"); if (!form) return;
    const session = await window.marketplaceAuth?.obtenerSesion();
    const current = read(CART_KEY, []);
    const summary = document.getElementById("checkout-items");
    const subtotal = current.reduce((sum,item)=>sum+Number(item.precio||0)*Number(item.cantidad||1),0);
    const shipping = subtotal ? 8000 : 0;
    if (summary) summary.innerHTML = current.map(i=>`<div class="summary-line"><span>${escapeHtml(i.nombre)} × ${Number(i.cantidad||1)}</span><span>${money(Number(i.precio||0)*Number(i.cantidad||1))}</span></div>`).join("") || "<p>Tu carrito está vacío.</p>";
    document.getElementById("checkout-subtotal").textContent=money(subtotal);
    document.getElementById("checkout-envio").textContent=money(shipping);
    document.getElementById("checkout-total").textContent=money(subtotal+shipping);
    if (session?.user?.email) form.elements.email.value = session.user.email;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const message = document.getElementById("mensaje-checkout-pagina");
      if (!session) { window.location.href = `login.html?redirect=${encodeURIComponent(window.location.href)}`; return; }
      if (!current.length) { message.textContent="Tu carrito está vacío. Agrega productos antes de continuar."; message.className="mensaje-form mensaje-error"; return; }
      const order = { id: "UMB-" + Date.now().toString().slice(-8), fecha: new Date().toISOString(), estado: "Solicitud recibida (demo)", email: session.user.email, items: current, subtotal, envio: shipping, total: subtotal+shipping, entrega: { nombre: form.elements.nombre.value.trim(), telefono: form.elements.telefono.value.trim(), direccion: form.elements.direccion.value.trim() }, pago: form.elements.metodoPago.value };
      const all = read(ORDERS_KEY, []); all.unshift(order); write(ORDERS_KEY,all); write(CART_KEY,[]);
      message.textContent = `Solicitud ${order.id} guardada en este navegador. El pago real y el registro en Supabase todavía no están configurados.`;
      message.className="mensaje-form mensaje-exito";
      form.querySelector('button[type="submit"]').disabled=true;
      const done=document.getElementById("checkout-final"); if(done) done.hidden=false;
    });
  }

  async function initSeller() {
    const form = document.getElementById("form-tienda"); if (!form) return;
    const session = await window.marketplaceAuth?.obtenerSesion();
    if (!session) { window.location.href = `login.html?redirect=${encodeURIComponent(window.location.href)}`; return; }
    const message=document.getElementById("mensaje-tienda");
    form.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const button=form.querySelector('button[type="submit"]'); button.disabled=true;
      try {
        const {data,error}=await window.supabaseClient.rpc("crear_tienda",{p_nombre:form.elements.nombre.value.trim(),p_descripcion:form.elements.descripcion.value.trim()||null,p_categoria:form.elements.categoria.value||null,p_telefono:form.elements.telefono.value.trim()||null,p_direccion:null});
        if(error) throw error;
        message.textContent="¡Tienda creada correctamente! El siguiente paso es habilitar la publicación de productos en la tabla de productos que utiliza tu catálogo."; message.className="mensaje-form mensaje-exito";
        form.reset();
      } catch(error) { message.textContent=`No se pudo crear la tienda: ${error.message}. Verifica que la función crear_tienda y las tablas del esquema estén creadas en Supabase.`; message.className="mensaje-form mensaje-error"; }
      finally { button.disabled=false; }
    });
  }

  document.addEventListener("DOMContentLoaded",()=>{ renderCart(); initAccount(); initCheckout(); initSeller(); renderOrders(); });
})();
