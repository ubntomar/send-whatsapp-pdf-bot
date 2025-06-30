require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs-extra');
const logger = require('./utils/error-handler');
const { errorMiddleware, requestLoggerMiddleware } = require('./utils/error-handler');
const apiRoutes = require('./routes/api');
const whatsappClient = require('./whatsapp');

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
app.listen(PORT, () => {
  logger.info(`Servidor iniciado en el puerto ${PORT}`);
});

// Programar una tarea para verificar la conexión periódicamente
cron.schedule('*/30 * * * *', () => {
  const status = whatsappClient.getStatus();
  logger.info(`Estado del cliente: ${JSON.stringify(status)}`);
  
  if (!status.isReady && status.reconnectAttempts >= 5) {
    logger.info('Reiniciando cliente debido a desconexión prolongada...');
    whatsappClient.restart();
  }
});

// Añadir después de las otras tareas cron
const cleanupUploads = require('./utils/cleanup');
cron.schedule('0 2 * * *', () => {
  logger.info('Iniciando limpieza de archivos temporales...');
  cleanupUploads();
});

// Manejar señales de proceso
process.on('SIGINT', async () => {
  logger.info('Cerrando aplicación...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error(`Excepción no capturada: ${error.message}`);
  logger.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Rechazo de promesa no manejado:', reason);
});

module.exports = app;