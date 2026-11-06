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
-- 1a. SEDES DE LA UNIVERSIDAD (editables desde el panel de administración)
-- =====================================================================

create table if not exists public.sedes (
    id uuid primary key default gen_random_uuid(),
    nombre text not null unique,
    ciudad text,
    activa boolean not null default true,
    creado_en timestamptz not null default now()
);

alter table public.sedes add column if not exists direccion text;

-- Sedes de la UMB (umb.edu.co). Se agregan las que falten, sin tocar las que
-- el administrador ya creó o desactivó.
insert into public.sedes (nombre, ciudad, direccion)
select v.nombre, v.ciudad, v.direccion
from (values
    ('Bogotá', 'Bogotá', 'Av. Circunvalar # 60-00 (sede principal)'),
    ('Cajicá', 'Cajicá', null),
    ('Bucaramanga', 'Bucaramanga', 'Calle 33 # 27-12'),
    ('Bucaramanga – Laboratorios', 'Bucaramanga', 'Calle 33 # 27-62'),
    ('UMB Virtual', null, 'Estudiantes en línea (umbvirtual.edu.co)')
) as v(nombre, ciudad, direccion)
where not exists (select 1 from public.sedes s where lower(s.nombre) = lower(v.nombre));

update public.sedes s set direccion = v.direccion
from (values
    ('Bogotá', 'Av. Circunvalar # 60-00 (sede principal)'),
    ('Bucaramanga', 'Calle 33 # 27-12')
) as v(nombre, direccion)
where lower(s.nombre) = lower(v.nombre) and s.direccion is null;


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

-- RF-03: estado de la cuenta.  RF-05: programa y sede.  RF-30: WhatsApp opcional.
alter table public.perfiles add column if not exists estado_cuenta text not null default 'pendiente';
alter table public.perfiles add column if not exists motivo_estado text;
alter table public.perfiles add column if not exists verificado_en timestamptz;
alter table public.perfiles add column if not exists programa text;
alter table public.perfiles add column if not exists sede_id uuid references public.sedes(id) on delete set null;
alter table public.perfiles add column if not exists whatsapp_visible boolean not null default false;
alter table public.perfiles add column if not exists avisos_correo boolean not null default true;
alter table public.perfiles add column if not exists avisos_whatsapp boolean not null default false;
alter table public.perfiles add column if not exists acepta_terminos boolean not null default false;
alter table public.perfiles add column if not exists fecha_aceptacion_terminos timestamptz;

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
        when lower(rol) in ('moderador', 'moderator') then 'moderador'
        else 'cliente'
    end
where rol is null or rol not in ('cliente', 'vendedor', 'admin', 'moderador');

-- Cuentas marcadas antes como "inactivo" pasan a Egresado/Inactivo; los administradores quedan verificados.
update public.perfiles set estado_cuenta = 'egresado' where estado = 'inactivo' and estado_cuenta = 'pendiente';
update public.perfiles set estado_cuenta = 'verificado', verificado_en = coalesce(verificado_en, now())
where rol in ('admin', 'moderador') and estado_cuenta = 'pendiente';
update public.perfiles set estado_cuenta = 'pendiente'
where estado_cuenta is null or estado_cuenta not in ('pendiente', 'verificado', 'suspendido', 'egresado');

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
    add constraint perfiles_rol_check check (rol in ('cliente', 'vendedor', 'admin', 'moderador'));
alter table public.perfiles
    add constraint perfiles_estado_cuenta_check
    check (estado_cuenta in ('pendiente', 'verificado', 'suspendido', 'egresado'));
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

-- RF-09: estado del producto y modalidades de entrega.  RF-25: tamaño para cotizar envíos.
alter table public.productos add column if not exists estado_producto text not null default 'nuevo';
alter table public.productos add column if not exists entrega_en_u boolean not null default true;
alter table public.productos add column if not exists entrega_domicilio boolean not null default false;
alter table public.productos add column if not exists tamano text not null default 'pequeno';
-- RF-06 a RF-08: moderación. Las publicaciones que ya existían quedan aprobadas;
-- las nuevas nacen como borrador.
alter table public.productos add column if not exists estado_moderacion text not null default 'aprobado';
alter table public.productos alter column estado_moderacion set default 'borrador';
alter table public.productos add column if not exists motivo_moderacion text;
alter table public.productos add column if not exists codigo_verificacion text;
alter table public.productos add column if not exists alertas jsonb not null default '[]'::jsonb;
alter table public.productos add column if not exists moderado_por uuid;
alter table public.productos add column if not exists moderado_en timestamptz;
alter table public.productos add column if not exists enviado_revision_en timestamptz;
alter table public.productos add column if not exists actualizado_en timestamptz not null default now();

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'productos_estado_producto_check' and conrelid = 'public.productos'::regclass) then
        alter table public.productos add constraint productos_estado_producto_check check (estado_producto in ('nuevo', 'usado'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'productos_tamano_check' and conrelid = 'public.productos'::regclass) then
        alter table public.productos add constraint productos_tamano_check check (tamano in ('pequeno', 'mediano', 'grande'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'productos_moderacion_check' and conrelid = 'public.productos'::regclass) then
        alter table public.productos add constraint productos_moderacion_check
            check (estado_moderacion in ('borrador', 'pendiente', 'aprobado', 'rechazado'));
    end if;
end $$;
create index if not exists idx_productos_moderacion on public.productos (estado_moderacion);

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

-- Pago en línea (Wompi): estado del pago de cada pedido.
--   no_aplica → el cliente paga contra entrega o por transferencia directa
alter table public.pedidos add column if not exists estado_pago text not null default 'no_aplica';
alter table public.pedidos add column if not exists pago_metodo text;
alter table public.pedidos add column if not exists pagado_en timestamptz;

do $$
begin
    if not exists (select 1 from pg_constraint
                   where conname = 'pedidos_estado_pago_check' and conrelid = 'public.pedidos'::regclass) then
        alter table public.pedidos
            add constraint pedidos_estado_pago_check
            check (estado_pago in ('no_aplica', 'pendiente', 'aprobado', 'rechazado', 'anulado', 'error'));
    end if;
end $$;

-- Cada intento de pago en Wompi (un pedido puede reintentar si el pago se rechaza).
create table if not exists public.pedido_pagos (
    referencia text primary key,
    pedido_id uuid not null references public.pedidos(id) on delete cascade,
    monto_centavos bigint not null check (monto_centavos > 0),
    estado text not null default 'pendiente'
        check (estado in ('pendiente', 'aprobado', 'rechazado', 'anulado', 'error')),
    transaccion_id text,
    metodo text,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);

create index if not exists idx_pedido_pagos_pedido on public.pedido_pagos (pedido_id, creado_en desc);


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
        where id = auth.uid() and rol = 'admin' and estado_cuenta not in ('suspendido', 'egresado')
    );
$$;

-- Administradores y moderadores (revisan verificaciones, publicaciones, reportes y disputas).
create or replace function public.es_moderador()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.perfiles
        where id = auth.uid() and rol in ('admin', 'moderador')
          and estado_cuenta not in ('suspendido', 'egresado')
    );
$$;

-- Estado de la cuenta del usuario actual.
create or replace function public.mi_estado_cuenta()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select estado_cuenta from public.perfiles where id = auth.uid();
$$;

