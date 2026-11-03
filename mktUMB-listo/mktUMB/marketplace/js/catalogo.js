/*
 * MARKETPLACE UMB · Portada, catálogo y ficha de producto
 */
(function () {
  "use strict";
  const { $, $$, esc } = UMB;
  let productos = [];
  const lista = () => productos;

  /* ======================= Portada ======================= */

  async function iniciarPortada() {
    const grid = $("#catalogo-grid");
    const estado = { q: (UMB.param("q") || "").toLowerCase(), cat: UMB.param("cat") || "", orden: "recientes", disponibles: false };

    // Categorías
    const contCats = $("#categorias");
    contCats.innerHTML = UMB.categorias.map((c) =>
      `<button class="categoria" type="button" data-cat="${esc(c.nombre)}" aria-pressed="${estado.cat === c.nombre}">
         <span class="categoria-icono" aria-hidden="true">${c.icono}</span>${esc(c.nombre)}
       </button>`).join("");

    const { productos: datos, origen } = await UMB.cargarProductos();
    productos = datos;

    $("#dato-productos").textContent = productos.length;
    $("#dato-tiendas").textContent = new Set(productos.map((p) => p.tienda)).size;
    if (origen === "demo") $("#aviso-demo").hidden = false;

    // Destacados: mejor calificados con stock
    const dest = $("#destacados-grid");
    const top = [...productos].filter((p) => p.stock > 0).sort((a, b) => b.rating * Math.log(b.resenas + 2) - a.rating * Math.log(a.resenas + 2)).slice(0, 4);
    dest.innerHTML = top.map(UMB.tarjetaProducto).join("");
    UMB.activarTarjetas(dest, lista);

    // Emprendimientos
    const tiendas = [...new Map(productos.map((p) => [p.tienda, p])).values()].slice(0, 6);
    $("#tiendas-grid").innerHTML = tiendas.map((p) => {
      const n = productos.filter((x) => x.tienda === p.tienda).length;
      return `<button class="tienda-card" type="button" data-tienda="${esc(p.tienda)}">
          <span class="avatar">${esc(UMB.iniciales(p.tienda))}</span>
          <span><strong>${esc(p.tienda)}</strong><span>${esc(p.categoria)} · ${n} producto${n === 1 ? "" : "s"}</span></span>
        </button>`;
    }).join("");

    // Chips de categoría del catálogo
    const chips = $("#chips");
    const cats = ["", ...new Set(productos.map((p) => p.categoria))];
    chips.innerHTML = cats.map((c) => `<button class="chip" type="button" data-chip="${esc(c)}" aria-pressed="${estado.cat === c}">${c ? esc(c) : "Todos"}</button>`).join("");

    function pintar() {
      let r = productos.filter((p) => {
        if (estado.cat && p.categoria !== estado.cat) return false;
        if (estado.disponibles && p.stock <= 0) return false;
        if (estado.q) {
          const texto = `${p.nombre} ${p.tienda} ${p.categoria} ${p.descripcion || ""}`.toLowerCase();
          return estado.q.split(/\s+/).every((t) => texto.includes(t));
        }
        return true;
      });
      const ord = {
        recientes: () => 0,
        "precio-asc": (a, b) => a.precio - b.precio,
        "precio-desc": (a, b) => b.precio - a.precio,
        rating: (a, b) => b.rating - a.rating
      }[estado.orden];
      r = [...r].sort(ord);

      $("#contador-resultados").textContent = `${r.length} producto${r.length === 1 ? "" : "s"}` + (estado.q ? ` para «${estado.q}»` : "");
      $$("[data-chip]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.chip === estado.cat)));
      $$("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cat === estado.cat)));

      if (!r.length) {
        grid.innerHTML = `<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">🔎</div><h3>No encontramos productos</h3><p>Prueba con otra palabra o quita los filtros.</p><button class="btn btn-linea" type="button" id="limpiar-filtros">Ver todo el catálogo</button></div>`;
        $("#limpiar-filtros").addEventListener("click", () => {
          estado.q = ""; estado.cat = ""; estado.disponibles = false;
          $("#buscar").value = ""; $("#solo-disponibles").checked = false;
          pintar();
        });
        return;
      }
      grid.innerHTML = r.map(UMB.tarjetaProducto).join("");
    }
    UMB.activarTarjetas(grid, lista);

    function elegirCategoria(c) {
      estado.cat = estado.cat === c ? "" : c;
      pintar();
      $("#catalogo").scrollIntoView({ behavior: "smooth" });
    }
    contCats.addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) elegirCategoria(b.dataset.cat); });
    chips.addEventListener("click", (e) => { const b = e.target.closest("[data-chip]"); if (b) { estado.cat = b.dataset.chip; pintar(); } });
    $("#tiendas-grid").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tienda]");
      if (!b) return;
      estado.q = b.dataset.tienda.toLowerCase(); estado.cat = "";
      $("#buscar").value = b.dataset.tienda;
      pintar();
      $("#catalogo").scrollIntoView({ behavior: "smooth" });
    });
    $("#orden").addEventListener("change", (e) => { estado.orden = e.target.value; pintar(); });
    $("#solo-disponibles").addEventListener("change", (e) => { estado.disponibles = e.target.checked; pintar(); });
    document.addEventListener("umb:buscar", (e) => { estado.q = e.detail.toLowerCase(); pintar(); });

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

    cont.innerHTML = `
      <nav class="migas" aria-label="Ruta"><a href="index.html">Inicio</a> / <a href="index.html?cat=${encodeURIComponent(p.categoria)}#catalogo">${esc(p.categoria)}</a> / <span>${esc(p.nombre)}</span></nav>
      <div class="ficha">
        <div class="ficha-imagen">${UMB.mediaProducto(p)}</div>
        <div>
          <span class="eyebrow">${esc(p.tienda)}</span>
          <h1>${esc(p.nombre)}</h1>
          ${p.resenas ? `<p class="producto-rating"><b>★</b> ${p.rating.toFixed(1)} · ${p.resenas} reseñas</p>` : ""}
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
            <li><span>Vendido por</span><strong>${esc(p.tienda)}</strong></li>
            <li><span>Categoría</span><strong>${esc(p.categoria)}</strong></li>
            <li><span>Disponibles</span><strong>${agotado ? "Agotado" : p.stock + " unidades"}</strong></li>
            <li><span>Envío</span><strong>Gratis desde ${UMB.dinero(UMB_CONFIG.ENVIO_GRATIS_DESDE)}</strong></li>
          </ul>
        </div>
      </div>`;

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

  const pagina = document.body.dataset.pagina;
  if (pagina === "inicio") iniciarPortada();
  if (pagina === "producto") iniciarFicha();
})();
