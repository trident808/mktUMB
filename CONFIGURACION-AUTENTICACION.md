# Configuración de autenticación — Marketplace UMB

## Páginas añadidas
- `login.html`: inicio de sesión por correo/contraseña y botón Google.
- `registro.html`: creación de cuenta comprador/vendedor.
- `carrito.html`: carrito multipágina compartido mediante `localStorage`.
- `checkout.html`: formulario de entrega y solicitud de pedido de demostración.
- `mi-cuenta.html`: perfil, accesos rápidos y favoritos.
- `pedidos.html`: solicitudes de pedido guardadas en el navegador.
- `vender.html`: formulario de creación de tienda mediante RPC `crear_tienda`.

## Google OAuth
1. En Google Cloud Console crea/configura un OAuth Client ID tipo Web.
2. En Supabase abre Authentication → Sign In / Providers → Google, habilita Google y copia Client ID y Client Secret de Google.
3. En Supabase → Authentication → URL Configuration, configura Site URL con la URL base publicada del proyecto, por ejemplo `https://trident808.github.io/Proyecto-Marketplace/`.
4. Agrega a Redirect URLs la URL de inicio del proyecto: `https://trident808.github.io/Proyecto-Marketplace/index.html`. Agrega también la URL local si vas a probar en local.
5. En Google Cloud, en los URI de redirección autorizados, copia exactamente la URL callback que muestra Supabase en la configuración del proveedor Google (normalmente `https://<project-ref>.supabase.co/auth/v1/callback`). No uses la URL de GitHub Pages como callback de Google.

## Notas importantes
- `marketplace/supabase-config.js` conserva la URL y la clave pública existentes; nunca pongas una clave `service_role` o `sb_secret_` en el navegador.
- La tabla `productos` existente del catálogo se conserva.
- El carrito, favoritos y pedidos de demostración usan almacenamiento local del navegador. Todavía no hay pago real ni persistencia de pedidos en Supabase.
- La página `vender.html` usa la función RPC `crear_tienda` definida en `marketplace/schema.sql`. Si la función/tablas/policies no se han ejecutado en Supabase, la creación de tienda fallará con un mensaje.
- El esquema incluido crea `public.products`, pero el catálogo actual consulta `public.productos`. La publicación de productos requiere unificar esas tablas antes de activarla.
- Para evitar que el registro de vendedores quede con rol incorrecto cuando Supabase exige confirmación por correo, el flujo de alta se mantiene como registro de usuario y el proceso de tienda se hace desde la página Vender.
