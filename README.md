# Marketplace UMB

Marketplace de emprendimientos de la comunidad de la Universidad Manuela Beltrán.
Es un sitio estático (HTML, CSS y JavaScript) que usa **Supabase** para las cuentas de usuario, la base de datos y las imágenes. Se puede publicar gratis en **GitHub Pages**, Netlify o Vercel.

## Qué incluye

| Página | Qué hace |
|---|---|
| `index.html` | Portada, categorías, destacados, catálogo con búsqueda, filtros y orden |
| `producto.html?id=…` | Ficha del producto, cantidad y productos relacionados |
| `registro.html` | Crear una cuenta con correo o con Google (guarda los datos en `perfiles`) |
| `login.html` | Iniciar sesión, recuperar contraseña y reenviar la confirmación |
| `restablecer.html` | Crear una contraseña nueva desde el enlace del correo |
| `carrito.html` / `checkout.html` | Carrito y confirmación del pedido (se guarda en `pedidos`) |
| `pedidos.html` | Historial de pedidos del comprador |
| `mi-cuenta.html` | Datos del perfil, favoritos, cambio de contraseña y actividad reciente |
| `vender.html` | Crear la tienda, publicar, editar, ocultar y borrar productos (con foto), y ver los pedidos recibidos |
| `admin.html` | Solo administradores: lista de usuarios registrados, accesos y exportación a CSV |
| `privacidad.html` | Política de tratamiento de datos (Ley 1581 de 2012) |

## Qué datos se guardan de cada persona que se registra

Cuando alguien crea una cuenta, un disparador de la base de datos (`manejar_nuevo_usuario`) guarda sus datos automáticamente:

- **Tabla `perfiles`:** nombre, correo, celular, tipo de cuenta, si entró con correo o con Google, si aceptó el tratamiento de datos, fecha de registro, último acceso y número de inicios de sesión.
- **Tabla `accesos`:** una fila por cada registro y por cada inicio de sesión, con la fecha, el método (correo o Google) y el navegador.

Para verlos: **Supabase → Table Editor → `perfiles`** (o `accesos`), o entra a `admin.html` con una cuenta de administrador.

> Las contraseñas **no** se guardan en estas tablas. Supabase Auth las guarda cifradas y nadie puede leerlas.

---

## Puesta en marcha (unos 10 minutos)

### 1. Crear las tablas en Supabase

1. Entra a <https://supabase.com/dashboard> y abre tu proyecto.
2. Ve a **SQL Editor → New query**.
3. Copia y pega **todo** el contenido de `supabase/schema.sql` y pulsa **Run**.

Puedes ejecutarlo de nuevo sin problema. Si ya tenías las tablas antiguas (`productos`, `profiles`, `stores`), conserva sus datos, crea el perfil de los usuarios que ya estaban registrados y deja una sola configuración de seguridad.

### 2. Configurar la autenticación

En **Authentication → URL Configuration**:

- **Site URL:** la dirección donde publicarás el sitio, por ejemplo `https://TU-USUARIO.github.io/mktUMB/`.
- **Redirect URLs:** agrega estas dos (el `**` permite volver a cualquier página del sitio):
  - `https://TU-USUARIO.github.io/mktUMB/**`
  - `http://localhost:5500/**` (solo si vas a probar en tu computador con Live Server)

En **Authentication → Sign In / Providers → Email**:

- **Confirm email** activado: el usuario debe confirmar su correo antes de entrar. Es lo recomendado.
- Si lo desactivas, la persona entra apenas se registra.

> El servicio de correo gratuito de Supabase envía muy pocos correos por hora. Para un uso real, configura tu propio SMTP en **Authentication → Emails → SMTP Settings** (sirven Gmail, Brevo, Resend, etc.).

