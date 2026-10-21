/* Marketplace UMB - sesión compartida mediante Supabase Auth */
(() => {
  const cliente = window.supabaseClient;
  const rutaInicio = new URL("index.html", window.location.href).href;
  const rutaLogin = new URL("login.html", window.location.href).href;

  function mostrarMensaje(elemento, texto, error = false) {
    if (!elemento) return;
    elemento.textContent = texto;
    elemento.classList.toggle("mensaje-error", error);
    elemento.classList.toggle("mensaje-exito", !error);
  }

  async function obtenerSesion() {
    if (!cliente) return null;
    const { data, error } = await cliente.auth.getSession();
    if (error) console.error("No se pudo consultar la sesión:", error.message);
    return data?.session || null;
  }

  async function actualizarCabecera() {
    const sesion = await obtenerSesion();
    const login = document.getElementById("enlace-login");
    const cuenta = document.getElementById("enlace-cuenta");
    const nombre = document.getElementById("auth-user-name");
    if (login) login.hidden = Boolean(sesion);
    if (cuenta) cuenta.hidden = !sesion;
    if (nombre && sesion?.user) {
      nombre.textContent = sesion.user.user_metadata?.nombre || sesion.user.user_metadata?.full_name || sesion.user.email || "Mi cuenta";
    }
    document.querySelectorAll("[data-requiere-auth]").forEach((elemento) => {
      elemento.hidden = !sesion;
    });
    document.querySelectorAll("[data-sin-auth]").forEach((elemento) => {
      elemento.hidden = Boolean(sesion);
    });
    return sesion;
  }

  async function exigirSesion() {
    const sesion = await obtenerSesion();
    if (!sesion) {
      const destino = encodeURIComponent(window.location.href);
      window.location.href = `${rutaLogin}?redirect=${destino}`;
      return null;
    }
    return sesion;
  }

  async function iniciarSesionCorreo(evento) {
    evento.preventDefault();
    const form = evento.currentTarget;
    const mensaje = document.getElementById("mensaje-login");
    const boton = form.querySelector('button[type="submit"]');
    const correo = form.elements.email.value.trim();
    const clave = form.elements.clave.value;
    if (!cliente) return mostrarMensaje(mensaje, "No se pudo conectar con Supabase. Revisa supabase-config.js.", true);
    boton.disabled = true;
    mostrarMensaje(mensaje, "Validando tus datos…");
    try {
      const { error } = await cliente.auth.signInWithPassword({ email: correo, password: clave });
      if (error) throw error;
      mostrarMensaje(mensaje, "Sesión iniciada. Redirigiendo…");
      const destino = new URLSearchParams(window.location.search).get("redirect");
      window.location.href = destino && destino.startsWith(window.location.origin) ? destino : rutaInicio;
    } catch (error) {
      mostrarMensaje(mensaje, error.message || "No se pudo iniciar sesión.", true);
      boton.disabled = false;
    }
  }

  async function iniciarConGoogle() {
    const mensaje = document.getElementById("mensaje-login");
    if (!cliente) return mostrarMensaje(mensaje, "No se pudo conectar con Supabase.", true);
    try {
      mostrarMensaje(mensaje, "Conectando con Google…");
      const { error } = await cliente.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: rutaInicio }
      });
      if (error) throw error;
    } catch (error) {
      mostrarMensaje(mensaje, `No se pudo iniciar con Google: ${error.message}`, true);
    }
  }

  async function registrarUsuario(evento) {
    evento.preventDefault();
    const form = evento.currentTarget;
    const mensaje = document.getElementById("mensaje-registro");
    const boton = form.querySelector('button[type="submit"]');
    const nombre = form.elements.nombre.value.trim();
    const correo = form.elements.email.value.trim();
    const clave = form.elements.clave.value;
    const telefono = form.elements.telefono.value.trim();
    const rol = form.elements.rol.value;
    if (!cliente) return mostrarMensaje(mensaje, "No se pudo conectar con Supabase.", true);
    if (clave.length < 8) return mostrarMensaje(mensaje, "La contraseña debe tener al menos 8 caracteres.", true);
    boton.disabled = true;
    mostrarMensaje(mensaje, "Creando tu cuenta…");
    try {
      const { data, error } = await cliente.auth.signUp({
        email: correo,
        password: clave,
        options: { data: { nombre, telefono, rol } }
      });
      if (error) throw error;
      if (data.session && data.user) {
        if (rol === "vendedor") {
          mostrarMensaje(mensaje, "Cuenta creada. Ahora completa el registro de tu tienda.");
          window.location.href = new URL("vender.html", window.location.href).href;
          return;
        }
        window.location.href = rutaInicio;
        return;
      }
      mostrarMensaje(mensaje, "Cuenta creada. Revisa tu correo para confirmar la dirección y luego inicia sesión.");
      boton.disabled = false;
    } catch (error) {
      mostrarMensaje(mensaje, error.message || "No se pudo crear la cuenta.", true);
      boton.disabled = false;
    }
  }

  async function recuperarClave(evento) {
    evento.preventDefault();
    const correo = document.getElementById("login-email")?.value.trim();
    const mensaje = document.getElementById("mensaje-login");
    if (!cliente || !correo) return mostrarMensaje(mensaje, "Escribe primero tu correo electrónico.", true);
    try {
      const redirectTo = new URL("login.html", window.location.href).href;
      const { error } = await cliente.auth.resetPasswordForEmail(correo, { redirectTo });
      if (error) throw error;
      mostrarMensaje(mensaje, "Si el correo está registrado, recibirás instrucciones para restablecer la contraseña.");
    } catch (error) {
      mostrarMensaje(mensaje, error.message || "No se pudo enviar el correo.", true);
    }
  }

  async function cerrarSesion() {
    if (!cliente) return;
    const { error } = await cliente.auth.signOut();
    if (error) {
      alert(`No se pudo cerrar sesión: ${error.message}`);
      return;
    }
    window.location.href = rutaInicio;
  }

  document.getElementById("form-login")?.addEventListener("submit", iniciarSesionCorreo);
  document.getElementById("btn-google-login")?.addEventListener("click", iniciarConGoogle);
  document.getElementById("form-registro-auth")?.addEventListener("submit", registrarUsuario);
  document.getElementById("btn-recuperar-clave")?.addEventListener("click", recuperarClave);
  document.getElementById("btn-cerrar-sesion")?.addEventListener("click", cerrarSesion);

  window.marketplaceAuth = { obtenerSesion, actualizarCabecera, exigirSesion, cerrarSesion };
  actualizarCabecera();
  cliente?.auth.onAuthStateChange(() => actualizarCabecera());
})();
