/**
 * graph-aplicativos.config.js
 * =============================
 * Configuración específica del Grafo 1: "Aplicativos ↔ Salidas".
 *
 * Este archivo es la ÚNICA pieza que graph-engine.js necesita para saber
 * cómo pintar y filtrar este grafo. No contiene lógica de Cytoscape: solo
 * declara datos y funciones de cálculo (compute) sobre el grafo ya cargado.
 *
 * Fuente de datos (ver tools/excel_to_json.py):
 *   - Fact_Salidas          -> data/nodes-salidas.json
 *   - Dim_Aplicativo        -> data/nodes-aplicativos.json
 *   - Rel_Salida_Aplicativo -> data/edges-salida-aplicativo.json  (334 relaciones)
 */

const GraphAplicativosConfig = {
  id: 'grafo-aplicativos',
  title: 'Aplicativos ↔ Salidas',

  dataSources: {
    nodeSources: ['data/nodes-salidas.json', 'data/nodes-aplicativos.json'],
    edgeSources: ['data/edges-salida-aplicativo.json'],
  },

  // Dimensiones auxiliares, NO se cargan como nodos del grafo: se usan
  // solo para poblar filtros y para resolver nombres en el panel lateral
  // (ej. mostrar "Compensación de Valores e Inhabilitados" en vez de idUO=1).
  auxDimensions: {
    unidadesOrganizativas: 'data/nodes-unidades-organizativas.json',
    rangosRTO: 'data/dim-rango-rto.json',
    subproductos: 'data/dim-subproducto.json',
  },

  defaultLayout: 'cose',
  layouts: ['cose', 'concentric', 'circle'], // Sankey no es un layout de Cytoscape, se maneja aparte

  // -----------------------------------------------------------------
  // Tipos de nodo: color + forma, para que se diferencien a simple vista.
  // -----------------------------------------------------------------
  nodeTypes: {
    salida: {
      label: 'Salida',
      color: '#145da0',
      shape: 'ellipse',
      size: 26,
    },
    aplicativo: {
      label: 'Aplicativo',
      color: '#2e8b57',
      shape: 'diamond',
      size: 30,
    },
  },

  edgeTypes: {
    salida_usa_aplicativo: {
      color: '#9aa4b5',
      width: 1.3,
    },
  },

  // -----------------------------------------------------------------
  // Filtros. Todos son 'enum' (checkbox multi-select). El de RTO usa
  // ordenCriticidad como valor, y se lista de más a menos crítico:
  // el RTO funciona acá como el indicador de criticidad operativa.
  // `appliesToTypes` acota el filtro a los nodos que realmente tienen
  // ese campo (los nodos "aplicativo" no tienen RTO propio ni UO propia).
  // -----------------------------------------------------------------
  filters: [
    {
      id: 'rto',
      label: 'Rango de RTO (criticidad)',
      type: 'enum',
      field: 'idRangoRTO',
      appliesToTypes: ['salida'],
      // optionsFrom: se resuelve en tiempo de ejecución desde auxDimensions.rangosRTO
      optionsFrom: 'rangosRTO',
      optionValue: (d) => d.id,
      optionLabel: (d) => d.rango,
      optionSort: (d) => d.ordenCriticidad,
    },
    {
      id: 'uo',
      label: 'Unidad Organizativa',
      type: 'enum',
      field: 'idUO',
      appliesToTypes: ['salida'],
      optionsFrom: 'unidadesOrganizativas',
      optionValue: (d) => d.data.idUO,
      optionLabel: (d) => d.label,
      optionSort: (d) => d.label,
    },
    {
      id: 'subproducto',
      label: 'Subproducto',
      type: 'enum',
      field: 'subproductos', // array embebido en el nodo Salida
      appliesToTypes: ['salida'],
      optionsFrom: 'subproductos',
      // las opciones se arman a partir de displayLabel (agrupado solo
      // visualmente), pero el campo del nodo también guarda displayLabel,
      // así que matchean directo
      optionValue: (d) => d.displayLabel,
      optionLabel: (d) => d.displayLabel,
      optionSort: (d) => d.displayLabel,
      dedupe: true, // varias filas de dim-subproducto.json comparten displayLabel
    },
  ],

  // -----------------------------------------------------------------
  // Panel lateral. `compute` recibe { node, cy, lookups } — ver
  // js/pages/init-grafo-aplicativos.js para qué hay en `lookups`.
  // Nunca se inventa un dato: si algo no está disponible se deja que
  // sidebar-panel.js muestre "Sin datos en el modelo".
  // -----------------------------------------------------------------
  panelFields: {
    salida: [
      {
        label: 'Unidad Organizativa',
        compute: (ctx) => ctx.lookups.uoNombreById.get(ctx.node.data.idUO),
      },
      { label: 'RTO (criticidad)', field: 'rtoNormalizado' },
      { label: 'Frecuencia', field: 'frecuencia' },
      { label: 'Períodos de alta criticidad', field: 'periodosAltaCriticidad' },
      { label: 'Incorporación en alcance', field: 'incorporacionEnAlcance' },
      { label: 'Subproductos relacionados', field: 'subproductos', list: true },
      { label: 'Procesos centrales relacionados', field: 'procesosCentrales', list: true },
      {
        label: 'Aplicativos relacionados',
        compute: (ctx) => ctx.node.neighborhood
          .filter('node.tipo-aplicativo')
          .map((n) => n.data('label')),
        list: true,
      },
      { label: 'Descripción', field: 'descripcion' },
      { label: 'Referente', field: 'referente' },
    ],
    aplicativo: [
      {
        label: 'Cantidad de salidas relacionadas',
        compute: (ctx) => ctx.node.neighborhood.filter('node.tipo-salida').length,
      },
      {
        label: 'Unidades Organizativas involucradas',
        compute: (ctx) => {
          const uoIds = new Set(
            ctx.node.neighborhood.filter('node.tipo-salida').map((n) => n.data('idUO'))
          );
          return [...uoIds].map((id) => ctx.lookups.uoNombreById.get(id)).filter(Boolean);
        },
        list: true,
      },
      {
        label: 'RTO mínimo asociado (más crítico)',
        compute: (ctx) => {
          const salidas = ctx.node.neighborhood.filter('node.tipo-salida');
          if (salidas.length === 0) return null;
          let minOrden = Infinity;
          let minLabel = null;
          salidas.forEach((n) => {
            const orden = n.data('idRangoRTO');
            if (orden != null && orden < minOrden) {
              minOrden = orden;
              minLabel = n.data('rtoNormalizado');
            }
          });
          return minLabel;
        },
      },
    ],
  },
};
