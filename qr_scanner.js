require('dotenv').config();
const WhatsAppClient = require('./src/whatsapp');

console.log('Iniciando cliente de WhatsApp. Por favor, espere a que aparezca el código QR...');
console.log('Una vez que escanee el código, verá mensajes de autenticación correcta.');
console.log('Puede cerrar este script con Ctrl+C después de la autenticación exitosa.');