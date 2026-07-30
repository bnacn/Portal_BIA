/**
 * data-loader.js
 * ===============
 * Módulo genérico de carga de datos para el Portal BIA.
 *
 * Responsabilidad única: traer los archivos JSON (nodos/aristas) declarados
 * en la config de un grafo y devolver un objeto { nodes, edges } ya validado
 * y normalizado, listo para que graph-engine.js lo convierta en elementos
 * de Cytoscape.
 *
 * No conoce nada específico de "Salidas" ni "Aplicativos": solo entiende el
 * contrato genérico definido en README.md:
 *   Nodo:  { id, type, label, data }
 *   Arista: { id, type, source, target, directed, data }
 *
 * CAMBIO IMPORTANTE: los datos ya no viven en /data del repo (por
 * seguridad, se sacaron del historial de git). Ahora se piden a la API
 * protegida (Cloudflare Worker + Access), que exige login con email
 * @bna.com.ar antes de devolver cualquier dato. Las configs (js/configs/*)
 * y los init-*.js siguen escribiendo rutas tipo "data/nodes-salidas.json"
 * sin saber nada de esto — fetchJson() las traduce acá abajo, en el único
 * lugar del código que sabe de dónde vienen realmente los datos.
 */

const DataLoader = (() => {
  // URL del Worker que sirve los datos protegidos. Ajustar si el
  // Worker se renombra o se cambia de cuenta/subdominio.
  const WORKER_BASE_URL = 'https://bia-api.cfranco-0ba.workers.dev';

  /**
   * Traduce una ruta local histórica ("data/nodes-salidas.json") a la
   * URL real de la API protegida ("<worker>/api/data/nodes-salidas").
   */
  function resolveUrl(path) {
    const clave = path.replace(/^.*data\//, '').replace(/\.json$/, '');
    return `${WORKER_BASE_URL}/api/data/${clave}`;
  }

  /**
   * Si el fetch falla en seco (típico cuando todavía no hay sesión de
   * Access en el dominio del Worker: un fetch en segundo plano no puede
   * mostrar la pantalla de login), llevamos a la persona a loguearse con
   * una navegación real, y el propio Worker la trae de vuelta a esta
   * página después. Usamos "authRetry" para no quedar en loop si por
   * algún motivo el problema no era de sesión.
   */
  function irALoginYVolver() {
    const yaReintentado = new URLSearchParams(location.search).has('authRetry');
    if (yaReintentado) return false;
    const separador = location.href.includes('?') ? '&' : '?';
    const volverA = location.href + separador + 'authRetry=1';
    location.href = `${WORKER_BASE_URL}/api/login?return=${encodeURIComponent(volverA)}`;
    return true;
  }

  /**
   * Descarga un único archivo JSON desde la API protegida.
   * @param {string} path - ruta relativa histórica (ej. "data/nodes-salidas.json")
   * @returns {Promise<any>}
   */
  async function fetchJson(path) {
    const url = resolveUrl(path);
    let res;
    try {
      res = await fetch(url, {
        cache: 'no-cache',
        credentials: 'include', // manda la cookie de sesión de Cloudflare Access
      });
    } catch (err) {
      if (irALoginYVolver()) {
        // La página está navegando afuera; no hace falta seguir.
        return new Promise(() => {});
      }
      throw new Error(
        `No se pudo conectar con la API de datos. Si ya iniciaste sesión y ` +
        `seguís viendo esto, recargá la página o avisale a Carlos.`
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `No autorizado para acceder a "${path}". Iniciá sesión con tu email ` +
        `@bna.com.ar en la pantalla de login que debería haber aparecido, o ` +
        `recargá la página si ya iniciaste sesión.`
      );
    }
    if (!res.ok) {
      throw new Error(`No se pudo cargar "${path}" (HTTP ${res.status}).`);
    }
    return res.json();
  }

  /**
   * Valida que un array de nodos cumpla el contrato mínimo.
   * Lanza un error descriptivo (no silencioso) si algo no cierra: preferimos
   * fallar fuerte y avisar, antes que renderizar un grafo con datos rotos.
   */
  function validateNodes(nodes, sourceName) {
    const ids = new Set();
    nodes.forEach((n, i) => {
      if (!n.id) throw new Error(`${sourceName}: nodo en posición ${i} sin "id".`);
      if (!n.type) throw new Error(`${sourceName}: nodo "${n.id}" sin "type".`);
      if (n.label === undefined || n.label === null) {
        throw new Error(`${sourceName}: nodo "${n.id}" sin "label".`);
      }
      if (ids.has(n.id)) {
        throw new Error(`${sourceName}: id de nodo duplicado "${n.id}".`);
      }
      ids.add(n.id);
    });
  }

  /**
   * Valida aristas y avisa (sin frenar la carga) si source/target no existen
   * dentro del conjunto de nodos ya cargado, para detectar referencias rotas
   * cuanto antes en vez de que Cytoscape falle silenciosamente.
   */
  function validateEdges(edges, nodeIdSet, sourceName) {
    const ids = new Set();
    edges.forEach((e, i) => {
      if (!e.id) throw new Error(`${sourceName}: arista en posición ${i} sin "id".`);
      if (!e.source || !e.target) {
        throw new Error(`${sourceName}: arista "${e.id}" sin "source"/"target".`);
      }
      if (ids.has(e.id)) {
        throw new Error(`${sourceName}: id de arista duplicado "${e.id}".`);
      }
      ids.add(e.id);
      if (!nodeIdSet.has(e.source)) {
        console.warn(`${sourceName}: arista "${e.id}" referencia un nodo source ` +
          `inexistente "${e.source}" (se omite la arista).`);
      }
      if (!nodeIdSet.has(e.target)) {
        console.warn(`${sourceName}: arista "${e.id}" referencia un nodo target ` +
          `inexistente "${e.target}" (se omite la arista).`);
      }
    });
  }

  /**
   * Carga el conjunto completo de datos de un grafo a partir de su config.
   * @param {object} graphConfig - ver js/configs/*.config.js
   * @returns {Promise<{nodes: object[], edges: object[]}>}
   */
  async function loadGraphData(graphConfig) {
    const { nodeSources, edgeSources } = graphConfig.dataSources;

    // Carga en paralelo de todos los archivos de nodos y de aristas declarados.
    const nodeArrays = await Promise.all(nodeSources.map((path) => fetchJson(path)));
    const edgeArrays = await Promise.all(edgeSources.map((path) => fetchJson(path)));

    let nodes = [];
    nodeArrays.forEach((arr, i) => {
      validateNodes(arr, nodeSources[i]);
      nodes = nodes.concat(arr);
    });

    const nodeIdSet = new Set(nodes.map((n) => n.id));

    let edges = [];
    edgeArrays.forEach((arr, i) => {
      validateEdges(arr, nodeIdSet, edgeSources[i]);
      // solo se conservan aristas cuyos dos extremos existen en el set de nodos
      const valid = arr.filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));
      edges = edges.concat(valid);
    });

    return { nodes, edges };
  }

  /**
   * Carga una tabla de dimensión "suelta" (no nodo/arista), por ejemplo
   * dim-rango-rto.json o dim-subproducto.json, usada por los filtros y
   * por el panel lateral.
   */
  async function loadDimension(path) {
    return fetchJson(path);
  }

  return { loadGraphData, loadDimension, fetchJson };
})();
