-- =====================================================================
-- MARKETPLACE UMB · Esquema completo para Supabase (PostgreSQL)
-- ---------------------------------------------------------------------
-- Cómo usarlo:
--   Supabase → SQL Editor → New query → pega TODO este archivo → Run.
--
-- Es seguro ejecutarlo varias veces (idempotente):
--   * Crea las tablas si no existen y agrega las columnas que falten.
--   * Si ya tenías las tablas antiguas "profiles" y "stores", copia sus
--     datos a "perfiles" y "tiendas".
--   * Crea el perfil de los usuarios que ya se habían registrado antes.
--   * Reemplaza las políticas RLS de estas tablas por las de este archivo.
--
-- Qué guarda:
--   perfiles      → datos de cada persona que se registra (1 fila por usuario)
--   accesos       → historial de registros e inicios de sesión
--   tiendas       → emprendimientos (1 por vendedor)
--   productos     → catálogo
--   pedidos       → compras realizadas
--   pedido_items  → productos de cada pedido
-- =====================================================================

create extension if not exists pgcrypto;


-- =====================================================================
-- 0. APARTAR TABLAS ANTIGUAS INCOMPATIBLES
--    Si ya existían "tiendas", "pedidos", "pedido_items" o "accesos" con
--    otra estructura (de una versión anterior del proyecto), se renombran
--    a <tabla>_anterior_<fecha> para no perder datos, y se crean nuevas.
-- =====================================================================

do $$
declare
    v_tabla text;
    v_req text[];
    v_falta boolean;
    v_sufijo text := to_char(now(), 'YYYYMMDD_HH24MISS');
    v_apartadas text[] := '{}';
begin
    foreach v_tabla in array array['tiendas', 'pedidos', 'pedido_items', 'accesos'] loop
        if to_regclass('public.' || v_tabla) is null then
            continue;
        end if;

        v_req := case v_tabla
            when 'tiendas' then array['id:uuid', 'usuario_id:uuid', 'nombre']
            when 'pedidos' then array['id:uuid', 'codigo', 'usuario_id:uuid', 'estado', 'subtotal', 'envio', 'total',
                                      'metodo_pago', 'nombre_entrega', 'telefono_entrega', 'direccion_entrega', 'notas', 'creado_en']
            when 'pedido_items' then array['id', 'pedido_id:uuid', 'producto_id', 'tienda_id:uuid', 'nombre', 'precio', 'cantidad']
            when 'accesos' then array['id', 'usuario_id:uuid', 'correo', 'evento', 'metodo', 'navegador', 'creado_en']
        end;

        select exists (
            select 1 from unnest(v_req) as r(col)
            where not exists (
                select 1 from information_schema.columns c
                where c.table_schema = 'public'
                  and c.table_name = v_tabla
                  and c.column_name = split_part(r.col, ':', 1)
                  and (split_part(r.col, ':', 2) = '' or c.udt_name = split_part(r.col, ':', 2))
            )
        ) into v_falta;

        -- Si se apartó "pedidos", sus ítems también.
        if v_tabla = 'pedido_items' and 'pedidos' = any(v_apartadas) then
            v_falta := true;
        end if;

        if v_falta then
            execute format('alter table public.%I rename to %I', v_tabla, v_tabla || '_anterior_' || v_sufijo);
            v_apartadas := v_apartadas || v_tabla;
            raise notice 'La tabla antigua % se renombró a %', v_tabla, v_tabla || '_anterior_' || v_sufijo;
        end if;
    end loop;

    -- Si se apartó "tiendas", quitar de "productos" la relación con la tabla vieja.
    if 'tiendas' = any(v_apartadas) and to_regclass('public.productos') is not null then
        declare
            r record;
        begin
            for r in
                select conname from pg_constraint
                where conrelid = 'public.productos'::regclass and contype = 'f'
            loop
                execute format('alter table public.productos drop constraint %I', r.conname);
            end loop;
        end;
    end if;
end $$;


-- =====================================================================
-- 1. PERFILES (datos de registro de cada usuario)
-- =====================================================================

create table if not exists public.perfiles (
    id uuid primary key references auth.users(id) on delete cascade
);

alter table public.perfiles add column if not exists nombre text not null default 'Usuario';
alter table public.perfiles add column if not exists correo text;
alter table public.perfiles add column if not exists telefono text;
alter table public.perfiles add column if not exists avatar_url text;
alter table public.perfiles add column if not exists rol text not null default 'cliente';
alter table public.perfiles add column if not exists proveedor text not null default 'email';
alter table public.perfiles add column if not exists estado text not null default 'activo';
alter table public.perfiles add column if not exists acepta_datos boolean not null default false;
alter table public.perfiles add column if not exists fecha_aceptacion_datos timestamptz;
alter table public.perfiles add column if not exists fecha_registro timestamptz not null default now();
alter table public.perfiles add column if not exists ultimo_acceso timestamptz;
alter table public.perfiles add column if not exists total_accesos integer not null default 0;
alter table public.perfiles add column if not exists actualizado_en timestamptz not null default now();

-- Adaptar una tabla "perfiles" creada antes con otra estructura:
--  * columnas obligatorias sin valor por defecto que el registro no llena
--  * valores de rol/estado distintos (p. ej. 'comprador')
--  * restricciones antiguas con otros valores permitidos
do $$
declare
    r record;
begin
    for r in
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'perfiles'
          and is_nullable = 'NO' and column_default is null
          and column_name <> 'id'
    loop
        execute format('alter table public.perfiles alter column %I drop not null', r.column_name);
        raise notice 'perfiles.% ya no es obligatoria', r.column_name;
    end loop;

    for r in
        select conname from pg_constraint
        where conrelid = 'public.perfiles'::regclass and contype = 'c'
    loop
        execute format('alter table public.perfiles drop constraint %I', r.conname);
    end loop;

    -- Copiar el correo desde columnas antiguas ("email") si existían.
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'perfiles' and column_name = 'email') then
        execute 'update public.perfiles set correo = email where correo is null';
    end if;
