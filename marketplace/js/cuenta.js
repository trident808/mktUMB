/*
 * MARKETPLACE UMB · Mi cuenta y Mis pedidos
 */
(function () {
  "use strict";
  const { $, $$, esc } = UMB;
  const navegadorCorto = UMB.navegadorCorto;

  const ROLES = { cliente: "Comprador", vendedor: "Vendedor", admin: "Administrador" };
  const PROVEEDORES = { email: "Correo y contraseña", google: "Google", azure: "Microsoft (UMB)" };

  /* ======================= Mi cuenta ======================= */

  async function iniciarCuenta() {
    const sesion = await UMB.exigirSesion();
    if (!sesion) return;
    let perfil = await UMB.perfil();

    function pintarPerfil() {
      $("#perfil-cabecera").innerHTML = `
        ${UMB.avatarHTML(perfil, "avatar avatar-grande")}
        <div><h2>${esc(perfil.nombre)}</h2><span class="etiqueta ${perfil.rol === "vendedor" ? "etiqueta-verde" : ""}">${ROLES[perfil.rol] || "Comprador"}</span></div>`;
      $("#perfil-datos").innerHTML = `
        <li><span>Correo</span><strong>${esc(perfil.correo)}</strong></li>
        <li><span>Teléfono</span><strong>${esc(perfil.telefono || "Sin registrar")}</strong></li>
        <li><span>Forma de ingreso</span><strong>${esc(PROVEEDORES[perfil.proveedor] || perfil.proveedor || "Correo")}</strong></li>
        <li><span>Miembro desde</span><strong>${UMB.fecha(perfil.fecha_registro || sesion.user.created_at)}</strong></li>
        <li><span>Último acceso</span><strong>${UMB.fecha(perfil.ultimo_acceso || sesion.user.last_sign_in_at, true)}</strong></li>
        <li><span>Inicios de sesión</span><strong>${perfil.total_accesos ?? "—"}</strong></li>`;
    }
    pintarPerfil();

    if (perfil._sinTabla) {
      UMB.mensaje("#mensaje-perfil", "Tu perfil aún no está guardado en la base de datos. El administrador debe ejecutar schema.sql en Supabase.", "error");
    }

    // Pestañas
    const tabs = $$('[role="tab"]');
    tabs.forEach((t) => t.addEventListener("click", () => {
      tabs.forEach((x) => { x.setAttribute("aria-selected", String(x === t)); $("#" + x.getAttribute("aria-controls")).hidden = x !== t; });
    }));
    const inicial = location.hash.replace("#", "");
    if (inicial) tabs.find((t) => t.getAttribute("aria-controls") === "panel-" + inicial)?.click();

    // Editar datos
    const form = $("#form-perfil");
    form.nombre.value = perfil.nombre || "";
    form.telefono.value = perfil.telefono || "";
    form.correo.value = perfil.correo || "";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      const nombre = form.nombre.value.trim().replace(/\s+/g, " ");
      const telefono = form.telefono.value.replace(/[^\d+]/g, "");
      if (nombre.length < 3) return UMB.mensaje("#mensaje-perfil", "Escribe tu nombre completo.", "error");
      UMB.cargando(btn, true);
      const { error } = await UMB.db.from("perfiles")
        .update({ nombre, telefono: telefono || null, actualizado_en: new Date().toISOString() })
        .eq("id", sesion.user.id);
      // También en los metadatos de la cuenta (por si se consulta desde Auth).
      await UMB.db.auth.updateUser({ data: { nombre, telefono } });
      UMB.cargando(btn, false);
      if (error) return UMB.mensaje("#mensaje-perfil", UMB.traducirError(error), "error");
      perfil = await UMB.perfil(true);
      pintarPerfil();
      UMB.mensaje("#mensaje-perfil", "Datos actualizados.", "exito");
    });

    // Cambiar contraseña
    const formClave = $("#form-clave");
    if (perfil.proveedor && perfil.proveedor !== "email") {
      $("#nota-google").hidden = false;
    }
    formClave.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = formClave.querySelector('[type="submit"]');
      if (formClave.clave.value.length < 8) return UMB.mensaje("#mensaje-clave", "Mínimo 8 caracteres.", "error");
      if (formClave.clave.value !== formClave.clave2.value) return UMB.mensaje("#mensaje-clave", "Las contraseñas no coinciden.", "error");
      UMB.cargando(btn, true);
      const { error } = await UMB.db.auth.updateUser({ password: formClave.clave.value });
      UMB.cargando(btn, false);
      if (error) return UMB.mensaje("#mensaje-clave", UMB.traducirError(error), "error");
      formClave.reset();
      UMB.mensaje("#mensaje-clave", "Contraseña actualizada.", "exito");
    });

    // Historial de accesos
    const { data: accesos } = await UMB.db.from("accesos").select("evento, metodo, navegador, creado_en")
      .eq("usuario_id", sesion.user.id).order("creado_en", { ascending: false }).limit(10);
    $("#lista-accesos").innerHTML = (accesos && accesos.length)
      ? accesos.map((a) => `<li><span>${a.evento === "registro" ? "🆕 Creación de la cuenta" : "🔑 Inicio de sesión"} <small class="muted">· ${esc(PROVEEDORES[a.metodo] || a.metodo || "")}${a.navegador ? " · " + esc(navegadorCorto(a.navegador)) : ""}</small></span><span class="muted">${UMB.fecha(a.creado_en, true)}</span></li>`).join("")
      : `<li class="muted">Aún no hay registros.</li>`;

    // Favoritos
    const favIds = UMB.favoritos.lista();
    const { productos } = await UMB.cargarProductos();
    const favs = productos.filter((p) => favIds.includes(p.id));
    const g = $("#favoritos-grid");
    if (favs.length) {
      g.innerHTML = favs.map(UMB.tarjetaProducto).join("");
      UMB.activarTarjetas(g, () => productos);
    } else {
      g.innerHTML = `<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">♡</div><p>Aún no guardas productos. Toca el corazón en cualquier producto para verlo aquí.</p><a class="btn btn-linea" href="index.html#catalogo">Explorar</a></div>`;
    }
  }


  /* ======================= Mis pedidos ======================= */

  const ORDEN = ["pendiente", "confirmado", "enviado", "entregado"];
  const estadoGrupo = (items) => {
    const vivos = items.filter((i) => i.estado !== "cancelado");
    return vivos.length ? ORDEN[Math.min(...vivos.map((i) => ORDEN.indexOf(i.estado)))] : "cancelado";
  };

  function textoEvento(e, nombresTienda) {
    const tienda = nombresTienda.get(e.tienda_id) || "El vendedor";
    if (e.actor === "comprador") {
      if (e.estado === "entregado") return nombresTienda.size > 1 && e.tienda_id ? `Confirmaste que recibiste lo de ${tienda}` : "Confirmaste que recibiste el pedido";
      if (e.estado === "cancelado") return nombresTienda.size > 1 && e.tienda_id ? `Cancelaste los productos de ${tienda}` : "Cancelaste el pedido";
      return "Actualizaste el pedido";
    }
    const quien = e.actor === "admin" ? "Administración" : tienda;
    return { confirmado: `${quien} confirmó tu pedido`, enviado: `${quien} envió tu pedido`, entregado: `${quien} marcó el pedido como entregado`, cancelado: `${quien} canceló el pedido` }[e.estado] || `${quien} actualizó el pedido`;
  }

  async function iniciarPedidos() {
    const sesion = await UMB.exigirSesion();
    if (!sesion) return;
    const cont = $("#lista-pedidos");

    async function cargar() {
      let { data, error } = await UMB.db.from("pedidos")
        .select("id, codigo, estado, subtotal, envio, total, metodo_pago, direccion_entrega, creado_en, " +
                "pedido_items(nombre, precio, cantidad, estado, tienda_id, tiendas(nombre, telefono)), " +
                "pedido_eventos(estado, actor, tienda_id, creado_en)")
        .eq("usuario_id", sesion.user.id)
        .order("creado_en", { ascending: false });

      if (error) {
        cont.innerHTML = `<p class="mensaje error">${esc(UMB.traducirError(error))}</p>`;
        return;
      }
      if (!data.length) {
        cont.innerHTML = `<div class="vacio"><div class="vacio-icono">📦</div><h2>Aún no tienes pedidos</h2><p>Cuando compres algo, aquí verás su estado.</p><a class="btn btn-primario" href="index.html#catalogo">Ir al catálogo</a></div>`;
        return;
      }

      cont.innerHTML = data.map((p) => {
        // Agrupar los productos por tienda: cada tienda avanza su parte.
        const grupos = new Map();
        for (const i of p.pedido_items || []) {
          const k = i.tienda_id || "sin-tienda";
          if (!grupos.has(k)) grupos.set(k, { tienda_id: i.tienda_id, tienda: i.tiendas?.nombre || "Marketplace UMB", telefono: i.tiendas?.telefono || "", items: [] });
          grupos.get(k).items.push(i);
        }
        const nombres = new Map([...grupos.values()].map((g) => [g.tienda_id, g.tienda]));
        const puedeCancelar = (p.pedido_items || []).some((i) => i.estado === "pendiente");
        const eventos = [...(p.pedido_eventos || [])].sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en));
        // Si se canceló una parte, mostrar lo que realmente queda por pagar.
        const activo = (p.pedido_items || []).filter((i) => i.estado !== "cancelado").reduce((t, i) => t + Number(i.precio) * i.cantidad, 0);
        const totalReal = activo ? activo + Number(p.envio || 0) : 0;
        const totalHTML = totalReal !== Number(p.total)
          ? `${UMB.dinero(totalReal)} <s class="muted" style="font-weight:400;font-size:.85em">${UMB.dinero(p.total)}</s>`
          : UMB.dinero(p.total);

        return `
        <article class="pedido">
          <div class="pedido-cabecera">
            <div><span>Pedido</span><strong class="codigo">${esc(p.codigo)}</strong></div>
            <div><span>Fecha</span><strong>${UMB.fecha(p.creado_en, true)}</strong></div>
            <div><span>Total</span><strong>${totalHTML}</strong></div>
            ${UMB.estadoHTML(p.estado)}
          </div>
          ${[...grupos.values()].map((g) => {
            const est = estadoGrupo(g.items);
            const wa = UMB.whatsapp(g.telefono, `Hola, te escribo por mi pedido ${p.codigo} de Marketplace UMB.`);
            const confirmo = (p.pedido_eventos || []).some((e) => e.estado === "entregado" && e.actor === "comprador" && e.tienda_id === g.tienda_id);
            return `
            <section class="grupo-tienda">
              <div class="grupo-tienda-cabecera"><strong>${esc(g.tienda)}</strong>${UMB.estadoHTML(est)}</div>
              ${UMB.pasosHTML(est)}
              <ul class="pedido-items">
                ${g.items.map((i) => `<li><span>${esc(i.nombre)} × ${i.cantidad}${i.estado === "cancelado" && est !== "cancelado" ? ' <span class="muted">(cancelado)</span>' : ""}</span><span>${UMB.dinero(i.precio * i.cantidad)}</span></li>`).join("")}
              </ul>
              <div class="acciones-pedido">
                ${["confirmado", "enviado"].includes(est) ? `<button class="btn btn-primario btn-sm" type="button" data-recibido="${esc(p.id)}" data-tienda="${esc(g.tienda_id || "")}">Ya lo recibí</button>` : ""}
                ${est === "entregado" ? `<span class="confirmado-por">✓ ${confirmo ? "Confirmaste que lo recibiste" : "El vendedor lo marcó como entregado"}</span>` : ""}
                ${est === "pendiente" ? '<p class="nota">Esperando que el vendedor confirme tu pedido.</p>' : ""}
                ${wa && !["entregado", "cancelado"].includes(est) ? `<a class="btn btn-whatsapp btn-sm" href="${wa}" target="_blank" rel="noopener">Escribir al vendedor</a>` : ""}
              </div>
            </section>`;
          }).join("")}
          <div class="pedido-pie" style="border-top:1px solid var(--borde);padding-top:1rem">
            <ul class="pedido-items" style="padding:0">
              <li><span class="muted">Envío</span><span>${Number(p.envio) ? UMB.dinero(p.envio) : "Gratis"}</span></li>
              <li><span class="muted">${esc(UMB.PAGOS[p.metodo_pago] || p.metodo_pago)} · ${esc(p.direccion_entrega)}</span><span></span></li>
            </ul>
            ${puedeCancelar ? `<div class="acciones-pedido"><button class="btn btn-peligro btn-sm" type="button" data-cancelar="${esc(p.id)}">Cancelar pedido</button></div>` : ""}
            ${eventos.length ? `<ul class="historial">${eventos.map((e) => `<li><time>${UMB.fecha(e.creado_en, true)}</time>${esc(textoEvento(e, nombres))}</li>`).join("")}</ul>` : ""}
          </div>
        </article>`;
      }).join("");
    }

    cont.addEventListener("click", async (e) => {
      const rec = e.target.closest("[data-recibido]");
      const can = e.target.closest("[data-cancelar]");
      if (rec) {
        UMB.cargando(rec, true);
        const { error } = await UMB.db.rpc("confirmar_recibido", { p_pedido: rec.dataset.recibido, p_tienda: rec.dataset.tienda || null });
        if (error) { UMB.cargando(rec, false); return UMB.toast(UMB.traducirError(error), { error: true }); }
        UMB.toast("¡Gracias! Confirmaste que recibiste tu pedido.");
        await cargar();
      }
      if (can) {
        if (!UMB.confirmarToque(can, "¿Cancelar? Toca otra vez")) return;
        UMB.cargando(can, true);
        const { error } = await UMB.db.rpc("cancelar_pedido", { p_pedido: can.dataset.cancelar });
        if (error) { UMB.cargando(can, false); return UMB.toast(UMB.traducirError(error), { error: true }); }
        UMB.toast("Pedido cancelado.");
        await cargar();
      }
    });

    await cargar();
  }

  const pagina = document.body.dataset.pagina;
  if (pagina === "cuenta") iniciarCuenta();
  if (pagina === "pedidos") iniciarPedidos();
})();
