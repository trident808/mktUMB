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

    const { data: tienda, error } = await UMB.db.from("tiendas").select("*").eq("usuario_id", uid).maybeSingle();
    $("#cargando-panel").hidden = true;

    if (error) {
      $("#error-panel").hidden = false;
      UMB.mensaje("#error-panel", UMB.traducirError(error), "error");
      return;
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
    const vista = $("#vista-imagen");
    let archivo = null;
    let editando = null;
    let misProductos = [];

    // Imagen: vista previa y reducción de tamaño antes de subir
    form.archivo.addEventListener("change", () => {
      archivo = form.archivo.files[0] || null;
      if (!archivo) return;
      if (!/^image\//.test(archivo.type)) { archivo = null; return UMB.toast("Selecciona una imagen.", { error: true }); }
      if (archivo.size > 8 * 1024 * 1024) { archivo = null; return UMB.toast("La imagen pesa más de 8 MB.", { error: true }); }
      vista.innerHTML = `<img src="${URL.createObjectURL(archivo)}" alt="Vista previa">`;
    });

    async function reducir(file) {
      const bitmap = await createImageBitmap(file);
      const max = 1200;
      const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bitmap.width * escala);
      c.height = Math.round(bitmap.height * escala);
      c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
      return new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    }

    async function subirImagen() {
      if (!archivo) return null;
      const blob = await reducir(archivo).catch(() => archivo);
      const ruta = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await UMB.db.storage.from("productos").upload(ruta, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      return UMB.db.storage.from("productos").getPublicUrl(ruta).data.publicUrl;
    }

    function limpiarFormulario() {
      form.reset();
      archivo = null;
      editando = null;
      vista.innerHTML = '<span style="font-size:1.6rem">📷</span><span>Toca para subir una foto (JPG o PNG)</span>';
      $("#titulo-form-producto").textContent = "Publicar un producto";
      $("#btn-guardar-producto").textContent = "Publicar producto";
      $("#btn-cancelar-edicion").hidden = true;
    }
    $("#btn-cancelar-edicion").addEventListener("click", limpiarFormulario);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#btn-guardar-producto");
      const datos = {
        nombre: form.nombre.value.trim(),
        categoria: form.categoria.value,
        precio: Math.round(Number(form.precio.value)),
        stock: Math.round(Number(form.stock.value)),
        descripcion: form.descripcion.value.trim() || null,
        activo: true
      };
      if (datos.nombre.length < 3) return UMB.mensaje("#mensaje-producto", "El nombre debe tener al menos 3 caracteres.", "error");
      if (!(datos.precio > 0)) return UMB.mensaje("#mensaje-producto", "Escribe un precio válido.", "error");
      if (!(datos.stock >= 0)) return UMB.mensaje("#mensaje-producto", "Escribe las unidades disponibles.", "error");

      UMB.cargando(btn, true);
      UMB.mensaje("#mensaje-producto", "");
      try {
        const url = await subirImagen();
        if (url) datos.imagen = url;
        else if (form.imagen_url.value.trim()) datos.imagen = form.imagen_url.value.trim();

        let resp;
        if (editando) {
          resp = await UMB.db.from("productos").update(datos).eq("id", editando);
        } else {
          resp = await UMB.db.from("productos").insert({ ...datos, tienda_id: tienda.id });
        }
        if (resp.error) throw resp.error;
        UMB.toast(editando ? "Producto actualizado." : "¡Producto publicado en el catálogo!");
        limpiarFormulario();
        await cargarProductos();
      } catch (err) {
        UMB.mensaje("#mensaje-producto", UMB.traducirError(err), "error");
      } finally {
        UMB.cargando(btn, false);
      }
    });

    async function cargarProductos() {
      const { data, error } = await UMB.db.from("productos").select("*").eq("tienda_id", tienda.id).order("creado_en", { ascending: false });
      const cont = $("#mis-productos");
      if (error) { cont.innerHTML = `<p class="mensaje error">${esc(UMB.traducirError(error))}</p>`; return; }
      misProductos = data;
      $("#total-productos").textContent = data.length;
      if (!data.length) {
        cont.innerHTML = `<div class="vacio"><div class="vacio-icono">🏷️</div><p>Aún no has publicado productos. Usa el formulario para crear el primero.</p></div>`;
        return;
      }
      cont.innerHTML = data.map((p) => {
        const img = typeof p.imagen === "string" && !p.imagen.startsWith("icono:") ? p.imagen : "";
        const media = img ? `<img src="${esc(img)}" alt="">` : UMB.iconos[(p.imagen || "").replace("icono:", "")] || UMB.iconos.caja;
        return `
        <article class="mi-producto ${p.activo ? "" : "inactivo"}">
          <div class="miniatura">${media}</div>
          <div>
            <h3>${esc(p.nombre)}</h3>
            <span class="muted" style="font-size:.85rem">${UMB.dinero(p.precio)} · ${p.stock} disp. ${p.activo ? "" : "· <strong>Oculto</strong>"}</span>
          </div>
          <div class="mi-producto-acciones">
            ${p.activo ? `<a class="btn btn-fantasma btn-sm" href="producto.html?id=${encodeURIComponent(p.id)}">Ver</a>` : ""}
            <button class="btn btn-linea btn-sm" type="button" data-editar="${p.id}">Editar</button>
            <button class="btn btn-linea btn-sm" type="button" data-alternar="${p.id}">${p.activo ? "Ocultar" : "Mostrar"}</button>
            <button class="btn btn-peligro btn-sm" type="button" data-eliminar="${p.id}">Eliminar</button>
          </div>
        </article>`;
      }).join("");
    }

    $("#mis-productos").addEventListener("click", async (e) => {
      const ed = e.target.closest("[data-editar]");
      const al = e.target.closest("[data-alternar]");
      const el = e.target.closest("[data-eliminar]");
      const id = (ed || al || el)?.dataset.editar || (ed || al || el)?.dataset.alternar || (ed || al || el)?.dataset.eliminar;
      const p = misProductos.find((x) => String(x.id) === String(id));
      if (!p) return;

      if (ed) {
        editando = p.id;
        form.nombre.value = p.nombre;
        form.categoria.value = p.categoria || "Otros";
        form.precio.value = Number(p.precio);
        form.stock.value = p.stock;
        form.descripcion.value = p.descripcion || "";
        form.imagen_url.value = p.imagen && !p.imagen.startsWith("icono:") ? p.imagen : "";
        vista.innerHTML = form.imagen_url.value ? `<img src="${esc(form.imagen_url.value)}" alt="">` : '<span>Toca para cambiar la foto</span>';
        $("#titulo-form-producto").textContent = "Editar producto";
        $("#btn-guardar-producto").textContent = "Guardar cambios";
        $("#btn-cancelar-edicion").hidden = false;
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (al) {
        const { error } = await UMB.db.from("productos").update({ activo: !p.activo }).eq("id", p.id);
        if (error) return UMB.toast(UMB.traducirError(error), { error: true });
        UMB.toast(p.activo ? "Producto oculto del catálogo." : "Producto visible en el catálogo.");
        cargarProductos();
      }
      if (el) {
        if (el.dataset.confirmar !== "1") {
          el.dataset.confirmar = "1";
          el.textContent = "¿Seguro? Toca otra vez";
          setTimeout(() => { el.dataset.confirmar = ""; el.textContent = "Eliminar"; }, 4000);
          return;
        }
        const { error } = await UMB.db.from("productos").delete().eq("id", p.id);
        if (error) return UMB.toast(UMB.traducirError(error), { error: true });
        UMB.toast("Producto eliminado.");
        cargarProductos();
      }
    });

    await cargarProductos();

    // Pedidos recibidos
    const { data: pedidos, error: errPed } = await UMB.db.rpc("pedidos_de_mi_tienda");
    const tbody = $("#pedidos-recibidos");
    if (errPed) {
      tbody.innerHTML = `<tr><td colspan="6">${esc(UMB.traducirError(errPed))}</td></tr>`;
    } else if (!pedidos.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">Todavía no has recibido pedidos.</td></tr>`;
    } else {
      $("#total-pedidos").textContent = new Set(pedidos.map((p) => p.pedido_id)).size;
      tbody.innerHTML = pedidos.map((p) => `
        <tr>
          <td><span class="codigo">${esc(p.codigo)}</span><br><small class="muted">${UMB.fecha(p.creado_en, true)}</small></td>
          <td class="envolver">${esc(p.producto)} × ${p.cantidad}</td>
          <td>${UMB.dinero(p.precio * p.cantidad)}</td>
          <td class="envolver">${esc(p.nombre_entrega)}<br><a class="enlace" href="https://wa.me/57${esc(String(p.telefono_entrega).replace(/\D/g, "").replace(/^57/, ""))}" target="_blank" rel="noopener">${esc(p.telefono_entrega)}</a></td>
          <td class="envolver">${esc(p.direccion_entrega)}</td>
          <td><span class="estado estado-${esc(p.estado)}">${esc(p.estado)}</span></td>
        </tr>`).join("");
    }
  }

  if (document.body.dataset.pagina === "vender") iniciar();
})();
