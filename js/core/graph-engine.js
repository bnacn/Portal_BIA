/**
 * graph-engine.js
 * ================
 * Motor genérico de visualización de grafos, construido sobre Cytoscape.js.
 *
 * Esta es la ÚNICA pieza que sabe hablar con Cytoscape. No conoce nada de
 * "Salidas", "Aplicativos" ni ningún concepto del BIA: todo lo específico
 * de cada grafo (colores, formas, layouts permitidos, qué hacer al hacer
 * click en un nodo) llega desde afuera vía `config` y callbacks.
 *
 * Para agregar un grafo nuevo NO se toca este archivo: se crea un nuevo
 * config (js/configs/*.config.js) y un pequeño script de arranque
 * (js/pages/init-*.js) que instancia GraphEngine con ese config.
 */

class GraphEngine {
  /**
   * @param {object} opts
   * @param {string} opts.containerId - id del <div> donde se monta Cytoscape
   * @param {object} opts.config - configuración del grafo (tipos de nodo/arista, layouts, etc.)
   * @param {function} [opts.onNodeSelect] - callback(nodeData) al seleccionar un nodo
   * @param {function} [opts.onSelectionClear] - callback() al deseleccionar todo
   */
  constructor({ containerId, config, onNodeSelect, onSelectionClear }) {
    this.containerId = containerId;
    this.config = config;
    this.onNodeSelect = onNodeSelect || (() => {});
    this.onSelectionClear = onSelectionClear || (() => {});
    this.cy = null;
    this.labelsVisible = true;
    this.allNodes = [];   // dataset completo sin filtrar (formato Cytoscape)
    this.allEdges = [];
  }

  // -----------------------------------------------------------------
  // Inicialización
  // -----------------------------------------------------------------

  /**
   * Traduce nuestro formato genérico { nodes, edges } (ver data-loader.js)
   * al formato de elementos que espera Cytoscape, aplicando el estilo
   * declarado en config.nodeTypes / config.edgeTypes.
   */
  _toCytoscapeElements(nodes, edges) {
    const cyNodes = nodes.map((n) => ({
      group: 'nodes',
      data: {
        id: n.id,
        label: n.label,
        type: n.type,
        ...n.data,
      },
      classes: `tipo-${n.type}`,
    }));

    const cyEdges = edges.map((e) => ({
      group: 'edges',
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        ...e.data,
      },
      classes: `arista-${e.type}${e.directed ? ' dirigida' : ' no-dirigida'}`,
    }));

