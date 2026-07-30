/**
 * timeline-streamgraph.js
 * ========================
 * Dos renders D3 genéricos para la Temporalidad de Recursos:
 *
 *  - renderTimelineSmallMultiples: un mini gráfico de barras apiladas por
 *    Unidad Organizativa, POR CADA tipo de recurso (Personal Clave,
 *    Equipamiento de Oficina, Equipamiento Especial, Proveedores,
 *    Almacenamiento), en las 5 franjas temporales. Evita que los recursos
 *    nominalmente más chicos (ej. Equipamiento Especial, 19 registros)
 *    queden invisibles al lado de los más grandes (ej. Personal Clave).
 *    Soporta modo "totales" (cantidad) y "porcentual" (% del total de ESE
 *    tipo, dentro del filtro activo).
 *
 *  - renderStreamgraph: una sola vista con los 5 tipos apilados (offset
 *    wiggle), para ver de un vistazo cómo se reparte el total de recursos
 *    entre franjas.
 *
 * No conoce nada de Excel/BIA más allá del contrato { rangos, tipos } que
 * genera excel_to_json.py en data/recursos-temporalidad.json.
 */
const TimelineStreamgraph = (() => {
  let tooltipEl = null;
  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'd3-tooltip';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }
  function showTooltip(html, evt) {
    const t = ensureTooltip();
    t.innerHTML = html;
    t.style.opacity = 1;
    t.style.left = `${evt.clientX + 14}px`;
    t.style.top = `${evt.clientY + 10}px`;
  }
  function hideTooltip() { if (tooltipEl) tooltipEl.style.opacity = 0; }

  const COLOR_TIPO = {
    personal: '#6a3d9a',
    equipamiento_oficina: '#145da0',
    equipamiento_especial: '#2e8b57',
    proveedores: '#c0392b',
    almacenamiento: '#b8860b',
    aplicativos: '#e07b39',
  };

  function colorEscalaUO(uoLabels) {
    return d3.scaleOrdinal().domain(uoLabels).range(d3.schemeTableau10);
  }

  /**
   * @param {object} opts
   * @param {string} opts.containerId
   * @param {object[]} opts.tipos - [{id,label,unidadMedida,registros}] ya filtrados por UO/franja
   * @param {object[]} opts.rangos - [{id,label}] franjas a graficar (ya filtradas)
   * @param {'totales'|'porcentual'} opts.modo
   */
  function renderTimelineSmallMultiples({ containerId, tipos, rangos, modo }) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'timeline-grid';
    container.appendChild(grid);

    if (tipos.length === 0) {
      grid.innerHTML = '<div class="panel-vacio"><p>No hay tipos de recurso seleccionados.</p></div>';
      return;
    }

    tipos.forEach((tipo) => {
      const card = document.createElement('div');
      card.className = 'timeline-card';
      const totalTipo = d3.sum(tipo.registros, (r) => r.cantidad);
      card.innerHTML = `<h3>${tipo.label}</h3>
        <div class="subtitulo">${totalTipo} ${tipo.unidadMedida} en total ${modo === 'porcentual' ? '(vista %)' : '(vista totales)'}</div>`;
      grid.appendChild(card);

      const svgWrap = document.createElement('div');
      card.appendChild(svgWrap);

      if (tipo.registros.length === 0) {
        svgWrap.innerHTML = '<div class="panel-vacio"><p>Sin datos con los filtros actuales.</p></div>';
        return;
      }

      const width = 420;
      const height = 230;
      const margin = { top: 10, right: 12, bottom: 34, left: modo === 'porcentual' ? 40 : 46 };

      const uoLabels = Array.from(new Set(tipo.registros.map((r) => r.uoLabel || 'Sin UO')));
      const color = colorEscalaUO(uoLabels);

      // agrega cantidad por (rango, uo)
      const porRangoUO = new Map(); // idRango -> Map(uoLabel -> cantidad)
      rangos.forEach((r) => porRangoUO.set(r.id, new Map()));
      tipo.registros.forEach((r) => {
        if (!porRangoUO.has(r.idRango)) return;
        const m = porRangoUO.get(r.idRango);
        const uo = r.uoLabel || 'Sin UO';
        m.set(uo, (m.get(uo) || 0) + r.cantidad);
      });

      const dataPorRango = rangos.map((r) => {
        const m = porRangoUO.get(r.id);
        const total = d3.sum([...m.values()]);
        return { rango: r, total, porUO: m };
      });

      const maxTotal = modo === 'porcentual' ? 100 : (d3.max(dataPorRango, (d) => d.total) || 1);

      const svg = d3.select(svgWrap).append('svg').attr('width', width).attr('height', height);
      const x = d3.scaleBand().domain(rangos.map((r) => r.label)).range([margin.left, width - margin.right]).padding(0.28);
      const y = d3.scaleLinear().domain([0, maxTotal]).nice().range([height - margin.bottom, margin.top]);

      svg.append('g').attr('class', 'eje')
        .attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x))
        .selectAll('text').attr('transform', 'rotate(-18)').style('text-anchor', 'end');

      svg.append('g').attr('class', 'eje')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(4).tickFormat((v) => (modo === 'porcentual' ? `${v}%` : v)));

      dataPorRango.forEach((d) => {
        let acumulado = 0;
        const entradas = [...d.porUO.entries()];
        entradas.forEach(([uo, cantidad]) => {
          const valor = modo === 'porcentual' ? (totalTipo > 0 ? (cantidad / totalTipo) * 100 : 0) : cantidad;
          const y0 = y(acumulado + valor);
          const y1 = y(acumulado);
          acumulado += valor;
          svg.append('rect')
            .attr('x', x(d.rango.label))
            .attr('width', x.bandwidth())
            .attr('y', y0)
            .attr('height', Math.max(0, y1 - y0))
            .attr('fill', color(uo))
            .style('cursor', 'pointer')
            .on('mousemove', (evt) => showTooltip(
              `<strong>${uo}</strong><span class="muted">${tipo.label} · ${d.rango.label}</span>${cantidad} ${tipo.unidadMedida} ${modo === 'porcentual' ? `(${valor.toFixed(1)}%)` : ''}`,
              evt))
            .on('mouseleave', hideTooltip);
        });
        // etiqueta de total sobre la barra
        if (d.total > 0) {
          svg.append('text')
            .attr('x', x(d.rango.label) + x.bandwidth() / 2)
            .attr('y', y(acumulado) - 4)
            .attr('text-anchor', 'middle')
            .attr('font-size', 10)
            .attr('fill', 'var(--color-text-muted)')
            .text(modo === 'porcentual' ? `${acumulado.toFixed(0)}%` : d.total);
        }
      });
    });
  }

  /**
   * @param {object} opts
   * @param {string} opts.containerId
   * @param {object[]} opts.tipos - [{id,label,unidadMedida,registros}]
   * @param {object[]} opts.rangos
   */
  function renderStreamgraph({ containerId, tipos, rangos }) {
    const container = document.getElementById(containerId);
    container.innerHTML = '<div class="streamgraph-shell"><h3>Distribución del total de recursos por franja temporal</h3><div id="stream-legend" class="stream-legend"></div><div id="stream-svg-wrap"></div></div>';

    const legendEl = container.querySelector('#stream-legend');
    tipos.forEach((t) => {
      const item = document.createElement('span');
      item.className = 'stream-legend-item';
      item.innerHTML = `<span class="stream-legend-dot" style="background:${COLOR_TIPO[t.id] || '#999'}"></span>${t.label}`;
      legendEl.appendChild(item);
    });

    const wrap = container.querySelector('#stream-svg-wrap');
    if (tipos.length === 0 || rangos.length === 0) {
      wrap.innerHTML = '<div class="panel-vacio"><p>No hay datos para graficar con los filtros actuales.</p></div>';
      return;
    }

    // matriz: por cada franja, cantidad total de cada tipo
    const data = rangos.map((r) => {
      const row = { rango: r.label };
      tipos.forEach((t) => {
        row[t.id] = d3.sum(t.registros.filter((reg) => reg.idRango === r.id), (reg) => reg.cantidad);
      });
      return row;
    });

    const width = Math.max(wrap.clientWidth || 900, 700);
    const height = 420;
    const margin = { top: 30, right: 30, bottom: 40, left: 30 };

    const keys = tipos.map((t) => t.id);
    const stack = d3.stack().keys(keys).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut);
    const series = stack(data);

    const x = d3.scalePoint().domain(rangos.map((r) => r.label)).range([margin.left, width - margin.right]);
    const yExtent = [
      d3.min(series, (s) => d3.min(s, (d) => d[0])),
      d3.max(series, (s) => d3.max(s, (d) => d[1])),
    ];
    const y = d3.scaleLinear().domain(yExtent).range([height - margin.bottom, margin.top]);

    const area = d3.area()
      .x((d) => x(d.data.rango))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveBasis);

    const svg = d3.select(wrap).append('svg').attr('width', width).attr('height', height);

    svg.selectAll('path.stream')
      .data(series)
      .join('path')
      .attr('class', 'stream')
      .attr('d', area)
      .attr('fill', (d) => COLOR_TIPO[d.key] || '#999')
      .attr('fill-opacity', 0.88)
      .style('cursor', 'pointer')
      .on('mousemove', (evt, d) => {
        const tipo = tipos.find((t) => t.id === d.key);
        const total = d3.sum(tipo.registros, (r) => r.cantidad);
        showTooltip(`<strong>${tipo.label}</strong><span class="muted">${total} ${tipo.unidadMedida} en total (filtro actual)</span>`, evt);
      })
      .on('mouseleave', hideTooltip);

    svg.append('g').attr('class', 'eje')
      .attr('transform', `translate(0,${height - margin.bottom + 6})`)
      .call(d3.axisBottom(x).tickSize(0))
      .call((g) => g.select('.domain').remove());
  }

  return { renderTimelineSmallMultiples, renderStreamgraph, COLOR_TIPO };
})();
