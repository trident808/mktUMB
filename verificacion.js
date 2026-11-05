/*
 * MARKETPLACE UMB · Verificación de identidad (RF-02, RF-03)
 * El usuario sube carné, documento y selfie a un almacén privado;
 * un moderador los revisa desde el panel de administración.
 */
(function () {
  "use strict";
  const { $, $$, esc } = UMB;

  /** Reduce la foto (máx. 1600 px) para que suba rápido desde el celular. */
  async function reducir(file) {
    try {
      const bitmap = await createImageBitmap(file);
      const max = 1600;
      const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bitmap.width * escala);
      c.height = Math.round(bitmap.height * escala);
      c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
      return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    } catch {
      return file;
    }
  }

  async function iniciar() {
    const sesion = await UMB.exigirSesion();
    if (!sesion) return;
    const uid = sesion.user.id;
    const perfil = await UMB.perfil(true);
    const cont = $("#estado-verificacion");
    const form = $("#form-verificacion");

    const { data: solicitudes } = await UMB.db.from("verificaciones")
      .select("id, estado, motivo, creado_en, revisado_en")
      .eq("usuario_id", uid).order("creado_en", { ascending: false }).limit(1);
    const ultima = solicitudes?.[0];

    const tarjeta = (icono, titulo, texto, extra = "") =>
      `<div class="tarjeta" style="display:flex;gap:1rem;align-items:flex-start;margin-bottom:1rem">
         <div style="font-size:2rem;line-height:1">${icono}</div>
         <div><h2 style="margin:0 0 .3rem">${titulo}</h2><p class="muted" style="margin:0">${texto}</p>${extra}</div>
       </div>`;

    if (perfil.estado_cuenta === "verificado") {
      cont.innerHTML = tarjeta("✅", "Tu cuenta está verificada", "Ya puedes abrir tu tienda y publicar productos.",
        '<p style="margin:.8rem 0 0"><a class="btn btn-primario btn-sm" href="vender.html">Ir a mi tienda</a></p>');
      return;
    }
    if (perfil.estado_cuenta === "suspendido" || perfil.estado_cuenta === "egresado") {
      cont.innerHTML = tarjeta("⛔", perfil.estado_cuenta === "suspendido" ? "Tu cuenta está suspendida" : "Tu cuenta está inactiva",
        esc(perfil.motivo_estado || "Si crees que es un error, escribe a soporte."));
      return;
    }
    if (ultima?.estado === "pendiente") {
      cont.innerHTML = tarjeta("⏳", "Tus documentos están en revisión",
        `Los enviaste el ${UMB.fecha(ultima.creado_en, true)}. Te avisaremos en la campanita cuando un moderador los revise.`);
      return;
    }

    cont.innerHTML = ultima?.estado === "rechazada"
      ? tarjeta("⚠️", "Tu verificación anterior fue rechazada", esc(ultima.motivo || "Revisa que las fotos se vean claras.") + " Puedes enviar los documentos de nuevo.")
      : tarjeta("🪪", "Verifica tu cuenta", "Necesitamos comprobar que eres estudiante de la UMB. Solo toma unos minutos.");
    form.hidden = false;
    await UMB.cargarSedes(form.sede, perfil.sede_id);
    if (perfil.programa) form.programa.value = perfil.programa;

    // Vista previa de cada foto
    const archivos = {};
    $$("[data-foto]").forEach((label) => {
      const input = label.querySelector("input");
      input.addEventListener("change", () => {
        const f = input.files[0];
        if (!f) return;
        if (!/^image\//.test(f.type)) return UMB.toast("Selecciona una imagen.", { error: true });
        if (f.size > 15 * 1024 * 1024) return UMB.toast("La foto pesa más de 15 MB.", { error: true });
        archivos[label.dataset.foto] = f;
        label.classList.add("con-foto");
        label.querySelector("img")?.remove();
        const img = document.createElement("img");
        img.src = URL.createObjectURL(f);
        img.alt = "Vista previa";
        label.prepend(img);
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("#mensaje-verificacion");
      const faltan = ["carne", "documento", "selfie"].filter((k) => !archivos[k]);
      if (faltan.length) return UMB.mensaje(msg, "Faltan fotos: " + faltan.map((k) => ({ carne: "carné", documento: "documento", selfie: "selfie" })[k]).join(", ") + ".", "error");
      if (!form.sede.value) return UMB.mensaje(msg, "Elige tu sede.", "error");
      const btn = form.querySelector('[type="submit"]');
      UMB.cargando(btn, true);
      UMB.mensaje(msg, "Subiendo fotos…", "info");
      try {
        const marca = Date.now();
        const rutas = {};
        for (const k of ["carne", "documento", "selfie"]) {
          const ruta = `${uid}/${marca}-${k}.jpg`;
          const blob = await reducir(archivos[k]);
          const { error } = await UMB.db.storage.from("verificaciones").upload(ruta, blob, { contentType: "image/jpeg" });
          if (error) throw error;
          rutas[k] = ruta;
        }
        const { error } = await UMB.db.rpc("solicitar_verificacion", {
          p_carne: rutas.carne, p_documento: rutas.documento, p_selfie: rutas.selfie,
          p_programa: form.programa.value.trim() || null, p_sede: form.sede.value
        });
        if (error) throw error;
        UMB.toast("¡Listo! Tus documentos quedaron en revisión.");
        setTimeout(() => location.reload(), 900);
      } catch (err) {
        UMB.cargando(btn, false);
        UMB.mensaje(msg, UMB.traducirError(err), "error");
      }
    });
  }

  if (document.body.dataset.pagina === "verificacion") iniciar();
})();
