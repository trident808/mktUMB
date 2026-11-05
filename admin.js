/*
 * MARKETPLACE UMB · Panel de administración y moderación (RF-37 a RF-40)
 * Administradores: todo.  Moderadores: verificaciones, usuarios, publicaciones, reportes y disputas.
 * Los permisos reales los aplica la base de datos (RLS y funciones).
 */
(function () {
  "use strict";
  const { $, $$, esc } = UMB;
  const ROLES = { cliente: "Comprador", vendedor: "Vendedor", moderador: "Moderador", admin: "Admin" };
  const ESTADOS = { pendiente: "Pendiente", verificado: "Verificado", suspendido: "Suspendido", egresado: "Egresado/Inactivo" };
  let yo = null;
  const cargadas = new Set();
  const cargadores = {};
  UMB.admin = { cargadores, recargar: (tab) => { cargadas.delete(tab); activarTab(tab); } };

  /* ---------- Pestañas ---------- */

  function activarTab(tab) {
    const boton = $(`[data-tab="${tab}"]`);
    if (!boton || boton.hidden) tab = "resumen";
    $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
    if (location.hash.replace("#", "") !== tab) history.replaceState(null, "", "#" + tab);
    if (!cargadas.has(tab) && cargadores[tab]) {
      cargadas.add(tab);
      cargadores[tab]().catch((e) => UMB.mensaje("#mensaje-admin", UMB.traducirError(e), "error"));
    }
  }

  /* ---------- Resumen ---------- */

  cargadores.resumen = async () => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const [{ count: usuarios }, { count: verificados }, { data: accesos }, { count: pedidos }] = await Promise.all([
      UMB.db.from("perfiles").select("id", { count: "exact", head: true }),
      UMB.db.from("perfiles").select("id", { count: "exact", head: true }).eq("estado_cuenta", "verificado"),
      UMB.db.from("accesos").select("correo, evento, metodo, navegador, creado_en").order("creado_en", { ascending: false }).limit(40),
      UMB.db.from("pedidos").select("id", { count: "exact", head: true })
    ]);
    $("#st-usuarios").textContent = usuarios ?? "—";
    $("#st-verificados").textContent = verificados ?? "—";
    $("#st-hoy").textContent = (accesos || []).filter((a) => a.evento === "inicio_sesion" && new Date(a.creado_en) >= hoy).length;
    $("#st-pedidos").textContent = pedidos ?? "—";
    $("#tabla-accesos").innerHTML = (accesos || []).map((a) => `
      <tr>
        <td>${UMB.fecha(a.creado_en, true)}</td>
        <td>${esc(a.correo)}</td>
        <td>${a.evento === "registro" ? "Registro" : "Inicio de sesión"}</td>
        <td>${{ google: "Google", azure: "Microsoft" }[a.metodo] || "Correo"}</td>
        <td>${a.navegador ? esc(UMB.navegadorCorto(a.navegador)) : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="5" class="muted">Sin registros.</td></tr>`;
  };

  /* ---------- Verificaciones de identidad (RF-02) ---------- */

  let filtroVer = "pendiente";
  cargadores.verificaciones = async () => {
    const cont = $("#lista-verificaciones");
    let q = UMB.db.from("verificaciones")
      .select("id, estado, motivo, programa, creado_en, revisado_en, carne_ruta, documento_ruta, selfie_ruta, usuario:perfiles!verificaciones_usuario_id_fkey(nombre, correo, fecha_registro), sede:sedes(nombre)")
      .order("creado_en", { ascending: filtroVer === "pendiente" }).limit(40);
    q = filtroVer === "pendiente" ? q.eq("estado", "pendiente") : q.neq("estado", "pendiente");
    const { data, error } = await q;
    if (error) throw error;
    if (filtroVer === "pendiente") $("#n-verificaciones").textContent = data.length ? `(${data.length})` : "";
    if (!data.length) {
      cont.innerHTML = `<div class="vacio"><div class="vacio-icono">✅</div><p>${filtroVer === "pendiente" ? "No hay solicitudes pendientes." : "Aún no hay solicitudes revisadas."}</p></div>`;
      return;
    }
    // Enlaces temporales (10 min) a las fotos privadas
    const rutas = data.flatMap((v) => [v.carne_ruta, v.documento_ruta, v.selfie_ruta]);
    const { data: firmadas } = await UMB.db.storage.from("verificaciones").createSignedUrls(rutas, 600);
    const url = new Map((firmadas || []).map((f) => [f.path, f.signedUrl]));
    const foto = (ruta, titulo) => url.get(ruta)
      ? `<figure><a href="${esc(url.get(ruta))}" target="_blank" rel="noopener"><img src="${esc(url.get(ruta))}" alt="${titulo}" loading="lazy"></a><figcaption>${titulo}</figcaption></figure>`
      : `<figure><div class="foto-faltante">Sin acceso</div><figcaption>${titulo}</figcaption></figure>`;

    cont.innerHTML = data.map((v) => `
      <article class="tarjeta verificacion" data-id="${esc(v.id)}">
        <div class="grupo-tienda-cabecera">
          <div><strong>${esc(v.usuario?.nombre || "—")}</strong> <span class="muted">${esc(v.usuario?.correo || "")}</span>
            <div class="muted" style="font-size:.85rem">${esc(v.programa || "Programa no indicado")} · ${esc(v.sede?.nombre || "Sede no indicada")} · enviada ${UMB.fecha(v.creado_en, true)}</div></div>
          <span class="estado ${v.estado === "aprobada" ? "estado-entregado" : v.estado === "rechazada" ? "estado-cancelado" : "estado-pendiente"}">${esc(v.estado)}</span>
        </div>
        <div class="fotos-revision">${foto(v.carne_ruta, "Carné")}${foto(v.documento_ruta, "Documento")}${foto(v.selfie_ruta, "Selfie")}</div>
        ${v.estado === "pendiente" ? `
          <ul class="lista-chequeo">
            <li>¿La cara de la selfie coincide con la del documento?</li>
            <li>¿El nombre del carné y del documento coincide con el de la cuenta?</li>
            <li>¿El carné está vigente?</li>
          </ul>
          <div class="acciones-pedido">
            <button class="btn btn-primario btn-sm" type="button" data-aprobar="${esc(v.id)}">Aprobar</button>
            <input class="input-motivo" type="text" maxlength="300" placeholder="Motivo del rechazo (lo verá el estudiante)" aria-label="Motivo del rechazo">
            <button class="btn btn-peligro btn-sm" type="button" data-rechazar="${esc(v.id)}">Rechazar</button>
          </div>` : `<p class="muted" style="margin:.75rem 0 0;font-size:.88rem">Revisada ${UMB.fecha(v.revisado_en, true)}${v.motivo ? " · " + esc(v.motivo) : ""}</p>`}
      </article>`).join("");
  };

  document.addEventListener("click", async (e) => {
    const f = e.target.closest("[data-filtro-ver]");
    if (f) {
      filtroVer = f.dataset.filtroVer;
      $$("[data-filtro-ver]").forEach((b) => b.setAttribute("aria-pressed", String(b === f)));
      return UMB.admin.recargar("verificaciones");
    }
    const ap = e.target.closest("[data-aprobar]");
    const re = e.target.closest("[data-rechazar]");
    if (ap || re) {
      const b = ap || re;
      const motivo = b.closest(".verificacion").querySelector(".input-motivo")?.value.trim();
      if (re && (!motivo || motivo.length < 5)) return UMB.toast("Escribe el motivo del rechazo.", { error: true });
      UMB.cargando(b, true);
      const { error } = await UMB.db.rpc("revisar_verificacion", { p_id: (ap || re).dataset.aprobar || re.dataset.rechazar, p_aprobar: Boolean(ap), p_motivo: motivo || null });
      if (error) { UMB.cargando(b, false); return UMB.toast(UMB.traducirError(error), { error: true }); }
      UMB.toast(ap ? "Cuenta verificada." : "Solicitud rechazada.");
      UMB.admin.recargar("verificaciones");
      cargadas.delete("usuarios");
    }
  });

  /* ---------- Publicaciones (RF-06 a RF-10) ---------- */

  let filtroPub = "pendiente";
  const ALERTAS = {
    foto_repetida: (a) => `Una foto se parece a la de otra publicación: «${esc(a.producto || "#" + a.producto_id)}».`,
    fotos_iguales: () => "Hay fotos repetidas dentro de la misma publicación.",
    foto_en_internet: (a) => `Una foto aparece en internet${a.paginas?.length ? ": " + a.paginas.slice(0, 2).map((u) => `<a class="enlace" href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname)}</a>`).join(", ") : ""}.`
  };
  cargadores.publicaciones = async () => {
    const cont = $("#lista-publicaciones");
    const { data, error } = await UMB.db.from("productos")
      .select("id, nombre, descripcion, precio, stock, categoria, estado_producto, entrega_en_u, entrega_domicilio, codigo_verificacion, alertas, estado_moderacion, motivo_moderacion, enviado_revision_en, tienda, tienda_id")
      .eq("estado_moderacion", filtroPub).order("enviado_revision_en", { ascending: filtroPub === "pendiente", nullsFirst: false }).limit(30);
    if (error) throw error;
    if (filtroPub === "pendiente") $("#n-publicaciones").textContent = data.length ? `(${data.length})` : "";
    if (!data.length) { cont.innerHTML = '<div class="vacio"><div class="vacio-icono">✅</div><p>No hay publicaciones en esta lista.</p></div>'; return; }
    const { data: fotos } = await UMB.db.from("producto_fotos").select("producto_id, url, con_codigo, orden").in("producto_id", data.map((p) => p.id)).order("orden");
    cont.innerHTML = data.map((p) => {
      const fs = (fotos || []).filter((f) => f.producto_id === p.id);
      const alertas = Array.isArray(p.alertas) ? p.alertas : [];
      return `
      <article class="tarjeta verificacion" data-pub="${p.id}">
        <div class="grupo-tienda-cabecera">
          <div><strong>${esc(p.nombre)}</strong> <span class="muted">· ${esc(p.tienda || "")}</span>
            <div class="muted" style="font-size:.85rem">${esc(p.categoria)} · ${p.estado_producto === "usado" ? "Usado" : "Nuevo"} · ${UMB.dinero(p.precio)} · ${p.stock} disp. · ${[p.entrega_en_u ? "En la U" : "", p.entrega_domicilio ? "Domicilio" : ""].filter(Boolean).join(" y ")}</div></div>
          <div class="codigo-esperado">Código: <strong>${esc(p.codigo_verificacion || "—")}</strong></div>
        </div>
        ${alertas.length ? `<ul class="alertas">${alertas.map((a) => `<li>⚠️ ${(ALERTAS[a.tipo] || (() => esc(a.tipo)))(a)}</li>`).join("")}</ul>` : ""}
        <div class="fotos-revision fotos-pub">${fs.map((f) => `<figure><a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="" loading="lazy"></a><figcaption>${f.con_codigo ? "📝 Foto con el código" : "Foto " + f.orden}</figcaption></figure>`).join("") || '<p class="muted">Sin fotos.</p>'}</div>
        <p style="font-size:.92rem">${esc(p.descripcion || "")}</p>
        ${p.estado_moderacion === "rechazado" && p.motivo_moderacion ? `<p class="nota" style="color:var(--rojo)">${esc(p.motivo_moderacion)}</p>` : ""}
        ${p.estado_moderacion === "pendiente" ? `
          <ul class="lista-chequeo">
            <li>¿Una foto muestra el código <strong>${esc(p.codigo_verificacion || "")}</strong> escrito en papel junto al producto?</li>
            <li>¿Las fotos son reales (no de catálogo ni de internet) y coinciden con la descripción?</li>
            <li>¿El producto está permitido y los datos son claros?</li>
          </ul>` : ""}
        <div class="acciones-pedido">
          ${p.estado_moderacion !== "aprobado" ? `<button class="btn btn-primario btn-sm" type="button" data-pub-aprobar="${p.id}">Aprobar</button>` : `<a class="btn btn-fantasma btn-sm" href="producto.html?id=${p.id}" target="_blank">Ver publicación</a>`}
          <input class="input-motivo" type="text" maxlength="300" placeholder="${p.estado_moderacion === "aprobado" ? "Motivo para retirarla" : "Motivo del rechazo (lo verá el vendedor)"}" aria-label="Motivo">
          <button class="btn btn-peligro btn-sm" type="button" data-pub-rechazar="${p.id}">${p.estado_moderacion === "aprobado" ? "Retirar" : "Rechazar"}</button>
        </div>
      </article>`;
    }).join("");
  };

  /* ---------- Reportes (RF-11, RF-36) ---------- */

  let filtroRep = "abierto";
  const MOTIVOS_REP = { prohibido: "Producto prohibido", estafa: "Posible estafa", falsificado: "Falsificado", fotos_falsas: "Fotos falsas", precio_enganoso: "Precio/descr. engañosos", otro: "Otro" };
  cargadores.reportes = async () => {
    const cont = $("#lista-reportes");
    let q = UMB.db.from("reportes").select("id, producto_id, tienda_id, motivo, detalle, estado, nota, creado_en, resuelto_en, autor:perfiles!reportes_reportado_por_fkey(nombre)")
      .order("creado_en", { ascending: filtroRep === "abierto" }).limit(50);
    q = filtroRep === "abierto" ? q.eq("estado", "abierto") : q.neq("estado", "abierto");
    const { data, error } = await q;
    if (error) throw error;
    if (filtroRep === "abierto") $("#n-reportes").textContent = data.length ? `(${data.length})` : "";
    if (!data.length) { cont.innerHTML = '<div class="vacio"><div class="vacio-icono">✅</div><p>No hay reportes en esta lista.</p></div>'; return; }
    const ids = [...new Set(data.map((r) => r.producto_id))];
    const { data: prods } = await UMB.db.from("productos").select("id, nombre, tienda, imagen").in("id", ids);
    const pm = new Map((prods || []).map((p) => [p.id, p]));
    const cuenta = data.reduce((m, r) => (m[r.producto_id] = (m[r.producto_id] || 0) + 1, m), {});
    cont.innerHTML = data.map((r) => {
      const p = pm.get(r.producto_id) || { nombre: "Publicación #" + r.producto_id };
      return `
      <article class="tarjeta verificacion" data-rep="${r.id}">
        <div class="grupo-tienda-cabecera">
          <div><strong>${esc(MOTIVOS_REP[r.motivo] || r.motivo)}</strong> · <a class="enlace" href="producto.html?id=${r.producto_id}" target="_blank">${esc(p.nombre)}</a> <span class="muted">(${esc(p.tienda || "")})</span>
            <div class="muted" style="font-size:.85rem">Reportó ${esc(r.autor?.nombre || "—")} · ${UMB.fecha(r.creado_en, true)}${cuenta[r.producto_id] > 1 && r.estado === "abierto" ? ` · <strong>${cuenta[r.producto_id]} reportes abiertos</strong>` : ""}</div></div>
          <span class="estado ${r.estado === "confirmado" ? "estado-cancelado" : r.estado === "descartado" ? "estado-entregado" : "estado-pendiente"}">${esc(r.estado)}</span>
        </div>
        ${r.detalle ? `<p style="font-size:.92rem;margin:.6rem 0 0">“${esc(r.detalle)}”</p>` : ""}
        ${r.estado === "abierto" ? `
        <div class="acciones-pedido">
          <input class="input-motivo" type="text" maxlength="300" placeholder="Nota de la decisión" aria-label="Nota">
          <label class="check-linea"><input type="checkbox" data-retirar checked> Retirar la publicación</label>
          <button class="btn btn-peligro btn-sm" type="button" data-rep-confirmar="${r.id}">Confirmar reporte</button>
          <button class="btn btn-linea btn-sm" type="button" data-rep-descartar="${r.id}">Descartar</button>
        </div>` : `<p class="muted" style="margin:.6rem 0 0;font-size:.88rem">Resuelto ${UMB.fecha(r.resuelto_en, true)}${r.nota ? " · " + esc(r.nota) : ""}</p>`}
      </article>`;
    }).join("");
  };

  document.addEventListener("click", async (e) => {
    const fp = e.target.closest("[data-filtro-pub]");
    if (fp) { filtroPub = fp.dataset.filtroPub; $$("[data-filtro-pub]").forEach((b) => b.setAttribute("aria-pressed", String(b === fp))); return UMB.admin.recargar("publicaciones"); }
    const fr = e.target.closest("[data-filtro-rep]");
    if (fr) { filtroRep = fr.dataset.filtroRep; $$("[data-filtro-rep]").forEach((b) => b.setAttribute("aria-pressed", String(b === fr))); return UMB.admin.recargar("reportes"); }

    const pa = e.target.closest("[data-pub-aprobar]");
    const pr = e.target.closest("[data-pub-rechazar]");
    if (pa || pr) {
      const b = pa || pr;
      const motivo = b.closest("[data-pub]").querySelector(".input-motivo").value.trim();
      if (pr && motivo.length < 5) return UMB.toast("Escribe el motivo.", { error: true });
      UMB.cargando(b, true);
      const { error } = await UMB.db.rpc("moderar_publicacion", { p_producto: Number(b.dataset.pubAprobar || b.dataset.pubRechazar), p_aprobar: Boolean(pa), p_motivo: motivo || null });
      if (error) { UMB.cargando(b, false); return UMB.toast(UMB.traducirError(error), { error: true }); }
      UMB.toast(pa ? "Publicación aprobada." : "Publicación rechazada.");
      return UMB.admin.recargar("publicaciones");
    }

    const rc = e.target.closest("[data-rep-confirmar]");
    const rd = e.target.closest("[data-rep-descartar]");
    if (rc || rd) {
      const b = rc || rd;
      const card = b.closest("[data-rep]");
      if (rc && !UMB.confirmarToque(rc, "¿Confirmar? Toca otra vez")) return;
      UMB.cargando(b, true);
      const { error } = await UMB.db.rpc("resolver_reporte", {
        p_reporte: Number(card.dataset.rep), p_confirmar: Boolean(rc),
        p_nota: card.querySelector(".input-motivo").value.trim() || null,
        p_retirar: card.querySelector("[data-retirar]").checked
      });
      if (error) { UMB.cargando(b, false); return UMB.toast(UMB.traducirError(error), { error: true }); }
      UMB.toast(rc ? "Reporte confirmado." : "Reporte descartado.");
      cargadas.delete("usuarios");
      return UMB.admin.recargar("reportes");
    }
  });

  /* ---------- Usuarios (RF-03, RF-37) ---------- */

  let usuarios = [];
  cargadores.usuarios = async () => {
    const { data, error } = await UMB.db.from("perfiles")
      .select("id, nombre, correo, telefono, rol, estado_cuenta, motivo_estado, proveedor, acepta_datos, acepta_terminos, fecha_registro, ultimo_acceso, total_accesos, sede:sedes(nombre)")
      .order("fecha_registro", { ascending: false });
    if (error) throw error;
    usuarios = data;
    pintarUsuarios();
  };

  function pintarUsuarios() {
    const f = ($("#buscar-usuarios").value || "").toLowerCase();
    const est = $("#filtro-estado-cuenta").value;
    const lista = usuarios.filter((u) => (!est || u.estado_cuenta === est) && (!f || `${u.nombre} ${u.correo}`.toLowerCase().includes(f)));
    $("#contador-usuarios").textContent = `${lista.length} de ${usuarios.length}`;
    $("#tabla-usuarios").innerHTML = lista.map((u) => `
      <tr>
        <td><strong>${esc(u.nombre)}</strong></td>
        <td>${esc(u.correo)}</td>
        <td>${UMB.estadoCuentaHTML(u.estado_cuenta)}</td>
        <td>${ROLES[u.rol] || esc(u.rol)}</td>
        <td>${esc(u.sede?.nombre || "—")}</td>
        <td>${UMB.fecha(u.fecha_registro)}</td>
        <td>${u.ultimo_acceso ? UMB.fecha(u.ultimo_acceso, true) : "—"}</td>
        <td>${u.id === yo.id ? '<span class="muted">Tú</span>' : `<button class="btn btn-linea btn-sm" type="button" data-gestionar="${esc(u.id)}">Gestionar</button>`}</td>
      </tr>
      <tr class="fila-gestion" data-gestion="${esc(u.id)}" hidden>
        <td colspan="8">
          <div class="gestion-usuario">
            <label>Estado
              <select data-campo="estado">${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${k === u.estado_cuenta ? "selected" : ""}>${v}</option>`).join("")}</select>
            </label>
            <input data-campo="motivo" type="text" maxlength="300" placeholder="Motivo (obligatorio para suspender)" value="${esc(u.motivo_estado || "")}" aria-label="Motivo">
            <button class="btn btn-primario btn-sm" type="button" data-guardar-estado="${esc(u.id)}">Guardar estado</button>
            ${yo.rol === "admin" ? `
              <label>Rol
                <select data-campo="rol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === u.rol ? "selected" : ""}>${v}</option>`).join("")}</select>
              </label>
              <button class="btn btn-linea btn-sm" type="button" data-guardar-rol="${esc(u.id)}">Guardar rol</button>` : ""}
          </div>
        </td>
      </tr>`).join("") || `<tr><td colspan="8" class="muted">Sin resultados.</td></tr>`;
  }

  document.addEventListener("input", (e) => {
    if (e.target.id === "buscar-usuarios") pintarUsuarios();
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "filtro-estado-cuenta") pintarUsuarios();
  });
  document.addEventListener("click", async (e) => {
    const g = e.target.closest("[data-gestionar]");
    if (g) { const fila = $(`[data-gestion="${CSS.escape(g.dataset.gestionar)}"]`); fila.hidden = !fila.hidden; return; }
    const ge = e.target.closest("[data-guardar-estado]");
    const gr = e.target.closest("[data-guardar-rol]");
    if (!ge && !gr) return;
    const fila = (ge || gr).closest("[data-gestion]");
    const id = fila.dataset.gestion;
    const b = ge || gr;
    UMB.cargando(b, true);
    const { error } = ge
      ? await UMB.db.rpc("cambiar_estado_cuenta", { p_usuario: id, p_estado: fila.querySelector('[data-campo="estado"]').value, p_motivo: fila.querySelector('[data-campo="motivo"]').value.trim() || null })
      : await UMB.db.rpc("cambiar_rol", { p_usuario: id, p_rol: fila.querySelector('[data-campo="rol"]').value });
    UMB.cargando(b, false);
    if (error) return UMB.toast(UMB.traducirError(error), { error: true });
    UMB.toast("Cambios guardados.");
    UMB.admin.recargar("usuarios");
  });

  $("#btn-exportar")?.addEventListener("click", () => {
    const cols = ["nombre", "correo", "telefono", "rol", "estado_cuenta", "proveedor", "acepta_terminos", "acepta_datos", "fecha_registro", "ultimo_acceso", "total_accesos"];
    const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + [cols.concat("sede").join(";"), ...usuarios.map((u) => cols.map((c) => celda(u[c])).concat(celda(u.sede?.nombre)).join(";"))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `usuarios-marketplace-umb-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ---------- Configuración (RF-38) ---------- */

  cargadores.configuracion = async () => {
    const { data, error } = await UMB.db.from("sedes").select("*").order("nombre");
    if (error) throw error;
    $("#lista-sedes").innerHTML = data.map((s) => `
      <li><span><strong>${esc(s.nombre)}</strong> <span class="muted">${esc(s.ciudad || "")}</span>${s.activa ? "" : ' <span class="estado estado-cancelado">Inactiva</span>'}</span>
        <button class="btn btn-linea btn-sm" type="button" data-sede-activa="${esc(s.id)}" data-valor="${!s.activa}">${s.activa ? "Desactivar" : "Activar"}</button></li>`).join("")
      || '<li class="muted">No hay sedes.</li>';
    if (UMB.admin.cargarConfigExtra) await UMB.admin.cargarConfigExtra();
  };
  $("#form-sede")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const { error } = await UMB.db.from("sedes").insert({ nombre: f.nombre.value.trim(), ciudad: f.ciudad.value.trim() || null });
    if (error) return UMB.toast(UMB.traducirError(error), { error: true });
    f.reset();
    UMB.toast("Sede agregada.");
    UMB.admin.recargar("configuracion");
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-sede-activa]");
    if (!b) return;
    const { error } = await UMB.db.from("sedes").update({ activa: b.dataset.valor === "true" }).eq("id", b.dataset.sedeActiva);
    if (error) return UMB.toast(UMB.traducirError(error), { error: true });
    UMB.admin.recargar("configuracion");
  });

  UMB.admin.cargarConfigExtra = async () => {
    const [{ data: cats }, { data: palabras }, { data: params }] = await Promise.all([
      UMB.db.from("categorias").select("*").order("orden"),
      UMB.db.from("palabras_prohibidas").select("*").order("motivo"),
      UMB.db.from("configuracion").select("*").order("clave")
    ]);
    $("#lista-categorias").innerHTML = (cats || []).map((c) => `
      <li><span>${esc(c.icono)} <strong>${esc(c.nombre)}</strong>${c.activa ? "" : ' <span class="estado estado-cancelado">Inactiva</span>'}</span>
        <button class="btn btn-linea btn-sm" type="button" data-cat-activa="${esc(c.nombre)}" data-valor="${!c.activa}">${c.activa ? "Desactivar" : "Activar"}</button></li>`).join("");
    $("#lista-prohibidas").innerHTML = (palabras || []).map((p) => `
      <span class="chip-palabra" title="${esc(p.motivo)}">${esc(p.palabra)} <button type="button" data-quitar-palabra="${esc(p.palabra)}" aria-label="Quitar ${esc(p.palabra)}">✕</button></span>`).join("");
    $("#lista-parametros").innerHTML = (params || []).map((c) => `
      <div class="campo campo-parametro"><label for="par-${esc(c.clave)}">${esc(c.descripcion || c.clave)}</label>
        <input id="par-${esc(c.clave)}" data-clave="${esc(c.clave)}" type="number" step="0.1" min="0" value="${esc(c.valor)}"></div>`).join("");
    const umbral = (params || []).find((c) => c.clave === "reportes_para_suspender");
    if (umbral) $("#umbral-reportes").textContent = umbral.valor;
  };

  $("#form-categoria")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const { error } = await UMB.db.from("categorias").insert({ nombre: f.nombre.value.trim(), icono: f.icono.value.trim() || "✨" });
    if (error) return UMB.toast(UMB.traducirError(error), { error: true });
    f.reset(); UMB.toast("Categoría agregada."); UMB.admin.recargar("configuracion");
  });
  $("#form-prohibida")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const { error } = await UMB.db.from("palabras_prohibidas").insert({ palabra: f.palabra.value.trim().toLowerCase(), motivo: f.motivo.value });
    if (error) return UMB.toast(UMB.traducirError(error), { error: true });
    f.reset(); UMB.admin.recargar("configuracion");
  });
  $("#form-parametros")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    for (const inp of $$("#lista-parametros [data-clave]")) {
      const { error } = await UMB.db.from("configuracion").update({ valor: Number(inp.value) }).eq("clave", inp.dataset.clave);
      if (error) return UMB.toast(UMB.traducirError(error), { error: true });
    }
    UMB.toast("Parámetros guardados.");
  });
  document.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-cat-activa]");
    if (c) {
      const { error } = await UMB.db.from("categorias").update({ activa: c.dataset.valor === "true" }).eq("nombre", c.dataset.catActiva);
      if (error) return UMB.toast(UMB.traducirError(error), { error: true });
      return UMB.admin.recargar("configuracion");
    }
    const q = e.target.closest("[data-quitar-palabra]");
    if (q) {
      const { error } = await UMB.db.from("palabras_prohibidas").delete().eq("palabra", q.dataset.quitarPalabra);
      if (error) return UMB.toast(UMB.traducirError(error), { error: true });
      q.closest(".chip-palabra").remove();
    }
  });

  /* ---------- Auditoría (RF-40) ---------- */

  cargadores.auditoria = async () => {
    const { data, error } = await UMB.db.from("auditoria").select("*").order("creado_en", { ascending: false }).limit(300);
    if (error) throw error;
    const ACC = {
      aprobar_verificacion: "Aprobó verificación", rechazar_verificacion: "Rechazó verificación",
      cambiar_estado_cuenta: "Cambió estado de cuenta", cambiar_rol: "Cambió rol",
      aprobar_publicacion: "Aprobó publicación", rechazar_publicacion: "Rechazó publicación", rechazo_automatico: "Rechazo automático (prohibido)",
      confirmar_reporte: "Confirmó reporte", descartar_reporte: "Descartó reporte", suspension_automatica: "Suspensión automática"
    };
    $("#tabla-auditoria").innerHTML = data.map((a) => `
      <tr>
        <td>${UMB.fecha(a.creado_en, true)}</td>
        <td>${esc(a.actor_nombre || "Sistema")}</td>
        <td>${esc(ACC[a.accion] || a.accion.replace(/_/g, " "))}</td>
        <td>${esc(a.entidad)} <span class="muted">${esc((a.entidad_id || "").slice(0, 8))}</span></td>
        <td class="envolver">${esc(a.detalle ? Object.entries(a.detalle).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") : "")}</td>
      </tr>`).join("") || `<tr><td colspan="5" class="muted">Sin acciones registradas.</td></tr>`;
  };

  /* ---------- Inicio ---------- */

  async function iniciar() {
    const sesion = await UMB.exigirSesion();
    if (!sesion) return;
    yo = await UMB.perfil(true);
    if (!["admin", "moderador"].includes(yo.rol)) {
      $("#sin-permiso").hidden = false;
      return;
    }
    $("#panel-admin").hidden = false;
    $("#admin-rol").textContent = yo.rol === "admin" ? "Tienes acceso completo como administrador." : "Tienes acceso como moderador.";
    if (yo.rol !== "admin") $$("[data-solo-admin-tab]").forEach((b) => (b.hidden = true));
    $$("[data-tab]").forEach((b) => b.addEventListener("click", () => activarTab(b.dataset.tab)));
    activarTab(location.hash.replace("#", "") || "resumen");
    // Contador de verificaciones pendientes en la pestaña
    const [v, pub, rep] = await Promise.all([
      UMB.db.from("verificaciones").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      UMB.db.from("productos").select("id", { count: "exact", head: true }).eq("estado_moderacion", "pendiente"),
      UMB.db.from("reportes").select("id", { count: "exact", head: true }).eq("estado", "abierto")
    ]);
    $("#n-verificaciones").textContent = v.count ? `(${v.count})` : "";
    $("#n-publicaciones").textContent = pub.count ? `(${pub.count})` : "";
    $("#n-reportes").textContent = rep.count ? `(${rep.count})` : "";
  }

  if (document.body.dataset.pagina === "admin") iniciar();
})();
