const winston = require('winston');
const path = require('path');
const fs = require('fs-extra');

// Asegurar que existe el directorio de logs
const logDir = path.join(process.cwd(), 'logs');
fs.ensureDirSync(logDir);

// Crear el logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: path.join(logDir, 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(logDir, 'combined.log') 
    })
  ]
});

// Middleware para registro de errores HTTP
const errorMiddleware = (err, req, res, next) => {
  logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Error interno del servidor'
  });
};

// Middleware para registro de solicitudes HTTP
const requestLoggerMiddleware = (req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
};

module.exports = logger;
module.exports.errorMiddleware = errorMiddleware;
module.exports.requestLoggerMiddleware = requestLoggerMiddleware;