
-- =====================================================
-- MARKETPLACE UMB 
-- Base de datos inicial para Supabase / PostgreSQL
-- ====================================================

create extension if not exists pgcrypto;

-- =====================================================
-- 1. TABLA DE PERFILES
-- =====================================================

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text not null,
    apellido text,
    correo text not null unique,
    telefono text,
    fecha_registro timestamptz not null default now(),
    estado text not null default 'activo'
        check (estado in ('activo', 'inactivo')),
    rol text not null default 'cliente'
        check (rol in ('cliente', 'vendedor'))
);

-- =====================================================
-- 2. TABLA DE TIENDAS
-- =====================================================

create table if not exists public.stores (
    id uuid primary key default gen_random_uuid(),

    usuario_id uuid not null unique
        references public.profiles(id) on delete cascade,

    nombre text not null,
    descripcion text,
    categoria text,
    logo text,
    banner text,
    telefono text,
    direccion text,

    fecha_creacion timestamptz not null default now()
);

-- =====================================================
-- 3. TABLA DE PRODUCTOS
-- =====================================================

create table if not exists public.products (
    id uuid primary key default gen_random_uuid(),

    tienda_id uuid not null
        references public.stores(id) on delete cascade,

    nombre text not null,
    descripcion text,

    precio numeric(12,2) not null
        check (precio >= 0),

    imagen text,

    stock integer not null default 0
        check (stock >= 0),

    fecha_creacion timestamptz not null default now()
);

-- =====================================================
-- 4. ÍNDICES
-- =====================================================

create index if not exists idx_stores_usuario
on public.stores(usuario_id);

create index if not exists idx_products_tienda
on public.products(tienda_id);

create index if not exists idx_products_nombre
on public.products(nombre);

-- =====================================================
-- 5. CREAR PERFIL AUTOMÁTICAMENTE
-- =====================================================

create or replace function public.crear_perfil_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (
        id,
        nombre,
        apellido,
        correo,
        telefono,
        rol
    )
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'nombre', 'Usuario'),
        new.raw_user_meta_data ->> 'apellido',
        new.email,
        new.raw_user_meta_data ->> 'telefono',
        'cliente'
    );

    return new;
end;
$$;

drop trigger if exists trigger_crear_perfil
on auth.users;

create trigger trigger_crear_perfil
after insert on auth.users
for each row
execute function public.crear_perfil_usuario();

-- =====================================================
-- 6. FUNCIÓN SEGURA PARA CREAR TIENDA
-- =====================================================

create or replace function public.crear_tienda(
    p_nombre text,
    p_descripcion text default null,
    p_categoria text default null,
    p_telefono text default null,
    p_direccion text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usuario uuid;
    v_tienda uuid;
begin
    v_usuario := auth.uid();

    if v_usuario is null then
        raise exception 'Debes iniciar sesión';
    end if;

    if length(trim(coalesce(p_nombre, ''))) < 2 then
        raise exception 'El nombre de la tienda es obligatorio';
    end if;

    if exists (
        select 1
        from public.stores
        where usuario_id = v_usuario
    ) then
        raise exception 'Este usuario ya tiene una tienda';
    end if;

    insert into public.stores (
        usuario_id,
        nombre,
        descripcion,
        categoria,
        telefono,
        direccion
    )
    values (
        v_usuario,
        trim(p_nombre),
        p_descripcion,
        p_categoria,
        p_telefono,
        p_direccion
    )
    returning id into v_tienda;

    update public.profiles
    set rol = 'vendedor'
    where id = v_usuario;

    return v_tienda;
end;
$$;

-- =====================================================
-- 7. ACTIVAR SEGURIDAD RLS
-- =====================================================

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;

-- =====================================================
-- 8. PERMISOS DE PERFILES
-- =====================================================

revoke all on public.profiles from anon, authenticated;

grant select on public.profiles to authenticated;

grant update (nombre, apellido, telefono)
on public.profiles to authenticated;

drop policy if exists "Ver propio perfil"
on public.profiles;

create policy "Ver propio perfil"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Editar datos propios"
on public.profiles;

create policy "Editar datos propios"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- =====================================================
-- 9. PERMISOS DE TIENDAS
-- =====================================================

grant select on public.stores to anon, authenticated;

drop policy if exists "Tiendas visibles"
on public.stores;

create policy "Tiendas visibles"
on public.stores
for select
to anon, authenticated
using (true);

-- No se concede INSERT, UPDATE o DELETE directo.
-- La creación se realiza mediante crear_tienda().

revoke insert, update, delete
on public.stores from anon, authenticated;

grant execute on function public.crear_tienda(
    text, text, text, text, text
) to authenticated;

-- =====================================================
-- 10. PERMISOS DE PRODUCTOS
-- =====================================================

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

drop policy if exists "Productos visibles"
on public.products;

create policy "Productos visibles"
on public.products
for select
to anon, authenticated
using (true);

drop policy if exists "Vendedor crea sus productos"
on public.products;

create policy "Vendedor crea sus productos"
on public.products
for insert
to authenticated
with check (
    exists (
        select 1
        from public.stores s
        where s.id = tienda_id
        and s.usuario_id = auth.uid()
    )
);

drop policy if exists "Vendedor modifica sus productos"
on public.products;

create policy "Vendedor modifica sus productos"
on public.products
for update
to authenticated
using (
    exists (
        select 1
        from public.stores s
        where s.id = tienda_id
        and s.usuario_id = auth.uid()
    )
)
with check (
    exists (
        select 1
        from public.stores s
        where s.id = tienda_id
        and s.usuario_id = auth.uid()
    )
);

drop policy if exists "Vendedor elimina sus productos"
on public.products;

create policy "Vendedor elimina sus productos"
on public.products
for delete
to authenticated
using (
    exists (
        select 1
        from public.stores s
        where s.id = tienda_id
        and s.usuario_id = auth.uid()
    )
);

-- =====================================================
-- FIN DEL ESQUEMA INICIAL
-- =====================================================
