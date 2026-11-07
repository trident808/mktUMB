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

### 3. (Opcional) Activar «Continuar con Microsoft» (cuentas de la UMB)

1. En [portal.azure.com](https://portal.azure.com), entra con cualquier cuenta de Microsoft y abre **Microsoft Entra ID → App registrations → New registration**.
2. **Nombre:** Marketplace UMB. **Supported account types:** «Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)».
3. **Redirect URI:** plataforma **Web**, con la dirección `https://sispastooqxbzunmglxi.supabase.co/auth/v1/callback`. Pulsa **Register**.
4. Copia el **Application (client) ID**.
5. En **Certificates & secrets → New client secret**, crea un secreto y copia la columna **Value** (no el «Secret ID»). Anota la fecha de vencimiento.
6. (Recomendado) En **Manifest**, agrega en `optionalClaims` el claim `email` y el claim `xms_edov` en `idToken`, y `xms_edov` en `accessToken`.
7. En Supabase → **Authentication → Sign In / Providers → Azure**, actívalo y pega el Client ID y el secreto (Value). Deja **Azure Tenant URL** vacío.
8. Pulsa **Save**.

> Si al entrar aparece «Se necesita aprobación del administrador», la UMB no deja que los estudiantes autoricen apps externas. En ese caso, el área de TI de la universidad debe aprobar la app. Mientras tanto, el registro con correo y contraseña sigue funcionando.

### 4. Convertir tu cuenta en administradora

Regístrate en el sitio y luego ejecuta esto en el SQL Editor, con tu correo:

```sql
update public.perfiles set rol = 'admin' where correo = 'tu-correo@ejemplo.com';
```

Desde ese momento verás **🛡️ Administración** en el menú de tu cuenta.

### 4b. Permitir solo estudiantes de la UMB

En el SQL Editor, agrega el dominio de los correos institucionales:

```sql
insert into public.dominios_permitidos (dominio) values ('umb.edu.co');
```

- `umb.edu.co` también acepta subdominios como `@academia.umb.edu.co`. Si quieres **solo** estudiantes, usa el dominio exacto de su correo (por ejemplo `academia.umb.edu.co`).
- La base de datos rechaza cualquier registro de otro dominio, tanto con correo como con Google. La página lo avisa antes de enviar el formulario.
- Las cuentas que ya existían con otro dominio (por ejemplo Gmail) se cierran al intentar entrar. Los **administradores** sí pueden entrar con cualquier correo.
- Para quitar la restricción: `delete from public.dominios_permitidos;`

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
└── supabase/
    ├── schema.sql                      (base de datos completa)
    └── functions/pagos-wompi/index.ts  (Edge Function de pagos con Wompi)