    return [...cyNodes, ...cyEdges];
  }

  /**
   * Construye el array de `style` de Cytoscape a partir de config.nodeTypes
   * y config.edgeTypes. Mantiene todo el diseño visual centralizado en la
   * config del grafo, no hardcodeado acá.
   */
  _buildStylesheet() {
    const style = [
      {
        selector: 'node',
        style: {
          'label': this.labelsVisible ? 'data(label)' : '',
          'font-size': 10,
          'font-family': 'Segoe UI, Arial, sans-serif',
          'color': '#1a1a2e',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 4,
          'text-wrap': 'ellipsis',
          'text-max-width': '90px',
          'border-width': 1,
          'border-color': '#ffffff',
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 1.4,
          'line-color': '#b7bdc9',
          'target-arrow-color': '#b7bdc9',
          'curve-style': 'bezier',
          'opacity': 0.75,
        },
      },
      { selector: 'edge.dirigida', style: { 'target-arrow-shape': 'triangle' } },
      { selector: 'edge.no-dirigida', style: { 'target-arrow-shape': 'none' } },
      // Estados de interacción (aplican a cualquier tipo de nodo/arista)
      {
        selector: 'node:selected',
        style: { 'border-width': 3, 'border-color': '#ff6b35', 'z-index': 999 },
      },
      {
        selector: '.resaltado-busqueda',
        style: { 'border-width': 3, 'border-color': '#ffd23f', 'z-index': 998 },
      },
      { selector: '.atenuado', style: { opacity: 0.12 } },
      { selector: '.oculto', style: { display: 'none' } },
    ];

    // Estilo por tipo de nodo, declarado en la config del grafo. Si el tipo
    // declara `colorByField` + `colorMap`, el color se resuelve por elemento
    // según el valor de ese campo de datos (ej. Entidad Interna/Externa/Otros
    // dentro de un mismo tipo de nodo "entidad", sin crear tipos separados:
    // así se cumple "no separar entidades internas de externas" del Grafo 2
    // y a la vez se las distingue visualmente).
    Object.entries(this.config.nodeTypes).forEach(([type, def]) => {
      const backgroundColor = def.colorByField
        ? (ele) => (def.colorMap && def.colorMap[ele.data(def.colorByField)]) || def.color || '#999999'
        : def.color;
      style.push({
        selector: `node.tipo-${type}`,
        style: {
          'background-color': backgroundColor,
          'shape': def.shape || 'ellipse',
          'width': def.size || 28,
          'height': def.size || 28,
        },
      });
    });

    // Estilo por tipo de arista, declarado en la config del grafo. Si el
    // tipo declara `widthByField` + `widthDomain`/`widthRange`, el ancho se
    // resuelve por elemento (ej. peso = cantidad de Salidas agregadas en la
    // Vista por Equipo), igual criterio que `colorByField` para nodos.
    Object.entries(this.config.edgeTypes || {}).forEach(([type, def]) => {
      const width = def.widthByField
        ? (ele) => {
            const v = ele.data(def.widthByField);
            const [minV, maxV] = def.widthDomain || [1, 1];
            const [minW, maxW] = def.widthRange || [1, 6];
            if (v == null || maxV === minV) return minW;
            const t = Math.min(1, Math.max(0, (v - minV) / (maxV - minV)));
            return minW + t * (maxW - minW);
          }
        : (def.width || 1.4);
      style.push({
        selector: `edge.arista-${type}`,
        style: {
          'line-color': def.color || '#b7bdc9',
          'target-arrow-color': def.color || '#b7bdc9',
          'width': width,
        },
      });
    });

    return style;
  }

  /**
   * Monta Cytoscape en el DOM con los datos ya cargados por data-loader.js.
   * @param {{nodes: object[], edges: object[]}} data
   */
  init(data) {
    const elements = this._toCytoscapeElements(data.nodes, data.edges);

    this.cy = cytoscape({
      container: document.getElementById(this.containerId),
      elements,
      style: this._buildStylesheet(),
      layout: { name: 'preset' }, // el layout real se aplica después vía setLayout()
      minZoom: 0.1,
      maxZoom: 4,
      wheelSensitivity: 0.25,
      // Selección múltiple con click+shift / arrastre, nativo de Cytoscape
      boxSelectionEnabled: true,
      selectionType: 'additive',
    });

    this.allNodes = this.cy.nodes();
    this.allEdges = this.cy.edges();

    this._wireBaseInteractions();
    this.setLayout(this.config.defaultLayout || 'cose', this.config.defaultLayoutOptions || {});

    return this.cy;
  }

  // -----------------------------------------------------------------
  // Interacciones base (comunes a todos los grafos)
  // -----------------------------------------------------------------

  _wireBaseInteractions() {
    this.cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      this.onNodeSelect(this._nodeToPlainData(node));
    });

    this.cy.on('tap', (evt) => {
      if (evt.target === this.cy) {
        this.cy.elements().unselect();
        this.onSelectionClear();
      }
    });
  }

  _nodeToPlainData(node) {
    return {
      id: node.id(),
      type: node.data('type'),
      label: node.data('label'),
      data: node.data(),
      // conveniencias para el panel lateral / cálculos de agregación
      neighborhood: node.closedNeighborhood(),
      connectedEdges: node.connectedEdges(),
    };
  }

  // -----------------------------------------------------------------
  // Layouts
  // -----------------------------------------------------------------

  /**
   * Aplica uno de los layouts habilitados en config.layouts.
   * Los 4 layouts pedidos mapean directo a los layouts nativos de Cytoscape:
   *   Force        -> 'cose'          (fuerza dirigida, bueno para explorar)
   *   Circle       -> 'circle'
   *   Breadthfirst -> 'breadthfirst'  (jerárquico por niveles, ideal para Grafo 2)
   *   Concentric   -> 'concentric'
   */
  setLayout(name, extraOptions = {}) {
    const LAYOUTS = {
      cose: { name: 'cose', animate: false, nodeRepulsion: 8000, idealEdgeLength: 80 },
      circle: { name: 'circle', animate: false },
      breadthfirst: { name: 'breadthfirst', animate: false, directed: true, spacingFactor: 1.1 },
      concentric: { name: 'concentric', animate: false, minNodeSpacing: 30 },
    };
    const base = LAYOUTS[name] || LAYOUTS.cose;
    this.cy.layout({ ...base, ...extraOptions }).run();
  }

  // -----------------------------------------------------------------
  // Funcionalidades genéricas pedidas: zoom, ocultar aislados, labels,
  // exportar imagen. El "arrastrar nodos" y "selección múltiple" son
  // nativos de Cytoscape y ya quedaron habilitados en init().
  // -----------------------------------------------------------------

  zoomIn() { this.cy.zoom(this.cy.zoom() * 1.2); }
  zoomOut() { this.cy.zoom(this.cy.zoom() * 0.8); }
  fit() { this.cy.fit(undefined, 40); }

  toggleLabels() {
    this.labelsVisible = !this.labelsVisible;
    this.cy.style().selector('node').style('label', this.labelsVisible ? 'data(label)' : '').update();
    return this.labelsVisible;
  }

  /** Oculta (o vuelve a mostrar) los nodos sin ninguna arista visible. */
  toggleIsolatedNodes(hide) {
    this.cy.nodes().forEach((n) => {
      const visibleDegree = n.connectedEdges().filter((e) => !e.hasClass('oculto')).length;
      if (visibleDegree === 0) {
        n.toggleClass('oculto', hide);
      }
    });
    this.cy.style().update();
  }

  exportImage(filename = 'grafo.png') {
    const png64 = this.cy.png({ full: true, scale: 2, bg: '#ffffff' });
    const link = document.createElement('a');
    link.href = png64;
    link.download = filename;
    link.click();
  }

  // -----------------------------------------------------------------
  // Búsqueda (delegada acá porque necesita tocar clases de Cytoscape;
  // search.js arma el término y decide qué hacer con los resultados)
  // -----------------------------------------------------------------

  highlightNodesByIds(ids) {
    this.cy.nodes().removeClass('resaltado-busqueda atenuado');
    if (!ids || ids.length === 0) return;
    const idSet = new Set(ids);
    this.cy.nodes().forEach((n) => {
      if (idSet.has(n.id())) {
        n.addClass('resaltado-busqueda');
      } else {
        n.addClass('atenuado');
      }
    });
  }

  clearHighlight() {
    this.cy.nodes().removeClass('resaltado-busqueda atenuado');
  }

  // -----------------------------------------------------------------
  // Filtros: aplica un set de nodos "visibles" (calculado por
  // filter-engine.js) ocultando el resto. Las aristas se ocultan
  // automáticamente si alguno de sus extremos está oculto.
  // -----------------------------------------------------------------

  applyVisibleNodeSet(visibleNodeIds) {
    this.cy.nodes().forEach((n) => {
      n.toggleClass('oculto', !visibleNodeIds.has(n.id()));
    });
    this.cy.edges().forEach((e) => {
      const bothVisible = visibleNodeIds.has(e.source().id()) && visibleNodeIds.has(e.target().id());
      e.toggleClass('oculto', !bothVisible);
    });
    this.cy.style().update();
  }

  /**
   * Devuelve los nodos (opcionalmente acotados por selector) que NO están
   * ocultos por nuestros propios filtros.
   *
   * IMPORTANTE: a propósito NO se usa el selector ":visible" ni el método
   * `.visible()` de Cytoscape acá. Se verificó (ver notas de desarrollo del
   * Grafo 2) que, en consultas sucesivas sobre el mismo string de selector
   * antes/después de un cambio masivo de clases, Cytoscape puede devolver
   * un resultado cacheado y desactualizado para ":visible" -- ocurre incluso
   * llamando a `cy.style().update()` antes. La clase "oculto" que nosotros
   * mismos gestionamos es la única fuente de verdad confiable.
   */
  getVisibleNodes(selector) {
    const base = selector ? this.cy.nodes(selector) : this.cy.nodes();
    return base.filter((n) => !n.hasClass('oculto'));
  }
}
