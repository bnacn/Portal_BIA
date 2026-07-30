/**
 * filter-engine.js
 * =================
 * Motor genérico de filtros. Calcula, a partir de un conjunto de filtros
 * activos y del dataset completo (nodos), qué nodos deben quedar visibles.
 *
 * No sabe nada de "RTO" o "Unidad Organizativa" puntualmente: opera sobre
 * definiciones de filtro declaradas en la config de cada grafo. Tipos de
 * filtro soportados:
 *
 *   - 'enum'   : el nodo (o un array dentro de node.data[field]) debe
 *                contener alguno de los valores seleccionados.
 *   - 'range'  : el nodo tiene un valor ordinal (ej. idRangoRTO) y el
 *                filtro define un mínimo/máximo de ese orden.
 *   - 'toggle' : muestra/oculta directamente todos los nodos de un tipo
 *                (ej. "Mostrar entidades externas").
 *
 * Los filtros se combinan con AND entre sí. Dentro de un mismo filtro
 * 'enum' multi-valor, se combinan con OR (ej. UO=A o UO=B).
 */

const FilterEngine = (() => {
  /**
   * @param {object[]} nodes - nodos en formato Cytoscape ya cargados (cy.nodes())
   *                           o el array plano { id, type, label, data }.
   * @param {object[]} filterDefs - config.filters del grafo
   * @param {object} activeValues - { [filterId]: valorSeleccionado(es) }
   * @returns {Set<string>} ids de nodos que deben quedar visibles
   */
  function computeVisibleNodeIds(nodes, filterDefs, activeValues) {
    const getData = (n) => (typeof n.data === 'function' ? n.data() : n.data || n);

    const visible = new Set();

    nodes.forEach((n) => {
      const data = getData(n);
      const id = typeof n.id === 'function' ? n.id() : n.id;
      const nodeType = data.type;

      const passesAll = filterDefs.every((def) => {
        const active = activeValues[def.id];
        // sin selección activa para este filtro => no restringe
        if (active === undefined || active === null || (Array.isArray(active) && active.length === 0)) {
          return true;
        }

        // Los filtros de tipo 'toggle' / 'enum' de tipo de nodo pueden declarar
        // `appliesToTypes` para que solo afecten a ciertos tipos de nodo
        // (ej. el filtro de RTO solo aplica a nodos "salida", no a "aplicativo").
        if (def.appliesToTypes && !def.appliesToTypes.includes(nodeType)) {
          return true;
        }

        if (def.type === 'toggle') {
          // Si el toggle declara field/matchValue, solo gobierna los nodos
          // cuyo dato coincide (ej. tipoEntidad === 'Interno'); el resto de
          // los nodos de ese mismo tipo no se ven afectados por ESTE toggle
          // (podrán estarlo por otro, ej. el de Externo).
          if (def.field && def.matchValue !== undefined) {
            if (data[def.field] !== def.matchValue) return true;
          }
          // active = true/false -> visibilidad directa
          return active !== false;
        }

        if (def.type === 'enum') {
          const fieldValue = data[def.field];
          const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
          const activeArr = Array.isArray(active) ? active : [active];
          return values.some((v) => activeArr.includes(v));
        }

        if (def.type === 'range') {
          const fieldValue = data[def.field];
          if (fieldValue === undefined || fieldValue === null) return true;
          const [min, max] = active; // [minOrden, maxOrden]
          return fieldValue >= min && fieldValue <= max;
        }

        return true;
      });

      if (passesAll) visible.add(id);
    });

    return visible;
  }

  return { computeVisibleNodeIds };
})();
