// test-minimal.js - Minimal test to debug initialization
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;

console.log('Starting WhatsApp client initialization...');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run'
    ]
  },
  webVersionCache: {
    type: 'none'
  }
});

client.on('qr', qr => {
  console.log('QR Code generated successfully!');
  console.log('Client initialization successful');
  process.exit(0);
});

client.on('ready', () => {
  console.log('Client ready!');
  process.exit(0);
});

client.on('auth_failure', m => {
  console.log('[AUTH_FAILURE]', m);
  process.exit(1);
});

client.on('disconnected', r => {
  console.log('[DISCONNECTED]', r);
  process.exit(1);
});

// Add more detailed error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

console.log('Calling client.initialize()...');
client.initialize().catch(error => {
  console.error('Initialize error:', error);
  process.exit(1);
});