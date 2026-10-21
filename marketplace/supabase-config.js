
/*
 * =========================================================
 * MARKETPLACE UMB
 * Archivo: marketplace/supabase-config.js
 * Configuración de Supabase
 * =========================================================
 *
 * Requisitos:
 * - supabase-js debe cargarse antes de este archivo.
 * - La URL y la clave pública deben ser correctas.
 * - Las tablas deben existir en Supabase.
 * - Las políticas RLS deben estar configuradas.
 *
 * Nunca incluir claves service_role, sb_secret_...
 * ni contraseñas de la base de datos.
 * =========================================================
 */


// =========================================================
// 1. CREDENCIALES
// =========================================================

const SUPABASE_URL =
    "https://sispastooqxbzunmglxi.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_4VsgrjgyXv3-ERWhCadaeQ_1oli4Giz";


// =========================================================
// 2. VALIDAR CONFIGURACIÓN
// =========================================================


function validarConfiguracionSupabase() {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        console.error(
            "[Supabase] Falta la URL o la clave pública."
        );
        return false;
    }

    if (
        SUPABASE_URL.includes("PEGA_AQUI") ||
        SUPABASE_PUBLISHABLE_KEY.includes("PEGA_AQUI")
    ) {
        console.error(
            "[Supabase] Reemplaza las credenciales de ejemplo."
        );
        return false;
    }

    if (
        !SUPABASE_URL.startsWith("https://") ||
        !SUPABASE_URL.endsWith(".supabase.co")
    ) {
        console.error("[Supabase] La URL no es válida.");
        return false;
    }

    if (
        SUPABASE_PUBLISHABLE_KEY.startsWith("sb_secret_") ||
        SUPABASE_PUBLISHABLE_KEY.includes("service_role")
    ) {
        console.error(
            "[Supabase] No uses una clave secreta en el navegador."
        );
        return false;
    }

    return true;
}


// =========================================================
// 3. INICIALIZAR CLIENTE
// =========================================================



function inicializarSupabase() {
    console.log("[Supabase] Comprobando inicialización...");

    if (!window.supabase) {
        console.error(
            "[Supabase] La biblioteca no está cargada."
        );
        return null;
    }

    if (!validarConfiguracionSupabase()) {
        return null;
    }

    try {
        const cliente = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_PUBLISHABLE_KEY,
            {
                auth: {
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: true
                }
            }
        );

        console.log(
            "[Supabase] Cliente creado correctamente."
        );

        return cliente;

    } catch (error) {
        console.error(
            "[Supabase] Error al crear el cliente:",
            error
        );

        return null;
    }
}

window.supabaseClient = inicializarSupabase();

// =========================================================
// 4. PROBAR CONEXIÓN
// =========================================================

async function probarConexionSupabase() {
    const cliente = window.supabaseClient;

    if (!cliente) {
        console.error(
            "[Supabase] El cliente no está inicializado. " +
            "Revisa las credenciales y la biblioteca."
        );

        return {
            correcto: false,
            error: "Cliente no inicializado"
        };
    }

    try {
        console.log(
            "[Supabase] Probando acceso a la tabla perfiles..."
        );

        const { data, error } = await cliente
            .from("perfiles")
            .select("id")
            .limit(1);

        if (error) {
            console.error(
                "[Supabase] Error en la consulta:",
                error.message
            );

            console.error("Código:", error.code);
            console.error("Detalles:", error.details);
            console.error("Sugerencia:", error.hint);

            return {
                correcto: false,
                error: error
            };
        }

        console.log(
            "[Supabase] Consulta realizada correctamente.",
            data
        );

        return {
            correcto: true,
            data: data
        };

    } catch (error) {
        console.error(
            "[Supabase] Error inesperado:",
            error.message || error
        );

        return {
            correcto: false,
            error: error
        };
    }
}

window.probarConexionSupabase = probarConexionSupabase;


// =========================================================
// 5. CONSULTAR PRODUCTOS
// =========================================================

async function obtenerProductosSupabase() {
    const cliente = window.supabaseClient;

    if (!cliente) {
        return {
            correcto: false,
            productos: [],
            error: "Cliente Supabase no inicializado"
        };
    }

    try {
        const { data, error } = await cliente
            .from("productos")
            .select("*")
            .order("id", { ascending: true });

        if (error) {
            console.error(
                "[Supabase] Error al cargar productos:",
                error.message
            );

            console.error("Código:", error.code);
            console.error("Detalles:", error.details);

            return {
                correcto: false,
                productos: [],
                error: error
            };
        }

        console.log(
            "[Supabase] Productos cargados:",
            data.length
        );

        return {
            correcto: true,
            productos: data,
            error: null
        };

    } catch (error) {
        console.error(
            "[Supabase] Error inesperado cargando productos:",
            error.message || error
        );

        return {
            correcto: false,
            productos: [],
            error: error
        };
    }
}

window.obtenerProductosSupabase = obtenerProductosSupabase;


// =========================================================
// 6. OBTENER USUARIO ACTUAL
// =========================================================

async function obtenerUsuarioActualSupabase() {
    const cliente = window.supabaseClient;

    if (!cliente) {
        return null;
    }

    try {
        const { data, error } = await cliente.auth.getUser();

        if (error) {
            console.error(
                "[Supabase Auth] Error:",
                error.message
            );
            return null;
        }

        return data.user;

    } catch (error) {
        console.error(
            "[Supabase Auth] Error inesperado:",
            error.message || error
        );

        return null;
    }
}

window.obtenerUsuarioActualSupabase =
    obtenerUsuarioActualSupabase;


// =========================================================
// 7. CERRAR SESIÓN
// =========================================================

async function cerrarSesionSupabase() {
    const cliente = window.supabaseClient;

    if (!cliente) {
        return {
            correcto: false,
            error: "Cliente Supabase no inicializado"
        };
    }

    try {
        const { error } = await cliente.auth.signOut();

        if (error) {
            console.error(
                "[Supabase Auth] Error al cerrar sesión:",
                error.message
            );

            return {
                correcto: false,
                error: error
            };
        }

        console.log("[Supabase Auth] Sesión cerrada.");

        return {
            correcto: true,
            error: null
        };

    } catch (error) {
        console.error(
            "[Supabase Auth] Error inesperado:",
            error.message || error
        );

        return {
            correcto: false,
            error: error
        };
    }
}

window.cerrarSesionSupabase = cerrarSesionSupabase;


// =========================================================
// 8. DIAGNÓSTICO DESDE LA CONSOLA
// =========================================================

window.diagnosticarSupabase = function () {
    console.log("========== MARKETPLACE UMB ==========");
    console.log(
        "Biblioteca cargada:",
        typeof window.supabase
    );
    console.log(
        "Cliente inicializado:",
        Boolean(window.supabaseClient)
    );
    console.log(
        "Función de conexión:",
        typeof window.probarConexionSupabase
    );
    console.log(
        "Función de productos:",
        typeof window.obtenerProductosSupabase
    );
    console.log("======================================");

    return {
        bibliotecaDisponible: Boolean(window.supabase),
        clienteInicializado: Boolean(window.supabaseClient),
        pruebaDisponible:
            typeof window.probarConexionSupabase === "function",
        productosDisponible:
            typeof window.obtenerProductosSupabase === "function"
    };
};

console.log(
    "[Marketplace UMB] Archivo supabase-config.js cargado."
);
