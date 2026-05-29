import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import tenantManager from '../tenants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// Configurar multer para archivos subidos
const uploadDir = path.join(process.cwd(), 'uploads');
fs.ensureDirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Formatear target para WhatsApp (número o grupo)
const formatTarget = (target) => {
  const cleaned = target.toString().trim();
  if (cleaned.includes('-')) {
    return cleaned.endsWith('@g.us') ? cleaned : `${cleaned}@g.us`;
  }
  const numbersOnly = cleaned.replace(/\D/g, '');
  const withCountryCode = numbersOnly.length === 10 && !numbersOnly.startsWith('57')
    ? `57${numbersOnly}`
    : numbersOnly;
  return withCountryCode.endsWith('@c.us') ? withCountryCode : `${withCountryCode}@c.us`;
};

// Lógica común de envío. empresaId puede venir del path o del body (empresa_id).
async function handleSend(req, res, next) {
  try {
    const empresaId = req.params.empresaId ?? req.body.empresa_id ?? req.body.empresaId;
    const { target, phone, message, filePath } = req.body;

    const finalTarget = target || phone;
    if (!finalTarget) {
      return res.status(400).json({ success: false, message: 'Debe especificar un target (número o grupo)' });
    }

    const finalFilePath = req.file?.path || filePath;
    if (!message?.trim() && !finalFilePath) {
      return res.status(400).json({ success: false, message: 'Debe proporcionar un mensaje o archivo' });
    }

    const route = tenantManager.resolveForSend(empresaId);
    if (route.error) {
      return res.status(route.code || 503).json({ success: false, message: route.error });
    }

    const formattedTarget = formatTarget(finalTarget);
    const result = await route.client.sendMessage(formattedTarget, message || '', finalFilePath);

    return res.status(200).json({
      ...result,
      requestedTenant: route.requestedTenant,
      routedVia: route.routedVia,
      fallback: route.fallback
    });
  } catch (error) {
    next(error);
  }
}

// Envío solo texto (JSON). empresaId del path o body.
async function handleSendMessage(req, res, next) {
  try {
    const empresaId = req.params.empresaId ?? req.body.empresa_id ?? req.body.empresaId;
    const { target, phone, message } = req.body;

    const finalTarget = target || phone;
    if (!finalTarget) {
      return res.status(400).json({ success: false, message: 'Debe especificar un target (número o grupo)' });
    }
    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: 'Debe proporcionar un mensaje' });
    }

    const route = tenantManager.resolveForSend(empresaId);
    if (route.error) {
      return res.status(route.code || 503).json({ success: false, message: route.error });
    }

    const formattedTarget = formatTarget(finalTarget);
    const result = await route.client.sendMessage(formattedTarget, message);

    return res.status(200).json({
      ...result,
      requestedTenant: route.requestedTenant,
      routedVia: route.routedVia,
      fallback: route.fallback
    });
  } catch (error) {
    next(error);
  }
}

// ---------- Rutas globales / retrocompatibilidad (un solo segmento) ----------

// Estado de TODOS los tenants
router.get('/status', (req, res) => {
  res.status(200).json({ success: true, ...tenantManager.allStatus() });
});

// Lista de tenants definidos
router.get('/tenants', (req, res) => {
  res.status(200).json({ success: true, tenants: tenantManager.listTenants() });
});

// Retrocompat: sin tenant en la URL -> body.empresa_id o defaultTenant
router.post('/send', upload.single('file'), handleSend);
router.post('/send-message', handleSendMessage);

// ---------- Rutas por tenant (dos segmentos: /:empresaId/...) ----------

router.post('/:empresaId/send', upload.single('file'), handleSend);
router.post('/:empresaId/send-message', handleSendMessage);

router.get('/:empresaId/status', (req, res) => {
  const c = tenantManager.getClient(req.params.empresaId);
  if (!c) {
    const def = tenantManager.getDefinition(req.params.empresaId);
    if (!def) return res.status(404).json({ success: false, message: `Tenant ${req.params.empresaId} no existe` });
    return res.status(200).json({ success: true, ...def, isReady: false, wasConnectedOnce: false, hasQr: false });
  }
  res.status(200).json({ success: true, ...c.getStatus() });
});

// QR de un tenant como imagen PNG (para escanear desde el navegador)
router.get('/:empresaId/qr', async (req, res, next) => {
  try {
    const c = tenantManager.getClient(req.params.empresaId);
    if (!c) {
      return res.status(404).json({ success: false, message: `Tenant ${req.params.empresaId} no existe o no está habilitado` });
    }
    if (c.isReady) {
      return res.status(204).json({ success: true, message: 'Tenant ya conectado, no requiere QR' });
    }
    const qr = c.getQr();
    if (!qr) {
      return res.status(503).json({ success: false, message: 'QR aún no disponible; intenta de nuevo en unos segundos' });
    }
    const png = await QRCode.toBuffer(qr, { type: 'png', width: 320, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    return res.status(200).send(png);
  } catch (error) {
    next(error);
  }
});

router.get('/:empresaId/groups', async (req, res, next) => {
  try {
    const c = tenantManager.getClient(req.params.empresaId);
    const client = c?.getClient();
    if (!client) {
      return res.status(503).json({ success: false, message: 'Cliente no está listo' });
    }
    const chats = await client.getChats();
    const groups = chats.filter(chat => chat.isGroup).map(group => ({
      id: group.id._serialized,
      name: group.name
    }));
    return res.status(200).json({ success: true, groups });
  } catch (error) {
    next(error);
  }
});

router.post('/:empresaId/restart', async (req, res, next) => {
  try {
    const c = tenantManager.getClient(req.params.empresaId);
    if (!c) {
      return res.status(404).json({ success: false, message: `Tenant ${req.params.empresaId} no existe o no está habilitado` });
    }
    const result = await c.restart();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
