"""
excel_to_json.py
=================
Herramienta OFFLINE (no forma parte del portal, no corre en el navegador) que convierte
el Excel normalizado del BIA en los archivos JSON estáticos que consume el portal.

Se ejecuta una sola vez cada vez que se actualiza el BIA:

    python3 excel_to_json.py /ruta/al/BIA_operaciones_metricas_2026_normalizado.xlsx

Genera todos los .json dentro de ../data/

Reglas aplicadas (decisiones validadas con el usuario, 2026-07-20):
  1. Las filas vacías (NaN) de Dim_SubProducto y Dim_ProcesoCentral se incluyen
     como una opción explícita "Sin especificar" (no se descartan).
  2. Las variantes tipográficas de SubProducto/ProcesoCentral (mayúsculas, typos,
     singular/plural) se agrupan SOLO a nivel visual, mediante un diccionario de
     "display label" curado a mano. El dato crudo (tal como está en el Excel) se
     conserva intacto en cada registro; el agrupamiento no toca el modelo de datos.
  3. No se inventa ningún campo "Criticidad". El RTO (Fact_Salidas.RTO_Normalizado /
     ID_RangoRTO) se usa explícitamente como indicador de criticidad operativa
     (a menor RTO, mayor criticidad) y se expone como filtro y como atributo de
     panel, ordenado de más crítico a menos crítico.

Este script NO modifica el Excel de origen ni redefine el modelo de datos: solo
proyecta las tablas ya existentes a un formato de grafo (nodos/aristas) apto para
Cytoscape.js.
"""
import sys
import json
import math
from pathlib import Path
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE.parent / 'data'

DEFAULT_SRC = '/mnt/user-data/uploads/BIA_operaciones_metricas_2026_normalizado_20260727.xlsx'


def clean(v):
    """None-safe: convierte NaN de pandas en None, castea numpy a tipos nativos."""
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, (int, float)):
        # castea a int si es un entero exacto (evita "1.0" en el JSON)
        if isinstance(v, float) and v.is_integer():
            return int(v)
        return v
    return str(v).strip()


# ---------------------------------------------------------------------------
# Diccionario de agrupación VISUAL de SubProducto / ProcesoCentral.
# Clave = valor crudo tal cual aparece en el Excel. Valor = etiqueta a mostrar
# en los filtros del portal. Si un valor no está acá, se muestra tal cual está.
# Solo se agrupan pares que son, con certeza, el mismo concepto (typo/mayúsculas/
# singular-plural). Ante la duda, se dejaron SIN agrupar (ver README del portal).
# ---------------------------------------------------------------------------
SUBPRODUCTO_DISPLAY_MAP = {
    'CALL Y REPO': 'CALL y REPO',
    'CALL y REPO': 'CALL y REPO',
    'Cuenta Corriente (Segmento Comercial': 'Cuenta Corriente (Segmento Comercial)',
    'Cuenta Corriente (Segmento Comercial)': 'Cuenta Corriente (Segmento Comercial)',
    'Tarjeta de Crédito': 'Tarjeta de Crédito',
    'Tarjetas de Crédito': 'Tarjeta de Crédito',
    'Tarjeta de Crédito Comercio': 'Tarjeta de Crédito Comercio',
    'Tarjetas de Crédito Comercio': 'Tarjeta de Crédito Comercio',
}

PROCESOCENTRAL_DISPLAY_MAP = {
    'Compensaciones Bancaras': 'Compensaciones Bancarias',
    'Compensaciones Bancarias': 'Compensaciones Bancarias',
}

SIN_ESPECIFICAR = 'Sin especificar'

# ---------------------------------------------------------------------------
# Clasificación manual de las entidades marcadas "Otros" en Dim_Entidad (ni
# Interno ni Externo). Decisión validada con el usuario (2026-07-27): se usa
# 1x1 SOLO para los módulos nuevos que necesitan una clasificación binaria
# (Vista por Equipo de Interdependencias y Betweenness por Equipo). El
# Grafo 2 (Red de Interdependencias) sigue mostrando "Otros" sin forzar,
# tal como estaba documentado en el README, para no romper lo ya validado.
# ---------------------------------------------------------------------------
OTROS_A_EXTERNO = {
    'Clientes', 'Entes Nacionales y Provinciales',
    'Fondos Comúnes de Inversión Carlos Pellegrini', 'ESCO Fondos',
    'Mercados Financieros', 'Blessit', 'Base 24',
}
OTROS_A_INTERNO = {
    'Sector originante', 'Re de Sucursales', 'Otras Entidades',
    'Banca Minorista', 'ALCO', 'Soporte Comercial Banca Empresa',
    'Directorio', 'Cajeros Express', 'Sumas Contables',
}


