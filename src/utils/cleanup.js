const fs = require('fs-extra');
const path = require('path');
const logger = require('./error-handler');

// Eliminar archivos PDF más antiguos que cierto tiempo (1 día por defecto)
const cleanupUploads = (dir = 'uploads', maxAgeHours = 24) => {
  const uploadsDir = path.join(process.cwd(), dir);
  
  if (!fs.existsSync(uploadsDir)) {
    return;
  }
  
  const now = new Date().getTime();
  const files = fs.readdirSync(uploadsDir);
  
  files.forEach(file => {
    const filePath = path.join(uploadsDir, file);
    const stats = fs.statSync(filePath);
    const fileAge = now - stats.mtime.getTime();
    const maxAge = maxAgeHours * 60 * 60 * 1000;
    
    if (fileAge > maxAge) {
      try {
        fs.unlinkSync(filePath);
        logger.info(`Archivo eliminado: ${filePath}`);
      } catch (error) {
        logger.error(`Error al eliminar archivo ${filePath}: ${error.message}`);
      }
    }
  });
};

module.exports = cleanupUploads;