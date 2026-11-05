// =====================================================================
// MARKETPLACE UMB · Edge Function "revisar-imagenes"  (RF-07, opcional)
// ---------------------------------------------------------------------
// Busca en internet cada foto de una publicación con Google Cloud Vision
// (detección web). Si la foto aparece en otras páginas, agrega una alerta
// a la publicación para que el moderador la revise.
//
// Secreto (Supabase → Edge Functions → Secrets):
//   GOOGLE_VISION_API_KEY   clave de API de Google Cloud con "Cloud Vision API" activada.
// Sin la clave, la función responde { omitido: true } y no hace nada.
// La detección de fotos repetidas DENTRO del marketplace funciona siempre (en la base de datos).
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const clave = Deno.env.get("GOOGLE_VISION_API_KEY");
    if (!clave) return responder({ omitido: true, motivo: "GOOGLE_VISION_API_KEY no configurada" });

    const { producto_id } = await req.json();
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;

    // Solo el dueño de la publicación puede pedir la revisión.
    const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: esDueno } = await usuario.rpc("es_dueno_producto", { p_producto: producto_id });
    if (!esDueno) return responder({ error: "No autorizado" }, 403);

    const servicio = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: fotos } = await servicio.from("producto_fotos").select("url, con_codigo").eq("producto_id", producto_id);
    const propio = new URL(url).hostname;
    const encontradas: string[] = [];

    for (const f of (fotos ?? []).filter((x) => !x.con_codigo).slice(0, 6)) {
      const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${clave}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ image: { source: { imageUri: f.url } }, features: [{ type: "WEB_DETECTION", maxResults: 10 }] }] }),
      });
      if (!r.ok) continue;
      const web = (await r.json())?.responses?.[0]?.webDetection ?? {};
      const coincidencias = [
        ...(web.fullMatchingImages ?? []).map((x: { url: string }) => x.url),
        ...(web.pagesWithMatchingImages ?? []).filter((x: { fullMatchingImages?: unknown[] }) => x.fullMatchingImages?.length).map((x: { url: string }) => x.url),
      ].filter((u: string) => { try { return new URL(u).hostname !== propio; } catch { return false; } });
      encontradas.push(...coincidencias);
    }

    if (encontradas.length) {
      await servicio.rpc("agregar_alerta_producto", {
        p_producto: producto_id,
        p_alerta: { tipo: "foto_en_internet", paginas: [...new Set(encontradas)].slice(0, 5) },
      });
    }
    return responder({ revisadas: (fotos ?? []).length, coincidencias: encontradas.length });
  } catch (e) {
    return responder({ error: (e as Error).message }, 500);
  }
});
