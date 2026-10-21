
let productos = [
  {
    id: 1,
    nombre: "Café orgánico Tierra Alta 500g",
    tienda: "Finca Tierra Alta · Huila",
    categoria: "Alimentos y bebidas",
    precio: 38000,
    rating: 4.8,
    resenas: 132,
    stock: 24,
    imagen: "marketplace/cafe.jpg",
    descripcion: "Café de origen único, cultivado a 1.800 msnm y tostado en pequeños lotes por la familia productora."
  },
  {
    id: 2,
    nombre: "Vasija artesanal de barro",
    tienda: "Barro & Fuego · Boyacá",
    categoria: "Artesanías",
    precio: 95000,
    rating: 4.6,
    resenas: 41,
    stock: 9,
    imagen: "marketplace/vasija.jpg",
    descripcion: "Vasija de barro cocido, moldeada y pintada a mano por artesanos de Ráquira."
  },
  {
    id: 3,
    nombre: "Mochila tejida wayuu",
    tienda: "Telar Wayuu · Riohacha",
    categoria: "Moda y accesorios",
    precio: 180000,
    rating: 5.0,
    resenas: 87,
    stock: 5,
    icono: "textil",
    descripcion: "Mochila tejida a mano en algodón, con patrones tradicionales wayuu."
  },
  {
    id: 4,
    nombre: "Miel pura de abejas 350ml",
    tienda: "Apiario San Vicente",
    categoria: "Alimentos y bebidas",
    precio: 22000,
    rating: 4.7,
    resenas: 64,
    stock: 40,
    icono: "miel",
    descripcion: "Miel 100% pura extraída en frío, sin aditivos ni procesos industriales."
  },
  {
    id: 5,
    nombre: "Aretes de filigrana en plata",
    tienda: "Joyería Mompox",
    categoria: "Moda y accesorios",
    precio: 145000,
    rating: 4.9,
    resenas: 29,
    stock: 7,
    icono: "joyeria",
    descripcion: "Aretes elaborados con la técnica tradicional de filigrana momposina."
  },
  {
    id: 6,
    nombre: "Chocolate 70% cacao 100g",
    tienda: "Cacao Sierra Nevada",
    categoria: "Alimentos y bebidas",
    precio: 15000,
    rating: 4.5,
    resenas: 58,
    stock: 60,
    icono: "chocolate",
    descripcion: "Barra de chocolate oscuro elaborada con cacao fino de aroma."
  },
  {
    id: 7,
    nombre: "Velas de cera de abeja (set x3)",
    tienda: "Casa Cera",
    categoria: "Hogar",
    precio: 48000,
    rating: 4.4,
    resenas: 19,
    stock: 15,
    icono: "vela",
    descripcion: "Velas artesanales de cera de abeja natural."
  },
  {
    id: 8,
    nombre: "Jabón natural de avena 100g",
    tienda: "Raíz Botánica",
    categoria: "Belleza natural",
    precio: 12000,
    rating: 4.6,
    resenas: 73,
    stock: 33,
    icono: "jabon",
    descripcion: "Jabón artesanal elaborado con avena e ingredientes vegetales."
  }
];

// Cargar productos desde Supabase
async function cargarProductosDesdeSupabase() {
  try {
    if (typeof window.obtenerProductosSupabase !== "function") {
      console.warn("Supabase no está disponible. Se usa el catálogo local.");
      return false;
    }

    const resultado = await window.obtenerProductosSupabase();

    if (
      !resultado ||
      !resultado.correcto ||
      !Array.isArray(resultado.productos) ||
      resultado.productos.length === 0
    ) {
      console.warn("No se encontraron productos en Supabase.");
      return false;
    }

    productos = resultado.productos
      .filter((p) => p.activo !== false)
      .map((p) => {
        const valorImagen = typeof p.imagen === "string" ? p.imagen : "";
        const esIcono = valorImagen.startsWith("icono:");

        return {
          ...p,
          id: Number(p.id),
          precio: Number(p.precio),
          rating: Number(p.rating),
          resenas: Number(p.resenas),
          stock: Number(p.stock),
          imagen: esIcono ? "" : valorImagen,
          icono: esIcono
            ? valorImagen.slice("icono:".length)
            : p.icono || ""
        };
      });

    console.log(
      `[Marketplace] ${productos.length} productos cargados desde Supabase.`
    );

    return true;
  } catch (error) {
    console.error("Error al cargar productos:", error);
    return false;
  }
}