```

## Cuentas, verificación e identidad (fase 1)

| Requerimiento | Cómo se cumple |
|---|---|
| RF-01 | Solo se registran correos de los dominios en `dominios_permitidos` (por ejemplo `umb.edu.co` y sus subdominios). El correo se confirma con un **código de 6 dígitos**. |
| RF-02 | En `verificacion.html` el usuario sube su carné, su documento y una selfie a un almacén **privado**. Un moderador los compara y aprueba o rechaza en **Administración → Verificaciones**. |
| RF-03 | Estados de cuenta: **Pendiente**, **Verificado**, **Suspendido** y **Egresado/Inactivo**. Se cambian en **Administración → Usuarios**. |
| RF-04 | Solo las cuentas verificadas pueden abrir una tienda o publicar. Cualquier usuario registrado puede comprar. Las cuentas suspendidas o inactivas no pueden comprar. |
| RF-05 | El perfil público del vendedor (`vendedor.html?tienda=…`) muestra la insignia, el programa, la sede, la fecha de registro, las ventas completadas y la calificación. |
| RF-14 | Los favoritos se guardan en la cuenta (tabla `favoritos`). |
| RNF-02 | Verificación en dos pasos (app de autenticación) en **Mi cuenta → Seguridad**. Si está activa, se exige para publicar. |
| RNF-03 | Los documentos van al almacén privado `verificaciones`. Solo el dueño y los moderadores pueden verlos, y los enlaces vencen a los 10 minutos. |
| RNF-08 | Página `terminos.html`. Al registrarse se aceptan los términos y la política de datos, y queda guardado. |
| RF-40 | Las acciones de moderación quedan en `auditoria`, visible en **Administración → Auditoría** (solo para administradores). |

### Pasos de configuración en Supabase

1. **Plantilla del correo de confirmación.** Para que llegue el código, en **Authentication → Emails → Templates → Confirm signup** pega esta plantilla:

   ```html
   <h2>Confirma tu correo en Marketplace UMB</h2>
   <p>Tu código de verificación es:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
   <p>Escríbelo en la página para activar tu cuenta. Si no creaste esta cuenta, ignora este correo.</p>
   ```

   La longitud del código se configura en **Authentication → Sign In / Providers → Email → Email OTP Length** (6 por defecto).
2. **Moderadores.** Un administrador asigna el rol en **Administración → Usuarios → Gestionar → Rol**, o con SQL:

   ```sql
   update public.perfiles set rol = 'moderador', estado_cuenta = 'verificado' where correo = 'correo@umb.edu.co';
   ```
3. **Sedes.** Vienen de ejemplo Bogotá, Cajicá y Bucaramanga. Corrígelas en **Administración → Configuración**.
4. **Verificación en dos pasos.** Ya viene activada en Supabase (TOTP), no hay que configurar nada.

## Publicaciones y moderación (fase 2)

| Requerimiento | Cómo se cumple |
|---|---|
| RF-06 | Al tocar **Publicar un producto**, el sistema crea un borrador con un **código único** (por ejemplo `UMB-7K3QX`). El vendedor sube **la foto del producto junto al papel con el código** (paso 1) y **mínimo 2 fotos para el catálogo** (paso 2). La foto del código se guarda en el almacén **privado**: solo la ven el vendedor y los moderadores, nunca los compradores. |
| RF-07 | Cada foto lleva una **huella perceptual**. Si se parece a una foto de otra publicación, o si hay fotos repetidas dentro de la misma, el moderador ve una alerta. Opcional: búsqueda en internet con Google Cloud Vision (función `revisar-imagenes`). |
| RF-08 | Toda publicación nace como **borrador** y pasa a **En revisión** hasta que un moderador la aprueba. Si el vendedor cambia el nombre, la descripción, la categoría o las fotos de una publicación aprobada, vuelve a revisión. El precio y la cantidad se pueden cambiar sin perderla. |
| RF-09 | Campos obligatorios: categoría, estado (nuevo/usado), precio, cantidad, descripción (mínimo 20 caracteres) y modalidades de entrega (en la U o a domicilio, más el tamaño del paquete si es a domicilio). |
| RF-10 | Lista de **palabras prohibidas** (armas, sustancias, alcohol, medicamentos, tareas, falsificados) editable en **Administración → Configuración**. Si aparecen, la publicación se rechaza automáticamente. |
| RF-11 | Botón **⚑ Reportar esta publicación** en cada ficha. Los moderadores confirman o descartan en **Administración → Reportes**. |
| RF-36 (parte) | Con 3 reportes confirmados (valor configurable) el vendedor se **suspende automáticamente** y sus publicaciones dejan de verse. |
| RF-12 / RF-13 | Filtros por palabra, categoría, precio, estado, sede y tipo de entrega. Orden por relevancia, recientes, precio y mejor calificados. |
| RF-38 | Categorías, palabras prohibidas y parámetros editables en **Administración → Configuración**. |

### (Opcional) Buscar en internet si las fotos ya existen

1. En [Google Cloud Console](https://console.cloud.google.com) activa **Cloud Vision API** y crea una **clave de API**. Los primeros 1.000 análisis al mes son gratis.
2. En Supabase → **Edge Functions → Deploy a new function**, crea `revisar-imagenes` con el contenido de `supabase/functions/revisar-imagenes/index.ts`. Esta función sí debe tener **Verify JWT activado**.
3. En **Edge Functions → Secrets**, agrega `GOOGLE_VISION_API_KEY`.

Sin este paso, la detección de fotos repetidas **dentro** del marketplace sigue funcionando.

### Las fotos no aparecen al publicar o editar

1. Vuelve a ejecutar `supabase/schema.sql` completo: deja el bucket **productos** como público y pasa las fotos de productos antiguos a la galería.
2. En Supabase → **Storage → productos**, revisa que diga **Public**. Si en *Edit bucket* hay un límite de tamaño o una lista de tipos permitidos, quítalos o permite `image/jpeg`, `image/png` y `image/webp`.
3. Si la foto viene de un iPhone en formato HEIC, la página lo avisa: hay que tomarla en JPG (Ajustes → Cámara → Formatos → «Más compatible»).

## Seguimiento de pedidos

Cada tienda maneja el estado de **sus** productos dentro del pedido:

| Estado | Quién lo cambia | Qué significa |
|---|---|---|
| Pendiente | (automático) | El cliente hizo el pedido |
| Confirmado | Vendedor | El vendedor lo aceptó y lo está preparando |
| Enviado | Vendedor | Va en camino |
| Entregado | Vendedor **o** cliente («Ya lo recibí») | El cliente lo tiene |
| Cancelado | Vendedor (antes de enviar) o cliente (mientras siga pendiente) | Las unidades vuelven al inventario |

- El vendedor gestiona todo desde **Mi tienda → Pedidos recibidos**.
- El cliente ve el progreso en **Mis pedidos** y confirma con **Ya lo recibí**.
- Cada cambio queda en la tabla `pedido_eventos`, con quién lo hizo y cuándo. Así se sabe si la entrega la confirmó el cliente o el vendedor.

## Pagos en línea con Wompi (Nequi, Daviplata, PSE, tarjeta)

En el checkout, el cliente puede elegir **«Pagar en línea ahora»**. El pedido se crea, el cliente paga en la página segura de Wompi y vuelve a **Mis pedidos**, donde ve «✓ Pagado». El vendedor solo puede confirmar el pedido cuando el pago está aprobado.

También siguen disponibles **pago contra entrega** y **transferencia directa al vendedor**.

### Cómo funciona por dentro

- `supabase/functions/pagos-wompi/index.ts` es una **Edge Function** de Supabase. Es la única parte que conoce los secretos de Wompi:
  - firma cada pago (firma de integridad SHA-256),
  - recibe los avisos de Wompi (webhook) y valida su firma,
  - consulta la transacción cuando el cliente vuelve.
- La base de datos guarda cada intento en `pedido_pagos` y el estado en `pedidos.estado_pago`. Un pago solo se aprueba si el monto coincide exactamente con el del pedido.

### Configuración (modo pruebas)

1. **Cuenta de Wompi.** Regístrate en [comercios.wompi.co](https://comercios.wompi.co) y entra al **modo de pruebas (Sandbox)**. En la sección de **Desarrolladores** copia:
   - la **llave pública** de pruebas (`pub_test_…`),
   - el **secreto de integridad** (`test_integrity_…`),
   - el **secreto de eventos** (`test_events_…`).
2. **Base de datos.** Ejecuta el `supabase/schema.sql` actualizado en el SQL Editor.
3. **Crear la función.** En Supabase → **Edge Functions → Deploy a new function → Via Editor**:
   - Nombre: `pagos-wompi` (exactamente así).
   - Pega todo el contenido de `supabase/functions/pagos-wompi/index.ts` y pulsa **Deploy**.
   - En los ajustes de la función, **desactiva «Enforce JWT verification» / «Verify JWT»**. Wompi no envía ese token. La función valida por su cuenta quién llama.
4. **Secretos.** En **Edge Functions → Secrets**, agrega:

   | Nombre | Valor |
   |---|---|
   | `WOMPI_PUBLIC_KEY` | `pub_test_…` |
   | `WOMPI_INTEGRITY_SECRET` | `test_integrity_…` |
   | `WOMPI_EVENTS_SECRET` | `test_events_…` |
   | `WOMPI_ENV` | `sandbox` |
   | `SITIO_URL` (opcional) | `https://trident808.github.io/mktUMB/` |

