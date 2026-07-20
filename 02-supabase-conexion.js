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
  // Trae lecherías + su avance + su excedente en una sola consulta
  const { data, error } = await sb
    .from('lecherias')
    .select(`
      pv, estado, municipio, localidad, calle, colonia, familias, beneficiarios,
      lat, lng, zona, sub, fcomp, activo,
      avances ( status, m2, vobo, motivo, freal ),
      excedentes ( m2_excedente, precio_m2, evidencia_url )
    `)
    .eq('activo', true);
  if (error) { throw error; }

  // aplanar al formato que usa la app
  return data.map((r, i) => {
    const av = Array.isArray(r.avances)
    ? (r.avances[0] || {})
    : (r.avances || {});

    const ex = Array.isArray(r.excedentes)
    ? (r.excedentes[0] || {})
    : (r.excedentes || {});
    return {
      id: i,
      pv: r.pv, estado: r.estado, municipio: r.municipio, localidad: r.localidad,
      calle: r.calle, colonia: r.colonia, beneficiarios: r.beneficiarios,
      lat: r.lat, lng: r.lng, zona: r.zona, sub: r.sub, fcomp: r.fcomp,
      status: av.status || 'no',
      m2: Number(av.m2) || M2_STD,
      vobo: av.vobo || '-',
      motivo: av.motivo || '',
      freal: av.freal || '',
      
      m2_excedente: Number(ex.m2_excedente) || 0,
      precio_m2: Number(ex.precio_m2) || precioExtraSub(r.sub),
      evidencia_url: ex.evidencia_url || '',
      extraEvidencia: ex.evidencia_url ? [ex.evidencia_url] : [],

      // fotos y adjuntos (actas) se cargan aparte según se necesiten
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

// Subir una foto al Storage y registrar en la tabla
async function subirFoto(pv, momento, tipo, archivo, lat, lng) {
  const ruta = `${pv}/${momento}_${tipo}_${Date.now()}.jpg`;
  const { error: eUp } = await sb.storage.from('evidencias').upload(ruta, archivo);
  if (eUp) { throw eUp; }
  const { data: pub } = sb.storage.from('evidencias').getPublicUrl(ruta);
  const { error } = await sb.from('fotos').insert({
    pv, momento, tipo, archivo_url: pub.publicUrl, lat, lng,
    subido_por: (await sb.auth.getUser()).data.user.id
  });
  if (error) { throw error; }
  return pub.publicUrl;
}

async function eliminarFoto(idFoto, archivoUrl) {
  /*
   * Primero eliminamos el registro de la tabla.
   * Si Storage falla después, solo quedará un archivo huérfano,
   * pero la aplicación no mostrará una referencia rota.
   */
  const { error: errorTabla } = await sb
    .from('fotos')
    .delete()
    .eq('id', idFoto);

  if (errorTabla) {
    throw errorTabla;
  }

  const marcador = '/storage/v1/object/public/evidencias/';
  const posicion = archivoUrl.indexOf(marcador);

  if (posicion !== -1) {
    const ruta = decodeURIComponent(
      archivoUrl.substring(posicion + marcador.length)
    );

    const { error: errorStorage } = await sb.storage
      .from('evidencias')
      .remove([ruta]);

    if (errorStorage) {
      /*
       * La foto ya se eliminó de la tabla.
       * Dejamos aviso en consola para limpiar el archivo después,
       * sin volver a mostrar una foto que ya fue borrada.
       */
      console.warn('No se pudo eliminar el archivo de Storage:', errorStorage);
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
  const cambios = {
    vobo: estado,
    motivo: estado === 'rej' ? motivo : null,
    actualizado: new Date().toISOString()
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
      'El subcontratista no tiene una clave asignada'
    );
  }
  
  window.LECH = await cargarLecherias();
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