end $$;

update public.perfiles
set rol = case
        when lower(rol) in ('vendedor', 'seller') then 'vendedor'
        when lower(rol) in ('admin', 'administrador') then 'admin'
        else 'cliente'
    end
where rol is null or rol not in ('cliente', 'vendedor', 'admin');

update public.perfiles set estado = 'activo' where estado is null or estado not in ('activo', 'inactivo');
update public.perfiles set nombre = 'Usuario' where nombre is null or trim(nombre) = '';
update public.perfiles set proveedor = 'email' where proveedor is null;
update public.perfiles set total_accesos = 0 where total_accesos is null;
update public.perfiles set acepta_datos = false where acepta_datos is null;
update public.perfiles set fecha_registro = now() where fecha_registro is null;
update public.perfiles set actualizado_en = now() where actualizado_en is null;

-- Valores por defecto (la tabla antigua podía tener otros, p. ej. rol = 'comprador').
alter table public.perfiles alter column rol set default 'cliente';
alter table public.perfiles alter column estado set default 'activo';
alter table public.perfiles alter column nombre set default 'Usuario';
alter table public.perfiles alter column proveedor set default 'email';
alter table public.perfiles alter column total_accesos set default 0;
alter table public.perfiles alter column acepta_datos set default false;
alter table public.perfiles alter column fecha_registro set default now();
alter table public.perfiles alter column actualizado_en set default now();

alter table public.perfiles alter column rol set not null;
alter table public.perfiles alter column estado set not null;
alter table public.perfiles alter column nombre set not null;

alter table public.perfiles
    add constraint perfiles_rol_check check (rol in ('cliente', 'vendedor', 'admin'));
alter table public.perfiles
    add constraint perfiles_estado_check check (estado in ('activo', 'inactivo'));

create index if not exists idx_perfiles_correo on public.perfiles (lower(correo));


-- =====================================================================
-- 2. ACCESOS (historial de registro e inicio de sesión)
-- =====================================================================

create table if not exists public.accesos (
    id bigint generated by default as identity primary key,
    usuario_id uuid not null references public.perfiles(id) on delete cascade,
    correo text,
    evento text not null,
    metodo text,
    navegador text,
    creado_en timestamptz not null default now()
);

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'accesos_evento_check' and conrelid = 'public.accesos'::regclass) then
        alter table public.accesos
            add constraint accesos_evento_check check (evento in ('registro', 'inicio_sesion'));
    end if;
end $$;

create index if not exists idx_accesos_usuario on public.accesos (usuario_id, creado_en desc);


-- =====================================================================
-- 3. TIENDAS
-- =====================================================================

create table if not exists public.tiendas (
    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null unique references public.perfiles(id) on delete cascade,
    nombre text not null
);

alter table public.tiendas add column if not exists descripcion text;
alter table public.tiendas add column if not exists categoria text;
alter table public.tiendas add column if not exists telefono text;
alter table public.tiendas add column if not exists logo_url text;
alter table public.tiendas add column if not exists activa boolean not null default true;
alter table public.tiendas add column if not exists creado_en timestamptz not null default now();


-- =====================================================================
-- 4. PRODUCTOS (se conserva la tabla "productos" si ya existía)
-- =====================================================================

create table if not exists public.productos (
    id bigint generated by default as identity primary key,
    nombre text not null,
    precio numeric(12,2) not null default 0
);

alter table public.productos add column if not exists tienda_id uuid references public.tiendas(id) on delete cascade;

-- Si "tienda_id" ya existía de antes (sin relación o con otro tipo), ajustarla.
do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'productos'
                 and column_name = 'tienda_id' and udt_name <> 'uuid') then
        alter table public.productos rename column tienda_id to tienda_id_anterior;
        alter table public.productos add column tienda_id uuid references public.tiendas(id) on delete cascade;
    elsif not exists (select 1 from pg_constraint
                      where conrelid = 'public.productos'::regclass and contype = 'f'
                        and confrelid = 'public.tiendas'::regclass) then
        update public.productos p set tienda_id = null
        where tienda_id is not null and not exists (select 1 from public.tiendas t where t.id = p.tienda_id);
        alter table public.productos
            add constraint productos_tienda_id_fkey_umb foreign key (tienda_id)
            references public.tiendas(id) on delete cascade;
    end if;
end $$;
alter table public.productos add column if not exists tienda text;
alter table public.productos add column if not exists categoria text;
alter table public.productos add column if not exists descripcion text;
alter table public.productos add column if not exists imagen text;
alter table public.productos add column if not exists stock integer not null default 0;
alter table public.productos add column if not exists rating numeric(2,1) not null default 0;
alter table public.productos add column if not exists resenas integer not null default 0;
alter table public.productos add column if not exists activo boolean not null default true;
alter table public.productos add column if not exists creado_en timestamptz not null default now();

-- Si la tabla antigua tenía un id numérico sin valor automático, agregarlo.
do $$
declare
    v_tipo text;
    v_default text;
    v_identity text;
begin
    select data_type, column_default, is_identity
    into v_tipo, v_default, v_identity
    from information_schema.columns
    where table_schema = 'public' and table_name = 'productos' and column_name = 'id';

    if v_tipo in ('integer', 'bigint', 'smallint') and v_default is null and v_identity = 'NO' then
        execute 'alter table public.productos alter column id add generated by default as identity';
        perform setval(
            pg_get_serial_sequence('public.productos', 'id'),
            greatest((select coalesce(max(id), 0) from public.productos), 1)
        );
    end if;
