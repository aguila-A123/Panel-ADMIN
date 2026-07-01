PASOS

1. Abrir carpeta en VS Code

2. Ejecutar:
npm install

3. Ejecutar:
npm run dev

4. Crear archivo .env usando .env.example

5. Ejecutar supabase.sql en SQL Editor de Supabase

6. Pegar tu App.jsx completo en:
src/App.jsx

IMPORTANTE - NUEVA CATEGORÍA:
Para que el apartado "Categoría" se guarde en Supabase, ejecuta estas líneas una sola vez en el SQL Editor de Supabase:

alter table public.products add column if not exists category text;
alter table public.products add column if not exists category_extra text;

Después de eso, la categoría será obligatoria al publicar o editar una prenda.

IMPORTANTE - AVISO AUTOMÁTICO NACEX:
Este ZIP incluye una tarjeta abajo a la izquierda llamada "Servicio de etiquetas".
Lee la tabla worker_status cada 2 segundos.

Ejecuta también el bloque worker_status incluido en supabase.sql.

Funcionamiento:
- Si nacex_worker.exe actualiza last_seen cada 10s, el panel muestra "Automático activo".
- Si pasan más de 10s sin señal del worker, muestra "Automático inactivo". Internamente se usa un pequeño margen de 12s para evitar parpadeos por retrasos de red.
- El botón "Activar automático" muestra un aviso para abrir nacex_worker.exe en el PC de impresión.

Para que el botón ejecute el .exe directamente hará falta empaquetar el panel con Electron y añadir la llamada nativa de Windows.


OPTIMIZACIÓN 24/7 DEL MONITOR NACEX
- El Panel Admin consulta la tabla worker_status cada 10 segundos.
- El contador de "Última señal" se actualiza localmente cada 1 segundo, sin llamar a Supabase.
- El panel declara "Automático inactivo" si pasan más de 20 segundos sin una nueva señal del nacex_worker.exe.
- Esto evita llamadas innecesarias a Supabase para dejarlo encendido 24/7.
