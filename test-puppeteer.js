const { Client } = require('whatsapp-web.js');

console.log('Iniciando prueba de Puppeteer...');

const client = new Client({
  puppeteer: {
    executablePath: '/snap/bin/chromium',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--no-first-run'
    ],
    headless: true
  }
});

// Agregar logging detallado
client.on('qr', (qr) => {
  console.log('✅ QR generado exitosamente!');
});

client.on('ready', () => {
  console.log('✅ Cliente listo!');
});

client.on('auth_failure', (msg) => {
  console.log('❌ Error de autenticación:', msg);
});

client.on('disconnected', (reason) => {
  console.log('❌ Desconectado:', reason);
});

console.log('Iniciando cliente...');

client.initialize().then(() => {
  console.log('✅ Initialize completado');
}).catch((error) => {
  console.log('❌ Error en initialize:', error);
});

// Timeout de seguridad
setTimeout(() => {
  console.log('⏰ Timeout alcanzado - algo está mal');
  process.exit(1);
}, 60000); // 60 segundos