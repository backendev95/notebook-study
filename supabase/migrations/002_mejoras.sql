-- =====================================================================
--  Notebook Study — migración 002 (tipos de hoja, separadores, portada
--  con foto, notas adhesivas, fórmulas, tarjetas de repaso y tiempo real)
-- ---------------------------------------------------------------------
--  Si ya ejecutaste supabase/schema.sql antes, ejecuta ESTE archivo en
--  Supabase → SQL Editor. Se puede ejecutar varias veces sin problema.
--  (Las instalaciones nuevas no lo necesitan: schema.sql ya lo incluye.)
-- =====================================================================

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
