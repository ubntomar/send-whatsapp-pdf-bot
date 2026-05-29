import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import cron from 'node-cron';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import logger, { errorMiddleware, requestLoggerMiddleware } from './utils/error-handler.js';
import apiRoutes from './routes/api.js';
import tenantManager from './tenants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Crear directorios necesarios
fs.ensureDirSync(path.join(process.cwd(), 'uploads'));
fs.ensureDirSync(process.env.SESSION_PATH || './sessions');

// Inicializar clientes WhatsApp de todos los tenants habilitados
tenantManager.init();

// Crear la aplicación Express
const app = express();
const PORT = process.env.PORT || 8050;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLoggerMiddleware);

// Rutas
app.use('/api', apiRoutes);

// Ruta de prueba / documentación
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API de WhatsApp multi-tenant funcionando correctamente',
    endpoints: {
      statusGlobal: 'GET /api/status',
      tenants: 'GET /api/tenants',
      statusTenant: 'GET /api/:empresaId/status',
      qrTenant: 'GET /api/:empresaId/qr',
      groups: 'GET /api/:empresaId/groups',
      sendMessage: 'POST /api/:empresaId/send  (multipart: phone/target, message, file)',
      sendSimpleMessage: 'POST /api/:empresaId/send-message  (json: target/phone, message)',
      restart: 'POST /api/:empresaId/restart',
      legacySend: 'POST /api/send  (sin tenant -> body.empresa_id o defaultTenant)',
      legacySendMessage: 'POST /api/send-message'
    }
  });
});

// Middleware de manejo de errores
app.use(errorMiddleware);

// Iniciar el servidor
const server = app.listen(PORT, () => {
  logger.info(`Servidor multi-tenant iniciado en el puerto ${PORT}`);
});

// Limpieza diaria de archivos temporales
import cleanupUploads from './utils/cleanup.js';
cron.schedule('0 2 * * *', cleanupUploads);

// Manejo de señales
const gracefulShutdown = async (signal) => {
  logger.info(`Señal ${signal} recibida. Cerrando aplicación...`);
  server.close(() => logger.info('Servidor HTTP cerrado'));
  try {
    await tenantManager.destroyAll();
    logger.info('Clientes de WhatsApp cerrados');
  } catch (error) {
    logger.error(`Error al cerrar WhatsApp: ${error.message}`);
  }
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (error) => logger.error(`Excepción no capturada: ${error.message}`));
process.on('unhandledRejection', (reason) => logger.error('Promesa rechazada:', reason));

export default app;
