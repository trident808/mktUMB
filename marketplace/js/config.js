/*
 * MARKETPLACE UMB · Configuración de Supabase
 * ------------------------------------------------------------
 * Solo va aquí la URL del proyecto y la clave PÚBLICA
 * (publishable / anon). Nunca pongas la clave "service_role"
 * ni "sb_secret_..." en archivos del navegador.
 */
window.UMB_CONFIG = {
  SUPABASE_URL: "https://sispastooqxbzunmglxi.supabase.co",
  SUPABASE_KEY: "sb_publishable_4VsgrjgyXv3-ERWhCadaeQ_1oli4Giz",

  // Envío: gratis desde este valor; si no, se cobra COSTO_ENVIO.
  // Debe coincidir con la función crear_pedido() de schema.sql.
  ENVIO_GRATIS_DESDE: 150000,
  COSTO_ENVIO: 8000,

  CORREO_SOPORTE: "soporte@marketplaceumb.com"
};
