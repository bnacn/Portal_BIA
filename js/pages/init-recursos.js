/**
 * init-recursos.js
 * =================
 * Arranque de la Temporalidad de Recursos. No usa Cytoscape ni el
 * GraphEngine (el dato de origen no es un grafo): arma sus propios filtros
 * livianos (UO / tipo de recurso / franja) sobre data/recursos-temporalidad.json
 * y delega el dibujo a TimelineStreamgraph (js/core/timeline-streamgraph.js).
 */
(async function main() {
  const estadoCarga = document.getElementById('estado-carga');
  const estadoError = document.getElementById('estado-error');

  try {
    const recursos = await DataLoader.fetchJson('data/recursos-temporalidad.json');
    const { rangos, tipos } = recursos;

    // Universo de UO presentes en los datos (para el filtro)
    const uoSet = new Map(); // idUO -> label
    tipos.forEach((t) => t.registros.forEach((r) => { if (r.idUO != null) uoSet.set(r.idUO, r.uoLabel); }));
    const uoOpciones = [...uoSet.entries()].sort((a, b) => a[1].localeCompare(b[1]));

    const estado = {
      uoSeleccionadas: new Set(),          // vacío = todas
      tiposSeleccionados: new Set(tipos.map((t) => t.id)), // por defecto todos
      rangosSeleccionados: new Set(rangos.map((r) => r.id)), // por defecto todos
      vista: 'timeline',
      modoTimeline: 'totales',
    };

    function tiposFiltrados() {
      return tipos
        .filter((t) => estado.tiposSeleccionados.has(t.id))
        .map((t) => ({
          ...t,
          registros: t.registros.filter((r) =>
            (estado.uoSeleccionadas.size === 0 || estado.uoSeleccionadas.has(r.idUO)) &&
            estado.rangosSeleccionados.has(r.idRango)),
        }));
    }
    function rangosFiltrados() {
      return rangos.filter((r) => estado.rangosSeleccionados.has(r.id));
    }

    const contadorEl = document.getElementById('contador-elementos');
    function actualizarContador() {
      const tf = tiposFiltrados();
      const totalRegistros = d3.sum(tf, (t) => d3.sum(t.registros, (r) => r.cantidad));
      contadorEl.textContent = `${tf.length} tipo(s) de recurso · ${totalRegistros} unidades en el filtro actual`;
    }

    function redibujar() {
      if (estado.vista === 'timeline') {
        TimelineStreamgraph.renderTimelineSmallMultiples({
          containerId: 'timeline-container', tipos: tiposFiltrados(), rangos: rangosFiltrados(), modo: estado.modoTimeline,
        });
      } else {
        TimelineStreamgraph.renderStreamgraph({
          containerId: 'stream-container', tipos: tiposFiltrados(), rangos: rangosFiltrados(),
        });
      }
      actualizarContador();
    }

    // --- Filtros (panel izquierdo) ---
    const filtrosEl = document.getElementById('filtros-container');

    function grupoFiltro(titulo) {
      const grupo = document.createElement('div');
      grupo.className = 'filtro-grupo';
      grupo.innerHTML = `<h3>${titulo}</h3><div class="filtro-opciones"></div>`;
      filtrosEl.appendChild(grupo);
      return grupo.querySelector('.filtro-opciones');
    }

    const contUO = grupoFiltro('Unidad Organizativa');
    uoOpciones.forEach(([id, label]) => {
      const lbl = document.createElement('label');
      lbl.innerHTML = `<input type="checkbox" value="${id}"> ${label}`;
      const input = lbl.querySelector('input');
      input.addEventListener('change', () => {
        if (input.checked) estado.uoSeleccionadas.add(id); else estado.uoSeleccionadas.delete(id);
        redibujar();
      });
      contUO.appendChild(lbl);
    });

    const contTipo = grupoFiltro('Tipo de Recurso');
    tipos.forEach((t) => {
      const lbl = document.createElement('label');
      lbl.innerHTML = `<input type="checkbox" value="${t.id}" checked> ${t.label}`;
      const input = lbl.querySelector('input');
      input.addEventListener('change', () => {
        if (input.checked) estado.tiposSeleccionados.add(t.id); else estado.tiposSeleccionados.delete(t.id);
        redibujar();
      });
      contTipo.appendChild(lbl);
    });

    const contRango = grupoFiltro('Franja temporal (Dim_RangoTiempo_Recursos)');
    rangos.forEach((r) => {
      const lbl = document.createElement('label');
      lbl.innerHTML = `<input type="checkbox" value="${r.id}" checked> ${r.label}`;
      const input = lbl.querySelector('input');
      input.addEventListener('change', () => {
        if (input.checked) estado.rangosSeleccionados.add(r.id); else estado.rangosSeleccionados.delete(r.id);
        redibujar();
      });
      contRango.appendChild(lbl);
    });

    // --- Selector de vista ---
    const timelineContainer = document.getElementById('timeline-container');
    const streamContainer = document.getElementById('stream-container');
    const controlModo = document.getElementById('control-modo');
    document.querySelectorAll('[data-vista]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-vista]').forEach((b) => b.classList.remove('activo'));
        btn.classList.add('activo');
        estado.vista = btn.dataset.vista;
        timelineContainer.style.display = estado.vista === 'timeline' ? '' : 'none';
        streamContainer.style.display = estado.vista === 'stream' ? '' : 'none';
        controlModo.style.display = estado.vista === 'timeline' ? '' : 'none';
        redibujar();
      });
    });

    document.querySelectorAll('input[name="modo-timeline"]').forEach((r) => {
      r.addEventListener('change', (evt) => {
        estado.modoTimeline = evt.target.value;
        redibujar();
      });
    });

    redibujar();
    estadoCarga.style.display = 'none';
  } catch (err) {
    console.error(err);
    estadoCarga.style.display = 'none';
    estadoError.style.display = 'flex';
    estadoError.querySelector('.mensaje-error').textContent = err.message;
  }
})();