def tipo_efectivo(nombre, tipo_crudo):
    """Tipo Interno/Externo ya resuelto para 'Otros', usado solo por los
    módulos que necesitan una clasificación binaria (ver arriba)."""
    if tipo_crudo in ('Interno', 'Externo'):
        return tipo_crudo
    if nombre in OTROS_A_EXTERNO:
        return 'Externo'
    if nombre in OTROS_A_INTERNO:
        return 'Interno'
    return 'Interno'  # fallback conservador, no debería alcanzarse


# ---------------------------------------------------------------------------
# Fusión de UO por turno. Decisión validada con el usuario (2026-07-28):
# "Medio Electrónico de Pagos T.M / T.T" y "Transmisiones Internas T. M / T. T"
# son el MISMO equipo trabajando en dos turnos (mañana/tarde), no cuatro
# equipos distintos. Se fusionan en un solo nodo por par, en TODO el portal
# (nodos UO, Fact_Salidas.ID_UO, y las tablas de Recursos que referencian la
# UO por nombre). Se aplica antes que cualquier otra lectura de UO.
# ---------------------------------------------------------------------------
UO_MERGE_MAP = {
    'Transmisiones Internas T. M': 'Transmisiones Internas',
    'Transmisiones Internas T. T': 'Transmisiones Internas',
    'Medio Electrónico de Pagos T.M': 'Medio Electrónico de Pagos',
    'Medio Electrónico de Pagos T.T': 'Medio Electrónico de Pagos',
}


def normalizar_uo_nombre(nombre):
    return UO_MERGE_MAP.get(nombre, nombre)


def display_label(raw, mapping):
    if raw is None:
        return SIN_ESPECIFICAR
    return mapping.get(raw, raw)


def write_json(name, obj):
    path = DATA_DIR / name
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    n = len(obj) if isinstance(obj, list) else 1
    print(f'  {name:45s} {n:5d} registros')


