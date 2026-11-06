/*
 * MARKETPLACE UMB · Panel del vendedor (tienda, productos y pedidos recibidos)
 */
(function () {
  "use strict";
  const { $, esc } = UMB;

  async function iniciar() {
    const sesion = await UMB.exigirSesion();
    if (!sesion) return;
    const uid = sesion.user.id;

    // RNF-02: si activó la verificación en dos pasos, completar el segundo paso antes de vender.
    const { data: aal } = await UMB.db.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      location.replace("login.html?volver=vender.html");
      return;
    }

    const [{ data: tienda, error }, perfil] = await Promise.all([
      UMB.db.from("tiendas").select("*").eq("usuario_id", uid).maybeSingle(),
      UMB.perfil(true)
    ]);
    $("#cargando-panel").hidden = true;

    if (error) {
      $("#error-panel").hidden = false;
      UMB.mensaje("#error-panel", UMB.traducirError(error), "error");
      return;
    }

    // RF-04: solo usuarios verificados venden.
    const estado = perfil?.estado_cuenta || "pendiente";
    if (estado !== "verificado") {
      const texto = {
        suspendido: "Tu cuenta está suspendida, así que no puedes vender. " + (perfil.motivo_estado || ""),
        egresado: "Tu cuenta está inactiva, así que no puedes vender."
      }[estado];
      if (!tienda || texto) {
        $("#sin-verificar").hidden = false;
        if (texto) {
          $("#sin-verificar-texto").textContent = texto;
          $("#sin-verificar .btn").hidden = true;
        } else {
          const { data: sol } = await UMB.db.from("verificaciones").select("estado").eq("usuario_id", uid)
            .order("creado_en", { ascending: false }).limit(1);
          if (sol?.[0]?.estado === "pendiente") {
            $("#sin-verificar-texto").textContent = "Tus documentos están en revisión. Te avisaremos cuando un moderador apruebe tu cuenta.";
            $("#sin-verificar .btn").textContent = "Ver estado";
          }
        }
        return;
      }
      // Tiene tienda de antes pero no está verificado: puede ver su panel, no publicar.
      UMB.mensaje("#error-panel", "Para publicar o editar productos debes verificar tu identidad.", "info");
      $("#error-panel").hidden = false;
      $("#error-panel").insertAdjacentHTML("beforeend", ' <a class="enlace" href="verificacion.html">Verificar ahora</a>');
    }

    if (!tienda) return mostrarCrearTienda();
    mostrarPanel(tienda, uid);
  }

  /* ---------- Crear tienda ---------- */

  function mostrarCrearTienda() {
    $("#crear-tienda").hidden = false;
    const form = $("#form-tienda");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      UMB.cargando(btn, true);
      const { error } = await UMB.db.rpc("crear_tienda", {
        p_nombre: form.nombre.value.trim(),
        p_descripcion: form.descripcion.value.trim() || null,
        p_categoria: form.categoria.value || null,
        p_telefono: form.telefono.value.trim() || null
      });
      UMB.cargando(btn, false);
      if (error) return UMB.mensaje("#mensaje-tienda", UMB.traducirError(error), "error");
      UMB.toast("¡Tu tienda está lista! Ahora publica tu primer producto.");
      location.reload();
    });
  }

  /* ---------- Panel ---------- */

  async function mostrarPanel(tienda, uid) {
    $("#panel").hidden = false;
    $("#tienda-nombre").textContent = tienda.nombre;
    $("#tienda-detalle").textContent = [tienda.categoria, tienda.telefono].filter(Boolean).join(" · ") || "Completa los datos de tu tienda";

    const form = $("#form-producto");
    const editor = $("#editor-producto");
    const MIN_FOTOS = 3;
    // vender.html viejo con vender.js nuevo: avisar en vez de fallar.
    if (!form || !editor || !form.entrega_domicilio || !$("#pr-fotos")) {
      ($("#mis-productos") || $("#panel")).innerHTML = `<div class="vacio"><div class="vacio-icono">⚠️</div>
        <h2>Esta página está desactualizada</h2>
        <p>El archivo <strong>vender.html</strong> del sitio es de una versión anterior. Súbelo de nuevo desde el zip (está en la carpeta principal, junto a index.html) y recarga con <strong>Ctrl + Shift + R</strong>.</p></div>`;
      return;
    }
    const MODERACION = {
      borrador: ["Borrador", "estado-pendiente"],
      pendiente: ["⏳ En revisión", "estado-confirmado"],
      aprobado: ["✓ Publicado", "estado-entregado"],
      rechazado: ["✕ Rechazado", "estado-cancelado"]
    };
    let misProductos = [];
    let actual = null;      // producto que se está editando
    let fotos = [];         // fotos del producto actual

    // Categorías desde la base de datos (RF-38)
    const cats = await UMB.cargarCategorias();
    form.categoria.innerHTML = '<option value="">Selecciona…</option>' + cats.map((c) => `<option>${esc(c.nombre)}</option>`).join("");
    const actualizarTamano = () => { $("#campo-tamano").hidden = !form.entrega_domicilio.checked; };
    form.entrega_domicilio.addEventListener("change", actualizarTamano);

    /* ----- Editor ----- */

    function pintarFotos() {
      $("#contador-fotos").textContent = `(${fotos.length} de mínimo ${MIN_FOTOS})`;
      $("#contador-fotos").classList.toggle("ok", fotos.length >= MIN_FOTOS);
      $("#fotos-editor").innerHTML = fotos.map((f) => `
        <figure class="foto-editor${f.con_codigo ? " con-codigo" : ""}">
          <img src="${esc(f.vista || f.url)}" alt="Foto del producto" data-foto-url="${esc(f.url)}">
          <label class="check-linea"><input type="radio" name="foto-codigo" value="${f.id}" ${f.con_codigo ? "checked" : ""}> Tiene el código</label>
          <button class="btn-quitar-foto" type="button" data-quitar-foto="${f.id}" aria-label="Quitar foto">✕</button>
        </figure>`).join("");
      // Si la foto no se puede mostrar, decirlo en vez de dejar el recuadro vacío.
      $("#fotos-editor").querySelectorAll("img").forEach((img) => {
        img.addEventListener("error", () => {
          img.closest("figure").classList.add("foto-rota");
          UMB.mensaje("#mensaje-producto",
            "Una foto se subió pero no se puede ver. En Supabase → Storage, el bucket «productos» debe estar como Public (vuelve a ejecutar schema.sql).", "error");
        }, { once: true });
      });
    }

    async function abrirEditor(producto) {
      actual = producto;
      const { data } = await UMB.db.from("producto_fotos").select("*").eq("producto_id", producto.id).order("orden");
      fotos = data || [];
      $("#titulo-editor").textContent = producto.estado_moderacion === "borrador" ? "Nueva publicación" : "Editar publicación";
      $("#codigo-publicacion").textContent = producto.codigo_verificacion || "—";
      const nota = $("#nota-edicion");
      if (producto.estado_moderacion === "aprobado") {
        nota.textContent = "Puedes cambiar precio y cantidad sin perder la publicación. Si cambias el nombre, la descripción, la categoría o las fotos, volverá a revisión.";
        nota.hidden = false;
      } else if (producto.estado_moderacion === "rechazado") {
        nota.textContent = "Motivo del rechazo: " + (producto.motivo_moderacion || "—") + " Corrige y envíala de nuevo.";
        nota.className = "mensaje error"; nota.hidden = false;
      } else { nota.hidden = true; nota.className = "mensaje info"; }
      form.nombre.value = producto.nombre === "Nueva publicación" ? "" : producto.nombre;
      form.categoria.value = producto.estado_moderacion === "borrador" && producto.categoria === "Otros" ? "" : (producto.categoria || "");
      form.estado_producto.value = producto.estado_producto || "nuevo";
      form.precio.value = Number(producto.precio) || "";
      form.stock.value = producto.estado_moderacion === "borrador" && !Number(producto.stock) ? "" : producto.stock;
      form.descripcion.value = producto.descripcion || "";
      form.entrega_en_u.checked = producto.entrega_en_u !== false;
      form.entrega_domicilio.checked = Boolean(producto.entrega_domicilio);
      form.tamano.value = producto.tamano || "pequeno";
      actualizarTamano();
      $("#btn-enviar-revision").textContent = producto.estado_moderacion === "aprobado" ? "Guardar cambios" : "Enviar a revisión";
      $("#btn-guardar-borrador").hidden = producto.estado_moderacion === "aprobado";
      UMB.mensaje("#mensaje-producto", "");
      pintarFotos();
      editor.hidden = false;
      editor.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function cerrarEditor() { editor.hidden = true; actual = null; fotos = []; }
    $("#btn-cerrar-editor").addEventListener("click", cerrarEditor);

    $("#btn-nueva-publicacion").addEventListener("click", async (e) => {
      const b = e.currentTarget;
      UMB.cargando(b, true);
      const { data, error } = await UMB.db.rpc("nueva_publicacion");
      UMB.cargando(b, false);
      if (error) return UMB.toast(UMB.traducirError(error), { error: true });
      await cargarProductos();
      const p = misProductos.find((x) => String(x.id) === String(data.id));
      abrirEditor(p || { id: data.id, codigo_verificacion: data.codigo, estado_moderacion: "borrador", nombre: "", precio: 0, stock: 0 });
    });

    // Subir fotos (RF-06) con su huella para detectar repetidas (RF-07)
    $("#pr-fotos").addEventListener("change", async (e) => {
      const archivos = [...e.target.files].filter((f) => /^image\//.test(f.type));
      e.target.value = "";
      if (!actual || !archivos.length) return;
      if (fotos.length + archivos.length > 8) return UMB.toast("Máximo 8 fotos por publicación.", { error: true });
      UMB.mensaje("#mensaje-producto", `Subiendo ${archivos.length} foto(s)…`, "info");
      try {
        for (const f of archivos) {
          const blob = await UMB.reducirImagen(f, 1400);
          if (blob === f && !/^image\/(jpe?g|png|webp|gif)$/i.test(f.type)) {
            throw new Error(`La foto «${f.name}» está en un formato que el navegador no puede abrir (por ejemplo HEIC de iPhone). Tómala de nuevo en JPG o haz una captura de pantalla de la foto y súbela.`);
          }
          const tipo = blob.type || f.type || "image/jpeg";
          const ext = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[tipo] || "jpg";
          const huella = await UMB.huellaImagen(blob);
          const ruta = `${uid}/${actual.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
          const up = await UMB.db.storage.from("productos").upload(ruta, blob, { contentType: tipo, upsert: false });
          if (up.error) throw up.error;
          const url = UMB.db.storage.from("productos").getPublicUrl(ruta).data.publicUrl;
          const { data, error } = await UMB.db.from("producto_fotos")
            .insert({ producto_id: actual.id, ruta, url, orden: fotos.length + 1, huella, con_codigo: false })
            .select().single();
          if (error) throw error;
          data.vista = URL.createObjectURL(blob);   // se ve al instante, sin esperar la descarga
          fotos.push(data);
          pintarFotos();
        }
        UMB.mensaje("#mensaje-producto", "");
        cargarProductos();
      } catch (err) {
        UMB.mensaje("#mensaje-producto", UMB.traducirError(err), "error");
      }
    });

    $("#fotos-editor").addEventListener("change", async (e) => {
      if (e.target.name !== "foto-codigo") return;
      const id = Number(e.target.value);
      await UMB.db.from("producto_fotos").update({ con_codigo: false }).eq("producto_id", actual.id);
      const { error } = await UMB.db.from("producto_fotos").update({ con_codigo: true }).eq("id", id);
      if (error) return UMB.toast(UMB.traducirError(error), { error: true });
      fotos.forEach((f) => (f.con_codigo = f.id === id));
      pintarFotos();
    });

    $("#fotos-editor").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-quitar-foto]");
      if (!b) return;
      const f = fotos.find((x) => String(x.id) === b.dataset.quitarFoto);
      const { error } = await UMB.db.from("producto_fotos").delete().eq("id", f.id);
      if (error) return UMB.toast(UMB.traducirError(error), { error: true });
      UMB.db.storage.from("productos").remove([f.ruta]);
      fotos = fotos.filter((x) => x !== f);
      cargarProductos();
      pintarFotos();
    });

    function datosFormulario() {
      return {
        nombre: form.nombre.value.trim(),
        categoria: form.categoria.value || "Otros",
        estado_producto: form.estado_producto.value,
        precio: Math.round(Number(form.precio.value)) || 0,
        stock: Math.max(0, Math.round(Number(form.stock.value)) || 0),
        descripcion: form.descripcion.value.trim() || null,
        entrega_en_u: form.entrega_en_u.checked,
        entrega_domicilio: form.entrega_domicilio.checked,
        tamano: form.tamano.value
      };
    }

    async function guardar() {
      const datos = datosFormulario();
      if (!datos.nombre) datos.nombre = "Nueva publicación";
      const { error } = await UMB.db.from("productos").update(datos).eq("id", actual.id);
      if (error) throw error;
    }

    $("#btn-guardar-borrador").addEventListener("click", async (e) => {
      const b = e.currentTarget;
      UMB.cargando(b, true);
      try { await guardar(); UMB.toast("Borrador guardado."); await cargarProductos(); }
      catch (err) { UMB.mensaje("#mensaje-producto", UMB.traducirError(err), "error"); }
      finally { UMB.cargando(b, false); }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = $("#btn-enviar-revision");
      const msg = "#mensaje-producto";
      const d = datosFormulario();
      // Validaciones rápidas antes de ir al servidor (el servidor las repite)
      if (fotos.length < MIN_FOTOS) return UMB.mensaje(msg, `Sube al menos ${MIN_FOTOS} fotos reales del producto.`, "error");
      if (!fotos.some((f) => f.con_codigo)) return UMB.mensaje(msg, "Marca cuál foto muestra el código escrito en el papel.", "error");
      if (!d.entrega_en_u && !d.entrega_domicilio) return UMB.mensaje(msg, "Elige al menos una modalidad de entrega.", "error");
      UMB.cargando(b, true);
      try {
        await guardar();
        if (actual.estado_moderacion === "aprobado") {
          await cargarProductos();
          let p = misProductos.find((x) => x.id === actual.id);
          if (p?.estado_moderacion === "pendiente") {
            // Cambió el contenido o las fotos: se validan de nuevo (fotos repetidas, código, etc.)
            const r = await UMB.db.rpc("enviar_a_revision", { p_producto: actual.id });
            if (r.error) throw r.error;
            await cargarProductos();
            p = misProductos.find((x) => x.id === actual.id);
          }
          UMB.toast(p?.estado_moderacion === "pendiente" ? "Cambios guardados. La publicación volvió a revisión." : "Cambios guardados.");
          cerrarEditor();
          return;
        }
        const { data, error } = await UMB.db.rpc("enviar_a_revision", { p_producto: actual.id });
        if (error) throw error;
        if (data.estado === "rechazado") {
          UMB.mensaje(msg, `No se puede publicar: parece un producto prohibido (${(data.motivos || []).join(", ")}). Revisa los términos y condiciones.`, "error");
        } else {
          UMB.toast("¡Enviada a revisión! Te avisaremos cuando un moderador la apruebe.");
          // RF-07: revisión en internet (opcional, si está configurada)
          UMB.db.functions.invoke("revisar-imagenes", { body: { producto_id: actual.id } }).catch(() => {});
          cerrarEditor();
        }
        await cargarProductos();
      } catch (err) {
        UMB.mensaje(msg, UMB.traducirError(err), "error");
      } finally {
        UMB.cargando(b, false);
      }
    });

    /* ----- Lista de publicaciones ----- */

    async function cargarProductos() {
      const { data, error } = await UMB.db.from("productos").select("*").eq("tienda_id", tienda.id).order("creado_en", { ascending: false });
      const cont = $("#mis-productos");
      if (error) { cont.innerHTML = `<p class="mensaje error">${esc(UMB.traducirError(error))}</p>`; return; }
      misProductos = data;
      $("#total-productos").textContent = data.filter((p) => p.estado_moderacion === "aprobado").length;
      if (!data.length) {
        cont.innerHTML = `<div class="vacio"><div class="vacio-icono">🏷️</div><p>Aún no tienes publicaciones. Toca «Publicar un producto» para crear la primera.</p></div>`;
        return;
      }
      cont.innerHTML = data.map((p) => {
        const img = typeof p.imagen === "string" && p.imagen && !p.imagen.startsWith("icono:") ? p.imagen : "";
        const media = img ? `<img src="${esc(img)}" alt="">` : UMB.iconos[(p.imagen || "").replace("icono:", "")] || UMB.iconos.caja;
        const [txt, clase] = MODERACION[p.estado_moderacion] || MODERACION.borrador;
        const visible = p.estado_moderacion === "aprobado" && p.activo;
        return `
        <article class="mi-producto ${p.activo || p.estado_moderacion === "borrador" ? "" : "inactivo"}">
          <div class="miniatura">${media}</div>
          <div>
            <h3>${esc(p.nombre)}</h3>
            <span class="muted" style="font-size:.85rem">${UMB.dinero(p.precio)} · ${p.stock} disp. · ${p.estado_producto === "usado" ? "Usado" : "Nuevo"}</span>
            <div style="margin-top:.3rem"><span class="estado ${clase}">${txt}</span>${p.estado_moderacion === "aprobado" && !p.activo ? ' <span class="estado estado-cancelado">Oculto</span>' : ""}</div>
            ${p.estado_moderacion === "rechazado" && p.motivo_moderacion ? `<p class="nota" style="color:var(--rojo);margin:.3rem 0 0">${esc(p.motivo_moderacion)}</p>` : ""}
          </div>
          <div class="mi-producto-acciones">
            ${visible ? `<a class="btn btn-fantasma btn-sm" href="producto.html?id=${encodeURIComponent(p.id)}">Ver</a>` : ""}
            <button class="btn btn-linea btn-sm" type="button" data-editar="${p.id}">${p.estado_moderacion === "borrador" ? "Continuar" : "Editar"}</button>
            ${p.estado_moderacion === "aprobado" ? `<button class="btn btn-linea btn-sm" type="button" data-alternar="${p.id}">${p.activo ? "Ocultar" : "Mostrar"}</button>` : ""}
            <button class="btn btn-peligro btn-sm" type="button" data-eliminar="${p.id}">Eliminar</button>
          </div>
        </article>`;
      }).join("");
    }

    $("#mis-productos").addEventListener("click", async (e) => {
      const ed = e.target.closest("[data-editar]");
      const al = e.target.closest("[data-alternar]");
      const el = e.target.closest("[data-eliminar]");
      const b = ed || al || el;
      if (!b) return;
      const id = b.dataset.editar || b.dataset.alternar || b.dataset.eliminar;
      const p = misProductos.find((x) => String(x.id) === String(id));
      if (!p) return;
      if (ed) return abrirEditor(p);
      if (al) {
        const { error } = await UMB.db.from("productos").update({ activo: !p.activo }).eq("id", p.id);
        if (error) return UMB.toast(UMB.traducirError(error), { error: true });
        UMB.toast(p.activo ? "Publicación oculta del catálogo." : "Publicación visible en el catálogo.");
        return cargarProductos();
      }
      if (el) {
        if (!UMB.confirmarToque(el)) return;
        const { error } = await UMB.db.from("productos").delete().eq("id", p.id);
        if (error) return UMB.toast(UMB.traducirError(error), { error: true });
        UMB.toast("Publicación eliminada.");
        if (actual?.id === p.id) cerrarEditor();
        cargarProductos();
      }
    });

    await cargarProductos();

    // Pedidos recibidos
    await cargarPedidos();
  }

  /* ---------- Pedidos recibidos ---------- */

  let pedidosAgrupados = [];
  let filtroPedidos = "activos";

  async function cargarPedidos() {
    const cont = $("#pedidos-recibidos");
    const { data, error } = await UMB.db.rpc("pedidos_de_mi_tienda");
    if (error) {
      cont.innerHTML = `<p class="mensaje error">${esc(UMB.traducirError(error))}</p>`;
      return;
    }
    // La función devuelve una fila por producto: agrupar por pedido.
    const mapa = new Map();
    for (const f of data || []) {
      if (!mapa.has(f.pedido_id)) mapa.set(f.pedido_id, { ...f, items: [] });
      const g = mapa.get(f.pedido_id);
      g.items.push({ nombre: f.producto, cantidad: f.cantidad, precio: Number(f.precio), estado: f.estado });
      if (new Date(f.actualizado_en) > new Date(g.actualizado_en)) g.actualizado_en = f.actualizado_en;
    }
    pedidosAgrupados = [...mapa.values()].map((g) => {
      const vivos = g.items.filter((i) => i.estado !== "cancelado");
      const orden = ["pendiente", "confirmado", "enviado", "entregado"];
      g.estado = vivos.length ? orden[Math.min(...vivos.map((i) => orden.indexOf(i.estado)))] : "cancelado";
      g.total = vivos.reduce((s, i) => s + i.precio * i.cantidad, 0);
      return g;
    });
    $("#total-pedidos").textContent = pedidosAgrupados.length;
    const activos = pedidosAgrupados.filter((p) => ["pendiente", "confirmado", "enviado"].includes(p.estado)).length;
    $("#n-activos").textContent = activos ? `(${activos})` : "";
    pintarPedidos();
  }

  function accionesVendedor(p) {
    const b = (estado, texto, clase = "btn-linea") =>
      `<button class="btn ${clase} btn-sm" type="button" data-pedido="${esc(p.pedido_id)}" data-estado="${estado}">${texto}</button>`;
    switch (p.estado) {
      case "pendiente":
        if (p.metodo_pago === "wompi" && p.estado_pago !== "aprobado") {
          return '<p class="nota">⏳ Esperando que el cliente complete el pago en línea. Podrás confirmarlo cuando se apruebe.</p>' + b("cancelado", "Cancelar", "btn-peligro");
        }
        return b("confirmado", "Confirmar pedido", "btn-primario") + b("cancelado", "Cancelar", "btn-peligro");
      case "confirmado":
        return b("enviado", "Marcar como enviado", "btn-primario") + b("entregado", "Ya lo entregué") + b("cancelado", "Cancelar", "btn-peligro");
      case "enviado":
        return b("entregado", "Ya lo entregué", "btn-primario") + '<p class="nota">O espera a que el cliente confirme que lo recibió.</p>';
      case "entregado":
        return `<span class="confirmado-por">✓ Entregado · ${p.entrega_confirmada_por === "comprador" ? "el cliente confirmó que lo recibió" : "marcado por ti"}</span>`;
      default:
        return '<span class="muted">Pedido cancelado. Las unidades volvieron a tu inventario.</span>';
    }
  }

  function pintarPedidos() {
    const cont = $("#pedidos-recibidos");
    UMB.$$("[data-filtro]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.filtro === filtroPedidos)));
    const lista = pedidosAgrupados.filter((p) =>
      filtroPedidos === "todos" ? true
        : filtroPedidos === "activos" ? ["pendiente", "confirmado", "enviado"].includes(p.estado)
        : p.estado === filtroPedidos);

    if (!pedidosAgrupados.length) {
      cont.innerHTML = `<div class="vacio"><div class="vacio-icono">📦</div><p>Todavía no has recibido pedidos. Cuando alguien compre tus productos, aparecerán aquí.</p></div>`;
      return;
    }
    if (!lista.length) {
      cont.innerHTML = `<div class="vacio"><p>No hay pedidos en esta lista.</p></div>`;
      return;
    }
    cont.innerHTML = lista.map((p) => {
      const wa = UMB.whatsapp(p.telefono_entrega, `Hola ${p.nombre_entrega.split(" ")[0]}, te escribo de Marketplace UMB por tu pedido ${p.codigo}.`);
      return `
      <article class="pedido">
        <div class="pedido-cabecera">
          <div><span>Pedido</span><strong class="codigo">${esc(p.codigo)}</strong></div>
          <div><span>Fecha</span><strong>${UMB.fecha(p.creado_en, true)}</strong></div>
          <div><span>Valor</span><strong>${UMB.dinero(p.total)}</strong></div>
          ${UMB.estadoHTML(p.estado)}
        </div>
        <div class="pedido-datos">
          <div><span>Cliente</span><strong>${esc(p.nombre_entrega)}</strong></div>
          <div><span>Celular</span><strong>${esc(p.telefono_entrega)}</strong></div>
          <div><span>Dirección</span><strong>${esc(p.direccion_entrega)}</strong></div>
          <div><span>Pago</span><strong>${esc(UMB.PAGOS[p.metodo_pago] || p.metodo_pago || "—")}</strong> ${UMB.estadoPagoHTML(p)}</div>
          ${p.notas ? `<div style="grid-column:1/-1"><span>Indicaciones</span><strong>${esc(p.notas)}</strong></div>` : ""}
        </div>
        <ul class="pedido-items">
          ${p.items.map((i) => `<li><span>${esc(i.nombre)} × ${i.cantidad}${i.estado === "cancelado" ? ' <span class="muted">(cancelado)</span>' : ""}</span><span>${UMB.dinero(i.precio * i.cantidad)}</span></li>`).join("")}
        </ul>
        <div class="pedido-pie">
          ${UMB.pasosHTML(p.estado)}
          <div class="acciones-pedido">
            ${accionesVendedor(p)}
            ${wa && !["entregado", "cancelado"].includes(p.estado) ? `<a class="btn btn-whatsapp btn-sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          </div>
        </div>
      </article>`;
    }).join("");
  }

  document.addEventListener("click", async (e) => {
    const f = e.target.closest("[data-filtro]");
    if (f) { filtroPedidos = f.dataset.filtro; pintarPedidos(); return; }

    const b = e.target.closest("[data-pedido][data-estado]");
    if (!b || !$("#pedidos-recibidos")?.contains(b)) return;
    if (b.dataset.estado === "cancelado" && !UMB.confirmarToque(b, "¿Cancelar? Toca otra vez")) return;
    UMB.cargando(b, true);
    const { error } = await UMB.db.rpc("actualizar_estado_pedido", { p_pedido: b.dataset.pedido, p_estado: b.dataset.estado });
    if (error) {
      UMB.cargando(b, false);
      return UMB.toast(UMB.traducirError(error), { error: true });
    }
    const textos = { confirmado: "Pedido confirmado. Avísale al cliente.", enviado: "Pedido marcado como enviado.", entregado: "¡Pedido entregado!", cancelado: "Pedido cancelado. Las unidades volvieron a tu inventario." };
    UMB.toast(textos[b.dataset.estado] || "Pedido actualizado.");
    await cargarPedidos();
  });

  if (document.body.dataset.pagina === "vender") iniciar();
})();
