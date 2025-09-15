// test-simple.js - Test script similar to the working test project
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const { Client, LocalAuth } = pkg;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', qr => {
  console.log('Escanea este QR con WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('change_state', s => console.log('[STATE]', s));
client.on('disconnected', r => console.log('[DISCONNECTED]', r));
client.on('auth_failure', m => console.log('[AUTH_FAILURE]', m));

client.on('ready', async () => {
  console.log('Cliente conectado ✅');

  const raw = '573215450397';               // 57 + número sin espacios
  const numeroId = await client.getNumberId(raw);

  if (!numeroId) {
    console.error('❌ Ese número no está en WhatsApp o está mal formateado:', raw);
    process.exit(2);
  }

  console.log('JID resuelto:', numeroId._serialized);

  // Enviar y seguir los ACKs (0..4)
  const msg = await client.sendMessage(numeroId._serialized, 'Test desde proyecto actualizado 🚀');
  console.log('Mensaje enviado (ID):', msg.id.id);

  // Escuchar ACKs de este mensaje
  client.on('message_ack', (message, ack) => {
    if (message.id.id === msg.id.id) {
      // 0: pending, 1: server, 2: device, 3: read, 4: played (audio)
      console.log('[ACK]', ack);
      if (ack >= 2) {
        console.log('✅ Entregado al dispositivo del destinatario.');
        process.exit(0);
      }
    }
  });

  // Failsafe: si en 60s no pasa a ACK>=2, salimos con pista
  setTimeout(() => {
    console.error('⚠️ No se obtuvo ACK>=2 en 60s. Posibles causas:\n' +
      '- Destinatario no tiene WhatsApp o cambió de cuenta.\n' +
      '- Te tiene bloqueado (WhatsApp no lo expone claramente; el ACK puede quedarse en 1).\n' +
      '- Sesión recién reinstalada: vuelve a vincular y prueba.\n' +
      '- Problema temporal del multi-dispositivo (reintenta).');
    process.exit(3);
  }, 60000);
});

client.initialize();