/**
 * sankey-render.js
 * =================
 * Render genérico de un diagrama de Sankey con D3 + d3-sankey. No conoce
 * "Salidas" ni "Aplicativos": recibe nodos/links ya resueltos y funciones
 * de color/formato. Pensado para reusarse en cualquier vista de flujo
 * (hoy: Aplicativos <-> Salidas del Grafo 1).
 *
 * Los nodos AISLADOS (sin ningún link) simplemente no producen flujo, así
 * que nunca aparecen en el diagrama: el Sankey cumple "por defecto sin
 * aislados" de forma natural, sin necesidad de lógica extra.
 */
const SankeyRender = (() => {
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
  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.opacity = 0;
  }

  /**
   * @param {object} opts
   * @param {string} opts.containerId
   * @param {{id:string,label:string,category:string}[]} opts.nodesData
   * @param {{source:string,target:string,value:number,meta?:object}[]} opts.linksData
   * @param {function} opts.colorFn - (categoria) => color hex
   * @param {function} [opts.onNodeClick] - (nodeDatum) => void
   * @param {function} [opts.tooltipForNode] - (nodeDatum, totalValue) => html
   * @param {function} [opts.tooltipForLink] - (linkDatum) => html
   */
  function render({ containerId, nodesData, linksData, colorFn, onNodeClick, tooltipForNode, tooltipForLink }) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (nodesData.length === 0 || linksData.length === 0) {
      container.innerHTML = '<div class="panel-vacio"><p>No hay flujos para mostrar con los filtros actuales.</p></div>';
      return;
    }

    const width = Math.max(container.clientWidth, 700);
    const height = Math.max(container.clientHeight, 500);

    const svg = d3.select(container).append('svg')
      .attr('width', width).attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    const sankeyGen = d3.sankey()
      .nodeId((d) => d.id)
      .nodeWidth(14)
      .nodePadding(8)
      .nodeSort((a, b) => b.value - a.value)
      .extent([[4, 12], [width - 160, height - 12]]);

    const graph = sankeyGen({
      nodes: nodesData.map((d) => ({ ...d })),
      links: linksData.map((d) => ({ ...d })),
    });

    const linkG = svg.append('g').attr('fill', 'none');
    const linkPaths = linkG.selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('class', 'sankey-link')
      .attr('d', d3.sankeyLinkHorizontal())
      .attr('stroke', (d) => colorFn(d.source.category))
      .attr('stroke-width', (d) => Math.max(1, d.width))
      .on('mousemove', (evt, d) => {
        showTooltip(tooltipForLink ? tooltipForLink(d) :
          `<strong>${d.source.label} → ${d.target.label}</strong>`, evt);
      })
      .on('mouseleave', hideTooltip);

    const nodeG = svg.append('g');
    const nodeSel = nodeG.selectAll('g')
      .data(graph.nodes)
      .join('g')
      .attr('class', 'sankey-node')
      .attr('transform', (d) => `translate(${d.x0},${d.y0})`)
      .style('cursor', 'pointer')
      .on('click', (evt, d) => { if (onNodeClick) onNodeClick(d); })
      .on('mousemove', (evt, d) => {
        const total = d3.sum(d.sourceLinks.concat(d.targetLinks), (l) => l.value);
        showTooltip(tooltipForNode ? tooltipForNode(d, total) :
          `<strong>${d.label}</strong>`, evt);
        linkPaths.classed('atenuado', (l) => l.source !== d && l.target !== d);
      })
      .on('mouseleave', () => { hideTooltip(); linkPaths.classed('atenuado', false); });

    nodeSel.append('rect')
      .attr('height', (d) => Math.max(1, d.y1 - d.y0))
      .attr('width', (d) => d.x1 - d.x0)
      .attr('fill', (d) => colorFn(d.category));

    nodeSel.append('text')
      .attr('class', 'sankey-label')
      .attr('x', (d) => (d.x0 < width / 2 ? d.x1 - d.x0 + 6 : -6))
      .attr('y', (d) => (d.y1 - d.y0) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d) => (d.x0 < width / 2 ? 'start' : 'end'))
      .text((d) => d.label.length > 34 ? `${d.label.slice(0, 32)}…` : d.label);

    return graph;
  }

  return { render, showTooltip, hideTooltip };
})();
