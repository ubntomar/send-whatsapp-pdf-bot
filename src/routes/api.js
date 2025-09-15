import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import whatsappClient from '../whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// Configurar multer para guardar los archivos subidos
const uploadDir = path.join(process.cwd(), 'uploads');
fs.ensureDirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

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

// Endpoint unificado para enviar mensajes
router.post('/send', upload.single('file'), async (req, res, next) => {
  try {
    const { target, phone, message, filePath } = req.body;

    // Determinar el target (prioridad: target > phone)
    const finalTarget = target || phone;
    if (!finalTarget) {
      return res.status(400).json({
        success: false,
        message: 'Debe especificar un target (número o grupo)'
      });
    }

    // Determinar archivo (prioridad: archivo subido > ruta especificada)
    const finalFilePath = req.file?.path || filePath;

    if (!message?.trim() && !finalFilePath) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar un mensaje o archivo'
      });
    }

    const formattedTarget = formatTarget(finalTarget);
    const result = await whatsappClient.sendMessage(formattedTarget, message || '', finalFilePath);

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// Verificar el estado del cliente
router.get('/status', (req, res) => {
  const status = whatsappClient.getStatus();
  res.status(200).json({
    success: true,
    ...status
  });
});

// Endpoint simple para enviar solo mensajes de texto
router.post('/send-message', async (req, res, next) => {
  try {
    const { target, message } = req.body;

    if (!target) {
      return res.status(400).json({
        success: false,
        message: 'Debe especificar un target (número o grupo)'
      });
    }

    if (!message?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar un mensaje'
      });
    }

    const formattedTarget = formatTarget(target);
    const result = await whatsappClient.sendMessage(formattedTarget, message);

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// Reiniciar el cliente
router.post('/restart', async (req, res, next) => {
  try {
    const result = await whatsappClient.restart();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;