// Iconos SVG
const iconosSVG = {
  cafe: `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="24" y="38" width="42" height="38" rx="6" fill="rgb(200,132,36)"/><path d="M66 46h8a10 10 0 0 1 0 20h-8" fill="none" stroke="rgb(22,40,31)" stroke-width="5"/></svg>`,

  ceramica: `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M35 30h30l-4 12c6 6 9 15 9 24 0 14-9 22-20 22s-20-8-20-22c0-9 3-18 9-24z" fill="rgb(193,67,46)"/></svg>`,

  textil: `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="26" y="34" width="48" height="46" rx="10" fill="rgb(227,165,66)"/></svg>`,

  miel: `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M36 28h28v14l6 8v26a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V50l6-8z" fill="rgb(227,165,66)"/></svg>`,

  joyeria: `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="38" r="12" fill="none" stroke="rgb(200,132,36)" stroke-width="5"/></svg>`,

  chocolate: `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="24" y="32" width="52" height="36" rx="4" fill="rgb(90,58,30)"/></svg>`,

  vela: `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="38" y="42" width="24" height="36" rx="3" fill="rgb(227,165,66)"/></svg>`,

  jabon: `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="26" y="38" width="48" height="28" rx="10" fill="rgb(246,241,227)" stroke="rgb(200,132,36)" stroke-width="3"/></svg>`
};

// Estado de la aplicación
const STORAGE_CARRITO = "marketplace_umb_carrito";
const STORAGE_WISHLIST = "marketplace_umb_wishlist";

function leerStorageSeguro(clave, valorInicial) {
  try {
    const valor = localStorage.getItem(clave);
    return valor ? JSON.parse(valor) : valorInicial;
  } catch (error) {
    console.warn("No se pudo leer el almacenamiento local:", error);
    return valorInicial;
  }
}

function guardarEstadoLocal() {
  try {
    localStorage.setItem(STORAGE_CARRITO, JSON.stringify(estado.carrito));
    localStorage.setItem(STORAGE_WISHLIST, JSON.stringify(estado.wishlist));
  } catch (error) {
    console.warn("No se pudo guardar el estado local:", error);
  }
}

const estado = {
  carrito: leerStorageSeguro(STORAGE_CARRITO, []),
  wishlist: leerStorageSeguro(STORAGE_WISHLIST, []),
  filtros: {
    categoria: "",
    precioMin: null,
    precioMax: null,
    calificacion: 0,
    soloStock: false
  },
  busqueda: ""
};

const formatoCOP = (n) =>
  "$" + Number(n || 0).toLocaleString("es-CO");

// Notificaciones
function mostrarToast(texto) {
  const cont = document.getElementById("toast-contenedor");
  const toast = document.createElement("div");

  toast.className = "toast";
  toast.textContent = texto;

  if (!cont) {
    console.log(texto);
    return;
  }

  cont.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("visible"));

  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// Filtros de productos
function productoCumpleFiltros(p) {
  const f = estado.filtros;

  if (f.categoria && p.categoria !== f.categoria) return false;
  if (f.precioMin != null && p.precio < Number(f.precioMin)) return false;
  if (f.precioMax != null && p.precio > Number(f.precioMax)) return false;
  if (f.calificacion && p.rating < f.calificacion) return false;
  if (f.soloStock && p.stock <= 0) return false;

  if (
    estado.busqueda &&
    !(
      p.nombre.toLowerCase().includes(estado.busqueda) ||
      p.tienda.toLowerCase().includes(estado.busqueda)
    )
  ) {
    return false;
  }

  return true;
}

