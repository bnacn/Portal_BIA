/**
 * graph-interdependencias-equipo.config.js
 * ==========================================
 * "Vista por Equipo" del Grafo 2: la Salida deja de ser un nodo y pasa a
 * ser el dato agregado (peso = cantidad de Salidas distintas) de la
 * relación directa Equipo <-> Equipo (Unidad Organizativa o Entidad).
 * Reemplaza al toggle roto "Mostrar Salidas" (al destildarlo no quedaba
 * nada visible, porque ocultar la Salida cortaba todos los caminos).
 *
 * Fuente: data/edges-equipo-agregado.json (ver tools/excel_to_json.py).
 */

const GraphInterdependenciasEquipoConfig = {
  id: 'grafo-interdependencias-equipo',
  title: 'Interdependencias — Vista por Equipo',

  dataSources: {
    nodeSources: [
      'data/nodes-unidades-organizativas.json',
      'data/nodes-entidades.json',
    ],
    edgeSources: [
      'data/edges-equipo-agregado.json',
    ],
  },

  auxDimensions: {
    unidadesOrganizativas: 'data/nodes-unidades-organizativas.json',
  },

  defaultLayout: 'cose',
  defaultLayoutOptions: { nodeRepulsion: 12000, idealEdgeLength: 110 },
  layouts: ['cose', 'breadthfirst', 'concentric', 'circle'],

  nodeTypes: {
    unidad_organizativa: { label: 'Unidad Organizativa', color: '#6a3d9a', shape: 'round-rectangle', size: 32 },
    entidad: {
      label: 'Entidad', shape: 'hexagon', size: 26,
      colorByField: 'tipoEntidad',
      colorMap: { Interno: '#b8860b', Externo: '#c0392b', Otros: '#7f8c8d' },
      color: '#7f8c8d',
    },
  },

  edgeTypes: {
    equipo_hacia_entidad: {
      color: '#7fa8d9', widthByField: 'peso', widthDomain: [1, 12], widthRange: [1.2, 9],
    },
    entidad_hacia_equipo: {
      color: '#e0a96d', widthByField: 'peso', widthDomain: [1, 12], widthRange: [1.2, 9],
    },
  },

  filters: [
    {
      id: 'uo',
      label: 'Unidad Organizativa',
      type: 'enum',
      field: 'idUO',
      appliesToTypes: ['unidad_organizativa'],
      optionsFrom: 'unidadesOrganizativas',
      optionValue: (d) => d.data.idUO,
      optionLabel: (d) => d.label,
      optionSort: (d) => d.label,
    },
    {
      id: 'mostrarEntidadesInternas',
      label: 'Mostrar entidades internas (equipos BNA no relevados)',
      type: 'toggle',
      appliesToTypes: ['entidad'],
      field: 'tipoEntidad',
      matchValue: 'Interno',
    },
    {
      id: 'mostrarEntidadesExternas',
      label: 'Mostrar entidades externas (terceros)',
      type: 'toggle',
      appliesToTypes: ['entidad'],
      field: 'tipoEntidad',
      matchValue: 'Externo',
    },
  ],

  panelFields: {
    unidad_organizativa: [
      {
        label: 'Equipos relacionados (sucesores)',
        compute: (ctx) => ctx.node.connectedEdges.filter('.arista-equipo_hacia_entidad').targets()
          .map((n) => `${n.data('label')} (${n.connectedEdges().length} rel.)`),
        list: true,
      },
      {
        label: 'Equipos relacionados (predecesores)',
        compute: (ctx) => ctx.node.connectedEdges.filter('.arista-entidad_hacia_equipo').sources()
          .map((n) => n.data('label')),
        list: true,
      },
    ],
    entidad: [
      { label: 'Tipo', field: 'tipoEntidad' },
      {
        label: 'Unidades Organizativas relacionadas',
        compute: (ctx) => ctx.node.neighborhood.filter('node.tipo-unidad_organizativa').map((n) => n.data('label')),
        list: true,
      },
    ],
  },
};
