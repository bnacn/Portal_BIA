/**
 * filter-panel-builder.js
 * ========================
 * Construye la interfaz de filtros (checkboxes agrupados) a partir de
 * `config.filters` de un grafo y de las dimensiones auxiliares cargadas
 * (config.auxDimensions). Es el puente entre el DOM y filter-engine.js:
 * no decide qué queda visible (eso lo hace FilterEngine), solo junta los
 * valores tildados por el usuario y avisa vía callback.
 *
 * Reutilizable por cualquier grafo: no conoce "RTO" ni "Unidad Organizativa",
 * solo lee las definiciones declarativas de la config.
 */

const FilterPanelBuilder = (() => {
  /**
   * @param {HTMLElement} containerEl - dónde renderizar los grupos de filtro
   * @param {object[]} filterDefs - config.filters
   * @param {object} auxData - { [nombreDimension]: array } ya cargado por data-loader.js
   * @param {function} onChange - se llama con el estado activo cada vez que cambia algo
   * @returns {{ getActiveValues: function }}
   */
  function build(containerEl, filterDefs, auxData, onChange) {
    const activeValues = {}; // { [filterId]: string[] | boolean }
    filterDefs.forEach((def) => {
      activeValues[def.id] = def.type === 'toggle' ? true : [];
    });

    containerEl.innerHTML = '';

    filterDefs.forEach((def) => {
      if (def.type === 'toggle') {
        renderToggleFilter(containerEl, def, activeValues, onChange);
        return;
      }
      renderEnumFilter(containerEl, def, auxData, activeValues, onChange);
    });

    return { getActiveValues: () => activeValues };
  }

  /** Filtro de un único checkbox on/off (ej. "Mostrar entidades externas"). */
  function renderToggleFilter(containerEl, def, activeValues, onChange) {
    const grupo = document.createElement('div');
    grupo.className = 'filtro-grupo filtro-toggle';
    const id = `filtro-${def.id}`;
    grupo.innerHTML = `<label for="${id}" style="display:flex;align-items:center;gap:6px;">
      <input type="checkbox" id="${id}" checked> ${escapeHtml(def.label)}</label>`;
    const input = grupo.querySelector('input');
    input.addEventListener('change', () => {
      activeValues[def.id] = input.checked;
      onChange(activeValues);
    });
    containerEl.appendChild(grupo);
  }

  /** Filtro de checkboxes múltiples sobre una dimensión (ej. Unidad Organizativa). */
  function renderEnumFilter(containerEl, def, auxData, activeValues, onChange) {
    const rawOptions = (auxData[def.optionsFrom] || []);

    // arma pares {value, label, sortKey}, aplicando dedupe si corresponde
    const seen = new Set();
    const opciones = [];
    rawOptions.forEach((d) => {
      const value = def.optionValue(d);
      const label = def.optionLabel(d);
      const sortKey = def.optionSort ? def.optionSort(d) : label;
      const dedupeKey = def.dedupe ? String(value) : `${value}__${opciones.length}`;
      if (def.dedupe && seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      opciones.push({ value, label, sortKey });
    });
    opciones.sort((a, b) => (a.sortKey > b.sortKey ? 1 : a.sortKey < b.sortKey ? -1 : 0));

    const grupo = document.createElement('div');
    grupo.className = 'filtro-grupo';
    grupo.innerHTML = `<h3>${escapeHtml(def.label)}</h3><div class="filtro-opciones" data-filtro="${def.id}"></div>`;
    const opcionesEl = grupo.querySelector('.filtro-opciones');

    opciones.forEach((opt) => {
      const id = `filtro-${def.id}-${String(opt.value).replace(/\W+/g, '_')}`;
      const wrap = document.createElement('label');
      wrap.setAttribute('for', id);
      wrap.innerHTML = `<input type="checkbox" id="${id}" value="${escapeAttr(opt.value)}"> ${escapeHtml(opt.label)}`;
      opcionesEl.appendChild(wrap);

      const input = wrap.querySelector('input');
      input.addEventListener('change', () => {
        const current = activeValues[def.id];
        if (input.checked) {
          current.push(opt.value);
        } else {
          activeValues[def.id] = current.filter((v) => v !== opt.value);
        }
        onChange(activeValues);
      });
    });

    containerEl.appendChild(grupo);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }
  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;');
  }

  return { build };
})();