// Mostrar catálogo
function renderCatalogo() {
  const grid = document.getElementById("catalogo-grid");
  if (!grid) return;

  grid.innerHTML = "";

  const visibles = productos.filter(productoCumpleFiltros);

  const contador = document.getElementById("contador-resultados");
  if (contador) contador.textContent = `${visibles.length} productos`;

  visibles.forEach((p) => {
    const article = document.createElement("article");
    article.className = "producto-card";

    const imagenHTML = p.imagen
      ? `<img src="${p.imagen}" alt="${p.nombre}" loading="lazy" onerror="this.style.display='none'">`
      : iconosSVG[p.icono] || iconosSVG.cafe;

    article.innerHTML = `
      <figure class="producto-imagen">
        ${imagenHTML}
        <figcaption>${p.tienda.split(" · ")[0]}</figcaption>
        <button
          class="btn-wishlist"
          data-producto-id="${p.id}"
          aria-pressed="${estado.wishlist.includes(p.id)}"
          type="button"
        >♥</button>
      </figure>

      <div class="producto-cuerpo">
        <span class="producto-categoria">${p.categoria}</span>
        <h3>${p.nombre}</h3>
        <p class="producto-rating">★ ${p.rating.toFixed(1)} (${p.resenas})</p>

        <div class="producto-precio-fila">
          <span class="precio-etiqueta">${formatoCOP(p.precio)}</span>
          <span
            class="producto-stock ${p.stock <= 5 ? "bajo" : ""}"
            data-stock-id="${p.id}"
          >${p.stock > 0 ? p.stock + " disp." : "Agotado"}</span>
        </div>

        <button
          class="boton boton-primario btn-agregar-carrito"
          data-producto-id="${p.id}"
          type="button"
          ${p.stock <= 0 ? "disabled" : ""}
        >${p.stock <= 0 ? "Sin stock" : `<svg class="icono-carrito" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/></svg><span>Agregar al carrito</span>`}</button>
      </div>
    `;

    grid.appendChild(article);
  });

  activarBotonesAgregarCarrito();
  activarBotonesWishlist();
}

// Aplicar filtros
document.getElementById("form-filtros")?.addEventListener("submit", (e) => {
  e.preventDefault();

  estado.filtros.categoria =
    document.getElementById("filtro-categoria").value;

  estado.filtros.precioMin =
    document.getElementById("filtro-precio-min").value || null;

  estado.filtros.precioMax =
    document.getElementById("filtro-precio-max").value || null;

  estado.filtros.calificacion = Number(
    document.getElementById("filtro-calificacion").value
  );

  estado.filtros.soloStock =
    document.getElementById("filtro-disponible").checked;

  renderCatalogo();
});

// Limpiar filtros
document.getElementById("btn-limpiar-filtros")?.addEventListener("click", () => {
  setTimeout(() => {
    estado.filtros = {
      categoria: "",
      precioMin: null,
      precioMax: null,
      calificacion: 0,
      soloStock: false
    };

    renderCatalogo();
  }, 0);
});

// Mostrar u ocultar filtros
document.getElementById("btn-toggle-filtros")?.addEventListener("click", function () {
  const aside = document.getElementById("filtros-aside");
  if (!aside) return;

  const abierto = aside.classList.toggle("visible");
  this.setAttribute("aria-expanded", abierto);
});

// Búsqueda global
document.getElementById("form-busqueda-global")?.addEventListener("submit", (e) => {
  e.preventDefault();

  estado.busqueda = document
    .getElementById("busqueda-global")
    .value.trim()
    .toLowerCase();

  renderCatalogo();
});

// Menú de navegación
document.getElementById("btn-menu")?.addEventListener("click", function () {
  const nav = document.getElementById("nav-categorias");
  if (!nav) return;

  const abierto = nav.classList.toggle("abierto");
  this.setAttribute("aria-expanded", abierto);
});

// Agregar productos al carrito
async function agregarAlCarrito(idProducto) {
  const producto = productos.find(
    (p) => p.id === Number(idProducto)
  );

  if (!producto) {
    return { producto: null, totalItems: 0 };
  }

  if (producto.stock <= 0) {
    mostrarToast("Este producto está agotado.");
    return { producto: null, totalItems: estado.carrito.reduce((acc, i) => acc + i.cantidad, 0) };
  }

  const existente = estado.carrito.find(
    (i) => i.id === producto.id
  );

  if (existente) {
    existente.cantidad += 1;
  } else {
    estado.carrito.push({ ...producto, cantidad: 1 });
  }

  producto.stock -= 1;

  return {
    producto,
    totalItems: estado.carrito.reduce((acc, i) => acc + i.cantidad, 0)
  };
}

