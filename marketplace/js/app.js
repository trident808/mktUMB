/*
 * MARKETPLACE UMB · Núcleo compartido por todas las páginas
 * ------------------------------------------------------------
 * - Cliente de Supabase
 * - Sesión, perfil y encabezado
 * - Carrito y favoritos (en el navegador)
 * - Catálogo de productos
 * - Utilidades (formato, avisos, botones)
 */
(function () {
  "use strict";

  const CFG = window.UMB_CONFIG || {};
  const UMB = (window.UMB = {});

  /* ======================= Supabase ======================= */

  UMB.db = null;
  try {
    if (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_KEY) {
      UMB.db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
  } catch (e) {
    console.error("[UMB] No se pudo crear el cliente de Supabase:", e);
  }

  /* ======================= Utilidades ======================= */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  UMB.$ = $;
  UMB.$$ = $$;

  UMB.esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fmt = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
  UMB.dinero = (n) => fmt.format(Number(n || 0));

  UMB.fecha = (iso, conHora = false) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("es-CO", conHora
      ? { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }
      : { day: "numeric", month: "long", year: "numeric" });
  };

  UMB.leer = (clave, defecto) => {
    try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) : defecto; } catch { return defecto; }
  };
  UMB.guardar = (clave, valor) => {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
  };

  UMB.param = (nombre) => new URLSearchParams(location.search).get(nombre);

  UMB.toast = (texto, opciones = {}) => {
    let cont = $("#toasts");
    if (!cont) {
      cont = document.createElement("div");
      cont.id = "toasts";
      cont.className = "toasts";
      cont.setAttribute("aria-live", "polite");
      document.body.appendChild(cont);
    }
    const t = document.createElement("div");
    t.className = "toast" + (opciones.error ? " error" : "");
    const span = document.createElement("span");
    span.textContent = texto;
    t.appendChild(span);
    if (opciones.enlace) {
      const a = document.createElement("a");
      a.href = opciones.enlace.href;
      a.textContent = opciones.enlace.texto;
      t.appendChild(a);
    }
    cont.appendChild(t);
    requestAnimationFrame(() => t.classList.add("visible"));
    setTimeout(() => { t.classList.remove("visible"); setTimeout(() => t.remove(), 300); }, opciones.duracion || 3500);
  };

  UMB.mensaje = (el, texto, tipo = "info") => {
    if (typeof el === "string") el = $(el);
    if (!el) return;
    el.textContent = texto || "";
    el.className = "mensaje" + (texto ? " " + tipo : "");
  };

  UMB.cargando = (boton, activo) => {
    if (!boton) return;
    boton.disabled = activo;
    boton.classList.toggle("cargando", activo);
  };

  /** Traduce los mensajes de error más comunes de Supabase. */
  UMB.traducirError = (error) => {
    const m = String(error?.message || error || "");
    const tabla = [
      [/invalid login credentials/i, "Correo o contraseña incorrectos."],
      [/email not confirmed/i, "Aún no has confirmado tu correo. Revisa tu bandeja de entrada (y la carpeta de spam)."],
      [/user already registered|already been registered/i, "Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña."],
      [/password should be at least/i, "La contraseña debe tener al menos 8 caracteres."],
      [/weak password|password is known/i, "Esa contraseña es muy fácil de adivinar. Usa una más segura."],
      [/rate limit|too many requests|for security purposes/i, "Demasiados intentos seguidos. Espera un momento e inténtalo de nuevo."],
      [/unable to validate email|invalid email/i, "El correo electrónico no es válido."],
      [/new password should be different/i, "La nueva contraseña debe ser distinta a la anterior."],
      [/failed to fetch|network/i, "No hay conexión con el servidor. Revisa tu internet."],
      [/jwt expired|session.*missing|auth session missing/i, "Tu sesión expiró. Inicia sesión de nuevo."],
      [/provider is not enabled|unsupported provider/i, "El inicio con Google aún no está activado en Supabase."],
      [/could not find the function|does not exist/i, "Falta configurar la base de datos (ejecuta schema.sql en Supabase)."],
      [/row-level security|permission denied/i, "No tienes permiso para realizar esta acción."]
    ];
    for (const [re, texto] of tabla) if (re.test(m)) return texto;
    return m || "Ocurrió un error inesperado.";
  };

  UMB.navegadorCorto = function (ua) {
    const nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
    const so = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    return so ? `${nav} en ${so}` : nav;
  };

  /* ======================= Tema ======================= */

  const TEMA_KEY = "umb_tema";
  function aplicarTema(tema) {
    if (tema === "claro" || tema === "oscuro") document.documentElement.dataset.tema = tema;
    else delete document.documentElement.dataset.tema;
  }
  aplicarTema(UMB.leer(TEMA_KEY, "auto"));

  function temaEfectivo() {
    const t = document.documentElement.dataset.tema;
    if (t) return t;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
  }

  /* ======================= Carrito ======================= */

  const CARRITO_KEY = "umb_carrito_v2";
  const FAV_KEY = "umb_favoritos_v2";

  UMB.carrito = {
    items() { return UMB.leer(CARRITO_KEY, []); },
    guardar(items) { UMB.guardar(CARRITO_KEY, items); UMB.carrito.actualizarContador(); },
    cantidadTotal() { return UMB.carrito.items().reduce((s, i) => s + Number(i.cantidad || 0), 0); },
    subtotal() { return UMB.carrito.items().reduce((s, i) => s + Number(i.precio) * Number(i.cantidad), 0); },
    envio(subtotal) {
      if (!subtotal) return 0;
      return subtotal >= (CFG.ENVIO_GRATIS_DESDE || 150000) ? 0 : (CFG.COSTO_ENVIO ?? 8000);
    },
    agregar(p, cantidad = 1) {
      const items = UMB.carrito.items();
      const id = String(p.id);
      const ex = items.find((i) => String(i.id) === id);
      const max = Math.max(0, Number(p.stock ?? 99));
      const actual = ex ? ex.cantidad : 0;
      const nueva = Math.min(actual + cantidad, max, 99);
      if (nueva <= actual) return false;
      if (ex) ex.cantidad = nueva;
      else items.push({
        id, nombre: p.nombre, precio: Number(p.precio), imagen: p.imagen || "", icono: p.icono || "",
        tienda: p.tienda || "", stock: max, cantidad: nueva
      });
      UMB.carrito.guardar(items);
      return true;
    },
    cambiar(id, cantidad) {
      const items = UMB.carrito.items();
      const it = items.find((i) => String(i.id) === String(id));
      if (!it) return;
      it.cantidad = Math.max(1, Math.min(Number(cantidad) || 1, Number(it.stock || 99), 99));
      UMB.carrito.guardar(items);
    },
    quitar(id) { UMB.carrito.guardar(UMB.carrito.items().filter((i) => String(i.id) !== String(id))); },
    vaciar() { UMB.carrito.guardar([]); },
    actualizarContador() {
      const n = UMB.carrito.cantidadTotal();
      $$("[data-contador-carrito]").forEach((el) => { el.textContent = n ? String(n) : ""; el.dataset.valor = n; });
    }
  };

  UMB.favoritos = {
    lista() { return UMB.leer(FAV_KEY, []).map(String); },
    tiene(id) { return UMB.favoritos.lista().includes(String(id)); },
    alternar(id) {
      const l = UMB.favoritos.lista();
      const i = l.indexOf(String(id));
      if (i >= 0) l.splice(i, 1); else l.push(String(id));
      UMB.guardar(FAV_KEY, l);
      return i < 0;
    }
  };

  window.addEventListener("storage", (e) => { if (e.key === CARRITO_KEY) UMB.carrito.actualizarContador(); });

  /* ======================= Productos ======================= */

  const ICONOS = {
    textil: '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="22" y="30" width="56" height="52" rx="12" fill="#e3a542"/><path d="M22 46h56M22 62h56" stroke="#c8102e" stroke-width="5"/><path d="M36 30c0-14 28-14 28 0" fill="none" stroke="#1b1724" stroke-width="5"/></svg>',
    miel: '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M34 26h32v12l8 10v30a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V48l8-10z" fill="#f2b705"/><rect x="32" y="18" width="36" height="10" rx="3" fill="#1b1724"/><path d="M40 58l10-6 10 6v10l-10 6-10-6z" fill="none" stroke="#9a6a00" stroke-width="3"/></svg>',
    joyeria: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="36" cy="44" r="13" fill="none" stroke="#b9b9c6" stroke-width="5"/><circle cx="64" cy="44" r="13" fill="none" stroke="#b9b9c6" stroke-width="5"/><path d="M36 57l-6 16h12zM64 57l-6 16h12z" fill="#c8102e"/></svg>',
    chocolate: '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="24" y="22" width="52" height="58" rx="5" fill="#5a3a1e"/><path d="M24 41h52M24 60h52M50 22v58" stroke="#3d2712" stroke-width="3"/><path d="M24 22h52v18L24 52z" fill="#c8102e"/></svg>',
    vela: '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="36" y="42" width="28" height="40" rx="4" fill="#f2d48a"/><path d="M50 18c7 9 7 16 0 20-7-4-7-11 0-20z" fill="#f2b705"/><path d="M50 38v6" stroke="#1b1724" stroke-width="3"/></svg>',
    jabon: '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="22" y="36" width="56" height="34" rx="14" fill="#f6efe0" stroke="#1f7a5a" stroke-width="4"/><circle cx="72" cy="28" r="6" fill="none" stroke="#1f7a5a" stroke-width="3"/><circle cx="62" cy="20" r="4" fill="none" stroke="#1f7a5a" stroke-width="3"/></svg>',
    cafe: '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M24 38h44v26a14 14 0 0 1-14 14H38a14 14 0 0 1-14-14z" fill="#c8102e"/><path d="M68 44h6a9 9 0 0 1 0 18h-6" fill="none" stroke="#1b1724" stroke-width="5"/><path d="M38 20c-4 6 4 8 0 14M50 20c-4 6 4 8 0 14" stroke="#b9a99a" stroke-width="3" fill="none"/></svg>',
    caja: '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M20 34l30-14 30 14v34L50 82 20 68z" fill="#e3a542"/><path d="M20 34l30 14 30-14M50 48v34" stroke="#9a6a00" stroke-width="3" fill="none"/></svg>'
  };
  UMB.iconos = ICONOS;

  const DEMO = [
    { id: "demo-1", nombre: "Café orgánico Tierra Alta 500 g", tienda: "Finca Tierra Alta", categoria: "Alimentos y bebidas", precio: 38000, rating: 4.8, resenas: 132, stock: 24, imagen: "marketplace/img/cafe.jpg", descripcion: "Café de origen único, cultivado a 1.800 m s. n. m. y tostado en pequeños lotes por la familia productora." },
    { id: "demo-2", nombre: "Vasija artesanal de barro", tienda: "Barro & Fuego", categoria: "Artesanías", precio: 95000, rating: 4.6, resenas: 41, stock: 9, imagen: "marketplace/img/vasija.jpg", descripcion: "Vasija de barro cocido, moldeada y pintada a mano por artesanos de Ráquira." },
    { id: "demo-3", nombre: "Mochila tejida wayuu", tienda: "Telar Wayuu", categoria: "Moda y accesorios", precio: 180000, rating: 5, resenas: 87, stock: 5, icono: "textil", descripcion: "Mochila tejida a mano en algodón, con patrones tradicionales wayuu." },
    { id: "demo-4", nombre: "Miel pura de abejas 350 ml", tienda: "Apiario San Vicente", categoria: "Alimentos y bebidas", precio: 22000, rating: 4.7, resenas: 64, stock: 40, icono: "miel", descripcion: "Miel 100 % pura extraída en frío, sin aditivos ni procesos industriales." },
    { id: "demo-5", nombre: "Aretes de filigrana en plata", tienda: "Joyería Mompox", categoria: "Moda y accesorios", precio: 145000, rating: 4.9, resenas: 29, stock: 7, icono: "joyeria", descripcion: "Aretes elaborados con la técnica tradicional de filigrana momposina." },
    { id: "demo-6", nombre: "Chocolate 70 % cacao 100 g", tienda: "Cacao Sierra Nevada", categoria: "Alimentos y bebidas", precio: 15000, rating: 4.5, resenas: 58, stock: 60, icono: "chocolate", descripcion: "Barra de chocolate oscuro elaborada con cacao fino de aroma." },
    { id: "demo-7", nombre: "Velas de cera de abeja (x3)", tienda: "Casa Cera", categoria: "Hogar", precio: 48000, rating: 4.4, resenas: 19, stock: 15, icono: "vela", descripcion: "Velas artesanales de cera de abeja natural, de larga duración." },
    { id: "demo-8", nombre: "Jabón natural de avena 100 g", tienda: "Raíz Botánica", categoria: "Belleza natural", precio: 12000, rating: 4.6, resenas: 73, stock: 33, icono: "jabon", descripcion: "Jabón artesanal elaborado con avena e ingredientes vegetales." }
  ];

  UMB.categorias = [
    { nombre: "Alimentos y bebidas", icono: "☕" },
    { nombre: "Artesanías", icono: "🏺" },
    { nombre: "Moda y accesorios", icono: "🎒" },
    { nombre: "Tecnología", icono: "💻" },
    { nombre: "Hogar", icono: "🕯️" },
    { nombre: "Belleza natural", icono: "🌿" },
    { nombre: "Servicios", icono: "🛠️" },
    { nombre: "Otros", icono: "✨" }
  ];

  function normalizar(p) {
    const img = typeof p.imagen === "string" ? p.imagen.trim() : "";
    const esIcono = img.startsWith("icono:");
    return {
      ...p,
      id: String(p.id),
      nombre: p.nombre || "Producto",
      tienda: p.tienda || "Emprendimiento UMB",
      categoria: p.categoria || "Otros",
      precio: Number(p.precio || 0),
      rating: Number(p.rating || 0),
      resenas: Number(p.resenas || 0),
      stock: Number(p.stock ?? 0),
      imagen: esIcono ? "" : img,
      icono: esIcono ? img.slice(6) : p.icono || "",
      demo: Boolean(p.demo)
    };
  }

  let cacheProductos = null;
  /** Devuelve { productos, origen: "supabase" | "demo", error } */
  UMB.cargarProductos = async function () {
    if (cacheProductos) return cacheProductos;
    if (UMB.db) {
      try {
        let { data, error } = await UMB.db
          .from("productos")
          .select("*")
          .eq("activo", true)
          .order("creado_en", { ascending: false });
        if (error) {
          // Tabla antigua sin las columnas nuevas: leer todo sin filtros.
          ({ data, error } = await UMB.db.from("productos").select("*"));
        }
        if (error) throw error;
        const lista = (data || []).filter((p) => p.activo !== false).map(normalizar);
        if (!lista.length) {
          cacheProductos = { productos: DEMO.map((p) => normalizar({ ...p, demo: true })), origen: "demo", error: "vacio" };
          return cacheProductos;
        }
        cacheProductos = { productos: lista, origen: "supabase", error: null };
        return cacheProductos;
      } catch (e) {
        console.warn("[UMB] No se pudo leer el catálogo de Supabase:", e.message || e);
        cacheProductos = { productos: DEMO.map((p) => normalizar({ ...p, demo: true })), origen: "demo", error: e };
        return cacheProductos;
      }
    }
    cacheProductos = { productos: DEMO.map((p) => normalizar({ ...p, demo: true })), origen: "demo", error: "sin-conexion" };
    return cacheProductos;
  };

  UMB.mediaProducto = (p) =>
    p.imagen
      ? `<img src="${UMB.esc(p.imagen)}" alt="${UMB.esc(p.nombre)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{innerHTML:UMB.iconos.caja}))">`
      : ICONOS[p.icono] || ICONOS.caja;

  const SVG_CORAZON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const SVG_MAS = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  UMB.tarjetaProducto = (p) => {
    const url = `producto.html?id=${encodeURIComponent(p.id)}`;
    const fav = UMB.favoritos.tiene(p.id);
    const agotado = p.stock <= 0;
    return `
      <article class="producto">
        <a class="producto-imagen" href="${url}" tabindex="-1" aria-hidden="true">
          ${UMB.mediaProducto(p)}
          ${agotado ? '<span class="etiqueta etiqueta-flotante">Agotado</span>' : p.stock <= 5 ? '<span class="etiqueta etiqueta-flotante etiqueta-roja">Últimas unidades</span>' : ""}
        </a>
        <button class="btn-favorito" type="button" data-favorito="${UMB.esc(p.id)}" aria-pressed="${fav}" aria-label="Guardar ${UMB.esc(p.nombre)} en favoritos">${SVG_CORAZON}</button>
        <div class="producto-cuerpo">
          <span class="producto-tienda">${UMB.esc(p.tienda)}</span>
          <h3><a href="${url}">${UMB.esc(p.nombre)}</a></h3>
          ${p.resenas ? `<span class="producto-rating"><b>★</b> ${p.rating.toFixed(1)} · ${p.resenas} reseñas</span>` : '<span class="producto-rating">Nuevo</span>'}
          <div class="producto-pie">
            <span class="precio">${UMB.dinero(p.precio)}</span>
            <button class="btn-agregar" type="button" data-agregar="${UMB.esc(p.id)}" ${agotado ? "disabled" : ""} aria-label="Agregar ${UMB.esc(p.nombre)} al carrito">${SVG_MAS}</button>
          </div>
        </div>
      </article>`;
  };

  /** Activa los botones de carrito y favoritos dentro de un contenedor. */
  UMB.activarTarjetas = (contenedor, productos) => {
    if (!contenedor || contenedor.dataset.activo) return;
    contenedor.dataset.activo = "1";
    contenedor.addEventListener("click", (e) => {
      const add = e.target.closest("[data-agregar]");
      if (add) {
        const p = productos().find((x) => x.id === add.dataset.agregar);
        if (!p) return;
        if (UMB.carrito.agregar(p, 1)) {
          UMB.toast(`Agregaste "${p.nombre}" al carrito.`, { enlace: { href: "carrito.html", texto: "Ver carrito" } });
        } else {
          UMB.toast("Ya tienes en el carrito todas las unidades disponibles.");
        }
        return;
      }
      const fav = e.target.closest("[data-favorito]");
      if (fav) {
        const ahora = UMB.favoritos.alternar(fav.dataset.favorito);
        $$(`[data-favorito="${CSS.escape(fav.dataset.favorito)}"]`).forEach((b) => b.setAttribute("aria-pressed", String(ahora)));
        UMB.toast(ahora ? "Guardado en tus favoritos." : "Quitado de tus favoritos.");
      }
    });
  };

  /* ======================= Sesión y perfil ======================= */

  let perfilPromesa = null;
  let perfilUsuario = null;
  UMB.sesion = async () => {
    if (!UMB.db) return null;
    try {
      const { data } = await UMB.db.auth.getSession();
      return data.session || null;
    } catch { return null; }
  };

  async function leerPerfil() {
    const s = await UMB.sesion();
    if (!s) return null;
    const meta = s.user.user_metadata || {};
    const base = {
      id: s.user.id,
      correo: s.user.email,
      nombre: meta.nombre || meta.full_name || meta.name || (s.user.email || "").split("@")[0],
      telefono: meta.telefono || "",
      avatar_url: meta.avatar_url || meta.picture || "",
      rol: "cliente",
      _sinTabla: true
    };
    try {
      const { data, error } = await UMB.db.from("perfiles").select("*").eq("id", s.user.id).maybeSingle();
      if (error) throw error;
      return data ? { ...base, ...data, _sinTabla: false } : base;
    } catch (e) {
      console.warn("[UMB] No se pudo leer el perfil:", e.message || e);
      return base;
    }
  }

  /** Perfil del usuario actual (tabla "perfiles"). Se consulta una sola vez por página. */
  UMB.perfil = (forzar = false) => {
    if (!perfilPromesa || forzar) perfilPromesa = leerPerfil();
    return perfilPromesa;
  };

  UMB.iniciales = (nombre) =>
    String(nombre || "U").trim().split(/\s+/).slice(0, 2).map((t) => t[0] || "").join("").toUpperCase() || "U";

  UMB.avatarHTML = (perfil, clase = "avatar") =>
    perfil?.avatar_url
      ? `<span class="${clase}"><img src="${UMB.esc(perfil.avatar_url)}" alt="" referrerpolicy="no-referrer"></span>`
      : `<span class="${clase}">${UMB.esc(UMB.iniciales(perfil?.nombre))}</span>`;

  /** Si no hay sesión, envía a login y vuelve aquí después. */
  UMB.exigirSesion = async () => {
    const s = await UMB.sesion();
    if (!s) {
      location.replace(`login.html?volver=${encodeURIComponent(location.pathname.split("/").pop() + location.search)}`);
      return null;
    }
    return s;
  };

  UMB.cerrarSesion = async () => {
    try { await UMB.db?.auth.signOut(); } catch { /* nada */ }
    perfilPromesa = null;
    location.href = "index.html";
  };

  /**
   * Guarda en la tabla "accesos" cada inicio de sesión.
   * auth.js marca "umb_registrar_acceso" antes de iniciar sesión
   * (también cuando se vuelve de Google), y aquí se envía una sola vez.
   */
  UMB.marcarAcceso = (metodo) => { try { sessionStorage.setItem("umb_registrar_acceso", metodo); } catch { /* nada */ } };
  UMB.registrarAccesoPendiente = async (sesion) => {
    let metodo = null;
    try { metodo = sessionStorage.getItem("umb_registrar_acceso"); } catch { /* nada */ }
    if (!metodo || !sesion || !UMB.db) return;
    try { sessionStorage.removeItem("umb_registrar_acceso"); } catch { /* nada */ }
    const { error } = await UMB.db.rpc("registrar_acceso", {
      p_metodo: metodo,
      p_navegador: navigator.userAgent.slice(0, 250)
    });
    if (error) console.warn("[UMB] No se registró el acceso:", error.message);
  };

  /* ======================= Encabezado ======================= */

  async function pintarCabecera() {
    const zonaSin = $$("[data-sin-sesion]");
    const zonaCon = $$("[data-con-sesion]");
    const s = await UMB.sesion();
    zonaSin.forEach((el) => (el.hidden = Boolean(s)));
    zonaCon.forEach((el) => (el.hidden = !s));
    if (!s) return;

    await UMB.registrarAccesoPendiente(s);
    const p = await UMB.perfil();
    const boton = $("#usuario-boton");
    if (boton) boton.innerHTML = `${UMB.avatarHTML(p)}<span class="usuario-nombre">${UMB.esc(p.nombre.split(" ")[0])}</span>`;
    const cab = $("#menu-correo");
    if (cab) cab.textContent = p.correo || "";
    $$("[data-solo-admin]").forEach((el) => (el.hidden = p.rol !== "admin"));
  }

  function activarCabecera() {
    // Menú móvil
    const btnMenu = $("#btn-menu");
    const nav = $("#nav-principal");
    btnMenu?.addEventListener("click", () => {
      const abierto = nav.classList.toggle("abierto");
      btnMenu.setAttribute("aria-expanded", String(abierto));
    });

    // Menú de usuario
    const ub = $("#usuario-boton");
    const menu = $("#usuario-desplegable");
    ub?.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      ub.setAttribute("aria-expanded", String(!menu.hidden));
    });
    document.addEventListener("click", (e) => {
      if (menu && !menu.hidden && !menu.contains(e.target)) { menu.hidden = true; ub?.setAttribute("aria-expanded", "false"); }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu && !menu.hidden) { menu.hidden = true; ub?.focus(); }
    });
    $$("[data-cerrar-sesion]").forEach((b) => b.addEventListener("click", UMB.cerrarSesion));

    // Tema
    const bt = $("#btn-tema");
    const pintarIconoTema = () => bt && bt.setAttribute("aria-label", temaEfectivo() === "oscuro" ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
    pintarIconoTema();
    bt?.addEventListener("click", () => {
      const nuevo = temaEfectivo() === "oscuro" ? "claro" : "oscuro";
      aplicarTema(nuevo);
      UMB.guardar(TEMA_KEY, nuevo);
      pintarIconoTema();
    });

    // Buscador: en la portada filtra en vivo; en otras páginas lleva al catálogo.
    const form = $("#form-buscar");
    form?.addEventListener("submit", (e) => {
      const q = $("#buscar").value.trim();
      if (document.body.dataset.pagina === "inicio") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("umb:buscar", { detail: q }));
        $("#catalogo")?.scrollIntoView({ behavior: "smooth" });
      }
    });
    if (document.body.dataset.pagina === "inicio") {
      $("#buscar")?.addEventListener("input", (e) =>
        document.dispatchEvent(new CustomEvent("umb:buscar", { detail: e.target.value.trim() })));
    }
    const q = UMB.param("q");
    if (q && $("#buscar")) $("#buscar").value = q;

    // Correo de soporte desde la configuración
    if (CFG.CORREO_SOPORTE) $$("#correo-soporte").forEach((a) => { a.href = "mailto:" + CFG.CORREO_SOPORTE; a.textContent = CFG.CORREO_SOPORTE; });

    // Año en el pie
    $$("[data-anio]").forEach((el) => (el.textContent = new Date().getFullYear()));

    // Aviso si no hay conexión con Supabase
    if (!UMB.db) {
      const aviso = document.createElement("div");
      aviso.className = "aviso-conexion";
      aviso.textContent = "No se pudo conectar con el servidor. Algunas funciones no estarán disponibles.";
      $(".cabecera")?.after(aviso);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    activarCabecera();
    UMB.carrito.actualizarContador();
    pintarCabecera();
    UMB.db?.auth.onAuthStateChange((evento, sesion) => {
      const id = sesion?.user?.id || null;
      if (evento === "INITIAL_SESSION") { perfilUsuario = id; return; }
      // Volver a pintar solo si cambió el usuario (no en cada renovación del token).
      if (id !== perfilUsuario || evento === "USER_UPDATED") {
        perfilUsuario = id;
        perfilPromesa = null;
        setTimeout(pintarCabecera, 0);
      }
    });
  });
})();