### 3. (Opcional) Activar «Continuar con Google»

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crea un **ID de cliente de OAuth** de tipo **Aplicación web**.
2. En **URI de redireccionamiento autorizados**, pega la URL de callback que muestra Supabase en **Authentication → Providers → Google**. Suele ser `https://sispastooqxbzunmglxi.supabase.co/auth/v1/callback`.
3. Copia el **Client ID** y el **Client Secret** en Supabase → Providers → Google y actívalo.

Si no lo configuras, el botón de Google muestra un mensaje de error claro y todo lo demás sigue funcionando.

### 4. Convertir tu cuenta en administradora

Regístrate en el sitio y luego ejecuta esto en el SQL Editor, con tu correo:

```sql
update public.perfiles set rol = 'admin' where correo = 'tu-correo@ejemplo.com';
```

Desde ese momento verás **🛡️ Administración** en el menú de tu cuenta.

### 5. Publicar en GitHub Pages

1. Sube **el contenido de esta carpeta** a la raíz de tu repositorio (deben quedar `index.html`, `marketplace/`, `supabase/`, etc.).
2. En el repositorio, ve a **Settings → Pages → Build and deployment**, elige **Deploy from a branch**, la rama `main` y la carpeta `/ (root)`, y pulsa **Save**.
3. Espera uno o dos minutos y abre `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.
4. Vuelve al paso 2 y confirma que esa misma dirección esté en **Site URL** y en **Redirect URLs**.

### Probar en tu computador

Abre la carpeta en VS Code y usa la extensión **Live Server**. Así la abres como `http://localhost:5500`. No abras los archivos con doble clic (`file://`), porque el inicio de sesión no funciona así.

---

## Configuración

`marketplace/js/config.js` contiene:

- `SUPABASE_URL` y `SUPABASE_KEY`: la URL del proyecto y la clave **pública** (publishable / anon). Nunca pongas aquí la clave `service_role` ni `sb_secret_…`.
- `ENVIO_GRATIS_DESDE` y `COSTO_ENVIO`: reglas del envío. Si las cambias, cámbialas también en la función `crear_pedido` de `schema.sql`.
- `CORREO_SOPORTE`: el correo que aparece en la política de privacidad. **Pon aquí un correo real.**

## Seguridad

- Todas las tablas tienen **Row Level Security**. Cada usuario solo ve y edita sus propios datos, los vendedores solo administran sus productos y los administradores pueden consultar todo.
- Los precios y el stock de los pedidos se calculan **en el servidor** (`crear_pedido`), así que nadie puede cambiar el precio desde el navegador.
- Nadie puede cambiar su propio rol a administrador desde la página.
- Las fotos de productos se guardan en el bucket `productos` de Supabase Storage. Cada vendedor solo puede subir y borrar archivos dentro de su propia carpeta.

## Estructura

```
├── index.html, producto.html, login.html, registro.html, restablecer.html
├── carrito.html, checkout.html, pedidos.html, mi-cuenta.html
├── vender.html, admin.html, privacidad.html, 404.html
├── marketplace/
│   ├── css/styles.css
│   ├── img/            (imágenes y favicon)
│   └── js/
│       ├── config.js   (credenciales públicas y ajustes)
│       ├── app.js      (núcleo: sesión, carrito, catálogo, encabezado)
│       ├── auth.js     (login, registro, recuperar contraseña)
│       ├── catalogo.js (portada y ficha de producto)
│       ├── compra.js   (carrito y checkout)
│       ├── cuenta.js   (mi cuenta y pedidos)
│       ├── vender.js   (panel del vendedor)
│       └── admin.js    (panel de administración)
└── supabase/schema.sql (base de datos completa)
```

## Pagos

El checkout registra el pedido con pago **contra entrega**, **Nequi/Daviplata** o **transferencia**. El vendedor contacta al comprador para coordinar. No se cobra en línea. Para cobrar con tarjeta o PSE hace falta una pasarela como Wompi o Mercado Pago con un backend (por ejemplo, Supabase Edge Functions).
