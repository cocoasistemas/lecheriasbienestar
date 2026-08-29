// ============================================================
// BITÁCORA DE LECHERÍAS
// Conexión, autenticación y operaciones con Supabase
// ============================================================

// ---- 1. CONFIGURACIÓN DE SUPABASE ----
const SUPABASE_URL  = 
  'https://sgziuqgwdcliefrhzfgk.supabase.co';   
const SUPABASE_ANON = 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNneml1cWd3ZGNsaWVmcmh6ZmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNjU1MDYsImV4cCI6MjA5ODk0MTUwNn0.t5MnqGrT4-pq-NyejK8waDo21wDpyxJQD-P8S-haejc';               // ← reemplazar
const sb = supabase.createClient(
  SUPABASE_URL, 
  SUPABASE_ANON
  );

// Variables globales que la app espera (se llenan al iniciar sesión)
let MI_PERFIL = null;   // {rol, sub, nombre}

// ---- 2. LOGIN ----
async function iniciarSesion(correo, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: correo, password });
  if (error) { throw error; }
  // cargar perfil (rol)
  const { data: perfil, error: e2 } = await sb
    .from('perfiles').select('*').eq('id', data.user.id).single();
  if (e2) { throw e2; }
  MI_PERFIL = perfil;
  return perfil;
}

async function cerrarSesion() {
  await sb.auth.signOut();
  MI_PERFIL = null;
  location.reload();
}

// Al cargar la página, revisa si ya hay sesión activa
async function revisarSesion() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    const { data: perfil } = await sb
      .from('perfiles').select('*').eq('id', data.session.user.id).single();
    MI_PERFIL = perfil;
    return perfil;
  }
  return null;
}

// ---- 3. CONSULTAS Y CARGA DE DATOS ----
async function cargarLecherias() {
  const TAMANO_PAGINA = 1000;
  let desde = 0;
  let registros = [];

  while (true) {
    const hasta =
      desde + TAMANO_PAGINA - 1;

    const { data, error } = await sb
      .from('lecherias')
      .select(`
        pv, estado, municipio, localidad, calle, colonia,
        familias, beneficiarios, lat, lng, zona, sub,
        fcomp, activo,
        avances (
          status,
          m2,
          vobo,
          motivo,
          freal,
          fecha_vobo,
          m2_protegido
        ),
        excedentes (
          m2_excedente,
          precio_m2,
          evidencia_url
        )
      `)
      .eq('activo', true)
      .order('pv', {
        ascending: true
      })
      .range(desde, hasta);

    if (error) {
      throw error;
    }

    const pagina =
      Array.isArray(data)
        ? data
        : [];

    registros.push(...pagina);

    if (pagina.length < TAMANO_PAGINA) {
      break;
    }

    desde += TAMANO_PAGINA;
  }

  return registros.map((r, i) => {
    const av =
      Array.isArray(r.avances)
        ? (r.avances[0] || {})
        : (r.avances || {});

    const ex =
      Array.isArray(r.excedentes)
        ? (r.excedentes[0] || {})
        : (r.excedentes || {});

    return {
      id: i,

      pv: r.pv,
      estado: r.estado,
      municipio: r.municipio,
      localidad: r.localidad,
      calle: r.calle,
      colonia: r.colonia,

      familias:
        r.familias === null
          ? null
          : Number(r.familias),

      beneficiarios:
        r.beneficiarios === null
          ? null
          : Number(r.beneficiarios),

      lat:
        r.lat === null ||
        r.lat === ''
          ? null
          : Number(r.lat),

      lng:
        r.lng === null ||
        r.lng === ''
          ? null
          : Number(r.lng),

      zona: r.zona,
      sub: r.sub,
      fcomp: r.fcomp,

      status: av.status || 'no',
      m2: Number(av.m2) || M2_STD,
      vobo: av.vobo || '-',
      motivo: av.motivo || '',
      freal: av.freal || '',
      fecha_vobo: av.fecha_vobo || '',

      m2_protegido:
      av.m2_protegido === true,

      m2_excedente:
        Number(ex.m2_excedente) || 0,

      precio_m2:
        Number(ex.precio_m2) ||
        precioExtraSub(r.sub),

      evidencia_url:
        ex.evidencia_url || '',

      extraEvidencia:
        ex.evidencia_url
          ? [ex.evidencia_url]
          : [],

      fotosPrev: [],
      fotosFin: [],
      adjuntos: []
    };
  });
}

