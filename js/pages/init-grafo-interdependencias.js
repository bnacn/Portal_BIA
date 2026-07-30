/**
 * init-grafo-interdependencias.js
 * ==================================
 * Arranque del Grafo 2, con dos vistas que comparten toolbar/paneles:
 *   - "Por Salidas": el grafo original (UO -> Salida -> Entidad).
 *   - "Por Equipo": nueva vista que reemplaza al toggle roto "Mostrar
 *     Salidas". Colapsa la Salida y muestra relación directa Equipo<->Equipo
 *     agregada por cantidad de Salidas (peso de la arista).
 * Ambas corren sobre el mismo motor genérico (GraphEngine/FilterEngine/etc.)
 * en dos instancias, cada una con su propio contenedor y config.
 */

(async function main() {
  const estadoCarga = document.getElementById('estado-carga');
  const estadoError = document.getElementById('estado-error');
  const configSalidas = GraphInterdependenciasConfig;
  const configEquipo = GraphInterdependenciasEquipoConfig;

  try {
    // 1) Datos de ambas vistas en paralelo
    const [graphDataSalidas, graphDataEquipo, uoDim, rtoDim, subproductoDim] = await Promise.all([
      DataLoader.loadGraphData(configSalidas),
      DataLoader.loadGraphData(configEquipo),
      DataLoader.loadDimension(configSalidas.auxDimensions.unidadesOrganizativas),
      DataLoader.loadDimension(configSalidas.auxDimensions.rangosRTO),
      DataLoader.loadDimension(configSalidas.auxDimensions.subproductos),
    ]);

    const auxData = { unidadesOrganizativas: uoDim, rangosRTO: rtoDim, subproductos: subproductoDim };
    const auxDataEquipo = { unidadesOrganizativas: uoDim };
    const lookups = { uoNombreById: new Map(uoDim.map((n) => [n.data.idUO, n.label])) };

    // 2) Vista "Por Salidas" (comportamiento original)
    const engine = new GraphEngine({
      containerId: 'cy-container',
      config: configSalidas,
      onNodeSelect: (nodeData) => {
        SidebarPanel.init({ containerId: 'panel-detalle-body', engine, graphConfig: configSalidas, lookups });
        SidebarPanel.renderNode(nodeData);
      },
      onSelectionClear: () => SidebarPanel.renderEmpty(),
    });
    engine.init(graphDataSalidas);

    // 3) Vista "Por Equipo" (nueva)
    const engineEquipo = new GraphEngine({
      containerId: 'cy-container-equipo',
      config: configEquipo,
      onNodeSelect: (nodeData) => {
        SidebarPanel.init({ containerId: 'panel-detalle-body', engine: engineEquipo, graphConfig: configEquipo, lookups });
        SidebarPanel.renderNode(nodeData);
      },
      onSelectionClear: () => SidebarPanel.renderEmpty(),
    });
    engineEquipo.init(graphDataEquipo);

    // Detalle de arista en la Vista por Equipo: al ser una relación
    // agregada, lo relevante es qué Salidas concretas la sostienen.
    engineEquipo.cy.on('tap', 'edge', (evt) => {
      const e = evt.target;
      const salidas = e.data('salidas') || [];
      const panel = document.getElementById('panel-detalle-body');
      panel.innerHTML = `
        <div class="panel-header">
          <span class="panel-badge" style="background:${e.data('type') === 'equipo_hacia_entidad' ? '#7fa8d9' : '#e0a96d'}">Relación agregada</span>
          <h3>${e.source().data('label')} ${e.data('type') === 'equipo_hacia_entidad' ? '→' : '←'} ${e.target().data('label')}</h3>
        </div>
        <div class="panel-body">
          <div class="panel-field"><span class="panel-field-label">Cantidad de Salidas que sostienen esta relación</span>
            <span class="panel-field-value">${e.data('peso')}</span></div>
          <div class="panel-field"><span class="panel-field-label">Salidas</span>
            <ul class="panel-field-list">${salidas.map((s) => `<li>${s}</li>`).join('')}</ul></div>
        </div>`;
    });

    SidebarPanel.init({ containerId: 'panel-detalle-body', engine, graphConfig: configSalidas, lookups });

    // 4) Filtros (uno por vista, mismo motor genérico)
    // Premisa de portal: por defecto se ocultan los nodos aislados.
    let ocultarAislados = true;
    let vistaActual = 'equipo'; // 'salidas' | 'equipo' — default: legible por equipo, complejizar a Por Salidas si se quiere

    const contadorEl = document.getElementById('contador-elementos');
    function actualizarContador() {
      if (vistaActual === 'salidas') {
        const nUO = engine.getVisibleNodes('.tipo-unidad_organizativa').length;
        const nSal = engine.getVisibleNodes('.tipo-salida').length;
        const nEnt = engine.getVisibleNodes('.tipo-entidad').length;
        contadorEl.textContent = `${nUO} UO · ${nSal} salidas · ${nEnt} entidades visibles`;
      } else {
        const nUO = engineEquipo.getVisibleNodes('.tipo-unidad_organizativa').length;
        const nEnt = engineEquipo.getVisibleNodes('.tipo-entidad').length;
        contadorEl.textContent = `${nUO} UO · ${nEnt} equipos/terceros visibles`;
      }
    }

    function recalcularVisibilidadSalidas(activeValues) {
      const visibles = FilterEngine.computeVisibleNodeIds(engine.cy.nodes(), configSalidas.filters, activeValues);
      engine.applyVisibleNodeSet(visibles);
      engine.toggleIsolatedNodes(ocultarAislados);
      actualizarContador();
    }
    function recalcularVisibilidadEquipo(activeValues) {
      const visibles = FilterEngine.computeVisibleNodeIds(engineEquipo.cy.nodes(), configEquipo.filters, activeValues);
      engineEquipo.applyVisibleNodeSet(visibles);
      engineEquipo.toggleIsolatedNodes(ocultarAislados);
      actualizarContador();
    }

    FilterPanelBuilder.build(document.getElementById('filtros-container-salidas'), configSalidas.filters, auxData, recalcularVisibilidadSalidas);
    FilterPanelBuilder.build(document.getElementById('filtros-container-equipo'), configEquipo.filters, auxDataEquipo, recalcularVisibilidadEquipo);

    // 5) Selector de vista
    const cyContainer = document.getElementById('cy-container');
    const cyContainerEquipo = document.getElementById('cy-container-equipo');
    const filtrosSalidas = document.getElementById('filtros-container-salidas');
    const filtrosEquipo = document.getElementById('filtros-container-equipo');
    const layoutsSalidas = document.getElementById('layout-buttons-salidas');
    const layoutsEquipo = document.getElementById('layout-buttons-equipo');
    const leyendaSalidas = document.getElementById('leyenda-salidas');
    const leyendaEquipo = document.getElementById('leyenda-equipo');

    document.querySelectorAll('[data-vista]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-vista]').forEach((b) => b.classList.remove('activo'));
        btn.classList.add('activo');
        vistaActual = btn.dataset.vista;
        const enEquipo = vistaActual === 'equipo';
        cyContainer.style.display = enEquipo ? 'none' : '';
        cyContainerEquipo.style.display = enEquipo ? '' : 'none';
        filtrosSalidas.style.display = enEquipo ? 'none' : '';
        filtrosEquipo.style.display = enEquipo ? '' : 'none';
        layoutsSalidas.style.display = enEquipo ? 'none' : '';
        layoutsEquipo.style.display = enEquipo ? '' : 'none';
        leyendaSalidas.style.display = enEquipo ? 'none' : '';
        leyendaEquipo.style.display = enEquipo ? '' : 'none';
        SidebarPanel.renderEmpty();
        (enEquipo ? engineEquipo : engine).fit();
        actualizarContador();
      });
    });

    // 6) Toolbar: layouts (separados por vista)
    document.querySelectorAll('#layout-buttons-salidas [data-layout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#layout-buttons-salidas [data-layout]').forEach((b) => b.classList.remove('activo'));
        btn.classList.add('activo');
        const extra = btn.dataset.layout === 'breadthfirst' ? configSalidas.defaultLayoutOptions : {};
        engine.setLayout(btn.dataset.layout, extra);
      });
    });
    document.querySelectorAll('#layout-buttons-equipo [data-layout-equipo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#layout-buttons-equipo [data-layout-equipo]').forEach((b) => b.classList.remove('activo'));
        btn.classList.add('activo');
        engineEquipo.setLayout(btn.dataset.layoutEquipo);
      });
    });

    // 7) Toolbar: zoom / fit / etiquetas (actúan sobre la vista activa)
    const activo = () => (vistaActual === 'equipo' ? engineEquipo : engine);
    document.getElementById('btn-zoom-in').addEventListener('click', () => activo().zoomIn());
    document.getElementById('btn-zoom-out').addEventListener('click', () => activo().zoomOut());
    document.getElementById('btn-fit').addEventListener('click', () => activo().fit());
    document.getElementById('btn-labels').addEventListener('click', (evt) => {
      const visible = engine.toggleLabels();
      engineEquipo.toggleLabels();
      evt.target.classList.toggle('activo', visible);
    });

    // 8) Toolbar: ocultar nodos aislados (por defecto activo en todo el portal)
    const chkAislados = document.getElementById('chk-aislados');
    chkAislados.checked = ocultarAislados;
    engine.toggleIsolatedNodes(ocultarAislados);
    engineEquipo.toggleIsolatedNodes(ocultarAislados);
    chkAislados.addEventListener('change', (evt) => {
      ocultarAislados = evt.target.checked;
      engine.toggleIsolatedNodes(ocultarAislados);
      engineEquipo.toggleIsolatedNodes(ocultarAislados);
      actualizarContador();
    });

    // 9) Toolbar: exportar imagen (vista activa)
    document.getElementById('btn-exportar').addEventListener('click', () => {
      activo().exportImage(vistaActual === 'equipo' ? 'interdependencias-por-equipo.png' : 'interdependencias-por-salidas.png');
    });

    // 10) Buscador (busca en la vista activa)
    NodeSearch.wireSearchInput(
      document.getElementById('input-buscar'),
      { highlightNodesByIds: (ids) => activo().highlightNodesByIds(ids), clearHighlight: () => activo().clearHighlight() },
      () => activo().cy.nodes()
    );

    actualizarContador();
    estadoCarga.style.display = 'none';
  } catch (err) {
    console.error(err);
    estadoCarga.style.display = 'none';
    estadoError.style.display = 'flex';
    estadoError.querySelector('.mensaje-error').textContent = err.message;
  }
})();
