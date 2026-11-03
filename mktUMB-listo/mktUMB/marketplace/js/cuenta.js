/*
 * MARKETPLACE UMB · Mi cuenta y Mis pedidos
 */
(function () {
  "use strict";
  const { $, $$, esc } = UMB;
  const navegadorCorto = UMB.navegadorCorto;

  const ROLES = { cliente: "Comprador", vendedor: "Vendedor", admin: "Administrador" };
  const PROVEEDORES = { email: "Correo y contraseña", google: "Google" };
  const ESTADOS = { pendiente: "Pendiente", confirmado: "Confirmado", enviado: "Enviado", entregado: "Entregado", cancelado: "Cancelado" };
  const PAGOS = { contraentrega: "Pago contra entrega", transferencia: "Transferencia bancaria", nequi: "Nequi / Daviplata" };

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
    if (perfil.proveedor === "google") {
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

  async function iniciarPedidos() {
    const sesion = await UMB.exigirSesion();
    if (!sesion) return;
    const cont = $("#lista-pedidos");
    const { data, error } = await UMB.db.from("pedidos")
      .select("id, codigo, estado, subtotal, envio, total, metodo_pago, direccion_entrega, creado_en, pedido_items(nombre, precio, cantidad)")
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
    cont.innerHTML = data.map((p) => `
      <article class="pedido">
        <div class="pedido-cabecera">
          <div><span>Pedido</span><strong class="codigo">${esc(p.codigo)}</strong></div>
          <div><span>Fecha</span><strong>${UMB.fecha(p.creado_en, true)}</strong></div>
          <div><span>Total</span><strong>${UMB.dinero(p.total)}</strong></div>
          <span class="estado estado-${esc(p.estado)}">${ESTADOS[p.estado] || esc(p.estado)}</span>
        </div>
        <ul class="pedido-items">
          ${(p.pedido_items || []).map((i) => `<li><span>${esc(i.nombre)} × ${i.cantidad}</span><span>${UMB.dinero(i.precio * i.cantidad)}</span></li>`).join("")}
          <li><span class="muted">Envío</span><span>${Number(p.envio) ? UMB.dinero(p.envio) : "Gratis"}</span></li>
          <li><span class="muted">${esc(PAGOS[p.metodo_pago] || p.metodo_pago)} · ${esc(p.direccion_entrega)}</span><span></span></li>
        </ul>
      </article>`).join("");
  }

  const pagina = document.body.dataset.pagina;
  if (pagina === "cuenta") iniciarCuenta();
  if (pagina === "pedidos") iniciarPedidos();
})();
