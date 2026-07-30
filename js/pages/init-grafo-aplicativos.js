/**
 * init-grafo-aplicativos.js
 * ==========================
 * Arranque específico del Grafo 1. Es el ÚNICO archivo que "sabe" que este
 * grafo se llama "Aplicativos ↔ Salidas": conecta GraphAplicativosConfig
 * con el motor genérico (GraphEngine, FilterEngine, FilterPanelBuilder,
 * SidebarPanel, NodeSearch). No contiene lógica de Cytoscape ni de filtros:
 * solo orquesta.
 */

(async function main() {
  const estadoCarga = document.getElementById('estado-carga');
  const estadoError = document.getElementById('estado-error');
  const config = GraphAplicativosConfig;

  try {
    // 1) Datos del grafo (nodos + aristas) y dimensiones auxiliares en paralelo
    const [graphData, uoDim, rtoDim, subproductoDim] = await Promise.all([
      DataLoader.loadGraphData(config),
      DataLoader.loadDimension(config.auxDimensions.unidadesOrganizativas),
      DataLoader.loadDimension(config.auxDimensions.rangosRTO),
      DataLoader.loadDimension(config.auxDimensions.subproductos),
    ]);

    const auxData = {
      unidadesOrganizativas: uoDim,
      rangosRTO: rtoDim,
      subproductos: subproductoDim,
    };

    // Lookups de apoyo para el panel lateral (resolver id -> nombre legible)
    const lookups = {
      uoNombreById: new Map(uoDim.map((n) => [n.data.idUO, n.label])),
    };

    // 2) Motor de grafos
    const engine = new GraphEngine({
      containerId: 'cy-container',
      config,
      onNodeSelect: (nodeData) => SidebarPanel.renderNode(nodeData),
      onSelectionClear: () => SidebarPanel.renderEmpty(),
    });
    engine.init(graphData);

    SidebarPanel.init({
      containerId: 'panel-detalle-body',
      engine,
      graphConfig: config,
      lookups,
    });

    // 3) Filtros
    // Premisa de portal: por defecto se ocultan los nodos aislados (sin
    // relación) en todos los grafos y métricas del sitio.
    let ocultarAislados = true;

    const contadorEl = document.getElementById('contador-elementos');
    function actualizarContador() {
      const nVisiblesSalida = engine.getVisibleNodes('.tipo-salida').length;
      const nVisiblesApp = engine.getVisibleNodes('.tipo-aplicativo').length;
      contadorEl.textContent = `${nVisiblesSalida} salidas · ${nVisiblesApp} aplicativos visibles`;
    }

    // --- Vista Sankey (alterna con la Red de Cytoscape) ---
    let vistaActual = 'red'; // 'red' | 'sankey'
    const cyContainer = document.getElementById('cy-container');
    const sankeyContainer = document.getElementById('sankey-container');
    const leyendaRed = document.getElementById('leyenda-red');
    const leyendaSankey = document.getElementById('leyenda-sankey');
    const colorPorCategoria = (cat) => (cat === 'salida' ? config.nodeTypes.salida.color : config.nodeTypes.aplicativo.color);

    function renderSankeyActual() {
      const salidasVisibles = engine.getVisibleNodes('.tipo-salida');
      const appsVisibles = engine.getVisibleNodes('.tipo-aplicativo');
      const idsSalidaVisible = new Set(salidasVisibles.map((n) => n.id()));
      const idsAppVisible = new Set(appsVisibles.map((n) => n.id()));

      const nodesData = [
        ...salidasVisibles.map((n) => ({ id: n.id(), label: n.data('label'), category: 'salida' })),
        ...appsVisibles.map((n) => ({ id: n.id(), label: n.data('label'), category: 'aplicativo' })),
      ];
      const linksData = engine.cy.edges('.arista-salida_usa_aplicativo')
        .filter((e) => !e.hasClass('oculto') && idsSalidaVisible.has(e.source().id()) && idsAppVisible.has(e.target().id()))
        .map((e) => ({ source: e.source().id(), target: e.target().id(), value: 1 }));

      SankeyRender.render({
        containerId: 'sankey-container',
        nodesData,
        linksData,
        colorFn: colorPorCategoria,
        onNodeClick: (d) => {
          const cyNode = engine.cy.getElementById(d.id);
          if (cyNode.length) SidebarPanel.renderNode(engine._nodeToPlainData(cyNode));
        },
        tooltipForNode: (d, total) => `<strong>${d.label}</strong><span class="muted">${d.category === 'salida' ? 'Salida' : 'Aplicativo'} · ${total} relación(es) visibles</span>`,
        tooltipForLink: (d) => `<strong>${d.source.label} → ${d.target.label}</strong>`,
      });
    }

    let sankeyInicializado = false;
    function setVista(nombre) {
      vistaActual = nombre;
      const enSankey = nombre === 'sankey';
      cyContainer.style.display = enSankey ? 'none' : '';
      sankeyContainer.style.display = enSankey ? '' : 'none';
      leyendaRed.style.display = enSankey ? 'none' : '';
      leyendaSankey.style.display = enSankey ? '' : 'none';
      uoSelect.style.display = enSankey ? '' : 'none';
      if (enSankey && !sankeyInicializado) {
        sankeyInicializado = true;
        const activeAlEntrar = filtroPanel.getActiveValues();
        // Solo aplica el default de "una sola UO" si el usuario todavía no
        // eligió ninguna UO por su cuenta desde el panel de filtros.
        if (!activeAlEntrar.uo || activeAlEntrar.uo.length === 0) {
          aplicarFiltroUOUnico(uoConMasSalidas());
          return; // aplicarFiltroUOUnico ya llama a recalcularVisibilidad -> renderSankeyActual
        }
      }
      if (enSankey) renderSankeyActual();
    }

    function recalcularVisibilidad(activeValues) {
      const visibles = FilterEngine.computeVisibleNodeIds(engine.cy.nodes(), config.filters, activeValues);
      engine.applyVisibleNodeSet(visibles);
      engine.toggleIsolatedNodes(ocultarAislados);
      actualizarContador();
      if (vistaActual === 'sankey') renderSankeyActual();
    }

    const filtroPanel = FilterPanelBuilder.build(
      document.getElementById('filtros-container'),
      config.filters,
      auxData,
      recalcularVisibilidad
    );

    // --- Selector rápido de UO para el Sankey (legibilidad por defecto) ---
    // Premisa de portal: cada vista arranca prolija y el usuario complejiza
    // si quiere. Sin filtro, el Sankey de 126+ salidas es ilegible: por eso
    // arranca mostrando UNA sola UO (la de mayor cantidad de salidas), con
    // un desplegable para cambiarla o volver a "Todas las UO".
    const uoSelect = document.getElementById('sankey-uo-select');
    const uoOrdenadas = [...uoDim].sort((a, b) => a.label.localeCompare(b.label, 'es'));
    uoSelect.innerHTML = '<option value="">Todas las UO (complejiza la vista)</option>' +
      uoOrdenadas.map((u) => `<option value="${u.data.idUO}">${u.label}</option>`).join('');

    function uoConMasSalidas() {
      const conteo = new Map();
      engine.cy.nodes('.tipo-salida').forEach((n) => {
        const idUO = n.data('idUO');
        conteo.set(idUO, (conteo.get(idUO) || 0) + 1);
      });
      let mejor = null; let max = -1;
      conteo.forEach((n, idUO) => { if (n > max) { max = n; mejor = idUO; } });
      return mejor;
    }

    function actualizarCheckboxesUOVisual(idUOSeleccionada) {
      document.querySelectorAll('.filtro-opciones[data-filtro="uo"] input[type=checkbox]').forEach((inp) => {
        inp.checked = idUOSeleccionada != null && String(inp.value) === String(idUOSeleccionada);
      });
    }

    function aplicarFiltroUOUnico(idUO) {
      const active = filtroPanel.getActiveValues();
      active.uo = idUO != null ? [idUO] : [];
      actualizarCheckboxesUOVisual(idUO);
      uoSelect.value = idUO != null ? String(idUO) : '';
      recalcularVisibilidad(active);
    }

    uoSelect.addEventListener('change', (evt) => {
      const v = evt.target.value;
      aplicarFiltroUOUnico(v === '' ? null : Number(v));
    });

    // 4) Toolbar: layouts / vista Sankey (misma fila de botones, "Sankey"
    // reemplaza a "Breadthfirst" como segunda opción, según lo pedido)
    document.querySelectorAll('[data-layout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-layout]').forEach((b) => b.classList.remove('activo'));
        btn.classList.add('activo');
        if (btn.dataset.layout === 'sankey') {
          setVista('sankey');
        } else {
          setVista('red');
          engine.setLayout(btn.dataset.layout);
        }
      });
    });

    // 5) Toolbar: zoom / fit
    document.getElementById('btn-zoom-in').addEventListener('click', () => engine.zoomIn());
    document.getElementById('btn-zoom-out').addEventListener('click', () => engine.zoomOut());
    document.getElementById('btn-fit').addEventListener('click', () => engine.fit());

    // 6) Toolbar: etiquetas
    document.getElementById('btn-labels').addEventListener('click', (evt) => {
      const visible = engine.toggleLabels();
      evt.target.classList.toggle('activo', visible);
    });

    // 7) Toolbar: ocultar nodos aislados (por defecto activo en todo el portal)
    const chkAislados = document.getElementById('chk-aislados');
    chkAislados.checked = ocultarAislados;
    engine.toggleIsolatedNodes(ocultarAislados);
    chkAislados.addEventListener('change', (evt) => {
      ocultarAislados = evt.target.checked;
      engine.toggleIsolatedNodes(ocultarAislados);
      actualizarContador();
      if (vistaActual === 'sankey') renderSankeyActual();
    });

    // 8) Toolbar: exportar imagen (solo aplica a la vista Red; en Sankey se
    // exporta el SVG directamente desde el navegador con click derecho)
    document.getElementById('btn-exportar').addEventListener('click', () => {
      if (vistaActual === 'sankey') {
        alert('La exportación a PNG está disponible en la vista Red. Para el Sankey, usá clic derecho → "Guardar imagen como" sobre el diagrama.');
        return;
      }
      engine.exportImage('grafo-aplicativos-salidas.png');
    });

    // 9) Buscador
    NodeSearch.wireSearchInput(
      document.getElementById('input-buscar'),
      engine,
      () => engine.cy.nodes()
    );

    // 10) Estado inicial del contador (aislados ya ocultos por defecto)
    actualizarContador();

    estadoCarga.style.display = 'none';
  } catch (err) {
    console.error(err);
    estadoCarga.style.display = 'none';
    estadoError.style.display = 'flex';
    estadoError.querySelector('.mensaje-error').textContent = err.message;
  }
})();
