// src/whatsapp.js - Versión simplificada sin reconexión automática
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import https from 'https';

const { Client, LocalAuth, MessageMedia } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Comandos para reiniciar el servicio (systemd)
const SERVICE_NAME = 'whatsapp-bot';
const RESTART_CMD = `sudo systemctl restart ${SERVICE_NAME}`;
const LOGS_CMD = `sudo journalctl -u ${SERVICE_NAME} -f`;

// Función para enviar notificaciones a ntfy
async function sendNtfyNotification(message, priority = 'default', tags = [], includeCommands = false) {
  const ntfyTopic = process.env.NTFY_TOPIC || 'whatsapp';
  const ntfyServer = process.env.NTFY_SERVER || 'ntfy.sh';

  // Construir el mensaje con comandos si es necesario
  let fullMessage = message;
  if (includeCommands) {
    fullMessage += `\n\n──────────────────\n`;
    fullMessage += `Comandos útiles:\n`;
    fullMessage += `  Reiniciar:  ${RESTART_CMD}\n`;
    fullMessage += `  Ver logs:   ${LOGS_CMD}`;
  }

  const priorityMap = { min: 1, low: 2, default: 3, high: 4, urgent: 5, max: 5 };
  const priorityNum = typeof priority === 'number' ? priority : (priorityMap[priority] || 3);

  const data = JSON.stringify({
    topic: ntfyTopic,
    message: fullMessage,
    title: 'WhatsApp Bot VPS',
    priority: priorityNum,
    tags: tags,
    click: `https://ntfy.sh/${ntfyTopic}`,
    actions: includeCommands ? [
      {
        action: 'view',
        label: 'Ver en navegador',
        url: `https://ntfy.sh/${ntfyTopic}`,
        clear: false
      }
    ] : []
  });

  const options = {
    hostname: ntfyServer,
    port: 443,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[NTFY] Notificación enviada: ${message}`);
          resolve({ success: true, body });
        } else {
          console.error(`[NTFY] Error: ${res.statusCode} - ${body}`);
          reject(new Error(`ntfy returned ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error(`[NTFY] Error de conexión: ${error.message}`);
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

class WhatsAppClient {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.wasConnectedOnce = false; // Una vez conectado, no volver a mostrar QR
    this.sentNotifications = new Set(); // Controlar notificaciones enviadas por arranque
    this.initialize();
  }

  // Método para enviar notificación (máximo una de cada tipo por arranque)
  async notify(type, message, priority = 'high', tags = [], includeCommands = false) {
    if (this.sentNotifications.has(type)) {
      console.log(`[NTFY] Notificación '${type}' ya enviada en este arranque, omitiendo.`);
      return;
    }
    this.sentNotifications.add(type);
    try {
      await sendNtfyNotification(message, priority, tags, includeCommands);
    } catch (error) {
      console.error('Error al enviar notificación:', error.message);
    }
  }

  initialize() {
    // Notificar que el servicio está iniciando
    this.notify(
      'startup',
      '── Servicio Iniciando ──\n\nEl bot de WhatsApp se está arrancando.\nEsperando conexión...',
      'default',
      ['rocket']
    );

    // Configurar directorio de sesión
    const sessionPath = process.env.SESSION_PATH || './.wwebjs_auth';
    fs.ensureDirSync(sessionPath);

    // Crear cliente
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: sessionPath
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    });

    // Manejo de QR - Solo mostrar si nunca se ha conectado
    this.client.on('qr', qr => {
      if (this.wasConnectedOnce) {
        // Ya se conectó antes, NO mostrar QR, solo notificar
        console.log('\n[!] Se requiere nuevo QR pero el servicio ya estuvo conectado.');
        console.log('[!] Reinicia el servicio manualmente para escanear un nuevo QR.\n');
        this.notify(
          'qr_lost',
          '── Sesión Perdida ──\n\nSe requiere un nuevo código QR pero el servicio ya estuvo conectado.\n\nAcción: Reinicia el servicio para escanear un nuevo QR.',
          'urgent',
          ['warning', 'x'],
          true
        );
        return;
      }

      // Primera vez: limpiar pantalla y mostrar QR
      console.clear();
      console.log('\n========================================');
      console.log('   ESCANEA ESTE QR CON WHATSAPP');
      console.log('========================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\n========================================\n');
    });

    // Evento de autenticación exitosa
    this.client.on('authenticated', () => {
      console.log('[OK] Sesión autenticada correctamente');
    });

    // Estados del cliente
    this.client.on('change_state', state => {
      console.log(`[STATE] ${state}`);

      if (state === 'CONFLICT' || state === 'UNPAIRED') {
        this.isReady = false;
        console.log(`\n[!] Estado problemático detectado: ${state}`);
        console.log('[!] Reinicia el servicio manualmente.\n');
        this.notify(
          'state_problem',
          `── Estado Problemático ──\n\nEstado detectado: ${state}\n\nAcción: Reinicia el servicio para restablecer la conexión.`,
          'urgent',
          ['warning'],
          true
        );
      }
    });

    // Desconexión
    this.client.on('disconnected', reason => {
      console.log(`\n[DISCONNECTED] ${reason}`);
      this.isReady = false;

      // Notificar y NO reconectar
      console.log('[!] Cliente desconectado. Reinicia el servicio manualmente.\n');
      this.notify(
        'disconnected',
        `── Desconectado ──\n\nMotivo: ${reason}\n\nEl bot ha perdido la conexión con WhatsApp.\n\nAcción: Reinicia el servicio manualmente.`,
        'urgent',
        ['broken_heart', 'warning'],
        true
      );
    });

    // Fallo de autenticación
    this.client.on('auth_failure', msg => {
      console.log(`\n[AUTH_FAILURE] ${msg}`);
      this.isReady = false;

      // Limpiar sesión corrupta
      const sessionPath = process.env.SESSION_PATH || './.wwebjs_auth';
      try {
        fs.removeSync(sessionPath);
        console.log('[!] Sesión corrupta eliminada');
      } catch (e) {
        console.error('Error limpiando sesión:', e.message);
      }

      console.log('[!] Reinicia el servicio manualmente para escanear nuevo QR.\n');
      this.notify(
        'auth_failure',
        '── Autenticación Fallida ──\n\nLa sesión estaba corrupta y fue eliminada.\n\nAcción: Reinicia el servicio para escanear un nuevo QR.',
        'urgent',
        ['x', 'warning'],
        true
      );
    });

    // Cliente listo
    this.client.on('ready', () => {
      console.clear();
      console.log('\n========================================');
      console.log('   WHATSAPP CONECTADO CORRECTAMENTE');
      console.log('========================================\n');
      console.log('[OK] El bot está listo para enviar mensajes.\n');

      this.isReady = true;
      this.wasConnectedOnce = true;

      this.notify(
        'ready',
        '── Conectado ──\n\nWhatsApp conectado y listo para enviar mensajes.',
        'default',
        ['white_check_mark']
      );
    });

    this.client.initialize();
  }

  // Método para enviar mensajes (texto y/o archivos)
  async sendMessage(target, message = '', filePath = null) {
    if (!this.isReady) {
      this.notify(
        'send_not_connected',
        '── Envío Fallido ──\n\nSe intentó enviar un mensaje pero el cliente no está conectado.\n\nAcción: Reinicia el servicio.',
        'high',
        ['warning'],
        true
      );
      throw new Error('El cliente de WhatsApp no está listo.');
    }

    if (!this.client.pupPage || this.client.pupPage.isClosed()) {
      this.isReady = false;
      this.notify(
        'browser_closed',
        '── Navegador Cerrado ──\n\nLa sesión del navegador se cerró inesperadamente.\n\nAcción: Reinicia el servicio.',
        'urgent',
        ['warning'],
        true
      );
      throw new Error('Sesión del navegador cerrada.');
    }

    try {
      // Formatear target (número o grupo)
      let formattedTarget = target;
      if (!target.includes('@')) {
        const raw = target.replace(/\D/g, '');
        const numeroId = await this.client.getNumberId(raw);

        if (!numeroId) {
          throw new Error(`Número no registrado en WhatsApp: ${raw}`);
        }

        formattedTarget = numeroId._serialized;
      }

      // Enviar mensaje de texto
      if (message.trim()) {
        const msg = await this.client.sendMessage(formattedTarget, message);
        console.log(`[SENT] Mensaje enviado (ID: ${msg.id.id})`);
      }

      // Enviar archivo si existe
      if (filePath) {
        if (!fs.existsSync(filePath)) {
          throw new Error(`Archivo no encontrado: ${filePath}`);
        }
        const media = MessageMedia.fromFilePath(filePath);
        const fileMsg = await this.client.sendMessage(formattedTarget, media);
        console.log(`[SENT] Archivo enviado (ID: ${fileMsg.id.id}): ${filePath}`);
      }

      return { success: true, message: 'Enviado correctamente', target: formattedTarget };

    } catch (error) {
      console.error(`[ERROR] ${error.message}`);

      if (error.message.includes('Session closed') || error.message.includes('Target closed')) {
        this.isReady = false;
        this.notify(
          'session_closed_send',
          '── Sesión Cerrada ──\n\nLa sesión se cerró mientras se enviaba un mensaje.\n\nAcción: Reinicia el servicio.',
          'urgent',
          ['warning'],
          true
        );
      }

      throw error;
    }
  }

  // Método para obtener el cliente
  getClient() {
    return this.isReady ? this.client : null;
  }

  // Método para verificar el estado
  getStatus() {
    return {
      isReady: this.isReady,
      wasConnectedOnce: this.wasConnectedOnce
    };
  }

  // Método para reiniciar (solo destruir, el usuario debe reiniciar el servicio)
  async restart() {
    console.log('\n[!] Reiniciando cliente...');
    try {
      await this.client.destroy();
    } catch (error) {
      console.error(`Error al destruir el cliente: ${error.message}`);
    }

    console.log('[!] Cliente destruido. Reinicia el servicio manualmente.\n');
    this.notify(
      'client_destroyed',
      '── Cliente Destruido ──\n\nEl cliente de WhatsApp fue destruido correctamente.\n\nAcción: Reinicia el servicio manualmente.',
      'default',
      ['arrows_counterclockwise']
    );

    return { success: true, message: 'Cliente destruido. Reinicia el servicio manualmente.' };
  }
}

// Crear y exportar instancia única
const whatsappClient = new WhatsAppClient();
export default whatsappClient;