-- ¿La tienda pertenece a un vendedor que puede vender? (no suspendido ni egresado)
create or replace function public.tienda_activa(p_tienda uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select p_tienda is null or exists (
        select 1 from public.tiendas t
        join public.perfiles p on p.id = t.usuario_id
        where t.id = p_tienda and t.activa and p.estado_cuenta not in ('suspendido', 'egresado')
    );
$$;

-- RNF-02: si el usuario activó la verificación en dos pasos, exigirla (nivel aal2).
create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
        or not exists (
            select 1 from auth.mfa_factors f
            where f.user_id = auth.uid() and f.status = 'verified'
        );
$$;

-- RF-40: registro de auditoría.
create table if not exists public.auditoria (
    id bigint generated by default as identity primary key,
    actor_id uuid references public.perfiles(id) on delete set null,
    actor_nombre text,
    accion text not null,
    entidad text not null,
    entidad_id text,
    detalle jsonb,
    creado_en timestamptz not null default now()
);
create index if not exists idx_auditoria_fecha on public.auditoria (creado_en desc);

create or replace function public.auditar(p_accion text, p_entidad text, p_entidad_id text, p_detalle jsonb default null)
returns void
language sql
security definer
set search_path = ''
as $$
    insert into public.auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
    values (
        auth.uid(),
        (select nombre from public.perfiles where id = auth.uid()),
        p_accion, p_entidad, p_entidad_id, p_detalle
    );
$$;

-- RF-32: notificaciones dentro de la plataforma (y luego por correo / WhatsApp).
create table if not exists public.notificaciones (
    id bigint generated by default as identity primary key,
    usuario_id uuid not null references public.perfiles(id) on delete cascade,
    tipo text not null default 'general',
    titulo text not null,
    cuerpo text,
    enlace text,
    leida boolean not null default false,
    enviada_correo timestamptz,
    enviada_whatsapp timestamptz,
    creado_en timestamptz not null default now()
);
create index if not exists idx_notificaciones_usuario on public.notificaciones (usuario_id, leida, creado_en desc);

create or replace function public.notificar(
    p_usuario uuid, p_tipo text, p_titulo text, p_cuerpo text default null, p_enlace text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
    insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, enlace)
    select p_usuario, p_tipo, left(p_titulo, 140), left(p_cuerpo, 600), p_enlace
    where p_usuario is not null;
$$;

create or replace function public.notificar_moderadores(
    p_tipo text, p_titulo text, p_cuerpo text default null, p_enlace text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
    insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, enlace)
    select id, p_tipo, left(p_titulo, 140), left(p_cuerpo, 600), p_enlace
    from public.perfiles
    where rol in ('admin', 'moderador') and estado_cuenta not in ('suspendido', 'egresado');
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
    v_terminos boolean := coalesce(v_meta ->> 'acepta_terminos', v_meta ->> 'acepta_datos', 'false') = 'true';
begin
    insert into public.perfiles (
        id, nombre, correo, telefono, avatar_url, rol, proveedor,
        acepta_datos, fecha_aceptacion_datos, fecha_registro,
        acepta_terminos, fecha_aceptacion_terminos
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
        coalesce(new.created_at, now()),
        v_terminos or v_proveedor <> 'email',
        case when v_terminos or v_proveedor <> 'email' then now() end
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

    -- RF-04: solo los usuarios verificados pueden vender.
    if coalesce(public.mi_estado_cuenta(), '') <> 'verificado' then
        raise exception 'Primero verifica tu identidad para poder vender';
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

    if tg_op = 'UPDATE' then
        new.actualizado_en := now();
        -- RF-08: si el vendedor cambia el contenido de una publicación aprobada,
        -- vuelve a moderación (precio, cantidad y visibilidad no la afectan).
        if old.estado_moderacion = 'aprobado'
           and new.estado_moderacion = old.estado_moderacion
           and not public.es_moderador()
           and (new.nombre is distinct from old.nombre
                or new.descripcion is distinct from old.descripcion
                or new.categoria is distinct from old.categoria
                or new.estado_producto is distinct from old.estado_producto) then
            new.estado_moderacion := 'pendiente';
            new.enviado_revision_en := now();
        end if;
    end if;
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

    if public.mi_estado_cuenta() in ('suspendido', 'egresado') then
        raise exception 'Tu cuenta no está habilitada para comprar. Escribe a soporte.';
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

    if coalesce(p_metodo_pago, '') not in ('contraentrega', 'transferencia', 'nequi', 'wompi') then
        raise exception 'Método de pago no válido';
    end if;

    insert into public.pedidos (
        usuario_id, nombre_entrega, telefono_entrega, direccion_entrega, metodo_pago, notas, estado_pago
    )
    values (
        v_usuario,
        left(trim(p_nombre), 120),
        left(trim(p_telefono), 20),
        left(trim(p_direccion), 300),
        p_metodo_pago,
        left(nullif(trim(p_notas), ''), 500),
        case when p_metodo_pago = 'wompi' then 'pendiente' else 'no_aplica' end
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
          and p.estado_moderacion = 'aprobado'
          and public.tienda_activa(p.tienda_id)
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

    if p_estado <> 'cancelado' and exists (
        select 1 from public.pedidos
        where id = p_pedido and metodo_pago = 'wompi' and estado_pago <> 'aprobado'
    ) then
        raise exception 'Espera a que el pago en línea del cliente sea aprobado';
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

    if exists (select 1 from public.pedidos where id = p_pedido and estado_pago = 'aprobado') then
        raise exception 'Ya pagaste este pedido en línea. Escríbele al vendedor para acordar la cancelación y la devolución.';
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
    entrega_confirmada_por text,
    estado_pago text
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
            order by e.creado_en desc limit 1),
           p.estado_pago
    from public.pedido_items i
    join public.pedidos p on p.id = i.pedido_id
    join public.tiendas t on t.id = i.tienda_id
    where t.usuario_id = auth.uid()
    order by p.creado_en desc
    limit 300;
$$;


-- =====================================================================
-- 13b. PAGOS EN LÍNEA CON WOMPI
--      La Edge Function "pagos-wompi" llama a estas funciones:
--        preparar_pago()           → con la sesión del comprador
--        registrar_resultado_pago()→ con la clave de servicio (avisos de Wompi)
-- =====================================================================

-- Crea un intento de pago y devuelve los datos para firmarlo.
create or replace function public.preparar_pago(p_pedido uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usuario uuid := auth.uid();
    v_ped record;
    v_monto numeric;
    v_centavos bigint;
    v_intento integer;
    v_ref text;
begin
    select p.id, p.codigo, p.estado, p.estado_pago, p.metodo_pago, p.envio,
           p.nombre_entrega, p.telefono_entrega, pf.correo
    into v_ped
    from public.pedidos p
    left join public.perfiles pf on pf.id = p.usuario_id
    where p.id = p_pedido and p.usuario_id = v_usuario;

    if not found then
        raise exception 'Este pedido no es tuyo';
    end if;
    if v_ped.metodo_pago <> 'wompi' then
        raise exception 'Este pedido no se paga en línea';
    end if;
    if v_ped.estado = 'cancelado' then
        raise exception 'Este pedido está cancelado';
    end if;
    if v_ped.estado_pago = 'aprobado' then
        raise exception 'Este pedido ya está pagado';
    end if;

    -- Total actual: productos no cancelados + envío.
    select coalesce(sum(precio * cantidad), 0) into v_monto
    from public.pedido_items
    where pedido_id = p_pedido and estado <> 'cancelado';

    v_centavos := round((v_monto + coalesce(v_ped.envio, 0)) * 100)::bigint;
    if v_centavos <= 0 then
        raise exception 'El pedido no tiene valor por pagar';
    end if;

    select count(*) + 1 into v_intento from public.pedido_pagos where pedido_id = p_pedido;
    v_ref := v_ped.codigo || '-' || v_intento;

    insert into public.pedido_pagos (referencia, pedido_id, monto_centavos)
    values (v_ref, p_pedido, v_centavos);

    update public.pedidos set estado_pago = 'pendiente' where id = p_pedido;

    return jsonb_build_object(
        'referencia', v_ref,
        'monto_centavos', v_centavos,
        'correo', v_ped.correo,
        'nombre', v_ped.nombre_entrega,
        'telefono', v_ped.telefono_entrega
    );
end;
$$;

-- Registra lo que Wompi informa sobre una transacción (idempotente).
create or replace function public.registrar_resultado_pago(
    p_referencia text,
    p_estado_wompi text,
    p_transaccion text,
    p_metodo text,
    p_monto_centavos bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_pago record;
    v_estado text;
begin
    select * into v_pago from public.pedido_pagos where referencia = p_referencia for update;
    if not found then
        return 'referencia_desconocida';
    end if;

    v_estado := case upper(coalesce(p_estado_wompi, ''))
        when 'APPROVED' then 'aprobado'
        when 'DECLINED' then 'rechazado'
        when 'VOIDED' then 'anulado'
        when 'ERROR' then 'error'
        else 'pendiente'
    end;

    -- Por seguridad: el monto pagado debe ser exactamente el esperado.
    if v_estado = 'aprobado' and p_monto_centavos is distinct from v_pago.monto_centavos then
        v_estado := 'error';
    end if;

    update public.pedido_pagos
    set estado = v_estado,
        transaccion_id = coalesce(p_transaccion, transaccion_id),
        metodo = coalesce(p_metodo, metodo),
        actualizado_en = now()
    where referencia = p_referencia;

    if v_estado = 'aprobado' then
        if exists (select 1 from public.pedidos where id = v_pago.pedido_id and estado_pago <> 'aprobado') then
            update public.pedidos
            set estado_pago = 'aprobado', pagado_en = now(), pago_metodo = p_metodo
            where id = v_pago.pedido_id;

            -- Avisar a cada tienda del pedido (aparece en el historial).
            insert into public.pedido_eventos (pedido_id, tienda_id, estado, actor)
            select distinct v_pago.pedido_id, tienda_id, 'pagado', 'sistema'
            from public.pedido_items where pedido_id = v_pago.pedido_id;
        end if;
    elsif v_estado <> 'pendiente' then
        update public.pedidos
        set estado_pago = v_estado
        where id = v_pago.pedido_id and estado_pago <> 'aprobado';
    end if;

    return v_estado;
end;
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
          and tablename in ('perfiles', 'accesos', 'tiendas', 'productos', 'pedidos', 'pedido_items', 'pedido_eventos', 'pedido_pagos')
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
alter table public.pedido_pagos enable row level security;

revoke all on public.perfiles, public.accesos, public.tiendas, public.productos,
              public.pedidos, public.pedido_items, public.pedido_eventos, public.pedido_pagos
from anon, authenticated;

-- ---------- Perfiles: cada quien ve y edita lo suyo; el admin ve todo ----------
grant select on public.perfiles to authenticated;
grant update (nombre, telefono, avatar_url, actualizado_en, programa, sede_id,
               whatsapp_visible, avisos_correo, avisos_whatsapp) on public.perfiles to authenticated;

create policy "perfiles_ver" on public.perfiles
for select to authenticated
using (id = auth.uid() or public.es_moderador());

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
-- Las publicaciones se crean con nueva_publicacion() y se envían con enviar_a_revision().
grant update (nombre, categoria, descripcion, precio, stock, activo,
              estado_producto, entrega_en_u, entrega_domicilio, tamano)
    on public.productos to authenticated;
grant delete on public.productos to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "productos_ver" on public.productos
for select to anon, authenticated
using (
    (coalesce(activo, true) and estado_moderacion = 'aprobado' and public.tienda_activa(tienda_id))
    or public.es_moderador()
    or exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid())
);

-- RF-04: solo vendedores verificados publican.  RNF-02: con 2FA si lo activaron.
create policy "productos_crear" on public.productos
for insert to authenticated
with check (
    exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid())
    and public.mi_estado_cuenta() = 'verificado'
    and public.mfa_ok()
);

create policy "productos_editar" on public.productos
for update to authenticated
using (exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid()))
with check (
    exists (select 1 from public.tiendas t where t.id = tienda_id and t.usuario_id = auth.uid())
    and public.mi_estado_cuenta() = 'verificado'
    and public.mfa_ok()
);

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

-- Intentos de pago: el comprador ve los de sus pedidos (se escriben solo desde el servidor).
grant select on public.pedido_pagos to authenticated;

create policy "pedido_pagos_ver" on public.pedido_pagos
for select to authenticated
using (
    public.es_admin()
    or exists (select 1 from public.pedidos p where p.id = pedido_id and p.usuario_id = auth.uid())
);

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
revoke all on function public.preparar_pago(uuid) from public, anon;
revoke all on function public.registrar_resultado_pago(text, text, text, text, bigint) from public, anon, authenticated;

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
grant execute on function public.preparar_pago(uuid) to authenticated;
do $$
begin
    -- Solo el servidor (Edge Function con la clave de servicio) registra resultados de Wompi.
    execute 'grant execute on function public.registrar_resultado_pago(text, text, text, text, bigint) to service_role';
exception when undefined_object then
    raise notice 'Rol service_role no encontrado (normal fuera de Supabase).';
end $$;


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


-- =====================================================================
-- 18. CUENTAS Y VERIFICACIÓN DE IDENTIDAD  (RF-01 a RF-05, RF-14, RF-37, RF-40)
-- =====================================================================

-- RF-33 (se usa en el perfil del vendedor): calificaciones mutuas tras cada compra.
create table if not exists public.calificaciones (
    id bigint generated by default as identity primary key,
    pedido_id uuid not null references public.pedidos(id) on delete cascade,
    tienda_id uuid references public.tiendas(id) on delete set null,
    autor_id uuid not null references public.perfiles(id) on delete cascade,
    calificado_id uuid not null references public.perfiles(id) on delete cascade,
    rol_calificado text not null check (rol_calificado in ('vendedor', 'comprador')),
    estrellas integer not null check (estrellas between 1 and 5),
    comentario text check (char_length(comentario) <= 500),
    creado_en timestamptz not null default now(),
    unique (pedido_id, tienda_id, autor_id)
);
create index if not exists idx_calificaciones_calificado on public.calificaciones (calificado_id, rol_calificado);

-- RF-02: solicitudes de verificación (carné, documento y selfie).
create table if not exists public.verificaciones (
    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references public.perfiles(id) on delete cascade,
    carne_ruta text not null,
    documento_ruta text not null,
    selfie_ruta text not null,
    programa text,
    sede_id uuid references public.sedes(id) on delete set null,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
    motivo text,
    revisado_por uuid references public.perfiles(id) on delete set null,
    revisado_en timestamptz,
    creado_en timestamptz not null default now()
);
create index if not exists idx_verificaciones_estado on public.verificaciones (estado, creado_en);

create or replace function public.solicitar_verificacion(
    p_carne text, p_documento text, p_selfie text, p_programa text default null, p_sede uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usuario uuid := auth.uid();
    v_estado text := public.mi_estado_cuenta();
    v_id uuid;
    v_prefijo text := auth.uid()::text || '/';
begin
    if v_usuario is null then raise exception 'Debes iniciar sesión'; end if;
    if v_estado = 'verificado' then raise exception 'Tu cuenta ya está verificada'; end if;
    if v_estado in ('suspendido', 'egresado') then raise exception 'Tu cuenta no puede solicitar verificación. Escribe a soporte.'; end if;
    if exists (select 1 from public.verificaciones where usuario_id = v_usuario and estado = 'pendiente') then
        raise exception 'Ya tienes una solicitud en revisión';
    end if;
    -- Las fotos deben estar en la carpeta privada del propio usuario.
    if left(coalesce(p_carne, ''), length(v_prefijo)) <> v_prefijo
       or left(coalesce(p_documento, ''), length(v_prefijo)) <> v_prefijo
       or left(coalesce(p_selfie, ''), length(v_prefijo)) <> v_prefijo then
        raise exception 'Faltan las fotos de verificación';
    end if;

    insert into public.verificaciones (usuario_id, carne_ruta, documento_ruta, selfie_ruta, programa, sede_id)
    values (v_usuario, p_carne, p_documento, p_selfie, left(nullif(trim(p_programa), ''), 120), p_sede)
    returning id into v_id;

    perform public.notificar_moderadores('verificacion', 'Nueva solicitud de verificación',
        (select nombre from public.perfiles where id = v_usuario) || ' envió sus documentos.', 'admin.html#verificaciones');
    return v_id;
end;
$$;

create or replace function public.revisar_verificacion(p_id uuid, p_aprobar boolean, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v record;
begin
    if not public.es_moderador() then raise exception 'Solo moderadores'; end if;
    select * into v from public.verificaciones where id = p_id for update;
    if not found then raise exception 'Solicitud no encontrada'; end if;
    if v.estado <> 'pendiente' then raise exception 'Esta solicitud ya fue revisada'; end if;
    if not p_aprobar and length(trim(coalesce(p_motivo, ''))) < 5 then
        raise exception 'Escribe el motivo del rechazo';
    end if;

    update public.verificaciones
    set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
        motivo = nullif(trim(p_motivo), ''), revisado_por = auth.uid(), revisado_en = now()
    where id = p_id;

    if p_aprobar then
        update public.perfiles
        set estado_cuenta = 'verificado', verificado_en = now(), motivo_estado = null,
            programa = coalesce(v.programa, programa), sede_id = coalesce(v.sede_id, sede_id)
        where id = v.usuario_id and estado_cuenta = 'pendiente';
        perform public.notificar(v.usuario_id, 'verificacion', '¡Tu cuenta fue verificada!',
            'Ya puedes abrir tu tienda y publicar productos.', 'vender.html');
    else
        perform public.notificar(v.usuario_id, 'verificacion', 'Tu verificación fue rechazada',
            trim(p_motivo) || ' Puedes enviar los documentos de nuevo.', 'verificacion.html');
    end if;

    perform public.auditar(case when p_aprobar then 'aprobar_verificacion' else 'rechazar_verificacion' end,
        'verificacion', p_id::text, jsonb_build_object('usuario', v.usuario_id, 'motivo', p_motivo));
    return case when p_aprobar then 'aprobada' else 'rechazada' end;
end;
$$;

-- RF-03 / RF-37: cambiar el estado de una cuenta (suspender, reactivar, egresado).
create or replace function public.cambiar_estado_cuenta(p_usuario uuid, p_estado text, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rol text;
begin
    if not public.es_moderador() then raise exception 'Solo moderadores'; end if;
    if p_estado not in ('pendiente', 'verificado', 'suspendido', 'egresado') then raise exception 'Estado no válido'; end if;
    if p_usuario = auth.uid() then raise exception 'No puedes cambiar tu propia cuenta'; end if;
    select rol into v_rol from public.perfiles where id = p_usuario;
    if not found then raise exception 'Usuario no encontrado'; end if;
    if v_rol in ('admin', 'moderador') and not public.es_admin() then
        raise exception 'Solo un administrador puede cambiar a otro moderador';
    end if;
    if p_estado = 'suspendido' and length(trim(coalesce(p_motivo, ''))) < 5 then
        raise exception 'Escribe el motivo de la suspensión';
    end if;

    update public.perfiles
    set estado_cuenta = p_estado, motivo_estado = nullif(trim(p_motivo), ''),
        verificado_en = case when p_estado = 'verificado' then coalesce(verificado_en, now()) else verificado_en end,
        actualizado_en = now()
    where id = p_usuario;

    perform public.notificar(p_usuario, 'cuenta',
        case p_estado when 'suspendido' then 'Tu cuenta fue suspendida'
                      when 'verificado' then 'Tu cuenta está verificada'
                      when 'egresado' then 'Tu cuenta quedó inactiva'
                      else 'El estado de tu cuenta cambió' end,
        p_motivo, 'mi-cuenta.html');
    perform public.auditar('cambiar_estado_cuenta', 'perfil', p_usuario::text,
        jsonb_build_object('estado', p_estado, 'motivo', p_motivo));
    return p_estado;
end;
$$;

-- Cambiar el rol (solo administradores): cliente, vendedor, moderador o admin.
create or replace function public.cambiar_rol(p_usuario uuid, p_rol text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.es_admin() then raise exception 'Solo administradores'; end if;
    if p_rol not in ('cliente', 'vendedor', 'moderador', 'admin') then raise exception 'Rol no válido'; end if;
    if p_usuario = auth.uid() then raise exception 'No puedes cambiar tu propio rol'; end if;
    update public.perfiles
    set rol = p_rol, actualizado_en = now(),
        estado_cuenta = case when p_rol in ('admin', 'moderador') and estado_cuenta = 'pendiente' then 'verificado' else estado_cuenta end
    where id = p_usuario;
    if not found then raise exception 'Usuario no encontrado'; end if;
    perform public.auditar('cambiar_rol', 'perfil', p_usuario::text, jsonb_build_object('rol', p_rol));
    return p_rol;
end;
$$;

-- RF-05: perfil público del vendedor (sin correo ni teléfono).
create or replace function public.perfil_publico_tienda(p_tienda uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'tienda_id', t.id,
        'tienda', t.nombre,
        'descripcion', t.descripcion,
        'categoria', t.categoria,
        'vendedor', split_part(p.nombre, ' ', 1) || coalesce(' ' || left(nullif(split_part(p.nombre, ' ', 2), ''), 1) || '.', ''),
        'verificado', p.estado_cuenta = 'verificado',
        'programa', p.programa,
        'sede', s.nombre,
        'miembro_desde', p.fecha_registro,
        'ventas_completadas', (
            select count(distinct i.pedido_id) from public.pedido_items i
            where i.tienda_id = t.id and i.estado = 'entregado'),
        'calificacion', (
            select round(avg(c.estrellas)::numeric, 1) from public.calificaciones c
            where c.calificado_id = p.id and c.rol_calificado = 'vendedor'),
        'total_calificaciones', (
            select count(*) from public.calificaciones c
            where c.calificado_id = p.id and c.rol_calificado = 'vendedor')
    )
    from public.tiendas t
    join public.perfiles p on p.id = t.usuario_id
    left join public.sedes s on s.id = p.sede_id
    where t.id = p_tienda and t.activa and p.estado_cuenta not in ('suspendido', 'egresado');
$$;

-- Resumen público de todas las tiendas activas (para tarjetas e insignias del catálogo).
create or replace function public.tiendas_publicas()
returns table (tienda_id uuid, verificado boolean, sede text, calificacion numeric, total_calificaciones bigint, ventas bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select t.id, p.estado_cuenta = 'verificado', s.nombre,
           (select round(avg(c.estrellas)::numeric, 1) from public.calificaciones c
             where c.calificado_id = p.id and c.rol_calificado = 'vendedor'),
           (select count(*) from public.calificaciones c
             where c.calificado_id = p.id and c.rol_calificado = 'vendedor'),
           (select count(distinct i.pedido_id) from public.pedido_items i
             where i.tienda_id = t.id and i.estado = 'entregado')
    from public.tiendas t
    join public.perfiles p on p.id = t.usuario_id
    left join public.sedes s on s.id = p.sede_id
    where t.activa and p.estado_cuenta not in ('suspendido', 'egresado');
$$;

-- RF-14: favoritos guardados en la cuenta.
create table if not exists public.favoritos (
    usuario_id uuid not null references public.perfiles(id) on delete cascade,
    producto_id text not null,
    creado_en timestamptz not null default now(),
    primary key (usuario_id, producto_id)
);

create or replace function public.marcar_notificaciones_leidas(p_ids bigint[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.notificaciones set leida = true
    where usuario_id = auth.uid() and not leida and (p_ids is null or id = any(p_ids));
$$;

-- ---------- Seguridad de las tablas nuevas ----------
alter table public.sedes enable row level security;
alter table public.auditoria enable row level security;
alter table public.notificaciones enable row level security;
alter table public.verificaciones enable row level security;
alter table public.favoritos enable row level security;
alter table public.calificaciones enable row level security;

revoke all on public.sedes, public.auditoria, public.notificaciones, public.verificaciones,
              public.favoritos, public.calificaciones from anon, authenticated;

grant select on public.sedes to anon, authenticated;
grant insert, update, delete on public.sedes to authenticated;
drop policy if exists "sedes_ver" on public.sedes;
drop policy if exists "sedes_admin" on public.sedes;
create policy "sedes_ver" on public.sedes for select to anon, authenticated using (activa or public.es_admin());
create policy "sedes_admin" on public.sedes for all to authenticated using (public.es_admin()) with check (public.es_admin());

grant select on public.auditoria to authenticated;
drop policy if exists "auditoria_ver" on public.auditoria;
create policy "auditoria_ver" on public.auditoria for select to authenticated using (public.es_admin());

grant select on public.notificaciones to authenticated;
drop policy if exists "notificaciones_ver" on public.notificaciones;
create policy "notificaciones_ver" on public.notificaciones for select to authenticated using (usuario_id = auth.uid());

grant select on public.verificaciones to authenticated;
drop policy if exists "verificaciones_ver" on public.verificaciones;
create policy "verificaciones_ver" on public.verificaciones for select to authenticated
using (usuario_id = auth.uid() or public.es_moderador());

grant select, insert, delete on public.favoritos to authenticated;
drop policy if exists "favoritos_propios" on public.favoritos;
create policy "favoritos_propios" on public.favoritos for all to authenticated
using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

grant select on public.calificaciones to anon, authenticated;
drop policy if exists "calificaciones_ver" on public.calificaciones;
create policy "calificaciones_ver" on public.calificaciones for select to anon, authenticated using (true);

-- Funciones internas: nadie las llama directamente desde el navegador.
revoke all on function public.auditar(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.notificar(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notificar_moderadores(text, text, text, text) from public, anon, authenticated;

grant execute on function public.es_moderador() to anon, authenticated;
grant execute on function public.mi_estado_cuenta() to authenticated;
grant execute on function public.tienda_activa(uuid) to anon, authenticated;
grant execute on function public.mfa_ok() to authenticated;
revoke all on function public.solicitar_verificacion(text, text, text, text, uuid) from public, anon;
grant execute on function public.solicitar_verificacion(text, text, text, text, uuid) to authenticated;
revoke all on function public.revisar_verificacion(uuid, boolean, text) from public, anon;
grant execute on function public.revisar_verificacion(uuid, boolean, text) to authenticated;
revoke all on function public.cambiar_estado_cuenta(uuid, text, text) from public, anon;
grant execute on function public.cambiar_estado_cuenta(uuid, text, text) to authenticated;
revoke all on function public.cambiar_rol(uuid, text) from public, anon;
grant execute on function public.cambiar_rol(uuid, text) to authenticated;
grant execute on function public.perfil_publico_tienda(uuid) to anon, authenticated;
grant execute on function public.tiendas_publicas() to anon, authenticated;
revoke all on function public.marcar_notificaciones_leidas(bigint[]) from public, anon;
grant execute on function public.marcar_notificaciones_leidas(bigint[]) to authenticated;

-- RNF-03: documentos de identidad en un almacén PRIVADO (cifrado en reposo por Supabase).
-- Cada usuario sube a su carpeta; solo él y los moderadores pueden verlos.
do $$
begin
    insert into storage.buckets (id, name, public)
    values ('verificaciones', 'verificaciones', false)
    on conflict (id) do update set public = false;

    drop policy if exists "verificaciones_subir" on storage.objects;
    drop policy if exists "verificaciones_ver" on storage.objects;

    create policy "verificaciones_subir" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'verificaciones' and (storage.foldername(name))[1] = auth.uid()::text);

    create policy "verificaciones_ver" on storage.objects
    for select to authenticated
    using (bucket_id = 'verificaciones'
           and ((storage.foldername(name))[1] = auth.uid()::text or public.es_moderador()));
exception when others then
    raise notice 'No se configuró el almacén de verificaciones: %', sqlerrm;
end $$;


-- =====================================================================
-- 19. PUBLICACIONES Y MODERACIÓN  (RF-06 a RF-11, RF-36, RF-38)
-- =====================================================================

-- ---------- Configuración general (editable por el administrador) ----------
create table if not exists public.configuracion (
    clave text primary key,
    valor jsonb not null,
    descripcion text
);
insert into public.configuracion (clave, valor, descripcion) values
    ('reportes_para_suspender', '3', 'Reportes confirmados para suspender automáticamente a un vendedor (RF-36)'),
    ('calificacion_minima', '2.5', 'Promedio mínimo de estrellas; por debajo se suspende al vendedor (RF-36)'),
    ('min_calificaciones_suspension', '5', 'Calificaciones mínimas antes de aplicar la regla de promedio (RF-36)'),
    ('plazo_despacho_horas', '48', 'Horas que tiene el vendedor para despachar un envío (RF-27)'),
    ('dias_liberacion_pago', '3', 'Días sin reclamos tras la entrega para liberar el pago al vendedor (RF-17)'),
    ('dias_confirmacion_automatica', '7', 'Días tras el envío para dar el pedido por entregado si el comprador no responde'),
    ('comision_porcentaje', '0', 'Porcentaje que retiene la plataforma de cada venta en línea'),
    ('min_fotos_publicacion', '3', 'Fotos mínimas por publicación (RF-06)')
on conflict (clave) do nothing;

create or replace function public.config_num(p_clave text, p_defecto numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((select (valor #>> '{}')::numeric from public.configuracion where clave = p_clave), p_defecto);
$$;

-- ---------- Categorías (RF-38) ----------
create table if not exists public.categorias (
    nombre text primary key,
    icono text not null default '✨',
    orden integer not null default 100,
    activa boolean not null default true
);
insert into public.categorias (nombre, icono, orden) values
    ('Alimentos y bebidas', '☕', 1), ('Artesanías', '🏺', 2), ('Moda y accesorios', '🎒', 3),
    ('Tecnología', '💻', 4), ('Libros y útiles', '📚', 5), ('Hogar', '🕯️', 6),
    ('Belleza natural', '🌿', 7), ('Servicios', '🛠️', 8), ('Otros', '✨', 99)
on conflict (nombre) do nothing;

-- ---------- Productos prohibidos (RF-10) ----------
create table if not exists public.palabras_prohibidas (
    palabra text primary key,
    motivo text not null
);
insert into public.palabras_prohibidas (palabra, motivo) values
    ('arma', 'Armas'), ('pistola', 'Armas'), ('revolver', 'Armas'), ('municion', 'Armas'), ('navaja', 'Armas'),
    ('puñal', 'Armas'), ('taser', 'Armas'), ('gas pimienta', 'Armas'),
    ('marihuana', 'Sustancias'), ('cannabis', 'Sustancias'), ('cocaina', 'Sustancias'), ('perico', 'Sustancias'),
    ('tusi', 'Sustancias'), ('extasis', 'Sustancias'), ('lsd', 'Sustancias'), ('popper', 'Sustancias'), ('cripy', 'Sustancias'),
    ('alcohol', 'Alcohol'), ('licor', 'Alcohol'), ('aguardiente', 'Alcohol'), ('cerveza', 'Alcohol'), ('ron', 'Alcohol'),
    ('whisky', 'Alcohol'), ('vodka', 'Alcohol'), ('tequila', 'Alcohol'), ('vino', 'Alcohol'),
    ('medicamento', 'Medicamentos'), ('pastillas', 'Medicamentos'), ('antibiotico', 'Medicamentos'),
    ('clonazepam', 'Medicamentos'), ('rivotril', 'Medicamentos'), ('viagra', 'Medicamentos'), ('tramadol', 'Medicamentos'),
    ('hago tareas', 'Trabajos académicos'), ('tareas resueltas', 'Trabajos académicos'), ('taller resuelto', 'Trabajos académicos'),
    ('parcial resuelto', 'Trabajos académicos'), ('examen resuelto', 'Trabajos académicos'), ('presento parciales', 'Trabajos académicos'),
    ('trabajo de grado', 'Trabajos académicos'), ('hago tu tesis', 'Trabajos académicos'), ('quices', 'Trabajos académicos'),
    ('replica', 'Falsificados'), ('imitacion', 'Falsificados'), ('copia aaa', 'Falsificados'), ('clon', 'Falsificados'),
    ('falsificado', 'Falsificados'), ('pirata', 'Falsificados'), ('1.1', 'Falsificados')
on conflict (palabra) do nothing;

create or replace function public.normalizar_texto(p text)
returns text
language sql
immutable
set search_path = ''
as $$
    select lower(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
$$;

-- Devuelve los motivos de prohibición encontrados en el texto (palabras completas).
create or replace function public.motivos_prohibidos(p_texto text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(array_agg(distinct pp.motivo), '{}')
    from public.palabras_prohibidas pp
    where public.normalizar_texto(p_texto) ~ ('(^|[^a-z0-9])' || regexp_replace(public.normalizar_texto(pp.palabra), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '([^a-z0-9]|$)');
$$;

-- ---------- Fotos de cada publicación (RF-06, RF-07) ----------
create table if not exists public.producto_fotos (
    id bigint generated by default as identity primary key,
    producto_id bigint not null,
    ruta text not null,
    url text not null,
    orden integer not null default 0,
    huella text,           -- huella perceptual (dHash de 64 bits en hexadecimal)
    con_codigo boolean not null default false,
    creado_en timestamptz not null default now()
);
create index if not exists idx_producto_fotos_producto on public.producto_fotos (producto_id, orden);
create index if not exists idx_producto_fotos_huella on public.producto_fotos (huella);

-- Distancia de Hamming entre dos huellas de 64 bits (0 = idénticas).
create or replace function public.distancia_huella(a text, b text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case when a ~ '^[0-9a-f]{16}$' and b ~ '^[0-9a-f]{16}$'
                then bit_count(('x' || a)::bit(64) # ('x' || b)::bit(64))::integer end;
$$;

create or replace function public.es_dueno_producto(p_producto bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.productos p join public.tiendas t on t.id = p.tienda_id
        where p.id = p_producto and t.usuario_id = auth.uid()
    );
$$;

-- RF-06: crea un borrador con su código de verificación (o reutiliza un borrador vacío).
create or replace function public.nueva_publicacion()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_tienda record;
    v_id bigint;
    v_codigo text;
begin
    if coalesce(public.mi_estado_cuenta(), '') <> 'verificado' then
        raise exception 'Primero verifica tu identidad para poder vender';
    end if;
    if not public.mfa_ok() then
        raise exception 'Completa la verificación en dos pasos para publicar';
    end if;
    select id, nombre into v_tienda from public.tiendas where usuario_id = auth.uid();
    if not found then raise exception 'Primero crea tu tienda'; end if;

    select p.id, p.codigo_verificacion into v_id, v_codigo
    from public.productos p
    where p.tienda_id = v_tienda.id and p.estado_moderacion = 'borrador'
      and not exists (select 1 from public.producto_fotos f where f.producto_id = p.id)
    order by p.creado_en desc limit 1;

    if v_id is null then
        v_codigo := 'UMB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
        insert into public.productos (tienda_id, nombre, precio, stock, activo, estado_moderacion, codigo_verificacion, categoria)
        values (v_tienda.id, 'Nueva publicación', 0, 0, false, 'borrador', v_codigo, 'Otros')
        returning id into v_id;
    end if;
    return jsonb_build_object('id', v_id, 'codigo', v_codigo);
end;
$$;

-- RF-06 a RF-10: valida y envía la publicación a moderación.
create or replace function public.enviar_a_revision(p_producto bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v record;
    v_fotos integer;
    v_con_codigo integer;
    v_motivos text[];
    v_alertas jsonb := '[]'::jsonb;
    v_min integer := public.config_num('min_fotos_publicacion', 3)::integer;
begin
    if not public.es_dueno_producto(p_producto) then raise exception 'Esta publicación no es tuya'; end if;
    if coalesce(public.mi_estado_cuenta(), '') <> 'verificado' then raise exception 'Tu cuenta debe estar verificada para publicar'; end if;
    if not public.mfa_ok() then raise exception 'Completa la verificación en dos pasos para publicar'; end if;

    select * into v from public.productos where id = p_producto for update;

    -- RF-09: campos obligatorios
    if length(trim(coalesce(v.nombre, ''))) < 3 or v.nombre = 'Nueva publicación' then raise exception 'Escribe el nombre del producto'; end if;
    if length(trim(coalesce(v.descripcion, ''))) < 20 then raise exception 'La descripción debe tener al menos 20 caracteres'; end if;
    if v.precio <= 0 then raise exception 'Escribe un precio válido'; end if;
    if v.stock < 1 then raise exception 'Indica la cantidad disponible'; end if;
    if not exists (select 1 from public.categorias where nombre = v.categoria and activa) then raise exception 'Elige una categoría'; end if;
    if not (v.entrega_en_u or v.entrega_domicilio) then raise exception 'Elige al menos una modalidad de entrega'; end if;

    -- RF-06: mínimo de fotos y una con el código escrito en papel
    select count(*), count(*) filter (where con_codigo) into v_fotos, v_con_codigo
    from public.producto_fotos where producto_id = p_producto;
    if v_fotos < v_min then raise exception 'Sube al menos % fotos reales del producto', v_min; end if;
    if v_con_codigo < 1 then raise exception 'Marca cuál foto muestra el código % escrito en un papel', v.codigo_verificacion; end if;

    -- RF-07: fotos repetidas en otras publicaciones o dentro de la misma
    select coalesce(jsonb_agg(distinct jsonb_build_object(
               'tipo', 'foto_repetida', 'producto_id', o.producto_id,
               'producto', (select nombre from public.productos where id = o.producto_id))), '[]'::jsonb)
    into v_alertas
    from public.producto_fotos f
    join public.producto_fotos o on o.producto_id <> f.producto_id
    where f.producto_id = p_producto and public.distancia_huella(f.huella, o.huella) <= 6;

    if exists (
        select 1 from public.producto_fotos a join public.producto_fotos b
          on a.producto_id = b.producto_id and a.id < b.id
        where a.producto_id = p_producto and public.distancia_huella(a.huella, b.huella) <= 3
    ) then
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object('tipo', 'fotos_iguales'));
    end if;

    -- RF-10: productos prohibidos (rechazo automático)
    v_motivos := public.motivos_prohibidos(v.nombre || ' ' || coalesce(v.descripcion, ''));

    update public.productos
    set estado_moderacion = case when array_length(v_motivos, 1) > 0 then 'rechazado' else 'pendiente' end,
        motivo_moderacion = case when array_length(v_motivos, 1) > 0
                                 then 'Rechazo automático: parece un producto prohibido (' || array_to_string(v_motivos, ', ') || ').' end,
        alertas = v_alertas,
        activo = true,
        enviado_revision_en = now(),
        imagen = (select url from public.producto_fotos where producto_id = p_producto order by con_codigo, orden, id limit 1)
    where id = p_producto;

    if array_length(v_motivos, 1) > 0 then
        insert into public.auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
        values (null, 'Sistema', 'rechazo_automatico', 'producto', p_producto::text, jsonb_build_object('motivos', v_motivos));
        return jsonb_build_object('estado', 'rechazado', 'motivos', v_motivos);
    end if;

    perform public.notificar_moderadores('publicacion', 'Publicación por revisar', v.nombre, 'admin.html#publicaciones');
    return jsonb_build_object('estado', 'pendiente', 'alertas', v_alertas);
end;
$$;

-- RF-08: el moderador aprueba o rechaza.
create or replace function public.moderar_publicacion(p_producto bigint, p_aprobar boolean, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v record;
begin
    if not public.es_moderador() then raise exception 'Solo moderadores'; end if;
    select p.id, p.nombre, p.estado_moderacion, t.usuario_id into v
    from public.productos p join public.tiendas t on t.id = p.tienda_id where p.id = p_producto;
    if not found then raise exception 'Publicación no encontrada'; end if;
    if not p_aprobar and length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escribe el motivo del rechazo'; end if;

    update public.productos
    set estado_moderacion = case when p_aprobar then 'aprobado' else 'rechazado' end,
        motivo_moderacion = case when p_aprobar then null else trim(p_motivo) end,
        moderado_por = auth.uid(), moderado_en = now()
    where id = p_producto;

    perform public.notificar(v.usuario_id, 'publicacion',
        case when p_aprobar then '¡Tu publicación fue aprobada!' else 'Tu publicación fue rechazada' end,
        case when p_aprobar then v.nombre || ' ya aparece en el catálogo.' else v.nombre || ': ' || trim(p_motivo) end,
        case when p_aprobar then 'producto.html?id=' || p_producto else 'vender.html' end);
    perform public.auditar(case when p_aprobar then 'aprobar_publicacion' else 'rechazar_publicacion' end,
        'producto', p_producto::text, jsonb_build_object('nombre', v.nombre, 'motivo', p_motivo));
    return case when p_aprobar then 'aprobado' else 'rechazado' end;
end;
$$;

-- RF-07 (búsqueda en internet): la Edge Function "revisar-imagenes" agrega alertas.
create or replace function public.agregar_alerta_producto(p_producto bigint, p_alerta jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.productos set alertas = coalesce(alertas, '[]'::jsonb) || jsonb_build_array(p_alerta)
    where id = p_producto;
$$;

-- La foto principal del producto (la que se ve en el catálogo) siempre es la
-- primera foto sin el código. Se actualiza sola al subir, quitar o marcar fotos.
create or replace function public.sincronizar_imagen_producto(p_producto bigint)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.productos p
    set imagen = coalesce(
        (select f.url from public.producto_fotos f where f.producto_id = p_producto
         order by f.con_codigo, f.orden, f.id limit 1),
        case when p.imagen like 'icono:%' then p.imagen end)
    where p.id = p_producto;
$$;

-- Si cambian las fotos de una publicación aprobada, vuelve a moderación.
create or replace function public.fotos_cambiaron()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_producto bigint := coalesce(new.producto_id, old.producto_id);
begin
    perform public.sincronizar_imagen_producto(v_producto);
    -- Solo agregar o quitar fotos (no marcar la del código) obliga a revisar de nuevo.
    -- auth.uid() nulo = migración desde el editor SQL: no cambia el estado.
    if tg_op in ('INSERT', 'DELETE') and auth.uid() is not null and not public.es_moderador() then
        update public.productos
        set estado_moderacion = 'pendiente', enviado_revision_en = now()
        where id = v_producto and estado_moderacion = 'aprobado';
    end if;
    return null;
end;
$$;
drop trigger if exists al_cambiar_fotos on public.producto_fotos;
create trigger al_cambiar_fotos
after insert or delete or update of con_codigo, orden on public.producto_fotos
for each row execute function public.fotos_cambiaron();

-- Productos creados antes de la galería: su foto pasa a la galería para
-- que aparezca al editarlos.
insert into public.producto_fotos (producto_id, ruta, url, orden)
select p.id,
       coalesce(substring(p.imagen from '/object/public/productos/(.+)$'), 'externa/' || p.id),
       p.imagen, 1
from public.productos p
where p.imagen ~ '^https?://'
  and not exists (select 1 from public.producto_fotos f where f.producto_id = p.id);

-- ---------- Reportes de publicaciones (RF-11) ----------
create table if not exists public.reportes (
    id bigint generated by default as identity primary key,
    producto_id bigint not null,
    tienda_id uuid references public.tiendas(id) on delete set null,
    reportado_por uuid not null references public.perfiles(id) on delete cascade,
    motivo text not null check (motivo in ('prohibido', 'estafa', 'falsificado', 'fotos_falsas', 'precio_enganoso', 'otro')),
    detalle text check (char_length(detalle) <= 600),
    estado text not null default 'abierto' check (estado in ('abierto', 'confirmado', 'descartado')),
    nota text,
    resuelto_por uuid references public.perfiles(id) on delete set null,
    resuelto_en timestamptz,
    creado_en timestamptz not null default now()
);
create index if not exists idx_reportes_estado on public.reportes (estado, creado_en);

create or replace function public.reportar_publicacion(p_producto bigint, p_motivo text, p_detalle text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_tienda uuid;
    v_nombre text;
    v_id bigint;
begin
    if auth.uid() is null then raise exception 'Inicia sesión para reportar'; end if;
    select tienda_id, nombre into v_tienda, v_nombre from public.productos where id = p_producto;
    if not found then raise exception 'Publicación no encontrada'; end if;
    if exists (select 1 from public.tiendas where id = v_tienda and usuario_id = auth.uid()) then
        raise exception 'No puedes reportar tu propia publicación';
    end if;
    if exists (select 1 from public.reportes where producto_id = p_producto and reportado_por = auth.uid() and estado = 'abierto') then
        raise exception 'Ya reportaste esta publicación; un moderador la está revisando';
    end if;
    insert into public.reportes (producto_id, tienda_id, reportado_por, motivo, detalle)
    values (p_producto, v_tienda, auth.uid(), p_motivo, left(nullif(trim(p_detalle), ''), 600))
    returning id into v_id;
    perform public.notificar_moderadores('reporte', 'Nueva publicación reportada', v_nombre, 'admin.html#reportes');
    return v_id;
end;
$$;

-- RF-11 / RF-36: el moderador resuelve; con N reportes confirmados se suspende al vendedor.
create or replace function public.resolver_reporte(p_reporte bigint, p_confirmar boolean, p_nota text default null, p_retirar boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    r record;
    v_vendedor uuid;
    v_confirmados integer;
begin
    if not public.es_moderador() then raise exception 'Solo moderadores'; end if;
    select * into r from public.reportes where id = p_reporte for update;
    if not found then raise exception 'Reporte no encontrado'; end if;
    if r.estado <> 'abierto' then raise exception 'Este reporte ya fue resuelto'; end if;

    update public.reportes
    set estado = case when p_confirmar then 'confirmado' else 'descartado' end,
        nota = nullif(trim(p_nota), ''), resuelto_por = auth.uid(), resuelto_en = now()
    where id = p_reporte;

    if p_confirmar then
        select usuario_id into v_vendedor from public.tiendas where id = r.tienda_id;
        if p_retirar then
            update public.productos
            set estado_moderacion = 'rechazado', motivo_moderacion = 'Retirada por reporte confirmado: ' || coalesce(nullif(trim(p_nota), ''), r.motivo)
            where id = r.producto_id;
            perform public.notificar(v_vendedor, 'publicacion', 'Una publicación tuya fue retirada',
                coalesce(nullif(trim(p_nota), ''), 'Se confirmó un reporte sobre ella.'), 'vender.html');
        end if;

        -- RF-36: suspensión automática por reportes confirmados
        select count(*) into v_confirmados from public.reportes
        where tienda_id = r.tienda_id and estado = 'confirmado';
        if v_confirmados >= public.config_num('reportes_para_suspender', 3)
           and exists (select 1 from public.perfiles where id = v_vendedor and estado_cuenta = 'verificado') then
            update public.perfiles
            set estado_cuenta = 'suspendido', motivo_estado = 'Suspensión automática: ' || v_confirmados || ' reportes confirmados.'
            where id = v_vendedor;
            perform public.notificar(v_vendedor, 'cuenta', 'Tu cuenta fue suspendida',
                'Tienes ' || v_confirmados || ' reportes confirmados. Escribe a soporte si crees que es un error.', 'mi-cuenta.html');
            insert into public.auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
            values (null, 'Sistema', 'suspension_automatica', 'perfil', v_vendedor::text, jsonb_build_object('reportes', v_confirmados));
        end if;
    end if;

    perform public.notificar(r.reportado_por, 'reporte', 'Revisamos tu reporte',
        case when p_confirmar then 'Gracias: confirmamos el problema y tomamos medidas.' else 'Revisamos la publicación y no encontramos un problema.' end, null);
    perform public.auditar(case when p_confirmar then 'confirmar_reporte' else 'descartar_reporte' end,
        'reporte', p_reporte::text, jsonb_build_object('producto', r.producto_id, 'nota', p_nota));
    return case when p_confirmar then 'confirmado' else 'descartado' end;
end;
$$;

-- ---------- Seguridad ----------
alter table public.configuracion enable row level security;
alter table public.categorias enable row level security;
alter table public.palabras_prohibidas enable row level security;
alter table public.producto_fotos enable row level security;
alter table public.reportes enable row level security;

revoke all on public.configuracion, public.categorias, public.palabras_prohibidas,
              public.producto_fotos, public.reportes from anon, authenticated;

grant select on public.configuracion to anon, authenticated;
grant update (valor) on public.configuracion to authenticated;
drop policy if exists "config_ver" on public.configuracion;
drop policy if exists "config_admin" on public.configuracion;
create policy "config_ver" on public.configuracion for select to anon, authenticated using (true);
create policy "config_admin" on public.configuracion for update to authenticated using (public.es_admin()) with check (public.es_admin());

grant select on public.categorias to anon, authenticated;
grant insert, update, delete on public.categorias to authenticated;
drop policy if exists "categorias_ver" on public.categorias;
drop policy if exists "categorias_admin" on public.categorias;
create policy "categorias_ver" on public.categorias for select to anon, authenticated using (activa or public.es_admin());
create policy "categorias_admin" on public.categorias for all to authenticated using (public.es_admin()) with check (public.es_admin());

grant select, insert, delete on public.palabras_prohibidas to authenticated;
drop policy if exists "prohibidas_moderador" on public.palabras_prohibidas;
create policy "prohibidas_moderador" on public.palabras_prohibidas for all to authenticated
using (public.es_moderador()) with check (public.es_admin());

-- Fotos: públicas las de publicaciones visibles; el dueño gestiona las suyas.
grant select on public.producto_fotos to anon, authenticated;
grant insert (producto_id, ruta, url, orden, huella, con_codigo) on public.producto_fotos to authenticated;
grant update (orden, con_codigo) on public.producto_fotos to authenticated;
grant delete on public.producto_fotos to authenticated;
drop policy if exists "fotos_ver" on public.producto_fotos;
drop policy if exists "fotos_dueno" on public.producto_fotos;
drop policy if exists "fotos_dueno_editar" on public.producto_fotos;
drop policy if exists "fotos_dueno_borrar" on public.producto_fotos;
create policy "fotos_ver" on public.producto_fotos for select to anon, authenticated
using (exists (select 1 from public.productos p where p.id = producto_id));   -- hereda la visibilidad del producto
create policy "fotos_dueno" on public.producto_fotos for insert to authenticated
with check (public.es_dueno_producto(producto_id) and ruta like auth.uid()::text || '/%');
create policy "fotos_dueno_editar" on public.producto_fotos for update to authenticated
using (public.es_dueno_producto(producto_id)) with check (public.es_dueno_producto(producto_id));
create policy "fotos_dueno_borrar" on public.producto_fotos for delete to authenticated
using (public.es_dueno_producto(producto_id));

grant select on public.reportes to authenticated;
drop policy if exists "reportes_ver" on public.reportes;
create policy "reportes_ver" on public.reportes for select to authenticated
using (reportado_por = auth.uid() or public.es_moderador());

revoke all on function public.agregar_alerta_producto(bigint, jsonb) from public, anon, authenticated;
do $$ begin
    execute 'grant execute on function public.agregar_alerta_producto(bigint, jsonb) to service_role';
exception when undefined_object then null; end $$;
revoke all on function public.fotos_cambiaron() from public, anon, authenticated;
grant execute on function public.config_num(text, numeric) to anon, authenticated;
grant execute on function public.motivos_prohibidos(text) to authenticated;
grant execute on function public.es_dueno_producto(bigint) to authenticated;
revoke all on function public.nueva_publicacion() from public, anon;
grant execute on function public.nueva_publicacion() to authenticated;
revoke all on function public.enviar_a_revision(bigint) from public, anon;
grant execute on function public.enviar_a_revision(bigint) to authenticated;
revoke execute on function public.sincronizar_imagen_producto(bigint) from public, anon, authenticated;
revoke all on function public.moderar_publicacion(bigint, boolean, text) from public, anon;
grant execute on function public.moderar_publicacion(bigint, boolean, text) to authenticated;
revoke all on function public.reportar_publicacion(bigint, text, text) from public, anon;
grant execute on function public.reportar_publicacion(bigint, text, text) to authenticated;
revoke all on function public.resolver_reporte(bigint, boolean, text, boolean) from public, anon;
grant execute on function public.resolver_reporte(bigint, boolean, text, boolean) to authenticated;
