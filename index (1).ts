// =====================================================================
// MARKETPLACE UMB · Edge Function "pagos-wompi"
// ---------------------------------------------------------------------
// Hace tres cosas:
//   1. accion "iniciar"   → firma el pago y devuelve el enlace al checkout de Wompi.
//   2. accion "verificar" → consulta a Wompi una transacción (cuando el cliente vuelve).
//   3. Aviso de Wompi     → recibe los eventos "transaction.updated" (webhook).
//
// Secretos (Supabase → Edge Functions → Secrets):
//   WOMPI_PUBLIC_KEY        pub_test_...      (llave pública)
//   WOMPI_INTEGRITY_SECRET  test_integrity_...(secreto de integridad)
//   WOMPI_EVENTS_SECRET     test_events_...   (secreto de eventos)
//   WOMPI_ENV               sandbox | production   (por defecto: sandbox)
//
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los pone Supabase.
// IMPORTANTE: desactiva "Verify JWT" en esta función, porque Wompi no envía JWT.
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const WOMPI_ENV = (Deno.env.get("WOMPI_ENV") ?? "sandbox").toLowerCase();
const WOMPI_API = Deno.env.get("WOMPI_API_URL") ??
  (WOMPI_ENV === "production" ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1");
const WOMPI_CHECKOUT = "https://checkout.wompi.co/p/";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respuesta(datos: unknown, status = 200) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Firma de integridad de Wompi: SHA256(referencia + montoEnCentavos + moneda + secretoIntegridad) */
export function firmaIntegridad(referencia: string, centavos: number | string, moneda: string, secreto: string) {
  return sha256Hex(`${referencia}${centavos}${moneda}${secreto}`);
}

/** Lee un valor anidado como "transaction.status" dentro de data. */
function leerRuta(obj: Record<string, unknown>, ruta: string): unknown {
  return ruta.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/**
 * Valida el checksum de un evento de Wompi:
 * SHA256( valores de signature.properties (en orden) + timestamp + secretoEventos )
 */
export async function eventoValido(evento: Record<string, any>, secreto: string, cabecera?: string | null) {
  const firma = evento?.signature;
  if (!firma || !Array.isArray(firma.properties) || evento.timestamp === undefined) return false;
  const valores = firma.properties.map((p: string) => String(leerRuta(evento.data ?? {}, p) ?? "")).join("");
  const calculado = await sha256Hex(`${valores}${evento.timestamp}${secreto}`);
  const recibido = String(cabecera || firma.checksum || "").toLowerCase();
  return recibido.length > 0 && calculado === recibido;
}

function clienteServicio() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

async function registrar(tx: Record<string, any>) {
  const { data, error } = await clienteServicio().rpc("registrar_resultado_pago", {
    p_referencia: tx.reference,
    p_estado_wompi: tx.status,
    p_transaccion: tx.id,
    p_metodo: tx.payment_method_type ?? null,
    p_monto_centavos: Number(tx.amount_in_cents),
  });
  if (error) throw error;
  return data as string;
}

/** Solo se permite volver a sitios web (https) o a localhost para pruebas. */
function urlRetornoValida(url: unknown): string | null {
  try {
    const u = new URL(String(url));
    const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
    if (u.protocol !== "https:" && !local) return null;
    const permitido = Deno.env.get("SITIO_URL");
    if (permitido && !u.href.startsWith(permitido) && !local) return null;
    return u.href;
  } catch {
    return null;
  }
}

async function iniciar(req: Request, cuerpo: Record<string, any>) {
  const publica = Deno.env.get("WOMPI_PUBLIC_KEY");
  const integridad = Deno.env.get("WOMPI_INTEGRITY_SECRET");
  if (!publica || !integridad) {
    return respuesta({ error: "Faltan los secretos de Wompi en Supabase (WOMPI_PUBLIC_KEY y WOMPI_INTEGRITY_SECRET)." }, 500);
  }
  const auth = req.headers.get("Authorization");
  if (!auth) return respuesta({ error: "Debes iniciar sesión." }, 401);

  const retorno = urlRetornoValida(cuerpo.redirect_url);
  if (!retorno) return respuesta({ error: "Dirección de retorno no válida." }, 400);

  // Llamar a la base de datos COMO el usuario: así preparar_pago() verifica que el pedido sea suyo.
  const usuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await usuario.rpc("preparar_pago", { p_pedido: cuerpo.pedido_id });
  if (error) return respuesta({ error: error.message }, 400);

  const pago = data as { referencia: string; monto_centavos: number; correo?: string; nombre?: string; telefono?: string };
  const firma = await firmaIntegridad(pago.referencia, pago.monto_centavos, "COP", integridad);

  const params = new URLSearchParams({
    "public-key": publica,
    "currency": "COP",
    "amount-in-cents": String(pago.monto_centavos),
    "reference": pago.referencia,
    "signature:integrity": firma,
    "redirect-url": retorno,
  });
  if (pago.correo) params.set("customer-data:email", pago.correo);
  if (pago.nombre) params.set("customer-data:full-name", pago.nombre);
  const tel = String(pago.telefono ?? "").replace(/\D/g, "").replace(/^57(?=\d{10}$)/, "");
  if (tel.length === 10) {
    params.set("customer-data:phone-number", tel);
    params.set("customer-data:phone-number-prefix", "+57");
  }

  return respuesta({ url: `${WOMPI_CHECKOUT}?${params.toString()}`, referencia: pago.referencia, ambiente: WOMPI_ENV });
}

async function verificar(cuerpo: Record<string, any>) {
  const id = String(cuerpo.transaccion_id ?? "");
  if (!/^[\w-]{5,80}$/.test(id)) return respuesta({ error: "Transacción no válida." }, 400);
  const r = await fetch(`${WOMPI_API}/transactions/${encodeURIComponent(id)}`);
  if (!r.ok) return respuesta({ error: "Wompi no encontró la transacción." }, 404);
  const tx = (await r.json())?.data;
  if (!tx?.reference) return respuesta({ error: "Respuesta inesperada de Wompi." }, 502);
  const estado = await registrar(tx);
  return respuesta({ estado, referencia: tx.reference, estado_wompi: tx.status });
}

async function webhook(req: Request, evento: Record<string, any>) {
  const secreto = Deno.env.get("WOMPI_EVENTS_SECRET");
  if (!secreto) return respuesta({ error: "Falta WOMPI_EVENTS_SECRET." }, 500);
  if (!(await eventoValido(evento, secreto, req.headers.get("X-Event-Checksum")))) {
    console.warn("Evento de Wompi con firma inválida; se ignora.");
    return respuesta({ ok: false, motivo: "firma inválida" }, 401);
  }
  if (evento.event === "transaction.updated" && evento.data?.transaction) {
    const estado = await registrar(evento.data.transaction);
    return respuesta({ ok: true, estado });
  }
  return respuesta({ ok: true, ignorado: evento.event });
}

export async function manejar(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return respuesta({ error: "Método no permitido" }, 405);

  let cuerpo: Record<string, any>;
  try {
    cuerpo = await req.json();
  } catch {
    return respuesta({ error: "JSON no válido" }, 400);
  }

  try {
    if (cuerpo.event) return await webhook(req, cuerpo);
    if (cuerpo.accion === "iniciar") return await iniciar(req, cuerpo);
    if (cuerpo.accion === "verificar") return await verificar(cuerpo);
    return respuesta({ error: "Acción desconocida" }, 400);
  } catch (e) {
    console.error("pagos-wompi:", e);
    return respuesta({ error: (e as Error).message ?? "Error interno" }, 500);
  }
}

Deno.serve(manejar);
