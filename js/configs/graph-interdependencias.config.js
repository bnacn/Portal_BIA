/**
 * graph-interdependencias.config.js
 * ====================================
 * Configuración del Grafo 2: "Red de Interdependencias Operativas".
 * Grafo principal del portal: representa el flujo operacional completo
 * entre Unidades Organizativas, Salidas y Entidades (internas y externas
 * mezcladas en un mismo grafo, distinguidas solo por color).
 *
 * Fuentes de datos (ver tools/excel_to_json.py):
 *   - Dim_UnidadOrganizativa       -> data/nodes-unidades-organizativas.json
 *   - Fact_Salidas                 -> data/nodes-salidas.json
 *   - Dim_Entidad (tras fusión UO) -> data/nodes-entidades.json
 *   - Fact_Salidas.ID_UO           -> data/edges-uo-salida.json                (UO -> Salida)
 *   - Rel_Salida_Sucesora          -> data/edges-salida-entidad-sucesora.json  (Salida -> Entidad)
 *   - Rel_Salida_Predec_Entidad    -> data/edges-entidad-salida-predecesora.json (Entidad -> Salida)
 */

const GraphInterdependenciasConfig = {
  id: 'grafo-interdependencias',
  title: 'Red de Interdependencias Operativas',

  dataSources: {
    nodeSources: [
      'data/nodes-unidades-organizativas.json',
      'data/nodes-salidas.json',
      'data/nodes-entidades.json',
    ],
    edgeSources: [
      'data/edges-uo-salida.json',
      'data/edges-salida-entidad-sucesora.json',
      'data/edges-entidad-salida-predecesora.json',
    ],
  },

  auxDimensions: {
    unidadesOrganizativas: 'data/nodes-unidades-organizativas.json',
    rangosRTO: 'data/dim-rango-rto.json',
    subproductos: 'data/dim-subproducto.json',
  },

  // Layout jerárquico orientado al flujo (pedido explícito: "evitar
  // distribuciones caóticas"). breadthfirst con roots = Unidades
  // Organizativas reproduce el recorrido UO -> Salida -> Entidad -> Salida...
  defaultLayout: 'breadthfirst',
  defaultLayoutOptions: { roots: '.tipo-unidad_organizativa', directed: true, spacingFactor: 1.25 },
  layouts: ['cose', 'breadthfirst', 'concentric', 'circle'],

  // -----------------------------------------------------------------
  // Tipos de nodo. "entidad" es UN SOLO tipo (no se separan internas de
  // externas, según lo pedido), pero se colorea por dato (colorByField)
  // para distinguirlas a simple vista sin partir el grafo.
  // -----------------------------------------------------------------
  nodeTypes: {
    unidad_organizativa: {
      label: 'Unidad Organizativa',
      color: '#6a3d9a',
      shape: 'round-rectangle',
      size: 32,
    },
    salida: {
      label: 'Salida',
      color: '#145da0',
      shape: 'ellipse',
      size: 24,
    },
    entidad: {
      label: 'Entidad',
      shape: 'hexagon',
      size: 26,
      colorByField: 'tipoEntidad',
      colorMap: {
        Interno: '#b8860b',
        Externo: '#c0392b',
        Otros: '#7f8c8d',
      },
      color: '#7f8c8d', // fallback si tipoEntidad viniera vacío
    },
  },

  edgeTypes: {
    uo_produce_salida: { color: '#a996c2', width: 1.4 },
    salida_hacia_entidad: { color: '#7fa8d9', width: 1.4 },
    entidad_hacia_salida: { color: '#e0a96d', width: 1.4 },
  },

  // -----------------------------------------------------------------
  // Filtros. RTO / UO / Subproducto acotan las Salidas (igual criterio
  // que el Grafo 1). Los 4 "Mostrar/Ocultar..." son toggles independientes
  // sobre cada categoría de nodo pedida explícitamente.
  // -----------------------------------------------------------------
  filters: [
    {
      id: 'rto',
      label: 'Rango de RTO (criticidad)',
      type: 'enum',
      field: 'idRangoRTO',
      appliesToTypes: ['salida'],
      optionsFrom: 'rangosRTO',
      optionValue: (d) => d.id,
      optionLabel: (d) => d.rango,
      optionSort: (d) => d.ordenCriticidad,
    },
    {
      id: 'uo',
      label: 'Unidad Organizativa (de la Salida)',
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
      field: 'subproductos',
      appliesToTypes: ['salida'],
      optionsFrom: 'subproductos',
      optionValue: (d) => d.displayLabel,
      optionLabel: (d) => d.displayLabel,
      optionSort: (d) => d.displayLabel,
      dedupe: true,
    },
    {
      id: 'mostrarUO',
      label: 'Mostrar Unidades Organizativas',
      type: 'toggle',
      appliesToTypes: ['unidad_organizativa'],
    },
    // Nota: el toggle "Mostrar Salidas" que existía acá se retiró (al
    // destildarlo no quedaba nada visible, porque ocultar la Salida corta
    // todos los caminos UO->Entidad). Para ver la red sin el detalle de
    // cada Salida individual, usar la "Vista por Equipo" (botón en la
    // toolbar), que agrega la relación directamente entre equipos.
    {
      id: 'mostrarEntidadesInternas',
      label: 'Mostrar entidades internas',
      type: 'toggle',
      appliesToTypes: ['entidad'],
      field: 'tipoEntidad',
      matchValue: 'Interno',
    },
    {
      id: 'mostrarEntidadesExternas',
      label: 'Mostrar entidades externas',
      type: 'toggle',
      appliesToTypes: ['entidad'],
      field: 'tipoEntidad',
      matchValue: 'Externo',
    },
    // Nota: las 11 entidades clasificadas como "Otros" (ver Dim_Entidad)
    // no tienen toggle propio -- no fue pedido explícitamente -- y quedan
    // siempre visibles salvo que se oculten como aisladas.
  ],

  // -----------------------------------------------------------------
  // Panel lateral, siguiendo los ejemplos del pedido para cada tipo:
  //   Salida  -> UO, Subproductos, Aplicativos relacionados, Entidades
  //              relacionadas, Criticidad (RTO)
  //   Entidad -> Tipo, Salidas relacionadas, UO relacionadas
  // (más un panel razonable para Unidad Organizativa, no listado
  // explícitamente en el pedido pero necesario para un grafo completo).
  // -----------------------------------------------------------------
  panelFields: {
    unidad_organizativa: [
      {
        label: 'Cantidad de Salidas',
        compute: (ctx) => ctx.node.connectedEdges.filter('.arista-uo_produce_salida').targets().length,
      },
      {
        label: 'Salidas relacionadas',
        compute: (ctx) => ctx.node.connectedEdges.filter('.arista-uo_produce_salida').targets().map((n) => n.data('label')),
        list: true,
      },
    ],
    salida: [
      {
        label: 'Unidad Organizativa',
        compute: (ctx) => ctx.lookups.uoNombreById.get(ctx.node.data.idUO),
      },
      { label: 'RTO (criticidad)', field: 'rtoNormalizado' },
      { label: 'Frecuencia', field: 'frecuencia' },
      { label: 'Subproductos relacionados', field: 'subproductos', list: true },
      { label: 'Aplicativos relacionados', field: 'aplicativosRelacionados', list: true },
      {
        label: 'Entidades destino (sucesoras)',
        compute: (ctx) => ctx.node.connectedEdges.filter('.arista-salida_hacia_entidad').targets().map((n) => n.data('label')),
        list: true,
      },
      {
        label: 'Entidades origen (predecesoras)',
        compute: (ctx) => ctx.node.connectedEdges.filter('.arista-entidad_hacia_salida').sources().map((n) => n.data('label')),
        list: true,
      },
      { label: 'Incorporación en alcance', field: 'incorporacionEnAlcance' },
      { label: 'Descripción', field: 'descripcion' },
    ],
    entidad: [
      { label: 'Tipo', field: 'tipoEntidad' },
      {
        label: 'Salidas relacionadas',
        compute: (ctx) => ctx.node.neighborhood.filter('node.tipo-salida').map((n) => n.data('label')),
        list: true,
      },
      {
        label: 'Unidades Organizativas relacionadas',
        compute: (ctx) => {
          const salidas = ctx.node.neighborhood.filter('node.tipo-salida');
          const uoIds = new Set(salidas.map((n) => n.data('idUO')));
          return [...uoIds].map((id) => ctx.lookups.uoNombreById.get(id)).filter(Boolean);
        },
        list: true,
      },
    ],
  },
};