// Evita registrar más de un evento por botón cuando se vuelve a renderizar la página.
const botonesCarritoActivados = new WeakSet();

// Activar botones de carrito
function activarBotonesAgregarCarrito() {
  document.querySelectorAll(".btn-agregar-carrito").forEach((btn) => {
    if (botonesCarritoActivados.has(btn)) return;
    botonesCarritoActivados.add(btn);
    btn.addEventListener("click", async (e) => {
      e.preventDefault();

      const idProducto = btn.dataset.productoId;
      if (!idProducto) return;

      btn.disabled = true;

      const resultado = await agregarAlCarrito(idProducto);

      if (!resultado.producto) {
        btn.disabled = true;
        return;
      }

      const contador = document.querySelector("#contador-carrito");
      if (contador) contador.textContent = resultado.totalItems;

      renderListaCarrito();
      actualizarStockEnPantalla(resultado.producto.id);

      mostrarToast(`${resultado.producto.nombre} se agregó al carrito.`);

      btn.disabled = resultado.producto.stock <= 0;

      if (resultado.producto.stock <= 0) {
        btn.textContent = "Sin stock";
      }
    });
  });
}

// Actualizar inventario visual
function actualizarStockEnPantalla(idProducto) {
  const producto = productos.find((p) => p.id === Number(idProducto));
  const badge = document.querySelector(`[data-stock-id="${idProducto}"]`);

  if (producto && badge) {
    badge.textContent =
      producto.stock > 0 ? producto.stock + " disp." : "Agotado";

    badge.classList.toggle("bajo", producto.stock <= 5);
  }

  renderInventario();
}

// Mostrar lista del carrito
function renderListaCarrito() {
  const lista = document.getElementById("lista-carrito");
  if (!lista) return;

  lista.innerHTML = "";

  if (estado.carrito.length === 0) {
    lista.innerHTML = `<li class="carrito-vacio">Tu carrito está vacío.</li>`;
  } else {
    estado.carrito.forEach((item) => {
      const li = document.createElement("li");
      li.className = "carrito-item";

      li.innerHTML = `
        <span>${item.nombre} × ${item.cantidad}</span>
        <span>${formatoCOP(item.precio * item.cantidad)}</span>
      `;

      lista.appendChild(li);
    });
  }

  const subtotal = estado.carrito.reduce(
    (acc, i) => acc + i.precio * i.cantidad,
    0
  );

  const carritoSubtotal = document.getElementById("carrito-subtotal");
  const resumenSubtotal = document.getElementById("resumen-subtotal");
  const resumenEnvio = document.getElementById("resumen-envio");
  const resumenTotal = document.getElementById("resumen-total");

  if (carritoSubtotal) carritoSubtotal.textContent = formatoCOP(subtotal);
  if (resumenSubtotal) resumenSubtotal.textContent = formatoCOP(subtotal);

  const envio = subtotal > 0 ? 8000 : 0;

  if (resumenEnvio) resumenEnvio.textContent = formatoCOP(envio);
  if (resumenTotal) resumenTotal.textContent = formatoCOP(subtotal + envio);
}

// Abrir y cerrar carrito
const carritoDrawer = document.getElementById("carrito-drawer");
const carritoOverlay = document.getElementById("carrito-overlay");

function abrirCarrito() {
  carritoDrawer?.classList.add("visible");
  carritoOverlay?.classList.add("visible");
}

function cerrarCarrito() {
  carritoDrawer?.classList.remove("visible");
  carritoOverlay?.classList.remove("visible");
}

document.getElementById("btn-abrir-carrito")?.addEventListener("click", abrirCarrito);
document.getElementById("btn-cerrar-carrito")?.addEventListener("click", cerrarCarrito);
carritoOverlay?.addEventListener("click", cerrarCarrito);
document.getElementById("btn-ir-checkout")?.addEventListener("click", cerrarCarrito);