exception when others then
    raise notice 'No se ajustó el id de productos: %', sqlerrm;
end $$;

update public.productos set activo = true where activo is null;

-- Columnas antiguas obligatorias que el formulario del vendedor no llena.
do $$
declare
    r record;
begin
    for r in
        select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('productos', 'tiendas')
          and is_nullable = 'NO' and column_default is null
          and column_name not in ('id', 'nombre', 'usuario_id')
    loop
        execute format('alter table public.%I alter column %I drop not null', r.table_name, r.column_name);
    end loop;
end $$;

create index if not exists idx_productos_tienda on public.productos (tienda_id);
create index if not exists idx_productos_categoria on public.productos (categoria);


-- =====================================================================
-- 5. PEDIDOS
-- =====================================================================

create table if not exists public.pedidos (
    id uuid primary key default gen_random_uuid(),
    codigo text not null unique
        default ('UMB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
    usuario_id uuid not null references public.perfiles(id) on delete cascade,
    estado text not null default 'pendiente',
    subtotal numeric(12,2) not null default 0,
    envio numeric(12,2) not null default 0,
    total numeric(12,2) not null default 0,
    metodo_pago text not null default 'contraentrega',
    nombre_entrega text not null,
    telefono_entrega text not null,
    direccion_entrega text not null,
    notas text,
    creado_en timestamptz not null default now()
);

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'pedidos_estado_check' and conrelid = 'public.pedidos'::regclass) then
        alter table public.pedidos
            add constraint pedidos_estado_check
            check (estado in ('pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado'));
    end if;
end $$;

create table if not exists public.pedido_items (
    id bigint generated by default as identity primary key,
    pedido_id uuid not null references public.pedidos(id) on delete cascade,
    producto_id text not null,
    tienda_id uuid references public.tiendas(id) on delete set null,
    nombre text not null,
    precio numeric(12,2) not null,
    cantidad integer not null check (cantidad > 0)
);

create index if not exists idx_pedidos_usuario on public.pedidos (usuario_id, creado_en desc);
create index if not exists idx_pedido_items_pedido on public.pedido_items (pedido_id);
create index if not exists idx_pedido_items_tienda on public.pedido_items (tienda_id);

-- Estado de cada producto del pedido (cada tienda maneja su parte).
alter table public.pedido_items add column if not exists estado text not null default 'pendiente';
alter table public.pedido_items add column if not exists actualizado_en timestamptz not null default now();

do $$
begin
    if not exists (select 1 from pg_constraint
                   where conname = 'pedido_items_estado_check' and conrelid = 'public.pedido_items'::regclass) then
        update public.pedido_items i set estado = p.estado
        from public.pedidos p
        where p.id = i.pedido_id and p.estado in ('pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado');
        alter table public.pedido_items
            add constraint pedido_items_estado_check
            check (estado in ('pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado'));
    end if;
end $$;

-- Historial: quién cambió el estado y cuándo.
create table if not exists public.pedido_eventos (
    id bigint generated by default as identity primary key,
    pedido_id uuid not null references public.pedidos(id) on delete cascade,
    tienda_id uuid references public.tiendas(id) on delete set null,
    estado text not null,
    actor text not null check (actor in ('comprador', 'vendedor', 'admin', 'sistema')),
    usuario_id uuid references public.perfiles(id) on delete set null,
    creado_en timestamptz not null default now()
);

create index if not exists idx_pedido_eventos_pedido on public.pedido_eventos (pedido_id, creado_en);


-- =====================================================================
-- 6. MIGRAR DATOS DE LAS TABLAS ANTIGUAS (profiles / stores)
-- =====================================================================

do $$
begin
    if to_regclass('public.profiles') is not null then
        insert into public.perfiles (id, nombre, correo, telefono, rol, fecha_registro)
        select p.id,
               coalesce(nullif(trim(p.nombre), ''), 'Usuario'),
               p.correo,
               p.telefono,
               case when p.rol in ('cliente', 'vendedor') then p.rol else 'cliente' end,
               coalesce(p.fecha_registro, now())
        from public.profiles p
        on conflict (id) do nothing;
    end if;
exception when others then
    raise notice 'No se migró public.profiles: %', sqlerrm;
end $$;

-- Perfiles para usuarios que se registraron antes de este esquema.
insert into public.perfiles (id, nombre, correo, telefono, proveedor, fecha_registro)
select u.id,
       coalesce(
           nullif(trim(u.raw_user_meta_data ->> 'nombre'), ''),
           nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
           split_part(coalesce(u.email, 'Usuario'), '@', 1)
       ),
       u.email,
       u.raw_user_meta_data ->> 'telefono',
       coalesce(u.raw_app_meta_data ->> 'provider', 'email'),
       coalesce(u.created_at, now())
from auth.users u
on conflict (id) do nothing;

do $$
begin
    if to_regclass('public.stores') is not null then
        insert into public.tiendas (id, usuario_id, nombre, descripcion, categoria, telefono, creado_en)
        select s.id, s.usuario_id, s.nombre, s.descripcion, s.categoria, s.telefono,
               coalesce(s.fecha_creacion, now())
        from public.stores s
        where exists (select 1 from public.perfiles pf where pf.id = s.usuario_id)
        on conflict do nothing;
    end if;
exception when others then
    raise notice 'No se migró public.stores: %', sqlerrm;
end $$;


-- =====================================================================
-- 7. FUNCIONES AUXILIARES
-- =====================================================================

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.perfiles
        where id = auth.uid() and rol = 'admin' and estado = 'activo'
    );
$$;


