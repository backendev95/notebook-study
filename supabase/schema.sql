-- =====================================================================
--  Notebook Study — esquema en un proyecto de Supabase compartido
-- ---------------------------------------------------------------------
--  Todo vive en el esquema `notebook`, separado de las tablas de tus otras
--  apps (que siguen en `public` o en su propio esquema). El login es el
--  mismo: se usa auth.users del proyecto, así que el mismo usuario y
--  contraseña sirven en las dos apps.
--
--  Cómo aplicarlo:
--   1. Supabase → SQL Editor → pega este archivo completo → Run.
--   2. Supabase → Project Settings → Data API → "Exposed schemas":
--      agrega `notebook` y guarda.
--  Se puede ejecutar varias veces sin romper nada.
-- =====================================================================

create schema if not exists notebook;

-- ---------- Tablas ----------
-- updated_at: hora del dispositivo que hizo el cambio (ms). Decide qué
--             versión gana cuando dos dispositivos editan lo mismo.
-- server_updated_at: hora del servidor; los dispositivos piden "lo que
--             cambió desde la última vez" con esta columna.

create table if not exists notebook.notebooks (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title             text not null,
  color             text not null,
  created_at        bigint not null,
  updated_at        bigint not null,
  deleted           boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table if not exists notebook.pages (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  notebook_id       uuid not null,
  position          double precision not null,
  updated_at        bigint not null,
  deleted           boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- texto, imagen o trazo; las propiedades de cada tipo van en `data`
create table if not exists notebook.elements (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  page_id           uuid not null,
  type              text not null check (type in ('text', 'image', 'ink')),
  data              jsonb not null,
  updated_at        bigint not null,
  deleted           boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- metadatos de las imágenes; el archivo está en Storage (bucket notebook-assets)
create table if not exists notebook.assets (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mime              text not null,
  path              text not null,
  updated_at        bigint not null,
  deleted           boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

create index if not exists notebooks_sync_idx on notebook.notebooks (user_id, server_updated_at);
create index if not exists pages_sync_idx     on notebook.pages     (user_id, server_updated_at);
create index if not exists elements_sync_idx  on notebook.elements  (user_id, server_updated_at);
create index if not exists assets_sync_idx    on notebook.assets    (user_id, server_updated_at);

-- ---------- "El cambio más reciente gana" ----------
-- Si llega una versión más vieja que la guardada (un dispositivo que estuvo
-- sin conexión), se ignora en vez de pisar la nueva.
create or replace function notebook.before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return null; -- se descarta la versión vieja
    end if;
    new.user_id := old.user_id; -- nadie puede cambiar el dueño
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['notebooks', 'pages', 'elements', 'assets'] loop
    execute format('drop trigger if exists before_write on notebook.%I', t);
    execute format(
      'create trigger before_write before insert or update on notebook.%I
         for each row execute function notebook.before_write()', t);
  end loop;
end $$;

-- ---------- Seguridad: cada usuario solo ve lo suyo ----------
do $$
declare t text;
begin
  foreach t in array array['notebooks', 'pages', 'elements', 'assets'] loop
    execute format('alter table notebook.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on notebook.%I', t);
    execute format(
      'create policy "own rows" on notebook.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Solo usuarios con sesión; el rol anónimo no tiene acceso a este esquema
grant usage on schema notebook to authenticated, service_role;
grant select, insert, update, delete on all tables in schema notebook to authenticated;
grant all on all tables in schema notebook to service_role;
alter default privileges in schema notebook grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema notebook grant all on tables to service_role;

-- ---------- Imágenes (Storage) ----------
-- Bucket privado; cada usuario escribe en la carpeta con su id: <user_id>/<asset_id>
insert into storage.buckets (id, name, public)
values ('notebook-assets', 'notebook-assets', false)
on conflict (id) do nothing;

drop policy if exists "notebook assets: own folder read"   on storage.objects;
drop policy if exists "notebook assets: own folder insert" on storage.objects;
drop policy if exists "notebook assets: own folder update" on storage.objects;
drop policy if exists "notebook assets: own folder delete" on storage.objects;

create policy "notebook assets: own folder read" on storage.objects for select to authenticated
  using (bucket_id = 'notebook-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "notebook assets: own folder insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'notebook-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "notebook assets: own folder update" on storage.objects for update to authenticated
  using (bucket_id = 'notebook-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "notebook assets: own folder delete" on storage.objects for delete to authenticated
  using (bucket_id = 'notebook-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- Mejoras (igual a supabase/migrations/002_mejoras.sql) ----------
alter table notebook.notebooks add column if not exists paper text not null default 'grid';
alter table notebook.notebooks add column if not exists cover_asset_id uuid;

alter table notebook.pages add column if not exists paper text;
alter table notebook.pages add column if not exists section_title text;
alter table notebook.pages add column if not exists section_color text;

-- nuevos tipos de elemento
alter table notebook.elements drop constraint if exists elements_type_check;
alter table notebook.elements add constraint elements_type_check
  check (type in ('text', 'image', 'ink', 'sticky', 'math', 'card'));

-- Tiempo real: avisar a los otros dispositivos apenas algo cambia
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notebooks', 'pages', 'elements', 'assets'] loop
      begin
        execute format('alter publication supabase_realtime add table notebook.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

-- que la API vea las columnas nuevas de inmediato
notify pgrst, 'reload schema';