// Lista de deseos
function activarBotonesWishlist() {
  document.querySelectorAll(".btn-wishlist").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.productoId);
      const enLista = estado.wishlist.includes(id);

      if (enLista) {
        estado.wishlist = estado.wishlist.filter((x) => x !== id);
      } else {
        estado.wishlist.push(id);
        mostrarToast("Guardado en tu lista de deseos.");
      }

      btn.setAttribute("aria-pressed", String(!enLista));
      guardarEstadoLocal();
      renderWishlist();
    });
  });
}

function renderWishlist() {
  const cont = document.getElementById("wishlist-lista");
  if (!cont) return;

  cont.innerHTML = "";

  if (estado.wishlist.length === 0) {
    cont.innerHTML = `<p class="wishlist-vacio">Aún no has guardado productos.</p>`;
    return;
  }

  estado.wishlist.forEach((id) => {
    const p = productos.find((prod) => prod.id === id);
    if (!p) return;

    const div = document.createElement("div");
    div.className = "wishlist-item";

    div.innerHTML = `
      <span>
        ${p.nombre}<br>
        <small style="color:#7a8a80;">${formatoCOP(p.precio)}</small>
      </span>
      <button
        class="boton boton-linea btn-agregar-carrito"
        data-producto-id="${p.id}"
        type="button"
      >Agregar</button>
    `;

    cont.appendChild(div);
  });

  activarBotonesAgregarCarrito();
}

// Mostrar inventario
function renderInventario() {
  const cont = document.getElementById("inventario-lista");
  if (!cont) return;

  cont.innerHTML = "";

  productos.forEach((p) => {
    const porcentaje = Math.min(
      100,
      Math.round((p.stock / 60) * 100)
    );

    const div = document.createElement("div");
    div.className = "inventario-item";

    div.innerHTML = `
      <div>
        <strong>${p.nombre}</strong>
        <div class="barra">
          <i style="width:${porcentaje}%;"></i>
        </div>
      </div>
      <span>${p.stock} und.</span>
    `;

    cont.appendChild(div);
  });
}

// Ficha del producto
function cargarFichaProducto(idProducto) {
  const p = productos.find(
    (prod) => Number(prod.id) === Number(idProducto)
  );

  if (!p) return;

  const nombre = document.getElementById("ficha-nombre");
  const tienda = document.getElementById("ficha-tienda");
  const descripcion = document.getElementById("ficha-descripcion");
  const precio = document.getElementById("ficha-precio");
  const stock = document.getElementById("ficha-stock");
  const imagen = document.getElementById("ficha-imagen-svg");

  if (nombre) nombre.textContent = p.nombre;
  if (tienda) tienda.textContent = p.tienda;
  if (descripcion) descripcion.textContent = p.descripcion || "";
  if (precio) precio.textContent = formatoCOP(p.precio);
  if (stock) stock.textContent = `${p.stock} unidades disponibles`;

  if (imagen) {
    imagen.src = p.imagen ||
      `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
        iconosSVG[p.icono] || iconosSVG.cafe
      )}`;

    imagen.alt = p.nombre;
  }
}

// Selección de rol en el formulario
document.querySelectorAll('input[name="rol"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const radioVendedor = document.getElementById("radio-vendedor");
    const camposTienda = document.getElementById("campos-tienda");

    if (radioVendedor && camposTienda) {
      camposTienda.classList.toggle("visible", radioVendedor.checked);
    }
  });
});

// Registro
document.getElementById("form-registro")?.addEventListener("submit", (e) => {
  e.preventDefault();
  mostrarToast("Cuenta creada correctamente.");
});

// Finalizar compra
document.getElementById("form-checkout")?.addEventListener("submit", (e) => {
  e.preventDefault();

  if (estado.carrito.length === 0) {
    const mensaje = document.getElementById("mensaje-checkout");
    if (mensaje) {
      mensaje.textContent = "Agrega al menos un producto al carrito.";
    }
    return;
  }

  mostrarToast("¡Pago procesado con éxito!");

  estado.carrito = [];
  guardarEstadoLocal();
  renderListaCarrito();

  const contador = document.getElementById("contador-carrito");
  if (contador) contador.textContent = "0";
});

// Inicializar marketplace
async function iniciarMarketplace() {
  await cargarProductosDesdeSupabase();

  renderCatalogo();
  renderListaCarrito();
  renderWishlist();
  renderInventario();
  cargarFichaProducto(1);
}

iniciarMarketplace();