def main(src_path):
    xls = pd.ExcelFile(src_path)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    def sheet(name):
        return pd.read_excel(xls, sheet_name=name, dtype=object)

    print('Leyendo', src_path)
    dim_uo = sheet('Dim_UnidadOrganizativa')
    dim_entidad = sheet('Dim_Entidad')
    dim_aplicativo = sheet('Dim_Aplicativo')
    dim_subproducto = sheet('Dim_SubProducto')
    dim_procesocentral = sheet('Dim_ProcesoCentral')
    dim_rango_rto = sheet('Dim_RangoTiempo_RTO')
    fact_salidas = sheet('Fact_Salidas')
    rel_subproducto = sheet('Rel_Salida_SubProducto')
    rel_procesocentral = sheet('Rel_Salida_ProcesoCentral')
    rel_aplicativo = sheet('Rel_Salida_Aplicativo')
    rel_sucesora = sheet('Rel_Salida_Sucesora')
    rel_predecesora = sheet('Rel_Salida_Predec_Entidad')
    dim_rango_recursos = sheet('Dim_RangoTiempo_Recursos')
    fact_personal = sheet('Fact_PersonalClave')
    fact_equipo_oficina = sheet('Fact_EquipamientoOficina')
    fact_equipo_especial = sheet('Fact_EquipamientoEspecial')
    fact_proveedores = sheet('Fact_Proveedores')
    fact_almacenamiento = sheet('Fact_Almacenamiento')
    fact_aplicativos_criticidad = sheet('Fact_AplicativosCriticidad')

    print('Generando archivos JSON en', DATA_DIR)

    # ---------------------------------------------------------------
    # Fusión de UO por turno (ver UO_MERGE_MAP). Se hace ANTES de construir
    # ningún nodo/índice: dim_uo queda con nombres ya fusionados y
    # deduplicados, con IDs reasignados 1..N en orden de primera aparición;
    # fact_salidas.ID_UO se remapea a esos nuevos IDs; y las tablas de
    # Recursos que referencian la UO por nombre (texto) se normalizan con
    # el mismo mapeo para que se alineen con los nombres fusionados.
    # ---------------------------------------------------------------
    dim_uo['Unidad_Organizativa'] = dim_uo['Unidad_Organizativa'].apply(
        lambda v: normalizar_uo_nombre(clean(v)))
    _nombres_uo_unicos = []
    _old_id_a_nombre = {}
    for _, r in dim_uo.iterrows():
        oid = clean(r['ID_UO'])
        nombre = clean(r['Unidad_Organizativa'])
        _old_id_a_nombre[oid] = nombre
        if nombre not in _nombres_uo_unicos:
            _nombres_uo_unicos.append(nombre)
    _nombre_a_nuevo_id = {n: i + 1 for i, n in enumerate(_nombres_uo_unicos)}
    uo_old_id_a_nuevo_id = {oid: _nombre_a_nuevo_id[n] for oid, n in _old_id_a_nombre.items()}
    dim_uo = pd.DataFrame([{'ID_UO': _nombre_a_nuevo_id[n], 'Unidad_Organizativa': n} for n in _nombres_uo_unicos])

    fact_salidas['ID_UO'] = fact_salidas['ID_UO'].apply(lambda v: uo_old_id_a_nuevo_id.get(clean(v)))
    for _df in (fact_personal, fact_equipo_oficina, fact_equipo_especial,
                fact_proveedores, fact_almacenamiento, fact_aplicativos_criticidad):
        _df['Unidad_Organizativa'] = _df['Unidad_Organizativa'].apply(
            lambda v: normalizar_uo_nombre(clean(v)))
    if len(_nombres_uo_unicos) < len(_old_id_a_nombre):
        fusionados_uo = sorted(set(UO_MERGE_MAP.values()))
        print(f'  (UO fusionadas por turno: {len(_old_id_a_nombre)} -> {len(_nombres_uo_unicos)}: {fusionados_uo})')

    # ---------------------------------------------------------------
    # Dim_RangoTiempo_RTO -> se expone ordenado de MÁS crítico a MENOS
    # crítico (así lo pidió el usuario: el RTO funciona como indicador
    # de criticidad, no solo como rango de tiempo).
    # ---------------------------------------------------------------
    rto_list = []
    for _, r in dim_rango_rto.sort_values('ID_RangoRTO').iterrows():
        rto_list.append({
            'id': clean(r['ID_RangoRTO']),
            'rango': clean(r['Rango']),
            'horasDesde': clean(r['Horas_Desde']),
            'horasHasta': clean(r['Horas_Hasta']),
            # orden 1 = más crítico (RTO más corto)
            'ordenCriticidad': clean(r['ID_RangoRTO']),
        })
    write_json('dim-rango-rto.json', rto_list)

    # ---------------------------------------------------------------
    # Dim_SubProducto / Dim_ProcesoCentral: NaN -> "Sin especificar",
    # + displayLabel agrupado solo para el filtro (dato crudo intacto).
    # ---------------------------------------------------------------
    subproducto_list = []
    subproducto_raw_to_id = {}
    for _, r in dim_subproducto.iterrows():
        raw = clean(r['SubProducto'])
        rid = clean(r['ID_SubProducto'])
        subproducto_list.append({
            'id': rid,
            'valor': raw if raw is not None else SIN_ESPECIFICAR,
            'valorOriginal': raw,  # None si la fila venía vacía en el Excel
            'displayLabel': display_label(raw, SUBPRODUCTO_DISPLAY_MAP),
        })
        subproducto_raw_to_id[raw] = rid
    write_json('dim-subproducto.json', subproducto_list)

    proceso_list = []
    for _, r in dim_procesocentral.iterrows():
        raw = clean(r['ProcesoCentral'])
        proceso_list.append({
            'id': clean(r['ID_ProcesoCentral']),
            'valor': raw if raw is not None else SIN_ESPECIFICAR,
            'valorOriginal': raw,
            'displayLabel': display_label(raw, PROCESOCENTRAL_DISPLAY_MAP),
        })
    write_json('dim-procesocentral.json', proceso_list)

    # ---------------------------------------------------------------
    # Nodos: Unidad Organizativa
    # ---------------------------------------------------------------
    nodes_uo = []
    for _, r in dim_uo.iterrows():
        nodes_uo.append({
            'id': f"uo-{clean(r['ID_UO'])}",
            'type': 'unidad_organizativa',
            'label': clean(r['Unidad_Organizativa']),
            'data': {'idUO': clean(r['ID_UO'])},
        })
    write_json('nodes-unidades-organizativas.json', nodes_uo)

    # ---------------------------------------------------------------
    # Nodos: Entidad (Interno/Externo/Otros)
    # Fusión con UO por nombre (decisión validada: opción A). Si el
    # nombre de la entidad coincide con una UO, NO se crea un nodo
    # "entidad" nuevo: se guarda el mapeo para que las aristas que
    # apunten a esa entidad se redirijan al nodo uo-<id> ya existente.
    # ---------------------------------------------------------------
    def fold(s):
        if s is None:
            return None
        return ' '.join(str(s).strip().lower()
                         .replace('á', 'a').replace('é', 'e').replace('í', 'i')
                         .replace('ó', 'o').replace('ú', 'u').split())

    uo_fold_to_id = {fold(clean(r['Unidad_Organizativa'])): clean(r['ID_UO'])
                      for _, r in dim_uo.iterrows()}

    nodes_entidad = []
    entidad_id_to_graph_id = {}   # ID_Entidad -> "ent-<id>" o "uo-<id>" si fusiona
    fusionadas = []
    for _, r in dim_entidad.iterrows():
        eid = clean(r['ID_Entidad'])
        nombre = clean(r['Entidad'])
        tipo = clean(r['Tipo'])
        f = fold(normalizar_uo_nombre(nombre))
        if tipo == 'Interno' and f in uo_fold_to_id:
            # Fusión: esta entidad ES una Unidad Organizativa, no se crea nodo aparte.
            entidad_id_to_graph_id[eid] = f"uo-{uo_fold_to_id[f]}"
            fusionadas.append(nombre)
            continue
        gid = f"ent-{eid}"
        entidad_id_to_graph_id[eid] = gid
        nodes_entidad.append({
            'id': gid,
            'type': 'entidad',
            'label': nombre,
            'data': {'idEntidad': eid, 'tipoEntidad': tipo},
        })
    write_json('nodes-entidades.json', nodes_entidad)
    print(f'  (fusionadas con UO por nombre: {len(fusionadas)} -> {fusionadas})')

    # ---------------------------------------------------------------
    # Nodos: Aplicativo
    # ---------------------------------------------------------------
    apps_con_relacion = set(clean(v) for v in rel_aplicativo['Aplicativo_Normalizado'].tolist())
    nodes_aplicativo = []
    app_valor_to_id = {}
    for _, r in dim_aplicativo.iterrows():
        aid = clean(r['ID_Aplicativo'])
        valor = clean(r['Aplicativo_Normalizado'])
        app_valor_to_id[valor] = aid
        nodes_aplicativo.append({
            'id': f"app-{aid}",
            'type': 'aplicativo',
            'label': valor,
            'data': {
                'idAplicativo': aid,
                'tieneRelacionConSalidas': valor in apps_con_relacion,
            },
        })
    write_json('nodes-aplicativos.json', nodes_aplicativo)

    # ---------------------------------------------------------------
    # Nodos: Salida (incluye subproductos/procesos como listas embebidas
    # para consumo rápido del panel lateral, además de las aristas)
    # ---------------------------------------------------------------
    sub_por_salida = {}
    for _, r in rel_subproducto.iterrows():
        sid = clean(r['ID_Salida'])
        sub_por_salida.setdefault(sid, []).append(display_label(clean(r['SubProducto']), SUBPRODUCTO_DISPLAY_MAP))

    proc_por_salida = {}
    for _, r in rel_procesocentral.iterrows():
        sid = clean(r['ID_Salida'])
        proc_por_salida.setdefault(sid, []).append(display_label(clean(r['ProcesoCentral']), PROCESOCENTRAL_DISPLAY_MAP))

    # Se embebe también la lista de aplicativos relacionados (misma fuente que
    # usa el Grafo 1 como arista): así el Grafo 2 puede mostrarla en el panel
    # lateral de una Salida sin necesidad de cargar nodos "aplicativo" ni sus
    # aristas, que no forman parte de este grafo.
    app_por_salida = {}
    for _, r in rel_aplicativo.iterrows():
        sid = clean(r['ID_Salida'])
        valor = clean(r['Aplicativo_Normalizado'])
        if sid is None or valor is None:
            continue
        app_por_salida.setdefault(sid, []).append(valor)

    nodes_salida = []
    for _, r in fact_salidas.iterrows():
        sid = clean(r['ID_Salida'])
        id_rto = clean(r['ID_RangoRTO'])
        nodes_salida.append({
            'id': f"sal-{sid}",
            'type': 'salida',
            'label': clean(r['Nombre_Salida']),
            'data': {
                'idSalida': sid,
                'idUO': clean(r['ID_UO']),
                'descripcion': clean(r['Descripcion']),
                'referente': clean(r['Referente']),
                'frecuencia': clean(r['Frecuencia']),
                'periodosAltaCriticidad': clean(r['Periodos_Alta_Criticidad']),
                'idRangoRTO': id_rto,
                'rtoNormalizado': clean(r['RTO_Normalizado']),
                'incorporacionEnAlcance': clean(r['Incorporacion_En_Alcance']),
                'subproductos': sub_por_salida.get(sid, []),
                'procesosCentrales': proc_por_salida.get(sid, []),
                'aplicativosRelacionados': app_por_salida.get(sid, []),
            },
        })
    write_json('nodes-salidas.json', nodes_salida)

    # ---------------------------------------------------------------
    # Aristas
    # ---------------------------------------------------------------
    # UO -> Salida (la UO produce la Salida)
    edges_uo_salida = []
    for _, r in fact_salidas.iterrows():
        sid = clean(r['ID_Salida'])
        uid = clean(r['ID_UO'])
        if sid is None or uid is None:
            continue
        edges_uo_salida.append({
            'id': f"e-uo-sal-{sid}",
            'type': 'uo_produce_salida',
            'source': f"uo-{uid}",
            'target': f"sal-{sid}",
            'directed': True,
            'data': {},
        })
    write_json('edges-uo-salida.json', edges_uo_salida)

    # Salida <-> Aplicativo (Grafo 1; no dirigida en el diseño visual, pero
    # se guarda source/target para que Cytoscape la trate como arista simple)
    edges_salida_aplicativo = []
    for i, r in rel_aplicativo.iterrows():
        sid = clean(r['ID_Salida'])
        app_valor = clean(r['Aplicativo_Normalizado'])
        aid = app_valor_to_id.get(app_valor)
        if sid is None or aid is None:
            continue
        edges_salida_aplicativo.append({
            'id': f"e-sal-app-{i}",
            'type': 'salida_usa_aplicativo',
            'source': f"sal-{sid}",
            'target': f"app-{aid}",
            'directed': False,
            'data': {'aplicativoOriginal': clean(r['Aplicativo_Original'])},
        })
    write_json('edges-salida-aplicativo.json', edges_salida_aplicativo)

    # Salida -> Entidad (sucesora), con fusión UO aplicada
    edges_salida_entidad = []
    for i, r in rel_sucesora.iterrows():
        sid = clean(r['ID_Salida'])
        eid = clean(r['ID_Entidad_Destino'])
        target_gid = entidad_id_to_graph_id.get(eid)
        if sid is None or target_gid is None:
            continue
        edges_salida_entidad.append({
            'id': f"e-sal-ent-suc-{i}",
            'type': 'salida_hacia_entidad',
            'source': f"sal-{sid}",
            'target': target_gid,
            'directed': True,
            'data': {'tipoEntidad': clean(r['Tipo'])},
        })
    write_json('edges-salida-entidad-sucesora.json', edges_salida_entidad)

    # Entidad -> Salida (predecesora), con fusión UO aplicada
    edges_entidad_salida = []
    for i, r in rel_predecesora.iterrows():
        sid = clean(r['ID_Salida'])
        eid = clean(r['ID_Entidad_Predecesora'])
        source_gid = entidad_id_to_graph_id.get(eid)
        if sid is None or source_gid is None:
            continue
        edges_entidad_salida.append({
            'id': f"e-ent-sal-pred-{i}",
            'type': 'entidad_hacia_salida',
            'source': source_gid,
            'target': f"sal-{sid}",
            'directed': True,
            'data': {'tipoEntidad': clean(r['Tipo'])},
        })
    write_json('edges-entidad-salida-predecesora.json', edges_entidad_salida)

    # ---------------------------------------------------------------
    # NUEVO — Vista por Equipo (Grafo 2): aristas agregadas Equipo<->Equipo
    # (UO relevada o Entidad Interno/Externo) con peso = cantidad de
    # Salidas distintas que sostienen esa relación. Reemplaza la necesidad
    # del toggle roto "Mostrar salidas": acá la Salida no es un nodo, es el
    # dato agregado (weight) de la arista entre dos equipos.
    # uo_de_salida: ID_UO de cada Salida, para resolver el equipo emisor.
    # ---------------------------------------------------------------
    uo_de_salida = {clean(r['ID_Salida']): clean(r['ID_UO']) for _, r in fact_salidas.iterrows()}
    nombre_salida = {clean(r['ID_Salida']): clean(r['Nombre_Salida']) for _, r in fact_salidas.iterrows()}

    def agregar_equipo_edges(rows, col_entidad_id, direccion):
        """direccion: 'salida_a_entidad' (sucesora) o 'entidad_a_salida' (predecesora)"""
        acc = {}  # (uoGid, entGid) -> set(idSalida)
        for _, r in rows.iterrows():
            sid = clean(r['ID_Salida'])
            eid = clean(r[col_entidad_id])
            ent_gid = entidad_id_to_graph_id.get(eid)
            uid = uo_de_salida.get(sid)
            if sid is None or ent_gid is None or uid is None:
                continue
            uo_gid = f"uo-{uid}"
            if ent_gid == uo_gid:
                continue  # una salida no se relaciona consigo misma (entidad fusionada con su propia UO)
            key = (uo_gid, ent_gid)
            acc.setdefault(key, set()).add(sid)
        return acc

    acc_sucesora = agregar_equipo_edges(rel_sucesora, 'ID_Entidad_Destino', 'salida_a_entidad')
    acc_predecesora = agregar_equipo_edges(rel_predecesora, 'ID_Entidad_Predecesora', 'entidad_a_salida')

    edges_equipo_agregado = []
    for (uo_gid, ent_gid), sids in acc_sucesora.items():
        edges_equipo_agregado.append({
            'id': f"e-equipo-suc-{uo_gid}-{ent_gid}",
            'type': 'equipo_hacia_entidad',
            'source': uo_gid,
            'target': ent_gid,
            'directed': True,
            'data': {
                'peso': len(sids),
                'salidas': sorted([nombre_salida.get(s, str(s)) for s in sids]),
            },
        })
    for (uo_gid, ent_gid), sids in acc_predecesora.items():
        edges_equipo_agregado.append({
            'id': f"e-equipo-pred-{ent_gid}-{uo_gid}",
            'type': 'entidad_hacia_equipo',
            'source': ent_gid,
            'target': uo_gid,
            'directed': True,
            'data': {
                'peso': len(sids),
                'salidas': sorted([nombre_salida.get(s, str(s)) for s in sids]),
            },
        })
    write_json('edges-equipo-agregado.json', edges_equipo_agregado)

    # ---------------------------------------------------------------
    # NUEVO — Temporalidad de Recursos: Personal Clave, Equipamiento de
    # Oficina, Equipamiento Especial, Proveedores Críticos y Almacenamiento
    # / Repositorios, cada uno distribuido en las 5 franjas de
    # Dim_RangoTiempo_Recursos. Proveedores/Almacenamiento no traen una
    # columna de cantidad: cada fila con Aplica=True cuenta como 1 recurso
    # que necesita estar recuperado en esa franja.
    # ---------------------------------------------------------------
    rangos_recursos = []
    for _, r in dim_rango_recursos.sort_values('ID_RangoRecursos').iterrows():
        rangos_recursos.append({
            'id': clean(r['ID_RangoRecursos']),
            'label': clean(r['Rango']),
            'horasDesde': clean(r['Horas_Desde']),
            'horasHasta': clean(r['Horas_Hasta']),
        })

    def registros_desde_cantidad(df, col_uo, col_item, col_rango_id, col_cantidad, col_detalle=None):
        out = []
        for _, r in df.iterrows():
            cantidad = clean(r[col_cantidad])
            if not cantidad:
                continue
            uo_nombre = clean(r[col_uo])
            uid = uo_fold_to_id.get(fold(uo_nombre))
            out.append({
                'idUO': uid,
                'uoLabel': uo_nombre,
                'item': clean(r[col_item]),
                'detalle': clean(r[col_detalle]) if col_detalle else None,
                'idRango': clean(r[col_rango_id]),
                'cantidad': cantidad,
            })
        return out

    def registros_desde_aplica(df, col_uo, col_item, col_rango_id, col_aplica, col_detalle=None):
        out = []
        for _, r in df.iterrows():
            if clean(r[col_aplica]) is not True and r[col_aplica] is not True:
                continue
            uo_nombre = clean(r[col_uo])
            uid = uo_fold_to_id.get(fold(uo_nombre))
            out.append({
                'idUO': uid,
                'uoLabel': uo_nombre,
                'item': clean(r[col_item]),
                'detalle': clean(r[col_detalle]) if col_detalle else None,
                'idRango': clean(r[col_rango_id]),
                'cantidad': 1,
            })
        return out

    recursos = {
        'rangos': rangos_recursos,
        'tipos': [
            {
                'id': 'personal', 'label': 'Personal Clave', 'unidadMedida': 'personas',
                'registros': registros_desde_cantidad(
                    fact_personal, 'Unidad_Organizativa', 'Rol', 'ID_RangoRecursos', 'Cantidad_En_Rango', 'Detalle'),
            },
            {
                'id': 'equipamiento_oficina', 'label': 'Equipamiento de Oficina', 'unidadMedida': 'unidades',
                'registros': registros_desde_cantidad(
                    fact_equipo_oficina, 'Unidad_Organizativa', 'Equipamiento', 'ID_RangoRecursos', 'Cantidad_En_Rango', 'Detalle'),
            },
            {
                'id': 'equipamiento_especial', 'label': 'Equipamiento Especial', 'unidadMedida': 'unidades',
                'registros': registros_desde_cantidad(
                    fact_equipo_especial, 'Unidad_Organizativa', 'Equipamiento', 'ID_RangoRecursos', 'Cantidad_En_Rango', 'Detalle'),
            },
            {
                'id': 'proveedores', 'label': 'Proveedores', 'unidadMedida': 'proveedores',
                'registros': registros_desde_aplica(
                    fact_proveedores, 'Unidad_Organizativa', 'Proveedor', 'ID_RangoRecursos', 'Aplica', 'Rubro'),
            },
            {
                'id': 'almacenamiento', 'label': 'Almacenamiento / Repositorios', 'unidadMedida': 'repositorios',
                'registros': registros_desde_aplica(
                    fact_almacenamiento, 'Unidad_Organizativa', 'Directorio', 'ID_RangoRecursos', 'Aplica', 'Registros Vitales'),
            },
            {
                'id': 'aplicativos', 'label': 'Aplicativos', 'unidadMedida': 'aplicativos',
                'registros': registros_desde_aplica(
                    fact_aplicativos_criticidad, 'Unidad_Organizativa', 'Aplicativo_Normalizado', 'ID_RangoRecursos', 'Aplica', 'Aplicaciones Críticas'),
            },
        ],
    }
    write_json('recursos-temporalidad.json', recursos)

    # ---------------------------------------------------------------
    # NUEVO — Betweenness por Equipo. Se calcula sobre el grafo COMPLETO
    # (UO, Salida, Aplicativo, Entidad) porque la Salida es el "puente" real
    # de la organización -- ahí es donde efectivamente conecta un equipo con
    # otro. Se usa networkx.betweenness_centrality (no dirigido, PESADO):
    # mide, para cada nodo, en qué proporción de los caminos MÁS CORTOS
    # entre TODOS los demás pares del grafo ese nodo actúa de intermediario.
    #
    # Ponderación por criticidad (decisión validada 2026-07-28): sin peso,
    # el cálculo original premiaba a los nodos con MÁS relaciones sin
    # importar su RTO, lo cual es conceptualmente incorrecto para un BIA
    # (una Salida con RTO de 2-4hs es más crítica que una con RTO >72hs,
    # aunque esta última tenga más aplicativos/entidades relacionados). Cada
    # arista que toca una Salida se pesa con el ID_RangoRTO de esa Salida
    # (1 = "2 a 4 horas" ... 6 = "Más de 36 horas"): al ser betweenness una
    # métrica de CAMINOS MÁS CORTOS, un peso más bajo (más crítico) hace que
    # esa arista sea preferida por el algoritmo, empujando hacia arriba del
    # ranking a los equipos que sostienen operatoria más crítica — no solo
    # a los que tienen más conexiones.
    #
    # Se excluye "M365 (Excel/Office)" del grafo (no del resultado: del
    # cálculo en sí), porque al ser una herramienta de uso transversal no
    # aporta ningún insight de riesgo puntual y, al ser un hub artificial,
    # distorsionaba el betweenness de todo el resto de la red.
    #
    # La Salida participa del cálculo como nodo puente pero se excluye del
    # resultado final, que se reporta a nivel de Equipo BNA (relevado / no
    # relevado) / Tercero / Aplicativo.
    # ---------------------------------------------------------------
    import networkx as nx

    EXCLUIDOS_BETWEENNESS = {'M365 (Excel/Office)'}
    apps_excluidos_gids = {n['id'] for n in nodes_aplicativo if n['label'] in EXCLUIDOS_BETWEENNESS}
    id_rto_por_salida_gid = {n['id']: (n['data']['idRangoRTO'] or 3) for n in nodes_salida}

    def peso_arista(e):
        """Peso = ID_RangoRTO de la Salida que toca esta arista (más bajo =
        más crítico = distancia más corta = más peso en el cálculo)."""
        for extremo in (e['source'], e['target']):
            if extremo in id_rto_por_salida_gid:
                return id_rto_por_salida_gid[extremo]
        return 3  # fallback: punto medio de la escala 1-6, no debería usarse

    G = nx.Graph()
    for n in nodes_uo:
        G.add_node(n['id'], kind='uo')
    for n in nodes_entidad:
        G.add_node(n['id'], kind='entidad', tipoEntidad=n['data']['tipoEntidad'], nombre=n['label'])
    for n in nodes_aplicativo:
        if n['id'] in apps_excluidos_gids:
            continue
        G.add_node(n['id'], kind='aplicativo')
    for n in nodes_salida:
        G.add_node(n['id'], kind='salida')

    for e in edges_uo_salida:
        G.add_edge(e['source'], e['target'], weight=peso_arista(e))
    for e in edges_salida_aplicativo:
        if e['target'] in apps_excluidos_gids:
            continue
        G.add_edge(e['source'], e['target'], weight=peso_arista(e))
    for e in edges_salida_entidad:
        G.add_edge(e['source'], e['target'], weight=peso_arista(e))
    for e in edges_entidad_salida:
        G.add_edge(e['source'], e['target'], weight=peso_arista(e))

    btw = nx.betweenness_centrality(G, normalized=True, weight='weight')
    label_by_id = {}
    for n in nodes_uo + nodes_entidad + nodes_aplicativo + nodes_salida:
        label_by_id[n['id']] = n['label']

    nombre_entidad_by_gid = {n['id']: n['label'] for n in nodes_entidad}
    tipo_crudo_by_gid = {n['id']: n['data']['tipoEntidad'] for n in nodes_entidad}

    equipos_betweenness = []
    for nid, data in G.nodes(data=True):
        kind = data['kind']
        if kind == 'salida':
            continue  # se excluye del resultado, solo aporta al cálculo
        grado = G.degree(nid)  # cantidad de Salidas (u otros equipos) directamente conectados
        if kind == 'uo':
            categoria = 'equipo_bna_relevado'
        elif kind == 'aplicativo':
            categoria = 'aplicativo'
        else:  # entidad
            tipo_ef = tipo_efectivo(nombre_entidad_by_gid[nid], tipo_crudo_by_gid[nid])
            categoria = 'tercero' if tipo_ef == 'Externo' else 'equipo_bna_no_relevado'
        equipos_betweenness.append({
            'id': nid,
            'label': label_by_id[nid],
            'categoria': categoria,
            'betweenness': round(btw[nid], 6),
            'grado': grado,
        })
    equipos_betweenness.sort(key=lambda x: x['betweenness'], reverse=True)
    write_json('betweenness-equipos.json', {
        'nodos': equipos_betweenness,
        'excluidos': sorted(EXCLUIDOS_BETWEENNESS),
        'notaMetodologica': (
            'Betweenness centrality (networkx, no dirigido, PESADO por RTO) calculado '
            'sobre el grafo completo Unidad Organizativa - Salida - Aplicativo - '
            'Entidad. Cada arista se pesa con el ID_RangoRTO (1 a 6) de la Salida que '
            'toca: a menor RTO (más crítico), menor peso, y por lo tanto mayor '
            'probabilidad de estar en un camino más corto. "M365 (Excel/Office)" se '
            'excluye del grafo por ser un hub transversal que no aporta insight de '
            'riesgo puntual. La Salida participa del cálculo como nodo puente pero se '
            'excluye del resultado final, que se reporta a nivel de Equipo.'
        ),
    })

    # ---------------------------------------------------------------
    # Metadata (para que la app sepa qué se generó, cuándo, y desde qué archivo)
    # ---------------------------------------------------------------
    import datetime
    meta = {
        'generadoDesde': str(src_path),
        'generadoEl': datetime.datetime.now().isoformat(timespec='seconds'),
        'reglas': [
            'Filas vacias de SubProducto/ProcesoCentral -> "Sin especificar"',
            'Variantes tipograficas agrupadas solo por displayLabel (dato crudo intacto)',
            'RTO usado como indicador de criticidad (1=mas critico .. 6=menos critico)',
            'Entidades Internas cuyo nombre coincide con una Unidad Organizativa se fusionan con el nodo UO',
        ],
        'conteos': {
            'unidadesOrganizativas': len(nodes_uo),
            'entidades': len(nodes_entidad),
            'entidadesFusionadasConUO': len(fusionadas),
            'aplicativos': len(nodes_aplicativo),
            'salidas': len(nodes_salida),
            'edgesUOSalida': len(edges_uo_salida),
            'edgesSalidaAplicativo': len(edges_salida_aplicativo),
            'edgesSalidaEntidadSucesora': len(edges_salida_entidad),
            'edgesEntidadSalidaPredecesora': len(edges_entidad_salida),
            'edgesEquipoAgregado': len(edges_equipo_agregado),
            'nodosBetweenness': len(equipos_betweenness),
            'registrosRecursos': sum(len(t['registros']) for t in recursos['tipos']),
        },
    }
    write_json('meta.json', meta)

    print('\nListo. Resumen:')
    print(json.dumps(meta['conteos'], indent=2, ensure_ascii=False))


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    main(src)
