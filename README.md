# Portal de Inteligencia del BIA — Banco Nación Argentina

Portal estático (HTML5 + CSS3 + JavaScript vanilla + Cytoscape.js) para explorar
visualmente el modelo de datos normalizado del Business Impact Analysis (BIA).

## Estado actual del proyecto

✅ Motor genérico de grafos (Cytoscape.js)
✅ Aplicativos ↔ Salidas — vista Red y vista Sankey (D3 + d3-sankey)
✅ Interdependencias — vista Por Salidas (original) y vista Por Equipo (nueva, agregada)
✅ Betweenness por Equipo (D3, cálculo con networkx sobre el grafo completo)
✅ Temporalidad de Recursos (D3: timeline en pequeños múltiplos + streamgraph)
✅ Premisa de portal: nodos aislados ocultos por defecto en todas las vistas

Los entregables originales (Grafo 1 y 2) fueron validados con un test de humo
headless (Cytoscape real + jsdom + canvas real, fuera del repositorio del
portal). La ampliación 2026-07 (Sankey, Vista por Equipo, Temporalidad de
Recursos, Betweenness) se validó con un smoke test headless real (Playwright)
sobre las 6 páginas del portal, sin errores de consola, más verificación
visual de cada vista/interacción.

## Cómo correrlo en local

Los módulos usan `fetch()` para traer los JSON de `/data`, así que el navegador
necesita que el portal se sirva por http(s) (no funciona con doble-click al
.html). Desde la raíz del proyecto:

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```

En GitHub Pages funciona directo, sin configuración adicional.

## Cómo regenerar los datos desde un Excel actualizado

```bash
python3 tools/excel_to_json.py /ruta/al/BIA_operaciones_metricas_2026_normalizado.xlsx
```

Esto sobrescribe todo `/data/*.json`. El script NO modifica el Excel ni redefine
el modelo de datos: solo proyecta las tablas ya normalizadas a formato de grafo.
Las 4 reglas de negocio aplicadas (validadas con el usuario) están documentadas
como comentario al inicio de `tools/excel_to_json.py`.

## Contrato de datos (lo único que el motor genérico entiende)

**Nodo**
```json
{ "id": "sal-1", "type": "salida", "label": "Nacha", "data": { "...": "..." } }
```

**Arista**
```json
{ "id": "e-1", "type": "salida_usa_aplicativo", "source": "sal-1", "target": "app-3",
  "directed": false, "data": { "...": "..." } }
```

El motor (`js/core/graph-engine.js`) nunca lee campos específicos de "Salida"
o "Aplicativo": todo lo que no sea `id/type/label/source/target/directed` es
`data` de libre uso, consumido únicamente por la config de cada grafo (filtros,
panel lateral) y no por el motor.

## Cómo agregar un grafo nuevo (sin tocar `js/core/`)

1. Generar (o agregar al script `excel_to_json.py`) los JSON de nodos/aristas
   del nuevo grafo en `/data`, respetando el contrato de arriba.
2. Crear `js/configs/grafo-X.config.js` declarando:
   - `nodeTypes` / `edgeTypes` (color, forma, tamaño)
   - `dataSources` (qué archivos JSON cargar)
   - `filters` (definiciones para `filter-engine.js`)
   - `panelFields` (qué mostrar en el panel lateral por tipo de nodo)
   - `defaultLayout`
3. Crear `js/pages/init-grafo-X.js`: instancia `GraphEngine`, conecta filtros,
   buscador y panel (siguiendo el mismo patrón que los grafos existentes).
4. Crear `grafo-X.html` con el layout base (header + panel filtros + canvas +
   panel detalle) y linkear los scripts.

`js/core/*.js` no se modifica en ningún paso de este proceso — esa es la
garantía de reutilización pedida.

## Preparado para (no implementado todavía)

La arquitectura de datos y de configuración deja lugar para, sin rediseño:
- Relaciones Salidas ↔ Proveedores / Personal Clave / Equipamiento Especial /
  Almacenamiento a nivel de grafo (hoy Temporalidad de Recursos las muestra
  agregadas por UO y franja, no como grafo nodo-arista)
- Relaciones Subproductos ↔ Salidas como grafo propio
- Dashboard ejecutivo combinando métricas de los 4 módulos en una sola pantalla

## Nota técnica: por qué no se usa `:visible` de Cytoscape

Al validar el Grafo 2 se detectó que el selector `:visible` (y el método
`.visible()`) de Cytoscape puede devolver un resultado cacheado y
desactualizado si se consulta el mismo selector antes y después de un
cambio masivo de clases (ej. aplicar un filtro), incluso llamando a
`cy.style().update()`. Por eso `graph-engine.js` expone `getVisibleNodes()`,
que determina visibilidad leyendo directamente la clase `oculto` (la misma
que nosotros gestionamos), sin pasar por ese mecanismo interno de
Cytoscape. Cualquier grafo nuevo debe usar `engine.getVisibleNodes()` en
vez de selectores `:visible` propios.

## Nota sobre calidad de datos (no corregida, por decisión explícita)

- `Diccionario_UO` del Excel contiene actualmente datos mezclados de
  entidades (no solo Unidades Organizativas) — no afecta al portal porque
  esa hoja no se usa como fuente de ningún grafo, pero queda documentado acá
  por si se decide corregir el Excel de origen más adelante.
