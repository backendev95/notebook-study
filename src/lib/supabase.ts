import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Mismo proyecto de Supabase que tus otras apps: mismo login (auth.users),
// pero las tablas de esta app viven en el esquema `notebook`.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  | string
  | undefined;

export const SCHEMA = 'notebook';
export const BUCKET = 'notebook-assets';

export const supabase: SupabaseClient<any, any, any> | null = // eslint-disable-line @typescript-eslint/no-explicit-any
  url && key ? createClient(url, key, { db: { schema: SCHEMA } }) : null;

/** Traduce los errores más comunes a algo entendible */
export function explainError(e: unknown): string {
  const err = e as { code?: string; message?: string; status?: number };
  const msg = err?.message ?? String(e);
  if (err?.code === 'PGRST106' || /schema must be one of|Invalid schema/i.test(msg))
    return 'Falta exponer el esquema "notebook" en Supabase (Project Settings → Data API → Exposed schemas).';
  if (err?.code === 'PGRST204' || /Could not find the '.*' column|column .* does not exist/i.test(msg))
    return 'Falta actualizar la base: ejecuta supabase/migrations/002_mejoras.sql en el SQL Editor de Supabase.';
  if (/violates check constraint "elements_type_check"/i.test(msg))
    return 'Falta actualizar la base: ejecuta supabase/migrations/002_mejoras.sql en el SQL Editor de Supabase.';
  if (err?.code === '42P01' || /does not exist/i.test(msg))
    return 'Faltan las tablas en Supabase: ejecuta supabase/schema.sql en el SQL Editor.';
  if (/Bucket not found/i.test(msg)) return 'Falta el bucket de imágenes: ejecuta supabase/schema.sql.';
  if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(msg)) return 'Confirma tu correo antes de iniciar sesión (revisa tu bandeja).';
  if (/User already registered/i.test(msg)) return 'Ese correo ya tiene cuenta: inicia sesión con tu contraseña.';
  if (/Password should be/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Sin conexión con Supabase.';
  return msg;
}
