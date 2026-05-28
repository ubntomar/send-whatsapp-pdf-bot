import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import cron from 'node-cron';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import logger, { errorMiddleware, requestLoggerMiddleware } from './utils/error-handler.js';
import apiRoutes from './routes/api.js';
import whatsappClient from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Crear directorios necesarios
fs.ensureDirSync(path.join(process.cwd(), 'uploads'));
fs.ensureDirSync(process.env.SESSION_PATH || './sessions');

// Crear la aplicación Express
const app = express();
const PORT = process.env.PORT || 8050;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLoggerMiddleware);

// Rutas
app.use('/api', apiRoutes);

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API de WhatsApp funcionando correctamente',
    endpoints: {
      status: 'GET /api/status',
      groups: 'GET /api/groups',
      sendSimpleMessage: 'POST /api/send-message',
      sendMessage: 'POST /api/send',
      sendWithPath: 'POST /api/send-with-path',
      restart: 'POST /api/restart'
    }
  });
});

// Middleware de manejo de errores
app.use(errorMiddleware);

// Iniciar el servidor
const server = app.listen(PORT, () => {
  logger.info(`Servidor iniciado en el puerto ${PORT}`);
});

// Limpieza diaria de archivos temporales
import cleanupUploads from './utils/cleanup.js';
cron.schedule('0 2 * * *', cleanupUploads);

// Manejar señales de proceso
const gracefulShutdown = async (signal) => {
  logger.info(`Señal ${signal} recibida. Cerrando aplicación...`);

  // Cerrar servidor HTTP
  server.close(() => {
    logger.info('Servidor HTTP cerrado');
  });

  // Destruir cliente de WhatsApp si existe
  try {
    const client = whatsappClient.getClient();
    if (client) {
      await client.destroy();
      logger.info('Cliente de WhatsApp cerrado');
    }
  } catch (error) {
    logger.error(`Error al cerrar WhatsApp: ${error.message}`);
  }

  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error(`Excepción no capturada: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promesa rechazada:', reason);
});

export default app;