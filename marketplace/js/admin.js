/*
 * MARKETPLACE UMB · Panel de administración
 * Muestra los usuarios registrados y su historial de acceso.
 * Solo funciona para perfiles con rol = 'admin' (lo controla RLS en Supabase).
 */
(function () {
  "use strict";
  const { $, esc } = UMB;
  const ROLES = { cliente: "Comprador", vendedor: "Vendedor", admin: "Admin" };

  async function iniciar() {
    const sesion = await UMB.exigirSesion();
    if (!sesion) return;
    const perfil = await UMB.perfil();
    if (perfil.rol !== "admin") {
      $("#sin-permiso").hidden = false;
      return;
    }
    $("#panel-admin").hidden = false;

    const [{ data: usuarios, error }, { data: accesos }, { count: totalPedidos }] = await Promise.all([
      UMB.db.from("perfiles").select("*").order("fecha_registro", { ascending: false }),
      UMB.db.from("accesos").select("correo, evento, metodo, navegador, creado_en").order("creado_en", { ascending: false }).limit(50),
      UMB.db.from("pedidos").select("id", { count: "exact", head: true })
    ]);

    if (error) return UMB.mensaje("#mensaje-admin", UMB.traducirError(error), "error");

    const hace7 = Date.now() - 7 * 864e5;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    $("#st-usuarios").textContent = usuarios.length;
    $("#st-nuevos").textContent = usuarios.filter((u) => new Date(u.fecha_registro) >= hace7).length;
    $("#st-hoy").textContent = (accesos || []).filter((a) => a.evento === "inicio_sesion" && new Date(a.creado_en) >= hoy).length;
    $("#st-pedidos").textContent = totalPedidos ?? 0;

    const tbody = $("#tabla-usuarios");
    function pintar(filtro = "") {
      const f = filtro.toLowerCase();
      const lista = usuarios.filter((u) => !f || `${u.nombre} ${u.correo} ${u.telefono || ""}`.toLowerCase().includes(f));
      $("#contador-usuarios").textContent = `${lista.length} de ${usuarios.length}`;
      tbody.innerHTML = lista.map((u) => `
        <tr>
          <td><strong>${esc(u.nombre)}</strong></td>
          <td>${esc(u.correo)}</td>
          <td>${esc(u.telefono || "—")}</td>
          <td>${ROLES[u.rol] || esc(u.rol)}</td>
          <td>${u.proveedor === "google" ? "Google" : "Correo"}</td>
          <td>${UMB.fecha(u.fecha_registro, true)}</td>
          <td>${u.ultimo_acceso ? UMB.fecha(u.ultimo_acceso, true) : "—"}</td>
          <td>${u.total_accesos ?? 0}</td>
        </tr>`).join("") || `<tr><td colspan="8" class="muted">Sin resultados.</td></tr>`;
    }
    pintar();
    $("#buscar-usuarios").addEventListener("input", (e) => pintar(e.target.value));

    $("#tabla-accesos").innerHTML = (accesos || []).map((a) => `
      <tr>
        <td>${UMB.fecha(a.creado_en, true)}</td>
        <td>${esc(a.correo)}</td>
        <td>${a.evento === "registro" ? "Registro" : "Inicio de sesión"}</td>
        <td>${a.metodo === "google" ? "Google" : "Correo"}</td>
        <td>${a.navegador ? esc(navCorto(a.navegador)) : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="5" class="muted">Sin registros.</td></tr>`;

    // Exportar a CSV (se abre en Excel)
    $("#btn-exportar").addEventListener("click", () => {
      const cols = ["nombre", "correo", "telefono", "rol", "proveedor", "acepta_datos", "fecha_registro", "ultimo_acceso", "total_accesos"];
      const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = "﻿" + [cols.join(";"), ...usuarios.map((u) => cols.map((c) => celda(u[c])).join(";"))].join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `usuarios-marketplace-umb-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  const navCorto = (ua) => UMB.navegadorCorto(ua);

  if (document.body.dataset.pagina === "admin") iniciar();
})();
