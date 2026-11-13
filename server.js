require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { MONGODB_URI, JWT_SECRET, PORT = 3000, CORS_ORIGIN = '' } = process.env;
if (!MONGODB_URI || !JWT_SECRET) {
  console.error('Faltan MONGODB_URI o JWT_SECRET. Copiá .env.example a .env y completalo.');
  process.exit(1);
}

/* ---------- Modelos ---------- */
const User = mongoose.model('User', new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  hash: { type: String, required: true },
}, { timestamps: true }));

const eventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  id: { type: String, required: true },
  type: { type: String, enum: ['parcial', 'final', 'tp', 'recordatorio'], required: true },
  materia: { type: String, required: true, maxlength: 60 },
  date: { type: String, required: true },
  endDate: { type: String, default: '' },
  hora: { type: String, default: '' },
  notas: { type: [String], default: [] },
  nota: { type: String, default: '' },
  hecho: { type: Boolean, default: false },
  calif: { type: String, default: '' },
  aviso: { type: String, default: '1' },
}, { versionKey: false });
eventSchema.index({ user: 1, id: 1 }, { unique: true });
const Event = mongoose.model('Event', eventSchema);

/* ---------- Validación ---------- */
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS = ['parcial', 'final', 'tp', 'recordatorio'];
const AVISOS = ['0', '1', '3', '7', 'no'];
const MAX_EVENTS = 5000;

function limpiar(e) {
  if (!e || typeof e !== 'object') return null;
  if (!TIPOS.includes(e.type) || !e.materia || !RE_DATE.test(e.date) || !e.id) return null;
  const notas = Array.isArray(e.notas) ? e.notas : (e.nota ? [e.nota] : []);
  return {
    id: String(e.id).slice(0, 64),
    type: e.type,
    materia: String(e.materia).slice(0, 60),
    date: e.date,
    endDate: typeof e.endDate === 'string' && RE_DATE.test(e.endDate) && e.endDate >= e.date ? e.endDate : '',
    hora: /^\d{2}:\d{2}$/.test(e.hora || '') ? e.hora : '',
    notas: notas.slice(0, 50).map(n => String(n).slice(0, 500)),
    nota: '',
    hecho: !!e.hecho,
    calif: String(e.calif || '').slice(0, 5),
    aviso: AVISOS.includes(String(e.aviso)) ? String(e.aviso) : '1',
  };
}

/* ---------- App ---------- */
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
// Se ignoran espacios, mayúsculas y barras finales: "https://mi-app.vercel.app/" == "https://mi-app.vercel.app"
const norm = s => String(s || '').trim().replace(/\/+$/, '').toLowerCase();
const origins = CORS_ORIGIN.split(',').map(norm).filter(Boolean);
console.log('CORS permitido para:', origins.length ? origins.join(', ') : '(ninguno: definí CORS_ORIGIN)');
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes(norm(origin))) }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' } });

const firmar = u => jwt.sign({ sub: String(u._id) }, JWT_SECRET, { expiresIn: '30d' });

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try { req.userId = jwt.verify(token, JWT_SECRET).sub; next(); }
  catch { res.status(401).json({ error: 'Sesión vencida. Iniciá sesión de nuevo.' }); }
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const datosAuth = body => {
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  if (email.length > 254 || !RE_EMAIL.test(email)) return { error: 'Ingresá un email válido.' };
  if (password.length < 6 || password.length > 100) return { error: 'La contraseña debe tener al menos 6 caracteres.' };
  return { email, password };
};

app.post('/api/register', authLimiter, async (req, res) => {
  const d = datosAuth(req.body);
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const user = await User.create({ email: d.email, hash: await bcrypt.hash(d.password, 10) });
    res.status(201).json({ token: firmar(user), email: user.email });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    console.error(e); res.status(500).json({ error: 'Error del servidor.' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  const d = datosAuth(req.body);
  const user = !d.error && await User.findOne({ email: d.email });
  // Mismo mensaje para email inexistente y contraseña incorrecta.
  if (!user || !(await bcrypt.compare(d.password, user.hash)))
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  res.json({ token: firmar(user), email: user.email });
});

app.get('/api/events', auth, async (req, res) => {
  const list = await Event.find({ user: req.userId }).select('-_id -user').lean();
  res.json({ events: list });
});

// Reemplaza la lista completa del usuario (el front guarda siempre todo el arreglo).
app.put('/api/events', auth, async (req, res) => {
  const raw = req.body && req.body.events;
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS) return res.status(400).json({ error: 'Datos inválidos.' });
  const vistos = new Set();
  const list = raw.map(limpiar).filter(e => e && !vistos.has(e.id) && vistos.add(e.id));
  const ops = list.map(e => ({ updateOne: { filter: { user: req.userId, id: e.id }, update: { $set: e }, upsert: true } }));
  if (ops.length) await Event.bulkWrite(ops, { ordered: false });
  await Event.deleteMany({ user: req.userId, id: { $nin: list.map(e => e.id) } });
  res.json({ ok: true, count: list.length });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Solo para desarrollo local: sirve ../front en http://localhost:PORT (en producción el front está en Vercel).
const front = path.join(__dirname, '..', 'front');
if (require('fs').existsSync(front)) app.use(express.static(front));

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Error del servidor.' }); });

mongoose.connect(MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log('Calendario en http://localhost:' + PORT)))
  .catch(e => { console.error('No se pudo conectar a MongoDB:', e.message); process.exit(1); });
