# Notebook Study 📓

Plataforma de cuadernos virtuales para estudiar. Cada cuaderno se ve y se usa como un **cuaderno cuadriculado anillado**: escribes con teclado o a mano con lápiz, pegas imágenes donde quieras y pasas las hojas como en uno de verdad.

## Qué hace hoy (v0.3)

- **Biblioteca de cuadernos** con portada de color y nombre.
- **Hoja cuadriculada** con perforaciones y espiral metálica.
- **Pasar hojas en 3D**: arrastras la esquina inferior derecha (o el margen izquierdo para volver), o usas las flechas ← → o los botones. Al pasar la última hoja se agrega una nueva.
- **Escritura mixta**:
  - **Texto**: haz clic donde quieras y escribe; las líneas caen sobre la cuadrícula.
  - **Lápiz**: trazo suave con presión real si usas stylus (iPad, Surface, Wacom…).
  - **Resaltador** y **borrador** (también el botón borrador del lápiz).
  - Si se detecta un lápiz, se ignora el toque de la palma al dibujar.
- **Imágenes**: Ctrl+V, arrastrar y soltar, o botón de imagen. Se pueden mover y redimensionar con la herramienta de selección. Las fotos grandes se comprimen automáticamente.
- **Guardado automático y sin conexión** en el navegador (IndexedDB). Al volver, el cuaderno se abre en la última hoja.
- **App instalable (PWA)**: se instala en el celular, la tablet o el computador con su propio ícono, abre en pantalla completa y funciona sin internet.
  - Android, o Chrome/Edge en el computador: botón **Instalar app** en la pantalla principal.
  - iPhone/iPad: en Safari toca **Compartir → Agregar a pantalla de inicio**.
- **Pantalla de inicio de sesión** al abrir la app, con la opción de continuar sin cuenta.
- **Sincronización entre dispositivos** con Supabase: inicias sesión con la **misma cuenta de tus otras apps** y tus cuadernos aparecen en el computador, la tablet y el celular. Sin conexión sigues trabajando y todo se sube al volver la conexión.

## Tecnologías

| Capa | Elección | Por qué |
|---|---|---|
| Lenguaje | TypeScript | Tipos para un modelo de datos que va a crecer |
| UI | React 19 + Vite | Ecosistema amplio, build rápido |
| Trazos | perfect-freehand | Trazos naturales con presión |
| Datos locales | Dexie (IndexedDB) | Funciona sin conexión, guarda imágenes como Blob |
| Sincronización | Supabase (proyecto compartido, esquema `notebook`) | Mismo login que tus otras apps, Postgres con RLS e imágenes en Storage |
| Distribución | PWA (fase 2), Tauri opcional | Un solo código para PC, tablet y celular |

## Cómo ejecutarlo

```bash
npm install
cp .env.example .env   # pon la URL y la publishable key de Supabase
npm run dev            # http://localhost:5173
npm run build          # versión de producción en dist/
```

Sin `.env` la app funciona igual, pero solo guarda en el dispositivo.

## Configurar Supabase (proyecto compartido con tus otras apps)

Esta app usa **el mismo proyecto** de Supabase que tus otras apps, pero sus tablas viven aparte en el esquema `notebook`. Las tablas de las otras apps no se tocan. El login (`auth.users`) es el mismo, así que entras con el mismo correo y contraseña.

1. **Crear tablas y permisos**: Supabase → **SQL Editor** → pega `supabase/schema.sql` → **Run**. Crea:
   - el esquema `notebook` con las tablas `notebooks`, `pages`, `elements` y `assets`;
   - reglas para que cada usuario solo vea lo suyo (RLS);
   - un trigger para que gane el cambio más reciente si editas lo mismo en dos dispositivos;
   - el bucket privado `notebook-assets` para las imágenes.
