/**
 * init-betweenness.js
 * =====================
 * Arranque del módulo Betweenness por Equipo. Consume
 * data/betweenness-equipos.json (ver metodología documentada dentro del
 * propio archivo, generada por tools/excel_to_json.py) y arma filtros
 * livianos de categoría / cantidad a mostrar / búsqueda por nombre.
 */
(async function main() {
  const estadoCarga = document.getElementById('estado-carga');
  const estadoError = document.getElementById('estado-error');

  try {
    const data = await DataLoader.fetchJson('data/betweenness-equipos.json');
    const nodos = data.nodos;

    const categorias = ['equipo_bna_relevado', 'equipo_bna_no_relevado', 'tercero', 'aplicativo'];
    const estado = {
      categoriasActivas: new Set(categorias),
      topN: 15,
      busqueda: '',
    };

    // Nota metodológica dinámica (RTO como ponderador + exclusión de M365),
    // generada por tools/excel_to_json.py junto con el propio cálculo.
    const excluidos = data.excluidos || [];
    document.getElementById('nota-metodologica').innerHTML =
      `<strong>Nota metodológica:</strong> ${data.notaMetodologica || ''}` +
      (excluidos.length ? ` <strong>Excluido del cálculo:</strong> ${excluidos.join(', ')}.` : '');

    // --- Filtro de categoría ---
    const contCategorias = document.getElementById('filtro-categorias');
    categorias.forEach((cat) => {
      const lbl = document.createElement('label');
      lbl.innerHTML = `<input type="checkbox" value="${cat}" checked>
        <span class="categoria-chip"><span class="dot" style="background:${BetweennessRender.COLOR_CATEGORIA[cat]}"></span>${BetweennessRender.LABEL_CATEGORIA[cat]}</span>`;
      const input = lbl.querySelector('input');
      input.addEventListener('change', () => {
        if (input.checked) estado.categoriasActivas.add(cat); else estado.categoriasActivas.delete(cat);
        redibujar();
      });
      contCategorias.appendChild(lbl);
    });

    // --- Leyenda (recuento por categoría) ---
    const leyendaEl = document.getElementById('leyenda-betweenness');
    function actualizarLeyenda() {
      const conteos = {};
      categorias.forEach((c) => { conteos[c] = nodos.filter((n) => n.categoria === c).length; });
      leyendaEl.innerHTML = categorias.map((c) =>
        `<div class="leyenda-item"><span class="leyenda-dot" style="background:${BetweennessRender.COLOR_CATEGORIA[c]}"></span>${BetweennessRender.LABEL_CATEGORIA[c]} (${conteos[c]})</div>`
      ).join('') + '<div class="leyenda-item" style="margin-top:4px;color:var(--color-text-muted);">Calculado sobre el grafo completo UO-Salida-Aplicativo-Entidad; se muestra a nivel Equipo.</div>';
    }
    actualizarLeyenda();

    // --- Top N ---
    document.getElementById('select-topn').addEventListener('change', (evt) => {
      estado.topN = Number(evt.target.value);
      redibujar();
    });

    // --- Buscador ---
    document.getElementById('input-buscar').addEventListener('input', (evt) => {
      estado.busqueda = NodeSearch.foldText(evt.target.value.trim());
      redibujar();
    });

    // --- Detalle ---
    function mostrarDetalle(d) {
      const panel = document.getElementById('panel-detalle-body');
      panel.innerHTML = `
        <div class="panel-header">
          <span class="panel-badge" style="background:${BetweennessRender.COLOR_CATEGORIA[d.categoria]}">${BetweennessRender.LABEL_CATEGORIA[d.categoria]}</span>
          <h3>${d.label}</h3>
        </div>
        <div class="panel-body">
          <div class="panel-field"><span class="panel-field-label">Betweenness centrality (normalizada)</span>
            <span class="panel-field-value">${d.betweenness.toFixed(4)}</span></div>
          <div class="panel-field"><span class="panel-field-label">Grado (Salidas / relaciones directas conectadas)</span>
            <span class="panel-field-value">${d.grado}</span></div>
          <div class="panel-field"><span class="panel-field-label">Interpretación</span>
            <span class="panel-field-value">Cuanto más alto, más veces este equipo actúa de intermediario entre otras dos partes de la red del BIA — si se cae, más caminos operativos quedan cortados.</span></div>
        </div>`;
    }

    const contadorEl = document.getElementById('contador-elementos');

    function redibujar() {
      let filtrados = nodos.filter((n) => estado.categoriasActivas.has(n.categoria));
      if (estado.busqueda) {
        filtrados = filtrados.filter((n) => NodeSearch.foldText(n.label).includes(estado.busqueda));
      }
      filtrados = filtrados.slice(0, estado.topN); // ya vienen ordenados desc por betweenness
      contadorEl.textContent = `${filtrados.length} de ${nodos.length} equipos/aplicativos/terceros`;
      BetweennessRender.render({ containerId: 'betweenness-container', nodos: filtrados, onSelect: mostrarDetalle });
    }

    redibujar();
    estadoCarga.style.display = 'none';
  } catch (err) {
    console.error(err);
    estadoCarga.style.display = 'none';
    estadoError.style.display = 'flex';
    estadoError.querySelector('.mensaje-error').textContent = err.message;
  }
})();