// Carga las fotos de una lechería (cuando se abre su detalle)
async function cargarFotos(pv) {
  const { data, error } = await sb
    .from('fotos')
    .select('id, momento, tipo, archivo_url, lat, lng, fecha_hora')
    .eq('pv', pv)
    .order('fecha_hora', { ascending: true });

  if (error) {
    throw error;
  }

    const convertirFoto = foto => ({
    id: foto.id,
    tipo: foto.tipo,
    url: foto.archivo_url,
    lat: foto.lat,
    lng: foto.lng,
    fecha: foto.fecha_hora
  });

  const prev = (data || [])
    .filter(foto => foto.momento === 'prev')
    .map(convertirFoto);

  const fin = (data || [])
    .filter(foto => foto.momento === 'fin')
    .map(convertirFoto);

  return { prev, fin };
}

  async function cargarAdjuntos(pv) {
  const { data, error } = await sb
    .from('adjuntos')
    .select('id, tipo, archivo_url, fecha')
    .eq('pv', pv)
    .order('fecha', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []).map(adjunto => {
    const segmento = adjunto.archivo_url.split('/').pop() || 'archivo';
    const nombreCodificado = segmento.replace(/^\d+_/, '');

    return {
      id: adjunto.id,
      tipo: adjunto.tipo || 'documento',
      url: adjunto.archivo_url,
      fecha: adjunto.fecha,
      nombre: decodeURIComponent(nombreCodificado)
    };
  });
}

async function subirAdjunto(pv, tipo, archivo) {
  const uid = (await sb.auth.getUser()).data.user.id;

  const nombreSeguro = archivo.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');

  const ruta = `${pv}/adjuntos/${Date.now()}_${nombreSeguro}`;

  const { error: errorStorage } = await sb.storage
    .from('evidencias')
    .upload(ruta, archivo, {
      contentType: archivo.type || undefined
    });

  if (errorStorage) {
    throw errorStorage;
  }

  const { data: publica } = sb.storage
    .from('evidencias')
    .getPublicUrl(ruta);

  const { data, error: errorTabla } = await sb
    .from('adjuntos')
    .insert({
      pv,
      tipo,
      archivo_url: publica.publicUrl,
      subido_por: uid
    })
    .select('id, tipo, archivo_url, fecha')
    .single();

  if (errorTabla) {
    // Si falla el registro, elimina el archivo recién subido.
    await sb.storage.from('evidencias').remove([ruta]);
    throw errorTabla;
  }

  return {
    id: data.id,
    tipo: data.tipo,
    url: data.archivo_url,
    fecha: data.fecha,
    nombre: archivo.name
  };
}

async function eliminarAdjunto(idAdjunto, archivoUrl) {
  const { error: errorTabla } = await sb
    .from('adjuntos')
    .delete()
    .eq('id', idAdjunto);

  if (errorTabla) {
    throw errorTabla;
  }

  const marcador = '/storage/v1/object/public/evidencias/';
  const posicion = archivoUrl.indexOf(marcador);

  if (posicion === -1) return;

  const ruta = decodeURIComponent(
    archivoUrl.substring(posicion + marcador.length)
  );

  const { error: errorStorage } = await sb.storage
    .from('evidencias')
    .remove([ruta]);

  if (errorStorage) {
    console.warn(
      'El registro se eliminó, pero el archivo quedó en Storage:',
      errorStorage
    );
  }
}