5. **Avisos de Wompi.** En el panel de Wompi (Desarrolladores), pon como **URL de eventos** del modo de pruebas:
   `https://sispastooqxbzunmglxi.supabase.co/functions/v1/pagos-wompi`
6. **Sitio.** Sube los archivos actualizados a GitHub, incluido `marketplace/js/config.js` (trae `PAGOS_EN_LINEA: true`).

### Datos de prueba de Wompi

| Método | Aprobado | Rechazado |
|---|---|---|
| Nequi | `3991111111` | `3992222222` |
| Tarjeta | `4242 4242 4242 4242` | `4111 1111 1111 1111` |
| PSE | «Banco que aprueba» | «Banco que rechaza» |
| Daviplata (código OTP) | `574829` | `932015` |

Las tarjetas aceptan cualquier fecha futura y cualquier CVC de 3 dígitos.

### Pasar a cobros reales

1. Wompi debe verificar tu cuenta de comercio (documentos y cuenta bancaria).
2. Cambia los secretos por los de producción (`pub_prod_…`, `prod_integrity_…`, `prod_events_…`) y pon `WOMPI_ENV` = `production`.
3. Configura la URL de eventos también en el modo de producción de Wompi.
4. En `config.js`, pon `PAGOS_MODO_PRUEBAS: false` para ocultar los datos de prueba.

> **Importante:** todo el dinero llega a **una sola** cuenta de Wompi, la del dueño del marketplace. Pagarle a cada vendedor su parte es un proceso manual o contable fuera del sitio. Repartir el dinero automáticamente entre vendedores requiere un producto de pagos para marketplaces y no está incluido.

> Un pedido con pago en línea **reserva las unidades** mientras está pendiente. Si el cliente no paga, él o el vendedor pueden cancelarlo para liberarlas.
