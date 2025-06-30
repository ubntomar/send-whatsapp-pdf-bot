const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const whatsappClient = require('../whatsapp');

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
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // Límite de 10MB
  }
});

// NUEVO ENDPOINT: Enviar mensaje simple a número o grupo específico
router.post('/send-message', async (req, res, next) => {
  try {
    const { target, message } = req.body;
    
    // Validar campos obligatorios
    if (!target) {
      return res.status(400).json({ 
        success: false, 
        message: 'El campo "target" (número de teléfono o grupo) es obligatorio' 
      });
    }
    
    if (!message) {
      return res.status(400).json({ 
        success: false, 
        message: 'El campo "message" es obligatorio' 
      });
    }

    // Validar que el mensaje no esté vacío
    if (message.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'El mensaje no puede estar vacío' 
      });
    }
    
    // Formatear el target para WhatsApp
    let formattedTarget = target.toString().trim();
    
    // Si es un grupo (contiene guión), usar formato de grupo
    if (formattedTarget.includes('-')) {
      // Es un grupo: formato 573213011018-1440435780@g.us
      if (!formattedTarget.endsWith('@g.us')) {
        formattedTarget = `${formattedTarget}@g.us`;
      }
    } else {
      // Es un número individual: formato +573215450397@c.us
      formattedTarget = formattedTarget.replace(/\D/g, ''); // Quitar caracteres no numéricos
      
      // Agregar código de país si no lo tiene
      if (!formattedTarget.startsWith('57') && formattedTarget.length === 10) {
        formattedTarget = `57${formattedTarget}`;
      }
      
      // Agregar sufijo de WhatsApp
      if (!formattedTarget.endsWith('@c.us')) {
        formattedTarget = `${formattedTarget}@c.us`;
      }
    }
    
    // Enviar mensaje usando el cliente existente
    const result = await whatsappClient.sendSimpleMessage(formattedTarget, message.trim());
    
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// Enviar mensaje con PDF opcional (endpoint existente)
router.post('/send', upload.single('pdf'), async (req, res, next) => {
  try {
    const { phone, message } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'El número de teléfono es obligatorio' 
      });
    }
    
    if (!message && !req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'Debe proporcionar un mensaje o un archivo PDF' 
      });
    }
    
    const pdfPath = req.file ? req.file.path : null;
    const result = await whatsappClient.sendMessage(phone, message, pdfPath);
    
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// Ruta alternativa para usar la ruta del PDF en lugar de subir el archivo (endpoint existente)
router.post('/send-with-path', async (req, res, next) => {
  try {
    const { phone, message, pdfPath } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'El número de teléfono es obligatorio' 
      });
    }
    
    if (!message && !pdfPath) {
      return res.status(400).json({ 
        success: false, 
        message: 'Debe proporcionar un mensaje o una ruta de archivo PDF' 
      });
    }
    
    if (pdfPath && !fs.existsSync(pdfPath)) {
      return res.status(400).json({ 
        success: false, 
        message: `El archivo PDF no existe en la ruta: ${pdfPath}` 
      });
    }
    
    const result = await whatsappClient.sendMessage(phone, message, pdfPath);
    
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

// Reiniciar el cliente
router.post('/restart', async (req, res, next) => {
  try {
    const result = await whatsappClient.restart();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;  