-- =====================================================================
-- 8. GUARDAR AUTOMÁTICAMENTE LOS DATOS DE CADA REGISTRO
--    Se ejecuta cuando alguien crea una cuenta (correo o Google).
-- =====================================================================

create or replace function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_proveedor text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
    v_acepta boolean := coalesce(v_meta ->> 'acepta_datos', 'false') = 'true';
begin
    insert into public.perfiles (
        id, nombre, correo, telefono, avatar_url, rol, proveedor,
        acepta_datos, fecha_aceptacion_datos, fecha_registro
    )
    values (
        new.id,
        left(coalesce(
            nullif(trim(v_meta ->> 'nombre'), ''),
            nullif(trim(v_meta ->> 'full_name'), ''),
            nullif(trim(v_meta ->> 'name'), ''),
            split_part(coalesce(new.email, 'Usuario'), '@', 1)
        ), 120),
        new.email,
        left(nullif(trim(v_meta ->> 'telefono'), ''), 20),
        coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'),
        case when v_meta ->> 'rol' = 'vendedor' then 'vendedor' else 'cliente' end,
        v_proveedor,
        -- Quien entra con Google acepta los términos al continuar.
        v_acepta or v_proveedor <> 'email',
        case when v_acepta or v_proveedor <> 'email' then now() end,
        coalesce(new.created_at, now())
    )
    on conflict (id) do nothing;

    insert into public.accesos (usuario_id, correo, evento, metodo)
    values (new.id, new.email, 'registro', v_proveedor);

    return new;
exception when others then
    -- Nunca bloquear la creación de la cuenta por un error al guardar el perfil.
    raise warning 'manejar_nuevo_usuario: %', sqlerrm;
    return new;
end;
$$;

-- Quitar TODOS los disparadores antiguos sobre auth.users (de configuraciones
-- anteriores o tutoriales: on_auth_user_created, trigger_crear_perfil, etc.).
-- Si alguno falla, Supabase responde "Database error saving new user" y nadie
-- puede registrarse. Solo quedan los de este archivo.
do $$
declare
    r record;
begin
    for r in
        select tgname from pg_trigger
        where tgrelid = 'auth.users'::regclass and not tgisinternal
    loop
        execute format('drop trigger if exists %I on auth.users', r.tgname);
        raise notice 'Disparador eliminado de auth.users: %', r.tgname;
    end loop;
end $$;

create trigger al_crear_usuario
after insert on auth.users
for each row execute function public.manejar_nuevo_usuario();

-- Mantener el correo del perfil sincronizado si el usuario lo cambia.
create or replace function public.sincronizar_correo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.email is distinct from old.email then
        update public.perfiles set correo = new.email, actualizado_en = now()
        where id = new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists al_actualizar_usuario on auth.users;
create trigger al_actualizar_usuario
after update of email on auth.users
for each row execute function public.sincronizar_correo_usuario();


-- =====================================================================
-- 8b. SOLO CORREOS INSTITUCIONALES
--     Si la tabla "dominios_permitidos" tiene al menos un dominio, solo se
--     pueden registrar correos de esos dominios (o de sus subdominios).
--     Si está vacía, cualquiera puede registrarse.
--
--     Ejemplo (permite @umb.edu.co y también @academia.umb.edu.co):
--       insert into public.dominios_permitidos (dominio) values ('umb.edu.co');
-- =====================================================================

create table if not exists public.dominios_permitidos (
    dominio text primary key
        check (dominio = lower(trim(dominio)) and dominio !~ '[@[:space:]]' and dominio like '%.%')
);

