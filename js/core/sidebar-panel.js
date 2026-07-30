/**
 * sidebar-panel.js
 * =================
 * Panel lateral genérico. Renderiza los atributos de un nodo seleccionado
 * según la definición declarada en config.panelFields[tipoDeNodo].
 *
 * Cada entrada de panelFields puede ser:
 *   { label: 'Nombre', field: 'label' }                    -> valor directo de node.data
 *   { label: 'Subproductos', field: 'subproductos', list: true }  -> array -> lista
 *   { label: 'Cant. de salidas', compute: (ctx) => ... }    -> valor calculado
 *
 * `compute` recibe un contexto { node, cy, lookups } con acceso al grafo
 * completo (no solo al nodo) y a dimensiones auxiliares que el grafo haya
 * declarado en config.auxDimensions (ej. nombres de Unidad Organizativa),
 * para poder calcular agregaciones reales sin inventar datos: todo sale
 * de las aristas, nodos y dimensiones ya cargados.
 */

const SidebarPanel = (() => {
  let containerEl = null;
  let engineRef = null; // referencia al GraphEngine, para leer cy.nodes()/cy.edges()
  let config = null;
  let lookupsRef = {}; // dimensiones auxiliares (ej. uoNombreById), ver init-*.js

  function init({ containerId, engine, graphConfig, lookups }) {
    containerEl = document.getElementById(containerId);
    engineRef = engine;
    config = graphConfig;
    lookupsRef = lookups || {};
    renderEmpty();
  }

  function renderEmpty() {
    containerEl.innerHTML = `
      <div class="panel-vacio">
        <p>Seleccioná un nodo del grafo para ver su detalle acá.</p>
      </div>`;
  }

  function renderNode(nodeData) {
    const fields = (config.panelFields && config.panelFields[nodeData.type]) || [];
    const typeLabel = (config.nodeTypes[nodeData.type] && config.nodeTypes[nodeData.type].label) || nodeData.type;

    const ctx = {
      node: nodeData,
      cy: engineRef.cy,
      lookups: lookupsRef,
    };

    const rows = fields.map((f) => {
      let value;
      if (typeof f.compute === 'function') {
        value = f.compute(ctx);
      } else {
        value = nodeData.data[f.field];
      }
      return renderField(f.label, value, f.list);
    }).join('');

    // Si el tipo de nodo colorea por dato (ej. "entidad" según tipoEntidad),
    // el badge del panel debe reflejar ESE color puntual, no un color fijo
    // por tipo (ver graph-engine.js _buildStylesheet, mismo criterio).
    const typeDef = config.nodeTypes[nodeData.type] || {};
    let badgeStyle = '';
    if (typeDef.colorByField) {
      const val = nodeData.data[typeDef.colorByField];
      const color = (typeDef.colorMap && typeDef.colorMap[val]) || typeDef.color || '#7f8c8d';
      badgeStyle = ` style="background:${color}"`;
    }

    containerEl.innerHTML = `
      <div class="panel-header">
        <span class="panel-badge tipo-${nodeData.type}"${badgeStyle}>${typeLabel}</span>
        <h3>${escapeHtml(nodeData.label)}</h3>
      </div>
      <div class="panel-body">${rows}</div>
    `;
  }

  function renderField(label, value, isList) {
    if (value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0)) {
      return `<div class="panel-field"><span class="panel-field-label">${label}</span>
              <span class="panel-field-value panel-field-vacio">Sin datos en el modelo</span></div>`;
    }
    if (isList && Array.isArray(value)) {
      const items = value.map((v) => `<li>${escapeHtml(String(v))}</li>`).join('');
      return `<div class="panel-field"><span class="panel-field-label">${label}</span>
              <ul class="panel-field-list">${items}</ul></div>`;
    }
    return `<div class="panel-field"><span class="panel-field-label">${label}</span>
            <span class="panel-field-value">${escapeHtml(String(value))}</span></div>`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { init, renderNode, renderEmpty };
})();
