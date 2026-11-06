/*
 * MARKETPLACE UMB · Inicio de sesión, registro y recuperación de contraseña
 */
(function () {
  "use strict";
  const { $, $$ } = UMB;

  const urlDe = (pagina) => new URL(pagina, location.href).href;

  /** Destino seguro después de iniciar sesión (solo páginas de este sitio). */
  function destino() {
    const v = UMB.param("volver") || "";
    return /^[a-z0-9-]+\.html(\?[^#]*)?$/i.test(v) ? v : "index.html";
  }

  // Mostrar / ocultar contraseña
  $$("[data-ver-clave]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = $("#" + btn.dataset.verClave);
      const ver = input.type === "password";
      input.type = ver ? "text" : "password";
      btn.setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
      btn.setAttribute("aria-pressed", String(ver));
    });
  });

  // Indicador de seguridad de la contraseña
  function puntuarClave(c) {
    let p = 0;
    if (c.length >= 8) p++;
    if (c.length >= 12) p++;
    if (/[A-Z]/.test(c) && /[a-z]/.test(c)) p++;
    if (/\d/.test(c)) p++;
    if (/[^A-Za-z0-9]/.test(c)) p++;
    return Math.min(p, 4);
  }
  $$("[data-fuerza]").forEach((input) => {
    const barra = $("#" + input.dataset.fuerza + " i");
    const texto = $("#" + input.dataset.fuerza + "-texto");
    input.addEventListener("input", () => {
      const p = input.value ? puntuarClave(input.value) : 0;
      const colores = ["#c8102e", "#c8102e", "#f2b705", "#1f7a5a", "#1f7a5a"];
      const etiquetas = ["", "Débil", "Aceptable", "Buena", "Muy segura"];
      if (barra) { barra.style.width = (p / 4) * 100 + "%"; barra.style.background = colores[p]; }
      if (texto) texto.textContent = input.value ? "Seguridad: " + etiquetas[p] : "Mínimo 8 caracteres.";
    });
  });

  // Mostrar qué correos se aceptan (si el registro está limitado a la UMB).
  UMB.dominios().then((lista) => {
    if (!lista.length) return;
    $$("[data-ayuda-dominio]").forEach((el) => {
      el.textContent = `Usa tu correo institucional (${UMB.textoDominios(lista)}).`;
      el.hidden = false;
    });
    $$('input[type="email"][name="correo"]').forEach((i) => (i.placeholder = "tu.nombre@" + lista[0]));
  });

  /* ======================= Código de verificación por correo (RF-01) ======================= */

  /**
   * Muestra el formulario del código de 6 dígitos que Supabase envía al correo.
   * alVerificar(sesion) se llama cuando el código es correcto.
   */
  function pedirCodigo(correo, alVerificar) {
    const form = $("#form-codigo");
    if (!form) return;
    $$("[data-ocultar-al-pedir-codigo]").forEach((el) => (el.hidden = true));
    form.hidden = false;
    $("#codigo-correo").textContent = correo;
    form.codigo.value = "";
    form.codigo.focus();
    const msg = $("#mensaje-codigo");

    form.onsubmit = async (e) => {
      e.preventDefault();
      const token = form.codigo.value.replace(/\D/g, "");
      if (token.length < 6) return UMB.mensaje(msg, "Escribe los 6 dígitos del código.", "error");
      const btn = form.querySelector('[type="submit"]');
      UMB.cargando(btn, true);
      let { data, error } = await UMB.db.auth.verifyOtp({ email: correo, token, type: "email" });
      if (error) ({ data, error } = await UMB.db.auth.verifyOtp({ email: correo, token, type: "signup" }));
      UMB.cargando(btn, false);
      if (error || !data?.session) {
        return UMB.mensaje(msg, /expired|invalid/i.test(error?.message || "") ? "El código no es válido o ya venció. Pide uno nuevo." : UMB.traducirError(error), "error");
      }
      UMB.mensaje(msg, "¡Correo verificado!", "exito");
      alVerificar(data.session);
    };

    $("#reenviar-codigo").onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      const { error } = await UMB.db.auth.resend({ type: "signup", email: correo, options: { emailRedirectTo: urlDe("login.html?confirmado=1") } });
      UMB.mensaje(msg, error ? UMB.traducirError(error) : "Te enviamos un código nuevo.", error ? "error" : "exito");
      setTimeout(() => (b.disabled = false), 60000);
    };
  }

  /** RNF-02: si el usuario tiene verificación en dos pasos, pedir el código de la app. */
  async function necesitaSegundoPaso() {
    const { data } = await UMB.db.auth.mfa.getAuthenticatorAssuranceLevel();
    return data && data.nextLevel === "aal2" && data.currentLevel !== "aal2";
  }

  function pedirSegundoPaso(alVerificar) {
    const form = $("#form-mfa");
    $$("[data-ocultar-al-pedir-codigo]").forEach((el) => (el.hidden = true));
    $("#form-codigo") && ($("#form-codigo").hidden = true);
    form.hidden = false;
    form.codigo.focus();
    const msg = $("#mensaje-mfa");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      UMB.cargando(btn, true);
      const { data: f } = await UMB.db.auth.mfa.listFactors();
      const factor = f?.totp?.[0];
      if (!factor) { UMB.cargando(btn, false); return alVerificar(); }
      const { error } = await UMB.db.auth.mfa.challengeAndVerify({ factorId: factor.id, code: form.codigo.value.replace(/\D/g, "") });
      UMB.cargando(btn, false);
      if (error) return UMB.mensaje(msg, "Código incorrecto. Revisa la app de autenticación e inténtalo de nuevo.", "error");
      alVerificar();
    };
    $("#mfa-salir").onclick = UMB.cerrarSesion;
  }

  /* ======================= Microsoft (y otros proveedores) ======================= */

  // Opciones por proveedor. Microsoft (Azure) exige pedir el permiso "email".
  const OPCIONES_PROVEEDOR = {
    azure: { scopes: "email", queryParams: { prompt: "select_account" } },
    google: {}
  };

  async function conProveedor(e) {
    const btn = e.currentTarget;
    const proveedor = btn.dataset.oauth;
    const msg = $("#mensaje");
    if (!UMB.db) return UMB.mensaje(msg, "No hay conexión con el servidor.", "error");
    UMB.cargando(btn, true);
    UMB.marcarAcceso(proveedor);
    const { error } = await UMB.db.auth.signInWithOAuth({
      provider: proveedor,
      options: { ...(OPCIONES_PROVEEDOR[proveedor] || {}), redirectTo: urlDe(destino()) }
    });
    if (error) {
      UMB.cargando(btn, false);
      UMB.mensaje(msg, UMB.traducirError(error), "error");
    }
  }
  $$("[data-oauth]").forEach((b) => b.addEventListener("click", conProveedor));

  /* ======================= Iniciar sesión ======================= */

  const formLogin = $("#form-login");
  if (formLogin) {
    const msg = $("#mensaje");

    const entrar = async (sesion) => {
      if (!(await UMB.verificarIngreso(sesion))) return;
      if (await necesitaSegundoPaso()) return pedirSegundoPaso(() => entrar(sesion));
      UMB.marcarAcceso("email");
      await UMB.registrarAccesoPendiente(sesion);
      UMB.mensaje(msg, "¡Bienvenido! Entrando…", "exito");
      location.replace(destino());
    };

    // Si ya hay sesión: pedir el segundo paso si falta; si no, continuar.
    UMB.sesion().then(async (s) => {
      if (!s) return;
      if (await necesitaSegundoPaso()) pedirSegundoPaso(() => location.replace(destino()));
      else location.replace(destino());
    });

    if (UMB.param("confirmado")) UMB.mensaje(msg, "¡Correo confirmado! Ya puedes iniciar sesión.", "exito");
    if (UMB.param("clave") === "actualizada") UMB.mensaje(msg, "Tu contraseña se actualizó. Inicia sesión con la nueva.", "exito");
    if (UMB.param("volver")) UMB.mensaje(msg, "Inicia sesión para continuar.", "info");
    if (UMB.param("bloqueado")) {
      UMB.dominios().then((lista) => UMB.mensaje(msg,
        `Marketplace UMB es solo para la comunidad de la universidad. Ingresa con tu correo institucional${lista.length ? " (" + UMB.textoDominios(lista) + ")" : ""}.`, "error"));
    }

    formLogin.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = formLogin.querySelector('[type="submit"]');
      const correo = formLogin.correo.value.trim().toLowerCase();
      const clave = formLogin.clave.value;
      if ($("#reenviar-confirmacion")) $("#reenviar-confirmacion").hidden = true;
      if (!UMB.db) return UMB.mensaje(msg, "No hay conexión con el servidor.", "error");

      UMB.cargando(btn, true);
      UMB.mensaje(msg, "");
      const { data, error } = await UMB.db.auth.signInWithPassword({ email: correo, password: clave });
      if (error) {
        UMB.cargando(btn, false);
        if (/not confirmed/i.test(error.message)) {
          // Falta confirmar el correo: enviar un código nuevo y pedirlo aquí mismo.
          await UMB.db.auth.resend({ type: "signup", email: correo, options: { emailRedirectTo: urlDe("login.html?confirmado=1") } });
          pedirCodigo(correo, entrar);
          UMB.mensaje("#mensaje-codigo", "Aún no habías confirmado tu correo. Te enviamos un código.", "info");
          return;
        }
        UMB.mensaje(msg, UMB.traducirError(error), "error");
        return;
      }
      await entrar(data.session);
    });

    $("#btn-olvide")?.addEventListener("click", async () => {
      const correo = formLogin.correo.value.trim();
      if (!correo || !formLogin.correo.checkValidity()) {
        formLogin.correo.focus();
        return UMB.mensaje(msg, "Escribe tu correo arriba y vuelve a pulsar «¿Olvidaste tu contraseña?».", "info");
      }
      if (!UMB.db) return UMB.mensaje(msg, "No hay conexión con el servidor.", "error");
      const { error } = await UMB.db.auth.resetPasswordForEmail(correo, { redirectTo: urlDe("restablecer.html") });
      if (error) return UMB.mensaje(msg, UMB.traducirError(error), "error");
      UMB.mensaje(msg, `Si ${correo} tiene una cuenta, te enviamos un enlace para crear una contraseña nueva.`, "exito");
    });

    $("#reenviar-confirmacion")?.addEventListener("click", async (e) => {
      const correo = formLogin.correo.value.trim();
      const { error } = await UMB.db.auth.resend({ type: "signup", email: correo, options: { emailRedirectTo: urlDe("login.html?confirmado=1") } });
      e.target.hidden = true;
      UMB.mensaje(msg, error ? UMB.traducirError(error) : "Te reenviamos el correo de confirmación.", error ? "error" : "exito");
    });
  }

  /* ======================= Registro ======================= */

  const formReg = $("#form-registro");
  if (formReg) {
    const msg = $("#mensaje");
    UMB.sesion().then((s) => { if (s) location.replace(destino()); });
    if (UMB.param("rol") === "vendedor") formReg.querySelector('input[name="rol"][value="vendedor"]').checked = true;

    formReg.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = formReg.querySelector('[type="submit"]');
      const nombre = formReg.nombre.value.trim().replace(/\s+/g, " ");
      const correo = formReg.correo.value.trim().toLowerCase();
      const telefono = formReg.telefono.value.replace(/[^\d+]/g, "");
      const clave = formReg.clave.value;
      const clave2 = formReg.clave2.value;
      const rol = formReg.rol.value;

      if (nombre.length < 3) return UMB.mensaje(msg, "Escribe tu nombre completo.", "error");
      if (clave.length < 8) return UMB.mensaje(msg, "La contraseña debe tener al menos 8 caracteres.", "error");
      if (clave !== clave2) { formReg.clave2.focus(); return UMB.mensaje(msg, "Las contraseñas no coinciden.", "error"); }
      if (!formReg.terminos.checked) return UMB.mensaje(msg, "Debes aceptar los términos y condiciones para crear la cuenta.", "error");
      if (!formReg.acepta.checked) return UMB.mensaje(msg, "Debes autorizar el tratamiento de tus datos para crear la cuenta.", "error");
      if (!(await UMB.correoPermitido(correo))) {
        formReg.correo.focus();
        const lista = await UMB.dominios();
        return UMB.mensaje(msg, `Solo pueden registrarse estudiantes de la UMB. Usa tu correo institucional (${UMB.textoDominios(lista)}).`, "error");
      }
      if (!UMB.db) return UMB.mensaje(msg, "No hay conexión con el servidor.", "error");

      UMB.cargando(btn, true);
      UMB.mensaje(msg, "");
      const { data, error } = await UMB.db.auth.signUp({
        email: correo,
        password: clave,
        options: {
          // Estos datos los guarda el disparador de schema.sql en la tabla "perfiles".
          data: { nombre, telefono, rol, acepta_datos: "true", acepta_terminos: "true" },
          emailRedirectTo: urlDe("login.html?confirmado=1")
        }
      });
      UMB.cargando(btn, false);

      if (error) return UMB.mensaje(msg, UMB.traducirError(error), "error");

      // Supabase devuelve un usuario sin identidades cuando el correo ya existe.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return UMB.mensaje(msg, "Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.", "error");
      }

      if (data.session) {
        // Confirmación por correo desactivada: entra directamente.
        UMB.marcarAcceso("email");
        await UMB.registrarAccesoPendiente(data.session);
        location.replace(rol === "vendedor" ? "vender.html" : destino());
        return;
      }

      // RF-01: confirmar con el código de 6 dígitos enviado al correo.
      pedirCodigo(correo, async (sesion) => {
        UMB.marcarAcceso("email");
        await UMB.registrarAccesoPendiente(sesion);
        location.replace(rol === "vendedor" ? "verificacion.html" : destino());
      });
    });
  }

  /* ======================= Restablecer contraseña ======================= */

  const formNueva = $("#form-nueva-clave");
  if (formNueva) {
    const msg = $("#mensaje");
    let listo = false;

    // El enlace del correo crea una sesión temporal (evento PASSWORD_RECOVERY).
    UMB.db?.auth.onAuthStateChange((evento, sesion) => {
      if ((evento === "PASSWORD_RECOVERY" || evento === "SIGNED_IN" || evento === "INITIAL_SESSION") && sesion) {
        listo = true;
        UMB.mensaje(msg, "");
        formNueva.hidden = false;
        $("#enlace-invalido").hidden = true;
      }
    });
    setTimeout(async () => {
      if (listo) return;
      const s = await UMB.sesion();
      UMB.mensaje(msg, "");
      if (s) { formNueva.hidden = false; return; }
      $("#enlace-invalido").hidden = false;
      formNueva.hidden = true;
    }, 1500);

    formNueva.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = formNueva.querySelector('[type="submit"]');
      const c1 = formNueva.clave.value;
      const c2 = formNueva.clave2.value;
      if (c1.length < 8) return UMB.mensaje(msg, "La contraseña debe tener al menos 8 caracteres.", "error");
      if (c1 !== c2) return UMB.mensaje(msg, "Las contraseñas no coinciden.", "error");
      UMB.cargando(btn, true);
      const { error } = await UMB.db.auth.updateUser({ password: c1 });
      UMB.cargando(btn, false);
      if (error) return UMB.mensaje(msg, UMB.traducirError(error), "error");
      await UMB.db.auth.signOut();
      location.replace("login.html?clave=actualizada");
    });
  }
})();