create or replace function public.correo_permitido(p_correo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select not exists (select 1 from public.dominios_permitidos)
        or exists (
            select 1 from public.dominios_permitidos d
            where lower(split_part(coalesce(p_correo, ''), '@', 2)) = d.dominio
               or lower(split_part(coalesce(p_correo, ''), '@', 2)) like '%.' || d.dominio
        );
$$;

-- Bloquea el registro (con correo o con Google) si el dominio no está permitido.
create or replace function public.validar_dominio_registro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.correo_permitido(new.email) then
        raise exception 'Solo se permiten correos institucionales de la UMB';
    end if;
    return new;
end;
$$;

drop trigger if exists antes_crear_usuario on auth.users;
create trigger antes_crear_usuario
before insert on auth.users
for each row execute function public.validar_dominio_registro();

-- ¿El usuario actual puede usar el sitio? (dominio permitido o administrador)
create or replace function public.puedo_ingresar()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.correo_permitido((select email from auth.users where id = auth.uid()))
        or public.es_admin();
$$;


-- =====================================================================
-- 9. REGISTRAR CADA INICIO DE SESIÓN
--    La página llama a esta función justo después de iniciar sesión.
-- =====================================================================

create or replace function public.registrar_acceso(
    p_metodo text default 'email',
    p_navegador text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usuario uuid := auth.uid();
    v_correo text;
begin
    if v_usuario is null then
        raise exception 'Debes iniciar sesión';
    end if;

    select email into v_correo from auth.users where id = v_usuario;

    -- Por si el usuario existía antes de crear el disparador.
    insert into public.perfiles (id, nombre, correo)
    values (v_usuario, split_part(coalesce(v_correo, 'Usuario'), '@', 1), v_correo)
    on conflict (id) do nothing;

    -- Evitar duplicados si la página llama dos veces seguidas.
    if exists (
        select 1 from public.accesos
        where usuario_id = v_usuario
          and evento = 'inicio_sesion'
          and creado_en > now() - interval '30 seconds'
    ) then
        return;
    end if;

    update public.perfiles
    set ultimo_acceso = now(),
        total_accesos = total_accesos + 1
    where id = v_usuario;

    insert into public.accesos (usuario_id, correo, evento, metodo, navegador)
    values (
        v_usuario,
        v_correo,
        'inicio_sesion',
        left(coalesce(p_metodo, 'email'), 20),
        left(p_navegador, 250)
    );
end;
$$;


-- =====================================================================
-- 10. CREAR TIENDA (convierte al usuario en vendedor)
-- =====================================================================

drop function if exists public.crear_tienda(text, text, text, text, text);

create or replace function public.crear_tienda(
    p_nombre text,
    p_descripcion text default null,
    p_categoria text default null,
    p_telefono text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usuario uuid := auth.uid();
    v_tienda uuid;
begin
    if v_usuario is null then
        raise exception 'Debes iniciar sesión';
    end if;

    if length(trim(coalesce(p_nombre, ''))) < 2 then
        raise exception 'El nombre de la tienda es obligatorio';
    end if;

    if exists (select 1 from public.tiendas where usuario_id = v_usuario) then
        raise exception 'Ya tienes una tienda registrada';
    end if;

    insert into public.tiendas (usuario_id, nombre, descripcion, categoria, telefono)
    values (
        v_usuario,
        left(trim(p_nombre), 80),
        left(nullif(trim(p_descripcion), ''), 600),
        nullif(trim(p_categoria), ''),
        left(nullif(trim(p_telefono), ''), 20)
    )
    returning id into v_tienda;

    update public.perfiles
    set rol = 'vendedor', actualizado_en = now()
    where id = v_usuario and rol = 'cliente';

    return v_tienda;
end;
$$;


-- =====================================================================
-- 11. PRODUCTOS: copiar el nombre de la tienda y validar datos
-- =====================================================================

create or replace function public.preparar_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.tienda_id is not null then
        select t.nombre into new.tienda from public.tiendas t where t.id = new.tienda_id;
    end if;
    new.nombre := left(trim(new.nombre), 120);
    if new.precio < 0 then raise exception 'El precio no puede ser negativo'; end if;
    if new.stock < 0 then raise exception 'El stock no puede ser negativo'; end if;
    return new;
end;
$$;

drop trigger if exists antes_guardar_producto on public.productos;
create trigger antes_guardar_producto
before insert or update on public.productos
for each row execute function public.preparar_producto();

-- Si el vendedor cambia el nombre de su tienda, actualizar sus productos.
create or replace function public.propagar_nombre_tienda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.nombre is distinct from old.nombre then
        update public.productos set tienda = new.nombre where tienda_id = new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists al_actualizar_tienda on public.tiendas;
create trigger al_actualizar_tienda
after update of nombre on public.tiendas
for each row execute function public.propagar_nombre_tienda();


-- =====================================================================
-- 12. CREAR PEDIDO (precios y stock se validan en el servidor)
--     p_items = [{"id": "1", "cantidad": 2}, ...]
-- =====================================================================

create or replace function public.crear_pedido(
    p_items jsonb,
    p_nombre text,
    p_telefono text,
    p_direccion text,
    p_metodo_pago text default 'contraentrega',
    p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usuario uuid := auth.uid();
    v_pedido uuid;
    v_codigo text;
    v_item jsonb;
    v_cantidad integer;
    v_prod record;
    v_subtotal numeric(12,2) := 0;
    v_envio numeric(12,2);
begin
    if v_usuario is null then
        raise exception 'Debes iniciar sesión para comprar';
    end if;

    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'El carrito está vacío';
    end if;

    if jsonb_array_length(p_items) > 50 then
        raise exception 'Demasiados productos en un solo pedido';
    end if;

    if length(trim(coalesce(p_nombre, ''))) < 3
       or length(trim(coalesce(p_telefono, ''))) < 7
       or length(trim(coalesce(p_direccion, ''))) < 8 then
        raise exception 'Completa nombre, teléfono y dirección de entrega';
    end if;

    if coalesce(p_metodo_pago, '') not in ('contraentrega', 'transferencia', 'nequi') then
        raise exception 'Método de pago no válido';
    end if;

    insert into public.pedidos (
        usuario_id, nombre_entrega, telefono_entrega, direccion_entrega, metodo_pago, notas
    )
    values (
        v_usuario,
        left(trim(p_nombre), 120),
        left(trim(p_telefono), 20),
        left(trim(p_direccion), 300),
        p_metodo_pago,
        left(nullif(trim(p_notas), ''), 500)
    )
    returning id, codigo into v_pedido, v_codigo;

    for v_item in select * from jsonb_array_elements(p_items) loop
        v_cantidad := coalesce((v_item ->> 'cantidad')::integer, 0);

        if v_cantidad < 1 or v_cantidad > 99 then
            raise exception 'Cantidad no válida';
        end if;

        select p.id::text as id, p.nombre, p.precio, p.stock, p.tienda_id
        into v_prod
        from public.productos p
        where p.id::text = (v_item ->> 'id')
          and coalesce(p.activo, true)
        for update;

        if not found then
            raise exception 'Un producto del carrito ya no está disponible';
        end if;

        if v_prod.stock < v_cantidad then
            raise exception 'Solo quedan % unidades de "%"', v_prod.stock, v_prod.nombre;
        end if;

        update public.productos
        set stock = stock - v_cantidad
        where id::text = v_prod.id;

        insert into public.pedido_items (pedido_id, producto_id, tienda_id, nombre, precio, cantidad)
        values (v_pedido, v_prod.id, v_prod.tienda_id, v_prod.nombre, v_prod.precio, v_cantidad);

        v_subtotal := v_subtotal + v_prod.precio * v_cantidad;
    end loop;

    v_envio := case when v_subtotal >= 150000 then 0 else 8000 end;

    update public.pedidos
    set subtotal = v_subtotal, envio = v_envio, total = v_subtotal + v_envio
    where id = v_pedido;

    return jsonb_build_object(
        'id', v_pedido,
        'codigo', v_codigo,
        'subtotal', v_subtotal,
        'envio', v_envio,
        'total', v_subtotal + v_envio
    );
end;
$$;


-- =====================================================================
-- 13. SEGUIMIENTO DE PEDIDOS
--     Cada tienda avanza el estado de SUS productos del pedido:
--       pendiente → confirmado → enviado → entregado   (o cancelado)
--     El comprador puede confirmar "ya lo recibí" o cancelar si sigue pendiente.
--     El estado general del pedido se calcula a partir de sus productos.
-- =====================================================================

create or replace function public.recalcular_estado_pedido(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_estado text;
begin
    select case
             when count(*) filter (where estado <> 'cancelado') = 0 then 'cancelado'
             else (array['pendiente', 'confirmado', 'enviado', 'entregado'])[
                    min(array_position(array['pendiente', 'confirmado', 'enviado', 'entregado'], estado))
                      filter (where estado <> 'cancelado')]
           end
    into v_estado
    from public.pedido_items
    where pedido_id = p_pedido;

    update public.pedidos set estado = coalesce(v_estado, estado) where id = p_pedido;
end;
$$;

-- VENDEDOR (o admin): cambiar el estado de su parte del pedido.
create or replace function public.actualizar_estado_pedido(
    p_pedido uuid,
    p_estado text,
    p_tienda uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usuario uuid := auth.uid();
    v_tienda uuid;
    v_actor text := 'vendedor';
    v_actual text;
    v_cambiadas integer;
begin
    if v_usuario is null then
        raise exception 'Debes iniciar sesión';
    end if;

    select id into v_tienda from public.tiendas where usuario_id = v_usuario;

    if p_tienda is not null and p_tienda is distinct from v_tienda then
        if not public.es_admin() then
            raise exception 'No tienes permiso para cambiar este pedido';
        end if;
        v_tienda := p_tienda;
        v_actor := 'admin';
    elsif v_tienda is null then
        raise exception 'No tienes una tienda';
    end if;

    select count(*) into v_cambiadas
    from public.pedido_items
    where pedido_id = p_pedido and tienda_id = v_tienda;

    if v_cambiadas = 0 then
        raise exception 'Este pedido no tiene productos de tu tienda';
    end if;

    -- Estado actual (el menos avanzado) de los productos de esta tienda
    select estado into v_actual
    from public.pedido_items
    where pedido_id = p_pedido and tienda_id = v_tienda and estado <> 'cancelado'
    order by array_position(array['pendiente', 'confirmado', 'enviado', 'entregado'], estado)
    limit 1;

    if v_actual is null then
        raise exception 'Este pedido ya fue cancelado';
    end if;

    if not (
        (v_actual = 'pendiente'  and p_estado in ('confirmado', 'cancelado')) or
        (v_actual = 'confirmado' and p_estado in ('enviado', 'entregado', 'cancelado')) or
        (v_actual = 'enviado'    and p_estado = 'entregado')
    ) then
        raise exception 'No se puede pasar de "%" a "%"', v_actual, p_estado;
    end if;

    -- Cambiar el estado y, si se cancela, devolver al inventario solo estas unidades.
    with cambiados as (
        update public.pedido_items
        set estado = p_estado, actualizado_en = now()
        where pedido_id = p_pedido and tienda_id = v_tienda and estado <> 'cancelado'
        returning producto_id, cantidad
    ), devolver as (
        select producto_id, sum(cantidad) as unidades from cambiados
        where p_estado = 'cancelado' group by producto_id
    )
    update public.productos pr
    set stock = pr.stock + d.unidades
    from devolver d
    where pr.id::text = d.producto_id;

    insert into public.pedido_eventos (pedido_id, tienda_id, estado, actor, usuario_id)
    values (p_pedido, v_tienda, p_estado, v_actor, v_usuario);

    perform public.recalcular_estado_pedido(p_pedido);
    return p_estado;
end;
$$;

-- COMPRADOR: confirmar que recibió los productos de una tienda.
create or replace function public.confirmar_recibido(p_pedido uuid, p_tienda uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usuario uuid := auth.uid();
    v_n integer;
begin
    if not exists (select 1 from public.pedidos where id = p_pedido and usuario_id = v_usuario) then
        raise exception 'Este pedido no es tuyo';
    end if;

    update public.pedido_items
    set estado = 'entregado', actualizado_en = now()
    where pedido_id = p_pedido
      and tienda_id is not distinct from p_tienda
      and estado in ('confirmado', 'enviado');
    get diagnostics v_n = row_count;

    if v_n = 0 then
        raise exception 'Solo puedes confirmar la entrega cuando el vendedor haya confirmado o enviado el pedido';
    end if;

    insert into public.pedido_eventos (pedido_id, tienda_id, estado, actor, usuario_id)
    values (p_pedido, p_tienda, 'entregado', 'comprador', v_usuario);

    perform public.recalcular_estado_pedido(p_pedido);
    return 'entregado';
end;
$$;

-- COMPRADOR: cancelar lo que siga pendiente.
create or replace function public.cancelar_pedido(p_pedido uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usuario uuid := auth.uid();
    v_n integer;
begin
    if not exists (select 1 from public.pedidos where id = p_pedido and usuario_id = v_usuario) then
        raise exception 'Este pedido no es tuyo';
    end if;

    if not exists (select 1 from public.pedido_items where pedido_id = p_pedido and estado <> 'cancelado') then
        raise exception 'Este pedido ya está cancelado';
    end if;

    select count(*) into v_n
    from public.pedido_items
    where pedido_id = p_pedido and estado = 'pendiente';

    if v_n = 0 then
        raise exception 'Ya no se puede cancelar: el vendedor confirmó el pedido. Escríbele para acordarlo.';
    end if;

    -- Un evento por cada tienda afectada, para que cada vendedor lo vea.
    insert into public.pedido_eventos (pedido_id, tienda_id, estado, actor, usuario_id)
    select distinct p_pedido, tienda_id, 'cancelado', 'comprador', v_usuario
    from public.pedido_items
    where pedido_id = p_pedido and estado = 'pendiente';

    with cancelados as (
        update public.pedido_items
        set estado = 'cancelado', actualizado_en = now()
        where pedido_id = p_pedido and estado = 'pendiente'
        returning producto_id, cantidad
    ), devolver as (
        select producto_id, sum(cantidad) as unidades from cancelados group by producto_id
    )
    update public.productos pr
    set stock = pr.stock + d.unidades
    from devolver d
    where pr.id::text = d.producto_id;

    perform public.recalcular_estado_pedido(p_pedido);
    return 'cancelado';
end;
$$;

-- Pedidos recibidos por la tienda del usuario (panel del vendedor).
drop function if exists public.devolver_stock(uuid, uuid, boolean);
drop function if exists public.pedidos_de_mi_tienda();

create or replace function public.pedidos_de_mi_tienda()
returns table (
    pedido_id uuid,
    codigo text,
    estado text,
    creado_en timestamptz,
    actualizado_en timestamptz,
    nombre_entrega text,
    telefono_entrega text,
    direccion_entrega text,
    notas text,
    metodo_pago text,
    producto text,
    cantidad integer,
    precio numeric,
    entrega_confirmada_por text
)
language sql
stable
security definer
set search_path = ''
as $$
    select p.id, p.codigo, i.estado, p.creado_en, i.actualizado_en,
           p.nombre_entrega, p.telefono_entrega, p.direccion_entrega, p.notas, p.metodo_pago,
           i.nombre, i.cantidad, i.precio,
           (select e.actor from public.pedido_eventos e
            where e.pedido_id = p.id and e.estado = 'entregado'
              and (e.tienda_id = t.id)
            order by e.creado_en desc limit 1)
    from public.pedido_items i
    join public.pedidos p on p.id = i.pedido_id
    join public.tiendas t on t.id = i.tienda_id
    where t.usuario_id = auth.uid()
    order by p.creado_en desc
    limit 300;
$$;


-- =====================================================================
-- 14. SEGURIDAD (RLS)
--     Se eliminan las políticas anteriores de estas tablas para que
--     queden exactamente las de este archivo.
-- =====================================================================

do $$
declare
    r record;
begin
    for r in
        select policyname, tablename from pg_policies
        where schemaname = 'public'
          and tablename in ('perfiles', 'accesos', 'tiendas', 'productos', 'pedidos', 'pedido_items', 'pedido_eventos')
    loop
        execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    end loop;
end $$;

alter table public.perfiles     enable row level security;
alter table public.accesos      enable row level security;
alter table public.tiendas      enable row level security;
alter table public.productos    enable row level security;
alter table public.pedidos      enable row level security;
alter table public.pedido_items enable row level security;
alter table public.dominios_permitidos enable row level security;
alter table public.pedido_eventos enable row level security;

revoke all on public.perfiles, public.accesos, public.tiendas, public.productos,
              public.pedidos, public.pedido_items, public.pedido_eventos
from anon, authenticated;

-- ---------- Perfiles: cada quien ve y edita lo suyo; el admin ve todo ----------
grant select on public.perfiles to authenticated;
grant update (nombre, telefono, avatar_url, actualizado_en) on public.perfiles to authenticated;

create policy "perfiles_ver" on public.perfiles
for select to authenticated
using (id = auth.uid() or public.es_admin());

create policy "perfiles_editar" on public.perfiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- ---------- Accesos: solo lectura (se escriben con funciones) ----------
grant select on public.accesos to authenticated;

create policy "accesos_ver" on public.accesos
for select to authenticated
using (usuario_id = auth.uid() or public.es_admin());

-- ---------- Tiendas: públicas; el dueño edita la suya ----------
grant select on public.tiendas to anon, authenticated;
grant update (nombre, descripcion, categoria, telefono, logo_url, activa) on public.tiendas to authenticated;

create policy "tiendas_ver" on public.tiendas
for select to anon, authenticated
using (activa or usuario_id = auth.uid() or public.es_admin());

create policy "tiendas_editar" on public.tiendas
for update to authenticated
using (usuario_id = auth.uid())
with check (usuario_id = auth.uid());

-- ---------- Productos: públicos si están activos; el vendedor gestiona los suyos ----------
grant select on public.productos to anon, authenticated;
grant insert (tienda_id, nombre, categoria, descripcion, imagen, precio, stock, activo)
    on public.productos to authenticated;
grant update (nombre, categoria, descripcion, imagen, precio, stock, activo)
    on public.productos to authenticated;
grant delete on public.productos to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "productos_ver" on public.productos
for select to anon, authenticated
using (
    coalesce(activo, true)
    or public.es_admin()
    or exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid())
);

create policy "productos_crear" on public.productos
for insert to authenticated
with check (
    exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid())
);

create policy "productos_editar" on public.productos
for update to authenticated
using (exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid()))
with check (exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid()));

create policy "productos_eliminar" on public.productos
for delete to authenticated
using (exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid()));

-- ---------- Pedidos: el comprador ve los suyos; se crean con crear_pedido() ----------
grant select on public.pedidos, public.pedido_items to authenticated;

create policy "pedidos_ver" on public.pedidos
for select to authenticated
using (usuario_id = auth.uid() or public.es_admin());

create policy "pedido_items_ver" on public.pedido_items
for select to authenticated
using (
    public.es_admin()
    or exists (select 1 from public.pedidos p where p.id = pedido_id and p.usuario_id = auth.uid())
    or exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid())
);

grant select on public.pedido_eventos to authenticated;

create policy "pedido_eventos_ver" on public.pedido_eventos
for select to authenticated
using (
    public.es_admin()
    or exists (select 1 from public.pedidos p where p.id = pedido_id and p.usuario_id = auth.uid())
    or exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid())
);

-- ---------- Dominios permitidos: cualquiera puede leerlos (la página los muestra) ----------
revoke all on public.dominios_permitidos from anon, authenticated;
grant select on public.dominios_permitidos to anon, authenticated;
drop policy if exists "dominios_ver" on public.dominios_permitidos;
create policy "dominios_ver" on public.dominios_permitidos
for select to anon, authenticated
using (true);

-- ---------- Funciones ----------
revoke all on function public.manejar_nuevo_usuario() from public, anon, authenticated;
revoke all on function public.sincronizar_correo_usuario() from public, anon, authenticated;
revoke all on function public.preparar_producto() from public, anon, authenticated;
revoke all on function public.propagar_nombre_tienda() from public, anon, authenticated;
revoke all on function public.validar_dominio_registro() from public, anon, authenticated;

revoke all on function public.registrar_acceso(text, text) from public, anon;
revoke all on function public.crear_tienda(text, text, text, text) from public, anon;
revoke all on function public.crear_pedido(jsonb, text, text, text, text, text) from public, anon;
revoke all on function public.pedidos_de_mi_tienda() from public, anon;
revoke all on function public.recalcular_estado_pedido(uuid) from public, anon, authenticated;
revoke all on function public.actualizar_estado_pedido(uuid, text, uuid) from public, anon;
revoke all on function public.confirmar_recibido(uuid, uuid) from public, anon;
revoke all on function public.cancelar_pedido(uuid) from public, anon;

grant execute on function public.es_admin() to anon, authenticated;
grant execute on function public.correo_permitido(text) to anon, authenticated;
grant execute on function public.puedo_ingresar() to authenticated;
grant execute on function public.registrar_acceso(text, text) to authenticated;
grant execute on function public.crear_tienda(text, text, text, text) to authenticated;
grant execute on function public.crear_pedido(jsonb, text, text, text, text, text) to authenticated;
grant execute on function public.pedidos_de_mi_tienda() to authenticated;
grant execute on function public.actualizar_estado_pedido(uuid, text, uuid) to authenticated;
grant execute on function public.confirmar_recibido(uuid, uuid) to authenticated;
grant execute on function public.cancelar_pedido(uuid) to authenticated;


-- =====================================================================
-- 15. ALMACENAMIENTO DE IMÁGENES DE PRODUCTOS (bucket público)
--     Cada vendedor sube a la carpeta con su id de usuario.
-- =====================================================================

do $$
begin
    insert into storage.buckets (id, name, public)
    values ('productos', 'productos', true)
    on conflict (id) do update set public = true;

    drop policy if exists "productos_imagenes_ver" on storage.objects;
    drop policy if exists "productos_imagenes_subir" on storage.objects;
    drop policy if exists "productos_imagenes_editar" on storage.objects;
    drop policy if exists "productos_imagenes_borrar" on storage.objects;

    create policy "productos_imagenes_ver" on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'productos');

    create policy "productos_imagenes_subir" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'productos' and (storage.foldername(name))[1] = auth.uid()::text);

    create policy "productos_imagenes_editar" on storage.objects
    for update to authenticated
    using (bucket_id = 'productos' and (storage.foldername(name))[1] = auth.uid()::text);

    create policy "productos_imagenes_borrar" on storage.objects
    for delete to authenticated
    using (bucket_id = 'productos' and (storage.foldername(name))[1] = auth.uid()::text);
