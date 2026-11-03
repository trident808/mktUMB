/*
 * MARKETPLACE UMB · Carrito y finalizar compra
 */
(function () {
  "use strict";
  const { $, esc } = UMB;
  const CFG = window.UMB_CONFIG;

  function miniatura(i) {
    return `<div class="miniatura">${UMB.mediaProducto(i)}</div>`;
  }

  function pintarResumen(prefijo) {
    const sub = UMB.carrito.subtotal();
    const env = UMB.carrito.envio(sub);
    $(`#${prefijo}-subtotal`).textContent = UMB.dinero(sub);
    $(`#${prefijo}-envio`).textContent = sub ? (env ? UMB.dinero(env) : "Gratis") : UMB.dinero(0);
    $(`#${prefijo}-total`).textContent = UMB.dinero(sub + env);
    const prog = $(`#${prefijo}-progreso`);
    if (prog) {
      const falta = CFG.ENVIO_GRATIS_DESDE - sub;
      prog.hidden = !sub;
      prog.textContent = falta > 0
        ? `Te faltan ${UMB.dinero(falta)} para tener envío gratis.`
        : "¡Tu pedido tiene envío gratis!";
    }
  }

  /* ======================= Carrito ======================= */

  function iniciarCarrito() {
    const cont = $("#carrito-lista");

    function pintar() {
      const items = UMB.carrito.items();
      const n = UMB.carrito.cantidadTotal();
      $("#carrito-cantidad").textContent = `${n} artículo${n === 1 ? "" : "s"}`;
      $("#carrito-resumen").hidden = !items.length;
      if (!items.length) {
        cont.innerHTML = `<div class="vacio"><div class="vacio-icono">🛍️</div><h2>Tu carrito está vacío</h2><p>Explora los emprendimientos de la comunidad y encuentra algo que te guste.</p><a class="btn btn-primario" href="index.html#catalogo">Explorar productos</a></div>`;
        return;
      }
      cont.innerHTML = items.map((i) => `
        <article class="carrito-item">
          ${miniatura(i)}
          <div>
            <h3><a href="producto.html?id=${encodeURIComponent(i.id)}">${esc(i.nombre)}</a></h3>
            <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">${esc(i.tienda)} · ${UMB.dinero(i.precio)} c/u</p>
            <div class="cantidad">
              <button type="button" data-paso="-1" data-id="${esc(i.id)}" aria-label="Quitar uno">−</button>
              <input type="number" min="1" max="${Math.min(i.stock || 99, 99)}" value="${i.cantidad}" data-cantidad="${esc(i.id)}" aria-label="Cantidad de ${esc(i.nombre)}">
              <button type="button" data-paso="1" data-id="${esc(i.id)}" aria-label="Agregar uno">+</button>
            </div>
          </div>
          <div class="carrito-item-precio">
            <strong class="precio">${UMB.dinero(i.precio * i.cantidad)}</strong>
            <button class="boton-texto" type="button" data-quitar="${esc(i.id)}">Eliminar</button>
          </div>
        </article>`).join("");
      pintarResumen("carrito");
    }

    cont.addEventListener("click", (e) => {
      const paso = e.target.closest("[data-paso]");
      if (paso) {
        const it = UMB.carrito.items().find((x) => x.id === paso.dataset.id);
        if (it) UMB.carrito.cambiar(it.id, it.cantidad + Number(paso.dataset.paso));
        return pintar();
      }
      const q = e.target.closest("[data-quitar]");
      if (q) { UMB.carrito.quitar(q.dataset.quitar); UMB.toast("Producto eliminado del carrito."); pintar(); }
    });
    cont.addEventListener("change", (e) => {
      const inp = e.target.closest("[data-cantidad]");
      if (inp) { UMB.carrito.cambiar(inp.dataset.cantidad, inp.value); pintar(); }
    });
    $("#vaciar-carrito")?.addEventListener("click", () => { UMB.carrito.vaciar(); pintar(); });
    window.addEventListener("storage", pintar);
    pintar();
  }

  /* ======================= Checkout ======================= */

  async function iniciarCheckout() {
    const sesion = await UMB.exigirSesion();
    if (!sesion) return;

    const form = $("#form-checkout");
    const msg = $("#mensaje");
    const items = UMB.carrito.items();

    if (!items.length) {
      $("#checkout-contenido").innerHTML = `<div class="vacio"><div class="vacio-icono">🛍️</div><h2>No hay productos para pagar</h2><p>Tu carrito está vacío.</p><a class="btn btn-primario" href="index.html#catalogo">Ir al catálogo</a></div>`;
      return;
    }

    $("#checkout-items").innerHTML = items.map((i) =>
      `<div class="resumen-linea"><span>${esc(i.nombre)} × ${i.cantidad}</span><span>${UMB.dinero(i.precio * i.cantidad)}</span></div>`).join("");
    pintarResumen("checkout");

    // Rellenar con los datos del perfil
    const perfil = await UMB.perfil();
    if (perfil) {
      form.nombre.value = perfil.nombre || "";
      form.telefono.value = perfil.telefono || "";
      form.correo.value = perfil.correo || sesion.user.email || "";
    }

    const hayDemo = items.some((i) => String(i.id).startsWith("demo-"));
    if (hayDemo) {
      UMB.mensaje(msg, "Tu carrito tiene productos de demostración que no existen en la base de datos. Ejecuta schema.sql en Supabase y vuelve a agregarlos desde el catálogo.", "error");
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      if (!form.reportValidity()) return;
      if (UMB.carrito.items().some((i) => String(i.id).startsWith("demo-"))) {
        return UMB.mensaje(msg, "Quita del carrito los productos de demostración para continuar.", "error");
      }
      UMB.cargando(btn, true);
      UMB.mensaje(msg, "");

      const { data, error } = await UMB.db.rpc("crear_pedido", {
        p_items: UMB.carrito.items().map((i) => ({ id: String(i.id), cantidad: Number(i.cantidad) })),
        p_nombre: form.nombre.value.trim(),
        p_telefono: form.telefono.value.trim(),
        p_direccion: `${form.direccion.value.trim()}, ${form.ciudad.value.trim()}`,
        p_metodo_pago: form.pago.value,
        p_notas: form.notas.value.trim() || null
      });

      UMB.cargando(btn, false);
      if (error) return UMB.mensaje(msg, UMB.traducirError(error), "error");

      // Guardar el teléfono en el perfil si no lo tenía
      if (perfil && !perfil.telefono && !perfil._sinTabla) {
        UMB.db.from("perfiles").update({ telefono: form.telefono.value.trim(), actualizado_en: new Date().toISOString() }).eq("id", perfil.id).then(() => {});
      }

      UMB.carrito.vaciar();
      $("#checkout-contenido").innerHTML = `
        <div class="tarjeta exito-pedido">
          <div class="exito-icono"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <h1>¡Pedido recibido!</h1>
          <p>Tu número de pedido es <span class="codigo">${esc(data.codigo)}</span>.</p>
          <p class="muted">Total: <strong>${UMB.dinero(data.total)}</strong>. El vendedor te contactará al ${esc(form.telefono.value.trim())} para coordinar la entrega y el pago.</p>
          <div class="portada-acciones" style="justify-content:center">
            <a class="btn btn-primario" href="pedidos.html">Ver mis pedidos</a>
            <a class="btn btn-linea" href="index.html#catalogo">Seguir comprando</a>
          </div>
        </div>`;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const pagina = document.body.dataset.pagina;
  if (pagina === "carrito") iniciarCarrito();
  if (pagina === "checkout") iniciarCheckout();
})();
