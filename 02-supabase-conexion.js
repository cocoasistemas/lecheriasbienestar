// ============================================================
// BITÁCORA DE LECHERÍAS — Conexión a Supabase
//
// Este archivo reemplaza los DATOS DE EJEMPLO de la maqueta por
// datos reales de la base de datos, y agrega el inicio de sesión.
//
// CÓMO USARLO (Israel):
// 1. En la app (bitacora-lecherias.html), dentro del <head>, agrega:
//    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// 2. Pega ESTE archivo como un <script> ANTES del script principal de la app.
// 3. Pon abajo tu URL y tu llave "anon public" de Supabase.
// 4. En el script principal de la app, sigue los 5 cambios marcados
//    en el archivo 03-cambios-en-la-app.md
// ============================================================

// ---- 1. CONFIGURACIÓN (pon aquí tus datos de Supabase) ----
const SUPABASE_URL  = 'https://sgziuqgwdcliefrhzfgk.supabase.co';   // ← reemplazar
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNneml1cWd3ZGNsaWVmcmh6ZmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNjU1MDYsImV4cCI6MjA5ODk0MTUwNn0.t5MnqGrT4-pq-NyejK8waDo21wDpyxJQD-P8S-haejc';               // ← reemplazar
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

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

// ---- 3. CARGAR DATOS (reemplaza los arreglos de ejemplo) ----
// Devuelve el arreglo LECH que la app ya sabe usar.
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
    const av = (r.avances && r.avances[0]) || {};
    return {
      id: i,
      pv: r.pv, estado: r.estado, municipio: r.municipio, localidad: r.localidad,
      calle: r.calle, colonia: r.colonia, beneficiarios: r.beneficiarios,
      lat: r.lat, lng: r.lng, zona: r.zona, sub: r.sub, fcomp: r.fcomp,
      status: av.status || 'no',
      m2: av.m2 || 21,
      vobo: av.vobo || '-',
      motivo: av.motivo || '',
      freal: av.freal || '',
      // fotos y actas se cargan aparte según se necesiten
      fotosPrev: [], 
      fotosFin: [], 
      adjuntos: [], 
      extraEvidencia: []
    };
  });
}

// Carga las fotos de una lechería (cuando se abre su detalle)
async function cargarFotos(pv) {
  const { data } = await sb.from('fotos').select('*').eq('pv', pv);
  const prev = (data || []).filter(f => f.momento === 'prev').map(f => ({ tipo: f.tipo, url: f.archivo_url }));
  const fin  = (data || []).filter(f => f.momento === 'fin').map(f => ({ tipo: f.tipo, url: f.archivo_url }));
  return { prev, fin };
}

//carga las actas
async function cargarActas() {
  const { data, error } = await sb
    .from('actas')
    .select('*');

  if (error) {
    throw error;
  }

  return data || [];
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
async function guardarVobo(pv, aprobado, motivo) {
  const { error } = await sb.from('avances').update({
    vobo: aprobado ? 'ok' : 'rej',
    motivo: aprobado ? null : motivo,
    actualizado: new Date().toISOString()
  }).eq('pv', pv);
  if (error) { throw error; }
}

// Registrar excedente (control interno hacia subcontratista)
async function guardarExcedente(pv,m2Excedente,evidenciaUrl){
  const uid=(await sb.auth.getUser()).data.user.id;
  const {error}=await sb
    .from('excedentes')
    .upsert({
      pv:pv,
      m2_excedente:m2Excedente,
      precio_m2: null,
      evidencia_url:evidenciaUrl,
      registrado_por:uid
    });
  if(error){
    console.error(error);
    toast(error.message);
    return;
  }
}

// Aprobar / rechazar acta
async function guardarActa(id, estado, obs) {
  const { error } = await sb.from('actas').update({ estado, obs }).eq('id', id);
  if (error) { throw error; }
}

// ---- 5. ARRANQUE ----
// Llama esto al cargar la app. Si no hay sesión, muestra el login.
async function arrancarApp() {
  const perfil = await revisarSesion();
  if (!perfil) {
    mostrarLogin();   // función de la pantalla de login (ver 03-cambios)
    return;
  }
  window.LECH = await cargarLecherias();
  ROLE = perfil.rol;
  if (ROLE === 'sub') {
      CURSUB = perfil.sub;
  }
  setRole(ROLE);
}