exception when others then
    raise notice 'No se configuró el almacenamiento de imágenes: %', sqlerrm;
end $$;


-- =====================================================================
-- 16b. SINCRONIZAR LOS CONTADORES DE ID
--      Si se insertaron filas con el id escrito a mano, el contador
--      automático queda atrás y aparece "duplicate key ... productos_pkey".
-- =====================================================================

do $$
declare
    v_tabla text;
    v_seq text;
    v_max bigint;
begin
    foreach v_tabla in array array['productos', 'accesos', 'pedido_items'] loop
        v_seq := pg_get_serial_sequence('public.' || v_tabla, 'id');
        if v_seq is null then
            continue;
        end if;
        execute format('select coalesce(max(id), 0) from public.%I', v_tabla) into v_max;
        perform setval(v_seq, v_max + 1, false);
    end loop;
exception when others then
    raise notice 'No se sincronizaron los contadores: %', sqlerrm;
end $$;


-- =====================================================================
-- 17. VISTA PARA CONSULTAR LOS USUARIOS REGISTRADOS
--     Supabase → Table Editor → perfiles   (o ejecuta la consulta de abajo)
-- =====================================================================

create or replace view public.resumen_usuarios
with (security_invoker = true)
as
select p.nombre, p.correo, p.telefono, p.rol, p.proveedor,
       p.fecha_registro, p.ultimo_acceso, p.total_accesos, p.acepta_datos
from public.perfiles p
order by p.fecha_registro desc;

revoke all on public.resumen_usuarios from anon;
grant select on public.resumen_usuarios to authenticated;

-- select * from public.resumen_usuarios;

-- Para convertir tu cuenta en administradora (ver todos los usuarios en admin.html):
-- update public.perfiles set rol = 'admin' where correo = 'TU_CORREO@ejemplo.com';

-- =====================================================================
-- FIN
-- =====================================================================
