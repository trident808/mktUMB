/*
 * MARKETPLACE UMB · Portada, catálogo y ficha de producto
 */
(function () {
  "use strict";
  const { $, $$, esc } = UMB;
  let productos = [];
  const lista = () => productos;

  /* ======================= Portada ======================= */

  const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  /** RF-13: puntaje de relevancia de un producto para una búsqueda. */
  function relevancia(p, tokens) {
    if (!tokens.length) return 0;
    const nombre = norm(p.nombre), cat = norm(p.categoria), tienda = norm(p.tienda), desc = norm(p.descripcion);
    let total = 0;
    for (const t of tokens) {
      let pts = 0;
      if (nombre.split(/\W+/).some((w) => w.startsWith(t))) pts += 6;
      else if (nombre.includes(t)) pts += 4;
      if (cat.includes(t)) pts += 3;
      if (tienda.includes(t)) pts += 2;
      if (desc.includes(t)) pts += 1;
      if (!pts) return -1;              // todas las palabras deben aparecer
      total += pts;
    }
    if (nombre.includes(tokens.join(" "))) total += 5;
    return total + (p.calificacion || 0) * 0.3 + Math.min(p.ventas || 0, 20) * 0.05;
  }

  async function iniciarPortada() {
    const grid = $("#catalogo-grid");
    const filtros = $("#filtros");
    const estado = {
      q: norm(UMB.param("q")), cat: UMB.param("cat") || "", orden: "relevancia",
      min: null, max: null, estadoProd: "", sede: "", entrega: "", disponibles: false
    };

    // Categorías desde la base de datos (RF-38)
    const categorias = await UMB.cargarCategorias();
    const contCats = $("#categorias");
    contCats.innerHTML = categorias.map((c) =>
      `<button class="categoria" type="button" data-cat="${esc(c.nombre)}" aria-pressed="${estado.cat === c.nombre}">
         <span class="categoria-icono" aria-hidden="true">${c.icono}</span>${esc(c.nombre)}
       </button>`).join("");

    const { productos: datos, origen } = await UMB.cargarProductos();
    productos = datos;

    $("#dato-productos").textContent = productos.length;
    $("#dato-tiendas").textContent = new Set(productos.map((p) => p.tienda)).size;
    if (origen === "error") $("#aviso-demo").hidden = false;

    $("#destacados-grid").closest("section").hidden = productos.length === 0;
    $("#tiendas-grid").closest("section").hidden = productos.length === 0;

    // Destacados: vendedores mejor calificados y con más ventas
    const puntaje = (p) => (p.calificacion || 0) * Math.log((p.total_calificaciones || 0) + 2) + Math.log((p.ventas || 0) + 1);
    const dest = $("#destacados-grid");
    dest.innerHTML = [...productos].filter((p) => p.stock > 0).sort((a, b) => puntaje(b) - puntaje(a)).slice(0, 4).map(UMB.tarjetaProducto).join("");
    UMB.activarTarjetas(dest, lista);

    // Emprendimientos
    const tiendas = [...new Map(productos.filter((p) => p.tienda_id).map((p) => [p.tienda_id, p])).values()].slice(0, 6);
    $("#tiendas-grid").innerHTML = tiendas.map((p) => {
      const n = productos.filter((x) => x.tienda_id === p.tienda_id).length;
      return `<a class="tienda-card" href="vendedor.html?tienda=${encodeURIComponent(p.tienda_id)}">
          <span class="avatar">${esc(UMB.iniciales(p.tienda))}</span>
          <span><strong>${esc(p.tienda)}${p.verificado ? ' <span class="check-verificado" aria-label="verificado">✓</span>' : ""}</strong><span>${esc(p.categoria)} · ${n} producto${n === 1 ? "" : "s"}${p.sede ? " · " + esc(p.sede) : ""}</span></span>
        </a>`;
    }).join("");

    // Chips de categoría y sedes disponibles
    const chips = $("#chips");
    const cats = ["", ...new Set(productos.map((p) => p.categoria))];
    chips.innerHTML = cats.map((c) => `<button class="chip" type="button" data-chip="${esc(c)}" aria-pressed="${estado.cat === c}">${c ? esc(c) : "Todos"}</button>`).join("");
    const sedes = [...new Set(productos.map((p) => p.sede).filter(Boolean))].sort();
    filtros.sede.innerHTML = '<option value="">Todas</option>' + sedes.map((s) => `<option>${esc(s)}</option>`).join("");
    filtros.sede.closest(".filtro").hidden = !sedes.length;

    function pintar() {
      const tokens = estado.q.split(/\s+/).filter(Boolean);
      let r = productos.map((p) => ({ p, score: relevancia(p, tokens) })).filter(({ p, score }) => {
        if (tokens.length && score < 0) return false;
        if (estado.cat && p.categoria !== estado.cat) return false;
        if (estado.disponibles && p.stock <= 0) return false;
        if (estado.min != null && p.precio < estado.min) return false;
        if (estado.max != null && p.precio > estado.max) return false;
        if (estado.estadoProd && (p.estado_producto || "nuevo") !== estado.estadoProd) return false;
        if (estado.sede && p.sede !== estado.sede) return false;
        if (estado.entrega === "en_u" && p.entrega_en_u === false) return false;
        if (estado.entrega === "domicilio" && !p.entrega_domicilio) return false;
        return true;
      });
      const ord = {
        relevancia: (a, b) => tokens.length ? b.score - a.score : new Date(b.p.creado_en || 0) - new Date(a.p.creado_en || 0),
        recientes: (a, b) => new Date(b.p.creado_en || 0) - new Date(a.p.creado_en || 0),
        "precio-asc": (a, b) => a.p.precio - b.p.precio,
        "precio-desc": (a, b) => b.p.precio - a.p.precio,
        rating: (a, b) => (b.p.calificacion || 0) - (a.p.calificacion || 0) || (b.p.total_calificaciones || 0) - (a.p.total_calificaciones || 0)
      }[estado.orden];
      r = r.sort(ord).map((x) => x.p);

      const activos = [estado.min != null, estado.max != null, estado.estadoProd, estado.sede, estado.entrega, estado.disponibles].filter(Boolean).length;
      $("#contador-resultados").textContent = `${r.length} producto${r.length === 1 ? "" : "s"}` +
        (estado.q ? ` para «${UMB.param("q") || $("#buscar").value || estado.q}»` : "") + (activos ? ` · ${activos} filtro${activos === 1 ? "" : "s"}` : "");
      $$("[data-chip]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.chip === estado.cat)));
      $$("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cat === estado.cat)));

      if (!productos.length) {
        grid.innerHTML = `<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">🛍️</div><h3>Aún no hay productos publicados</h3><p>Los emprendedores de la comunidad están preparando sus tiendas. ¿Tienes algo para vender? Sé el primero.</p><a class="btn btn-primario" href="vender.html">Publicar un producto</a></div>`;
        return;
      }
      if (!r.length) {
        grid.innerHTML = `<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">🔎</div><h3>No encontramos productos</h3><p>Prueba con otra palabra o quita los filtros.</p><button class="btn btn-linea" type="button" id="limpiar-filtros">Ver todo el catálogo</button></div>`;
        $("#limpiar-filtros").addEventListener("click", () => { $("#buscar").value = ""; estado.q = ""; estado.cat = ""; filtros.reset(); });
        return;
      }
      grid.innerHTML = r.map(UMB.tarjetaProducto).join("");
    }
    UMB.activarTarjetas(grid, lista);

    function leerFiltros() {
      const num = (v) => (v === "" || v == null ? null : Math.max(0, Number(v)));
      estado.min = num(filtros.min.value);
      estado.max = num(filtros.max.value);
      estado.estadoProd = filtros.estado.value;
      estado.sede = filtros.sede.value;
      estado.entrega = filtros.entrega.value;
      estado.orden = filtros.orden.value;
      estado.disponibles = filtros.disponibles.checked;
      pintar();
    }
    filtros.addEventListener("input", leerFiltros);
    filtros.addEventListener("change", leerFiltros);
    filtros.addEventListener("submit", (e) => e.preventDefault());
    filtros.addEventListener("reset", () => setTimeout(() => { estado.cat = ""; leerFiltros(); }, 0));

    function elegirCategoria(c) {
      estado.cat = estado.cat === c ? "" : c;
      pintar();
      $("#catalogo").scrollIntoView({ behavior: "smooth" });
    }
    contCats.addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) elegirCategoria(b.dataset.cat); });
    chips.addEventListener("click", (e) => { const b = e.target.closest("[data-chip]"); if (b) { estado.cat = b.dataset.chip; pintar(); } });
    document.addEventListener("umb:buscar", (e) => {
      estado.q = norm(e.detail);
      if (estado.q && filtros.orden.value === "recientes") filtros.orden.value = "relevancia";
      leerFiltros();
    });

    pintar();
    if (estado.q || estado.cat) $("#catalogo").scrollIntoView();
  }

  /* ======================= Ficha de producto ======================= */

  async function iniciarFicha() {
    const cont = $("#ficha");
    const id = UMB.param("id");
    const { productos: datos } = await UMB.cargarProductos();
    productos = datos;
    const p = productos.find((x) => x.id === id);

    if (!p) {
      cont.innerHTML = `<div class="vacio"><div class="vacio-icono">🧺</div><h1>Producto no encontrado</h1><p>Puede que ya no esté disponible.</p><a class="btn btn-primario" href="index.html#catalogo">Volver al catálogo</a></div>`;
      return;
    }

    document.title = `${p.nombre} | Marketplace UMB`;
    const fav = UMB.favoritos.tiene(p.id);
    const agotado = p.stock <= 0;

    // RF-06: galería con todas las fotos reales de la publicación
    let fotos = [];
    if (UMB.db && !String(p.id).startsWith("demo")) {
      const { data } = await UMB.db.from("producto_fotos").select("url, con_codigo, orden").eq("producto_id", p.id).order("orden");
      fotos = (data || []).filter((f) => !f.con_codigo).concat((data || []).filter((f) => f.con_codigo));
    }
    const galeria = fotos.length > 1
      ? `<div class="miniaturas" role="list">${fotos.map((f, i) => `<button type="button" role="listitem" data-foto="${esc(f.url)}" aria-label="Ver foto ${i + 1}" ${i === 0 ? 'aria-current="true"' : ""}><img src="${esc(f.url)}" alt="" loading="lazy"></button>`).join("")}</div>`
      : "";
    const principal = fotos.length ? { ...p, imagen: fotos[0].url } : p;
    const entregas = [p.entrega_en_u !== false ? "Dentro de la U" : null, p.entrega_domicilio ? "A domicilio" : null].filter(Boolean).join(" · ") || "Dentro de la U";

    cont.innerHTML = `
      <nav class="migas" aria-label="Ruta"><a href="index.html">Inicio</a> / <a href="index.html?cat=${encodeURIComponent(p.categoria)}#catalogo">${esc(p.categoria)}</a> / <span>${esc(p.nombre)}</span></nav>
      <div class="ficha">
        <div>
          <div class="ficha-imagen" id="foto-principal">${UMB.mediaProducto(principal)}</div>
          ${galeria}
        </div>
        <div>
          <span class="eyebrow">${esc(p.tienda)}</span>
          ${p.verificado ? UMB.insigniaVerificado : ""}
          <h1>${esc(p.nombre)}</h1>
          <p class="producto-rating"><span class="etiqueta">${p.estado_producto === "usado" ? "Usado" : "Nuevo"}</span>${p.total_calificaciones ? ` <b>★</b> ${p.calificacion.toFixed(1)} · ${p.total_calificaciones} calificaciones del vendedor` : ""}</p>
          <div class="ficha-precio">${UMB.dinero(p.precio)}</div>
          <p>${esc(p.descripcion || "Producto de un emprendimiento de la comunidad UMB.")}</p>
          <div class="ficha-acciones">
            <div class="cantidad" ${agotado ? "hidden" : ""}>
              <button type="button" data-paso="-1" aria-label="Quitar uno">−</button>
              <input id="cantidad" type="number" min="1" max="${Math.min(p.stock, 99)}" value="1" aria-label="Cantidad">
              <button type="button" data-paso="1" aria-label="Agregar uno">+</button>
            </div>
            <button class="btn btn-primario" id="btn-agregar" type="button" ${agotado ? "disabled" : ""}>${agotado ? "Agotado" : "Agregar al carrito"}</button>
            <button class="btn btn-linea" id="btn-fav" type="button" aria-pressed="${fav}">${fav ? "♥ En favoritos" : "♡ Guardar"}</button>
          </div>
          <ul class="ficha-datos">
            <li><span>Vendido por</span><strong>${p.tienda_id ? `<a class="enlace" href="vendedor.html?tienda=${encodeURIComponent(p.tienda_id)}">${esc(p.tienda)}</a>` : esc(p.tienda)}</strong></li>
            ${p.sede ? `<li><span>Sede</span><strong>${esc(p.sede)}</strong></li>` : ""}
            ${p.total_calificaciones ? `<li><span>Calificación del vendedor</span><strong>★ ${p.calificacion.toFixed(1)} (${p.total_calificaciones})</strong></li>` : ""}
            <li><span>Categoría</span><strong>${esc(p.categoria)}</strong></li>
            <li><span>Disponibles</span><strong>${agotado ? "Agotado" : p.stock + " unidades"}</strong></li>
            <li><span>Estado</span><strong>${p.estado_producto === "usado" ? "Usado" : "Nuevo"}</strong></li>
            <li><span>Entrega</span><strong>${entregas}</strong></li>
          </ul>
          <details class="reportar" id="reportar">
            <summary>⚑ Reportar esta publicación</summary>
            <form class="formulario" id="form-reporte" style="margin-top:.75rem">
              <div class="campo"><label for="rep-motivo">Motivo</label>
                <select id="rep-motivo" name="motivo" required>
                  <option value="">Selecciona…</option>
                  <option value="prohibido">Es un producto prohibido</option>
                  <option value="estafa">Posible estafa</option>
                  <option value="falsificado">Producto falsificado</option>
                  <option value="fotos_falsas">Fotos falsas o de internet</option>
                  <option value="precio_enganoso">Precio o descripción engañosos</option>
                  <option value="otro">Otro motivo</option>
                </select>
              </div>
              <div class="campo"><label for="rep-detalle">Cuéntanos más <span class="muted">(opcional)</span></label><textarea id="rep-detalle" name="detalle" maxlength="600"></textarea></div>
              <p class="mensaje" id="mensaje-reporte" role="status"></p>
              <div><button class="btn btn-peligro btn-sm" type="submit">Enviar reporte</button></div>
            </form>
          </details>
        </div>
      </div>`;

    // Galería
    cont.querySelector(".miniaturas")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-foto]");
      if (!b) return;
      $("#foto-principal").innerHTML = UMB.mediaProducto({ ...p, imagen: b.dataset.foto });
      cont.querySelectorAll(".miniaturas button").forEach((x) => x.removeAttribute("aria-current"));
      b.setAttribute("aria-current", "true");
    });

    // RF-11: reportar
    $("#form-reporte").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const s = await UMB.sesion();
      if (!s) return location.assign(`login.html?volver=${encodeURIComponent("producto.html?id=" + p.id)}`);
      const btn = f.querySelector('[type="submit"]');
      UMB.cargando(btn, true);
      const { error } = await UMB.db.rpc("reportar_publicacion", { p_producto: Number(p.id), p_motivo: f.motivo.value, p_detalle: f.detalle.value.trim() || null });
      UMB.cargando(btn, false);
      if (error) return UMB.mensaje("#mensaje-reporte", UMB.traducirError(error), "error");
      f.innerHTML = '<p class="mensaje exito">Gracias. Un moderador revisará la publicación.</p>';
    });

    const input = $("#cantidad");
    cont.addEventListener("click", (e) => {
      const b = e.target.closest("[data-paso]");
      if (!b) return;
      input.value = Math.max(1, Math.min(Number(input.max), Number(input.value) + Number(b.dataset.paso)));
    });
    $("#btn-agregar").addEventListener("click", () => {
      const n = Math.max(1, Math.min(Number(input.max), Number(input.value) || 1));
      if (UMB.carrito.agregar(p, n)) UMB.toast(`Agregaste ${n} × "${p.nombre}" al carrito.`, { enlace: { href: "carrito.html", texto: "Ver carrito" } });
      else UMB.toast("Ya tienes en el carrito todas las unidades disponibles.");
    });
    $("#btn-fav").addEventListener("click", (e) => {
      const ahora = UMB.favoritos.alternar(p.id);
      e.currentTarget.setAttribute("aria-pressed", String(ahora));
      e.currentTarget.textContent = ahora ? "♥ En favoritos" : "♡ Guardar";
    });

    // Relacionados
    const rel = productos.filter((x) => x.id !== p.id && (x.categoria === p.categoria || x.tienda === p.tienda)).slice(0, 4);
    if (rel.length) {
      $("#relacionados").hidden = false;
      const g = $("#relacionados-grid");
      g.innerHTML = rel.map(UMB.tarjetaProducto).join("");
      UMB.activarTarjetas(g, lista);
    }
  }

  /* ======================= Perfil público del vendedor (RF-05) ======================= */

  async function iniciarVendedor() {
    const cont = $("#perfil-vendedor");
    const id = UMB.param("tienda");
    const { data: perfil, error } = id ? await UMB.db.rpc("perfil_publico_tienda", { p_tienda: id }) : { data: null };
    if (error || !perfil) {
      cont.innerHTML = `<div class="vacio"><div class="vacio-icono">🏪</div><h1>Tienda no disponible</h1><p>Puede que ya no esté activa.</p><a class="btn btn-primario" href="index.html#catalogo">Ir al catálogo</a></div>`;
      $("#productos-vendedor").closest("section").hidden = true;
      return;
    }
    document.title = `${perfil.tienda} | Marketplace UMB`;
    cont.innerHTML = `
      <div class="tarjeta perfil-vendedor">
        <span class="avatar avatar-grande">${esc(UMB.iniciales(perfil.tienda))}</span>
        <div style="flex:1;min-width:220px">
          <span class="eyebrow">Emprendimiento UMB</span>
          <h1 style="margin:0">${esc(perfil.tienda)}</h1>
          <p class="muted" style="margin:.2rem 0 .6rem">por ${esc(perfil.vendedor)}${perfil.programa ? " · " + esc(perfil.programa) : ""}</p>
          ${perfil.verificado ? UMB.insigniaVerificado : '<span class="estado estado-pendiente">Vendedor sin verificar</span>'}
          ${perfil.descripcion ? `<p style="margin:.8rem 0 0">${esc(perfil.descripcion)}</p>` : ""}
        </div>
        <ul class="datos-vendedor">
          <li><strong>${perfil.calificacion != null ? "★ " + Number(perfil.calificacion).toFixed(1) : "—"}</strong><span>${perfil.total_calificaciones ? perfil.total_calificaciones + " calificaciones" : "Sin calificaciones"}</span></li>
          <li><strong>${perfil.ventas_completadas}</strong><span>ventas completadas</span></li>
          <li><strong>${esc(perfil.sede || "—")}</strong><span>sede</span></li>
          <li><strong>${UMB.fecha(perfil.miembro_desde).replace(/^\d+ de /, "")}</strong><span>miembro desde</span></li>
        </ul>
      </div>`;
    const { productos: datos } = await UMB.cargarProductos();
    productos = datos.filter((p) => p.tienda_id === id);
    const g = $("#productos-vendedor");
    g.innerHTML = productos.length ? productos.map(UMB.tarjetaProducto).join("")
      : '<div class="vacio" style="grid-column:1/-1"><p>Esta tienda aún no tiene productos publicados.</p></div>';
    UMB.activarTarjetas(g, lista);
  }

  const pagina = document.body.dataset.pagina;
  if (pagina === "vendedor") iniciarVendedor();
  if (pagina === "inicio") iniciarPortada();
  if (pagina === "producto") iniciarFicha();
})();
