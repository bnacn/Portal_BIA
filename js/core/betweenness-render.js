/**
 * betweenness-render.js
 * =======================
 * Barra horizontal ranqueada por betweenness centrality, con color por
 * categoría (Equipo BNA relevado / no relevado / Tercero / Aplicativo).
 * Ver tools/excel_to_json.py para cómo se calcula betweenness-equipos.json.
 */
const BetweennessRender = (() => {
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

  const COLOR_CATEGORIA = {
    equipo_bna_relevado: '#6a3d9a',
    equipo_bna_no_relevado: '#b8860b',
    tercero: '#c0392b',
    aplicativo: '#2e8b57',
  };
  const LABEL_CATEGORIA = {
    equipo_bna_relevado: 'Equipo BNA (relevado)',
    equipo_bna_no_relevado: 'Equipo BNA (no relevado)',
    tercero: 'Tercero',
    aplicativo: 'Aplicativo',
  };

  function render({ containerId, nodos, onSelect }) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (nodos.length === 0) {
      container.innerHTML = '<div class="panel-vacio"><p>No hay resultados con los filtros actuales.</p></div>';
      return;
    }

    const rowHeight = 20;
    const margin = { top: 10, right: 60, bottom: 10, left: 260 };
    const width = Math.max(container.clientWidth || 700, 500);
    const height = margin.top + margin.bottom + nodos.length * rowHeight;

    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);

    const x = d3.scaleLinear().domain([0, d3.max(nodos, (d) => d.betweenness) || 1]).range([0, width - margin.left - margin.right]);
    const y = d3.scaleBand().domain(nodos.map((d) => d.id)).range([margin.top, height - margin.bottom]).padding(0.22);

    const g = svg.append('g').attr('transform', `translate(${margin.left},0)`);

    const filas = g.selectAll('g.betweenness-bar-row')
      .data(nodos)
      .join('g')
      .attr('class', 'betweenness-bar-row')
      .attr('transform', (d) => `translate(0,${y(d.id)})`)
      .on('click', (evt, d) => { if (onSelect) onSelect(d); })
      .on('mousemove', (evt, d) => showTooltip(
        `<strong>${d.label}</strong><span class="muted">${LABEL_CATEGORIA[d.categoria]}</span>Betweenness: ${d.betweenness.toFixed(4)}<br>Grado (Salidas/relaciones directas): ${d.grado}`,
        evt))
      .on('mouseleave', hideTooltip);

    filas.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', (d) => Math.max(1, x(d.betweenness)))
      .attr('height', y.bandwidth())
      .attr('fill', (d) => COLOR_CATEGORIA[d.categoria] || '#999');

    filas.append('text')
      .attr('class', 'etiqueta')
      .attr('x', -6).attr('y', y.bandwidth() / 2).attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text((d) => (d.label.length > 34 ? `${d.label.slice(0, 32)}…` : d.label));

    filas.append('text')
      .attr('class', 'valor')
      .attr('x', (d) => x(d.betweenness) + 6).attr('y', y.bandwidth() / 2).attr('dy', '0.35em')
      .text((d) => d.betweenness.toFixed(3));

    svg.attr('height', height);
  }

  return { render, COLOR_CATEGORIA, LABEL_CATEGORIA };
})();