2. **Exponer el esquema**: **Project Settings → Data API → Exposed schemas** → agrega `notebook` → **Save**. Sin esto la app muestra el aviso "Falta exponer el esquema".
3. **Permitir la URL de la app**: **Authentication → URL Configuration → Redirect URLs** → agrega `https://backendev95.github.io/notebook-study/`. Así funcionan los correos de confirmación y de recuperar contraseña. No cambies el *Site URL* si lo usa tu otra app.
4. **Variables para el despliegue**: en GitHub → **Settings → Secrets and variables → Actions → Variables** crea:
   - `VITE_SUPABASE_URL`: la URL del proyecto (Supabase → Project Settings → API).
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: la *publishable key* (o la *anon public* en proyectos antiguos).

   Nunca uses la `service_role` en la app.
5. Haz push a `main` (o vuelve a ejecutar el workflow) para publicar con la sincronización activa.

### Cómo funciona la sincronización

- Todo se guarda primero en el dispositivo; los cambios pendientes quedan marcados y se suben a los ~1.5 s, cada 20 s, al volver la conexión o al regresar a la pestaña.
- Cada dispositivo baja solo lo que cambió desde la última vez (`server_updated_at`).
- Si dos dispositivos editan el mismo elemento, gana el cambio más reciente; el servidor también lo hace cumplir.
- Las imágenes se suben a Storage en `notebook-assets/<tu-usuario>/<id>` y se descargan en los otros dispositivos cuando se necesitan.
- Al cerrar sesión se sube lo pendiente y se borran los datos del dispositivo (siguen en la nube). Si hay cambios sin subir por falta de conexión, no te deja cerrar sesión para que no los pierdas.

Si tu otra app usa login con Google u otro proveedor en lugar de correo y contraseña, hay que agregar ese botón aquí; el proveedor ya queda configurado en el proyecto compartido.

## Estructura

```
supabase/schema.sql        Tablas, seguridad y bucket (se ejecuta una vez en Supabase)
src/
  types.ts                 Modelo de datos (Cuaderno → Hojas → Elementos)
  db.ts                    Base de datos local (Dexie), cambios pendientes
  lib/supabase.ts          Cliente de Supabase (esquema notebook)
  lib/sync.ts              Motor de sincronización
  lib/auth.ts              Sesión
  components/Account.tsx   Login y estado de sincronización
  lib/ink.ts               Conversión de trazos a SVG
  lib/images.ts            Pegar/comprimir imágenes
  components/
    Library.tsx            Lista de cuadernos
    NotebookView.tsx       Cuaderno: paso de hojas 3D, teclado, pegar
    PageSurface.tsx        Una hoja: texto, lápiz, borrador, imágenes
    Paper.tsx              Papel, perforaciones, espiral y portada
    Toolbar.tsx            Barra de herramientas
```

### Modelo de datos

```
Notebook { id, title, color, lastPage, updatedAt, deleted }
Page     { id, notebookId, order, updatedAt, deleted }
Element  { id, pageId, type: text | image | ink, x, y, w, h, z, updatedAt, deleted, ... }
Asset    { id, blob, mime }   ← las imágenes
```

Las coordenadas son de página (816 × 1056, proporción carta), así que el contenido se ve igual en cualquier pantalla. Todo lleva `updatedAt` y borrado suave (`deleted`) para que la sincronización pueda fusionar cambios de varios dispositivos.

## Hoja de ruta

1. ~~Sincronización entre dispositivos~~ ✅. Siguiente: Realtime, para ver los cambios de otro dispositivo al instante sin esperar los 20 s.
2. ~~PWA instalable~~ ✅
3. **Zoom y desplazamiento** con pellizco (clave en celular) y vista de dos páginas en pantallas anchas.
4. Formato de texto (negrita, listas, títulos), herramienta lazo para mover trazos y deshacer/rehacer.
5. Tipos de hoja (rayada, punteada, blanca), separadores, índice y búsqueda.
6. Exportar un cuaderno a PDF.