//carga las actas
async function cargarActas() {
  const { data, error } = await sb
    .from('actas')
    .select('*')
    .order('creado', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

// ============================================================
// ACTAS INDIVIDUALES POR LECHERÍA
// ============================================================

async function cargarActaIndividual(
  pv,
  clase
) {
  const { data, error } = await sb
    .from('actas')
    .select(`
      id,
      tipo,
      zona,
      sub,
      pv,
      clase,
      pvs,
      estado,
      comentarios,
      documento_url,
      documento_generado_url,
      documento_firmado_url,
      fecha_firma,
      version_formato,
      documento_generado_v2_url,
      documento_firmado_v2_url,
      fecha_firma_v2,
      fini,
      ffin,
      admin,
      contratista,
      creado
    `)
    .eq('pv', pv)
    .eq('clase', clase)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function crearActaAperturaBD(
  punto
) {
  const registro = {
    tipo: 'dependencia',

    zona:
      punto.zona || null,

    sub:
      punto.sub || null,

    pv:
      punto.pv,

    clase:
      'apertura',

    // Se conserva por compatibilidad con
    // funciones antiguas que todavía utilizan pvs.
    pvs: [
      punto.pv
    ],

    estado:
      'por_armar',

    comentarios:
      null,

    contratista:
      typeof EMPRESA !== 'undefined'
        ? EMPRESA
        : 'LUMEN-OAX PROYECTOS Y CONSTRUCCIÓN S.A. DE C.V.',

    admin:
      typeof DEPENDENCIA !== 'undefined'
        ? DEPENDENCIA
        : 'LECHE PARA EL BIENESTAR, S.A. DE C.V.'
  };

  const { data, error } = await sb
    .from('actas')
    .insert(registro)
    .select('*')
    .single();

  if (error) {
    /*
     * Si por doble clic o recarga ya existe,
     * recuperamos la existente.
     */
    if (error.code === '23505') {
      return await cargarActaIndividual(
        punto.pv,
        'apertura'
      );
    }

    throw error;
  }

  return data;
}

async function crearActaRecepcionBD(
  punto
) {
  const registro = {
    tipo: 'dependencia',

    zona:
      punto.zona || null,

    sub:
      punto.sub || null,

    pv:
      punto.pv,

    clase:
      'recepcion',

    /*
     * Compatibilidad con las funciones
     * antiguas que todavía leen pvs.
     */
    pvs: [
      punto.pv
    ],

    estado:
      'por_armar',

    comentarios:
      null,

    /*
     * Para recepción utilizamos la fecha
     * real de ejecución cuando ya existe.
     */
    fini:
      punto.freal || null,

    ffin:
      punto.freal || null,

    contratista:
      typeof EMPRESA !== 'undefined'
        ? EMPRESA
        : 'LUMEN-OAX PROYECTOS Y CONSTRUCCIÓN S.A. DE C.V.',

    admin:
      typeof DEPENDENCIA !== 'undefined'
        ? DEPENDENCIA
        : 'LECHE PARA EL BIENESTAR, S.A. DE C.V.'
  };

  const { data, error } = await sb
    .from('actas')
    .insert(registro)
    .select('*')
    .single();

  if (error) {
    /*
     * Nuestro índice único impide que
     * exista dos veces:
     *
     * PV + recepcion
     */
    if (error.code === '23505') {
      return await cargarActaIndividual(
        punto.pv,
        'recepcion'
      );
    }

    throw error;
  }

  return data;
}

async function guardarPDFGeneradoActaIndividual(
  acta,
  blob
) {
  const pvSeguro =
    String(acta.pv)
      .replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

  const claseSeguro =
    String(
      acta.clase || 'acta'
    )
      .replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

  const ruta =
    `${pvSeguro}/actas/${claseSeguro}/` +
    `generada_${Date.now()}.pdf`;

  const { error: errorStorage } =
    await sb.storage
      .from('evidencias')
      .upload(
        ruta,
        blob,
        {
          contentType:
            'application/pdf',

          upsert:
            false
        }
      );

  if (errorStorage) {
    throw errorStorage;
  }

  const { data: publica } =
    sb.storage
      .from('evidencias')
      .getPublicUrl(ruta);

  const url =
    publica.publicUrl;

  const { data, error } =
    await sb
      .from('actas')
      .update({
        documento_generado_url:
          url
      })
      .eq(
        'id',
        acta.id
      )
      .select('*')
      .single();

  if (error) {
    /*
     * Evitamos archivo huérfano
     * si falla la actualización.
     */
    await sb.storage
      .from('evidencias')
      .remove([
        ruta
      ]);

    throw error;
  }

  return data;
}

async function guardarPDFGeneradoActaIndividualV2(
  acta,
  blob
) {
  const pvSeguro =
    String(acta.pv)
      .replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

  const claseSeguro =
    String(
      acta.clase || 'acta'
    )
      .replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

  const ruta =
    `${pvSeguro}/actas/${claseSeguro}/v2/` +
    `generada_${Date.now()}.pdf`;

  const { error: errorStorage } =
    await sb.storage
      .from('evidencias')
      .upload(
        ruta,
        blob,
        {
          contentType:
            'application/pdf',

          upsert:
            false
        }
      );

  if (errorStorage) {
    throw errorStorage;
  }

  const { data: publica } =
    sb.storage
      .from('evidencias')
      .getPublicUrl(ruta);

  const url =
    publica.publicUrl;

  const { data, error } =
    await sb
      .from('actas')
      .update({
        documento_generado_v2_url:
          url,

        version_formato:
          2
      })
      .eq(
        'id',
        acta.id
      )
      .select('*')
      .single();

  if (error) {
    await sb.storage
      .from('evidencias')
      .remove([
        ruta
      ]);

    throw error;
  }

  return data;
}

async function guardarComentariosActaIndividual(
  actaId,
  comentarios
) {
  const { data, error } = await sb
    .from('actas')
    .update({
      comentarios:
        comentarios || null
    })
    .eq(
      'id',
      actaId
    )
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function subirActaIndividualFirmada(
  acta,
  archivo
) {
  const extension =
    archivo.name.includes('.')
      ? archivo.name
          .split('.')
          .pop()
          .toLowerCase()
      : 'pdf';

  const permitidas = [
    'pdf',
    'jpg',
    'jpeg',
    'png'
  ];

  if (
    !permitidas.includes(
      extension
    )
  ) {
    throw new Error(
      'Solo se permiten PDF, JPG o PNG'
    );
  }

  const pvSeguro =
    String(acta.pv)
      .replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

  const claseSeguro =
    String(
      acta.clase || 'acta'
    )
      .replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

  const urlAnterior =
  acta.documento_firmado_url ||
  null;

  const ruta =
    `${pvSeguro}/actas/${claseSeguro}/` +
    `firmada_${Date.now()}.${extension}`;

  const {
    error: errorStorage
  } =
    await sb.storage
      .from('evidencias')
      .upload(
        ruta,
        archivo,
        {
          contentType:
            archivo.type ||
            undefined,

          upsert:
            false
        }
      );

  if (errorStorage) {
    throw errorStorage;
  }

  const { data: publica } =
    sb.storage
      .from('evidencias')
      .getPublicUrl(
        ruta
      );

  const url =
    publica.publicUrl;

  const hoy =
    new Date()
      .toISOString()
      .slice(0, 10);

  const { data, error } =
    await sb
      .from('actas')
      .update({
        documento_firmado_url:
          url,

        /*
         * Conservamos documento_url para
         * compatibilidad con el módulo viejo.
         */
        documento_url:
          url,

        fecha_firma:
          hoy,

        estado:
          'en_revision'
      })
      .eq(
        'id',
        acta.id
      )
      .select('*')
      .single();

  if (error) {
    await sb.storage
      .from('evidencias')
      .remove([
        ruta
      ]);

    throw error;
  }

  /*
 * Si ya había un documento anterior,
 * lo eliminamos de Storage después
 * de confirmar que el nuevo quedó guardado.
 */
if (
  urlAnterior &&
  urlAnterior !== url
) {
  try {
    const marcador =
      '/storage/v1/object/public/evidencias/';

    const posicion =
      urlAnterior.indexOf(
        marcador
      );

    if (posicion !== -1) {
      const rutaAnterior =
        decodeURIComponent(
          urlAnterior.substring(
            posicion +
            marcador.length
          )
        );

      const {
        error: errorBorrado
      } =
        await sb.storage
          .from('evidencias')
          .remove([
            rutaAnterior
          ]);

      if (errorBorrado) {
        console.warn(
          'El acta fue reemplazada, pero no se pudo eliminar el archivo anterior:',
          errorBorrado
        );
      }
    }

  } catch (error) {
    console.warn(
      'No fue posible limpiar el archivo anterior:',
      error
    );
  }
}

  return data;
}

async function subirActaIndividualFirmadaV2(
  acta,
  archivo
) {
  const extension =
    archivo.name.includes('.')
      ? archivo.name
          .split('.')
          .pop()
          .toLowerCase()
      : 'pdf';

  const permitidas = [
    'pdf',
    'jpg',
    'jpeg',
    'png'
  ];

  if (
    !permitidas.includes(
      extension
    )
  ) {
    throw new Error(
      'Solo se permiten PDF, JPG o PNG'
    );
  }

  const pvSeguro =
    String(acta.pv)
      .replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

  const claseSeguro =
    String(
      acta.clase || 'acta'
    )
      .replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

  /*
   * IMPORTANTE:
   * solamente consideramos como anterior
   * otra V2.
   *
   * La V1 nunca se toca.
   */
  const urlAnteriorV2 =
    acta.documento_firmado_v2_url ||
    null;

  const ruta =
    `${pvSeguro}/actas/${claseSeguro}/v2/` +
    `firmada_${Date.now()}.${extension}`;

  const {
    error: errorStorage
  } =
    await sb.storage
      .from('evidencias')
      .upload(
        ruta,
        archivo,
        {
          contentType:
            archivo.type ||
            undefined,

          upsert:
            false
        }
      );

  if (errorStorage) {
    throw errorStorage;
  }

  const { data: publica } =
    sb.storage
      .from('evidencias')
      .getPublicUrl(
        ruta
      );

  const url =
    publica.publicUrl;

  const hoy =
    new Date()
      .toISOString()
      .slice(0, 10);

  /*
   * Si la acta ya estaba aprobada o
   * en revisión, NO retrocedemos su estado.
   *
   * Si es una acta nueva todavía por armar
   * o rechazada, la nueva firma sí la manda
   * a revisión.
   */
  const estadoNuevo =
    acta.estado === 'aprobada' ||
    acta.estado === 'en_revision'
      ? acta.estado
      : 'en_revision';

  const { data, error } =
    await sb
      .from('actas')
      .update({
        documento_firmado_v2_url:
          url,

        fecha_firma_v2:
          hoy,

        version_formato:
          2,

        /*
         * documento_url pasa a apuntar
         * al documento vigente.
         *
         * documento_firmado_url conserva
         * intacta la V1 histórica.
         */
        documento_url:
          url,

        estado:
          estadoNuevo
      })
      .eq(
        'id',
        acta.id
      )
      .select('*')
      .single();

  if (error) {
    await sb.storage
      .from('evidencias')
      .remove([
        ruta
      ]);

    throw error;
  }

  /*
   * Si sustituimos una V2 previa,
   * limpiamos únicamente esa V2.
   *
   * NUNCA documento_firmado_url de V1.
   */
  if (
    urlAnteriorV2 &&
    urlAnteriorV2 !== url
  ) {
    try {
      const marcador =
        '/storage/v1/object/public/evidencias/';

      const posicion =
        urlAnteriorV2.indexOf(
          marcador
        );

      if (posicion !== -1) {
        const rutaAnterior =
          decodeURIComponent(
            urlAnteriorV2.substring(
              posicion +
              marcador.length
            )
          );

        const {
          error: errorBorrado
        } =
          await sb.storage
            .from('evidencias')
            .remove([
              rutaAnterior
            ]);

        if (errorBorrado) {
          console.warn(
            'La V2 fue reemplazada, pero no se pudo eliminar la V2 anterior:',
            errorBorrado
          );
        }
      }

    } catch (error) {
      console.warn(
        'No fue posible limpiar la V2 anterior:',
        error
      );
    }
  }

  return data;
}

async function obtenerDetalleActa(actaId) {

  const { data, error } = await sb.rpc(
    'obtener_detalle_acta',
    {
      p_acta_id: actaId
    }
  );

  if (error) {
    throw error;
  }

  return data;
}

async function obtenerEstimacion() {
  const { data, error } = await sb.rpc(
    'obtener_estimacion'
  );

  if (error) {
    throw error;
  }

  return data;
}

async function generarActaSub(
  sub,
  fechaInicio,
  fechaFin,
  precioUnidad = PRECIO_FACHADA
) {
  const { data, error } = await sb.rpc('generar_acta_sub', {
    p_sub: sub,
    p_fini: fechaInicio,
    p_ffin: fechaFin,
    p_precio_unidad: precioUnidad
  });

  if (error) {
    throw error;
  }

  return data;
}

async function generarCartaDep(
  fechaInicio,
  fechaFin,
  cantidad = 50,
  precioUnidad = PRECIO_FACHADA
) {
  const { data, error } = await sb.rpc(
    'generar_carta_dep',
    {
      p_fini: fechaInicio,
      p_ffin: fechaFin,
      p_cantidad: cantidad,
      p_precio_unidad: precioUnidad
    }
  );

  if (error) {
    throw error;
  }

  return data;
}

async function subirDocumentoActa(acta, archivo) {
  const extensionOriginal =
    archivo.name.includes('.')
      ? archivo.name.split('.').pop().toLowerCase()
      : 'pdf';

  const extensionesPermitidas = [
    'pdf',
    'jpg',
    'jpeg',
    'png'
  ];

  if (!extensionesPermitidas.includes(extensionOriginal)) {
    throw new Error('Solo se permiten PDF, JPG o PNG');
  }

  const numeroSeguro = (acta.numero || `ACTA-${acta.id}`)
    .replace(/[^a-zA-Z0-9_-]/g, '_');

  const ruta =
    `actas/${numeroSeguro}/` +
    `firmada_${Date.now()}.${extensionOriginal}`;

  const { error: errorStorage } = await sb.storage
    .from('evidencias')
    .upload(ruta, archivo, {
      contentType: archivo.type || undefined,
      upsert: false
    });

  if (errorStorage) {
    throw errorStorage;
  }

  const { data: publica } = sb.storage
    .from('evidencias')
    .getPublicUrl(ruta);

  const { data, error } = await sb.rpc(
    'registrar_documento_acta',
    {
      p_acta_id: acta.id,
      p_documento_url: publica.publicUrl
    }
  );

  if (error) {
    // Evita dejar un archivo huérfano si falla la base.
    await sb.storage
      .from('evidencias')
      .remove([ruta]);

    throw error;
  }

  return data;
}

async function revisarActaBD(
  actaId,
  estado,
  observaciones = []
) {
  const { data, error } = await sb.rpc(
    'revisar_acta',
    {
      p_acta_id: actaId,
      p_estado: estado,
      p_obs: observaciones
    }
  );

  if (error) {
    throw error;
  }

  return data;
}

async function cargarPreciosSubcontrato() {
  const { data, error } = await sb
    .from('precios_subcontrato')
    .select('sub, precio_m2');
  if (error) {
    throw error;
  }
  return Object.fromEntries(
    (data || []).map(registro => [
      registro.sub,
      Number(registro.precio_m2) || 450
    ])
  );
}
// ---- 4. GUARDAR CAMBIOS ----
async function guardarFechaCompromiso(
  pv,
  fecha
) {
  const { error } = await sb
    .from('lecherias')
    .update({
      fcomp: fecha || null
    })
    .eq('pv', pv);

  if (error) {
    throw error;
  }
}

async function guardarIniciada(pv) {
  const uid =
    (await sb.auth.getUser())
      .data.user.id;

  /*
   * Primero revisamos el avance actual.
   * Nunca debemos bajar una lechería
   * que ya está ATENDIDA.
   */
  const {
    data: avance,
    error: errorLectura
  } = await sb
    .from('avances')
    .select(
      'pv, status, m2, vobo, motivo, freal'
    )
    .eq('pv', pv)
    .maybeSingle();

  if (errorLectura) {
    throw errorLectura;
  }

  if (
    avance &&
    avance.status === 'at'
  ) {
    return;
  }

  const { error } =
    await sb
      .from('avances')
      .upsert(
        {
          pv,
          status: 'ini',

          m2:
            avance?.m2 ??
            21,

          vobo:
            avance?.vobo ??
            '-',

          motivo:
            avance?.motivo ??
            null,

          freal:
            avance?.freal ??
            null,

          actualizado_por:
            uid,

          actualizado:
            new Date()
              .toISOString()
        },
        {
          onConflict: 'pv'
        }
      );

  if (error) {
    throw error;
  }
}

// Subir una foto al Storage y registrar en la tabla
async function subirFoto(pv, momento, tipo, archivo, lat, lng) {
  const ruta = `${pv}/${momento}_${tipo}_${Date.now()}.jpg`;
  const { error: eUp } = await sb.storage.from('evidencias').upload(ruta, archivo);
  if (eUp) { throw eUp; }
  const { data: pub } = sb.storage.from('evidencias').getPublicUrl(ruta);
  const { error } =
  await sb
    .from('fotos')
    .insert({
      pv,
      momento,
      tipo,
      archivo_url:
        pub.publicUrl,
      lat,
      lng,
      subido_por:
        (
          await sb.auth.getUser()
        ).data.user.id
    });

    if (error) {
      throw error;
    }

    /*
     * Primera evidencia DESPUÉS:
     * la lechería pasa automáticamente
     * a estado INICIADA.
     */
    if (momento === 'fin') {
      await guardarIniciada(pv);
    }

    return pub.publicUrl;
}

async function eliminarFoto(
  idFoto,
  archivoUrl
) {
  /*
   * Recuperamos los datos antes
   * de eliminar la fotografía.
   */
  const {
    data: foto,
    error: errorFoto
  } = await sb
    .from('fotos')
    .select(
      'id, pv, momento'
    )
    .eq('id', idFoto)
    .single();

  if (errorFoto) {
    throw errorFoto;
  }

  /*
   * Eliminamos primero el registro.
   */
  const {
    error: errorTabla
  } = await sb
    .from('fotos')
    .delete()
    .eq('id', idFoto);

  if (errorTabla) {
    throw errorTabla;
  }

  /*
   * Si era una foto DESPUÉS,
   * comprobamos si queda alguna.
   */
  if (
    foto.momento === 'fin'
  ) {
    const {
      count,
      error: errorConteo
    } = await sb
      .from('fotos')
      .select(
        'id',
        {
          count: 'exact',
          head: true
        }
      )
      .eq(
        'pv',
        foto.pv
      )
      .eq(
        'momento',
        'fin'
      );

    if (errorConteo) {
      throw errorConteo;
    }

    if (count === 0) {
      const {
        data: avance,
        error: errorAvance
      } = await sb
        .from('avances')
        .select(
          'status'
        )
        .eq(
          'pv',
          foto.pv
        )
        .maybeSingle();

      if (errorAvance) {
        throw errorAvance;
      }

      /*
       * Solo retrocedemos si estaba
       * INICIADA. Una ATENDIDA nunca
       * debe regresar automáticamente.
       */
      if (
        avance?.status ===
        'ini'
      ) {
        const { error } =
          await sb
            .from(
              'avances'
            )
            .update({
              status: 'no',
              actualizado:
                new Date()
                  .toISOString()
            })
            .eq(
              'pv',
              foto.pv
            );

        if (error) {
          throw error;
        }
      }
    }
  }

  /*
   * Limpiamos Storage.
   */
  const marcador =
    '/storage/v1/object/public/evidencias/';

  const posicion =
    archivoUrl.indexOf(
      marcador
    );

  if (posicion !== -1) {
    const ruta =
      decodeURIComponent(
        archivoUrl.substring(
          posicion +
          marcador.length
        )
      );

    const {
      error: errorStorage
    } =
      await sb.storage
        .from('evidencias')
        .remove([
          ruta
        ]);

    if (errorStorage) {
      console.warn(
        'No se pudo eliminar el archivo de Storage:',
        errorStorage
      );
    }
  }
}

// Registrar excedente (control interno hacia subcontratista)
async function guardarM2(pv, m2, status, vobo, motivo, freal) {
  const uid = (await sb.auth.getUser()).data.user.id;

  const { error } = await sb
    .from('avances')
    .upsert({
      pv,
      m2,
      status: status || 'no',
      vobo: vobo || '-',
      motivo: motivo || null,
      freal: freal || null,
      actualizado_por: uid,
      actualizado: new Date().toISOString()
    }, {
      onConflict: 'pv'
    });

  if (error) {
    throw error;
  }
}

async function guardarExcedente(
  pv,
  m2Excedente,
  precioM2,
  evidenciaUrl
) {
  const uid = (await sb.auth.getUser()).data.user.id;

  const { error } = await sb
    .from('excedentes')
    .upsert({
      pv,
      m2_excedente: m2Excedente,
      precio_m2: precioM2,
      evidencia_url: evidenciaUrl,
      registrado_por: uid,
      fecha: new Date().toISOString()
    }, {
      onConflict: 'pv'
    });

  if (error) {
    throw error;
  }
}

// Marcar lechería como atendida
async function guardarAtendido(pv, m2) {
  const uid = (await sb.auth.getUser()).data.user.id;
  const { error } = await sb.from('avances').upsert({
    pv, status: 'at', m2, vobo: 'wait',
    freal: new Date().toISOString().slice(0, 10),
    actualizado_por: uid, actualizado: new Date().toISOString()
  });
  if (error) { throw error; }
}

// Vo.Bo. del administrador (aprobar o rechazar)
async function guardarVobo(pv, estado, motivo = null) {

  const fechaVobo =
    estado === 'ok'
      ? new Date().toLocaleDateString(
          'en-CA',
          {
            timeZone: 'America/Mexico_City'
          }
        )
      : null;

  const cambios = {
    vobo: estado,
    motivo:
      estado === 'rej'
        ? motivo
        : null,

    fecha_vobo: fechaVobo,

    actualizado:
      new Date().toISOString()
  };

  const { error } = await sb
    .from('avances')
    .update(cambios)
    .eq('pv', pv);

  if (error) {
    throw error;
  }
}

// ---- 5. ARRANQUE DE LA APLICACIÓN ----
async function arrancarApp() {
  const perfil = await revisarSesion();
  if (!perfil) {
    mostrarLogin();
    return;
  }

  if (!perfil.rol) {
  await cerrarSesion();
  throw new Error(
    'El usuario no tiene un rol asignado'
  );
  }

  if (
    perfil.rol === 'sub' &&
    !perfil.sub
  ) {
    await cerrarSesion();
    throw new Error(
      'La cuadrilla no tiene una clave asignada'
    );
  }
  
  window.LECH = await cargarLecherias();
  /*
   * Construimos zonas y relación SUB-ZONA
   * directamente desde el padrón cargado.
   */
  reconstruirConfiguracionDinamica();
  ROLE = perfil.rol;
  if (ROLE === 'sub') {
      CURSUB = perfil.sub;
  }
  const precios = await cargarPreciosSubcontrato();
  Object.keys(PRECIO_M2_EXTRA_SUB).forEach(clave => {
    delete PRECIO_M2_EXTRA_SUB[clave];
  });
  Object.assign(PRECIO_M2_EXTRA_SUB, precios);
  setRole(ROLE);
}
