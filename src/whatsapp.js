// src/whatsapp.js - Cliente WhatsApp parametrizable por tenant (multi-tenant)
import pkg from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import https from 'https';

const { Client, LocalAuth, MessageMedia } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Función para enviar notificaciones a ntfy
async function sendNtfyNotification(message, title = 'WhatsApp Bot', priority = 'default', tags = []) {
  const ntfyTopic = process.env.NTFY_TOPIC || 'whatsapp';
  const ntfyServer = process.env.NTFY_SERVER || 'ntfy.sh';

  const priorityMap = { min: 1, low: 2, default: 3, high: 4, urgent: 5, max: 5 };
  const priorityNum = typeof priority === 'number' ? priority : (priorityMap[priority] || 3);

  const data = JSON.stringify({
    topic: ntfyTopic,
    message,
    title,
    priority: priorityNum,
    tags,
    click: `https://ntfy.sh/${ntfyTopic}`
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
          resolve({ success: true, body });
        } else {
          reject(new Error(`ntfy returned ${res.statusCode}`));
        }
      });
    });
    req.on('error', (error) => reject(error));
    req.write(data);
    req.end();
  });
}

class WhatsAppClient {
  // tenantConfig: { id, name, phone }
  constructor(tenantConfig) {
    this.tenantId = tenantConfig.id;
    this.name = tenantConfig.name || `tenant-${tenantConfig.id}`;
    this.phone = tenantConfig.phone || null;
    this.label = `[${this.name}]`;

    this.client = null;
    this.isReady = false;
    this.wasConnectedOnce = false;
    this.lastQr = null;            // último QR (string) pendiente de escanear
    this.sentNotifications = new Set();
    this.initialize();
  }

  // Notificación (máximo una de cada tipo por arranque, prefijada por empresa)
  async notify(type, message, priority = 'high', tags = []) {
    const key = `${this.tenantId}:${type}`;
    if (this.sentNotifications.has(key)) return;
    this.sentNotifications.add(key);
    try {
      await sendNtfyNotification(message, `WhatsApp Bot ${this.label}`, priority, tags);
    } catch (error) {
      console.error(`${this.label} Error al enviar notificación:`, error.message);
    }
  }

  initialize() {
    const basePath = process.env.SESSION_PATH || './sessions';
    fs.ensureDirSync(basePath);

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: `tenant-${this.tenantId}`,
        dataPath: basePath
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

    // QR: guardar en memoria (para endpoint) y mostrar en consola
    this.client.on('qr', qr => {
      this.lastQr = qr;
      this.isReady = false;
      console.log(`\n======== ${this.label} ESCANEA ESTE QR ========\n`);
      qrcodeTerminal.generate(qr, { small: true });
      console.log(`\n=============================================\n`);
      this.notify(
        'qr',
        `${this.label} Se requiere escanear un QR.\n\nAbre: /api/${this.tenantId}/qr`,
        'high',
        ['warning']
      );
    });

    this.client.on('authenticated', () => {
      console.log(`${this.label} [OK] Sesión autenticada`);
    });

    this.client.on('change_state', state => {
      console.log(`${this.label} [STATE] ${state}`);
      if (state === 'CONFLICT' || state === 'UNPAIRED') {
        this.isReady = false;
        this.notify('state_problem', `${this.label} Estado problemático: ${state}. Reinicia este tenant.`, 'urgent', ['warning']);
      }
    });

    this.client.on('disconnected', reason => {
      console.log(`${this.label} [DISCONNECTED] ${reason}`);
      this.isReady = false;
      this.notify('disconnected', `${this.label} Desconectado: ${reason}. Reinicia este tenant (/api/${this.tenantId}/restart).`, 'urgent', ['broken_heart', 'warning']);
    });

    this.client.on('auth_failure', msg => {
      console.log(`${this.label} [AUTH_FAILURE] ${msg}`);
      this.isReady = false;
      // Limpiar sesión corrupta SOLO de este tenant
      const sessionDir = path.join(process.env.SESSION_PATH || './sessions', `session-tenant-${this.tenantId}`);
      try {
        fs.removeSync(sessionDir);
        console.log(`${this.label} [!] Sesión corrupta eliminada: ${sessionDir}`);
      } catch (e) {
        console.error(`${this.label} Error limpiando sesión:`, e.message);
      }
      this.notify('auth_failure', `${this.label} Autenticación fallida; sesión eliminada. Reinicia para escanear nuevo QR.`, 'urgent', ['x', 'warning']);
    });

    this.client.on('ready', () => {
      this.isReady = true;
      this.wasConnectedOnce = true;
      this.lastQr = null;
      console.log(`${this.label} [OK] WhatsApp conectado y listo`);
      this.notify('ready', `${this.label} Conectado y listo para enviar mensajes.`, 'default', ['white_check_mark']);
    });

    this.client.initialize();
  }

  // Enviar mensajes (texto y/o archivos)
  async sendMessage(target, message = '', filePath = null) {
    if (!this.isReady) {
      throw new Error(`${this.label} El cliente de WhatsApp no está listo.`);
    }
    if (!this.client.pupPage || this.client.pupPage.isClosed()) {
      this.isReady = false;
      this.notify('browser_closed', `${this.label} El navegador se cerró inesperadamente. Reinicia este tenant.`, 'urgent', ['warning']);
      throw new Error(`${this.label} Sesión del navegador cerrada.`);
    }

    try {
      let formattedTarget = target;
      if (!target.includes('@')) {
        const raw = target.replace(/\D/g, '');
        const numeroId = await this.client.getNumberId(raw);
        if (!numeroId) {
          throw new Error(`Número no registrado en WhatsApp: ${raw}`);
        }
        formattedTarget = numeroId._serialized;
      }

      if (message.trim()) {
        const msg = await this.client.sendMessage(formattedTarget, message);
        console.log(`${this.label} [SENT] Mensaje (ID: ${msg.id.id})`);
      }

      if (filePath) {
        if (!fs.existsSync(filePath)) {
          throw new Error(`Archivo no encontrado: ${filePath}`);
        }
        const media = MessageMedia.fromFilePath(filePath);
        const fileMsg = await this.client.sendMessage(formattedTarget, media);
        console.log(`${this.label} [SENT] Archivo (ID: ${fileMsg.id.id}): ${filePath}`);
      }

      return { success: true, message: 'Enviado correctamente', target: formattedTarget, tenant: this.tenantId };
    } catch (error) {
      console.error(`${this.label} [ERROR] ${error.message}`);
      if (error.message.includes('Session closed') || error.message.includes('Target closed')) {
        this.isReady = false;
        this.notify('session_closed_send', `${this.label} La sesión se cerró durante un envío. Reinicia este tenant.`, 'urgent', ['warning']);
      }
      throw error;
    }
  }

  getClient() {
    return this.isReady ? this.client : null;
  }

  getQr() {
    return this.lastQr;
  }

  getStatus() {
    return {
      tenantId: this.tenantId,
      name: this.name,
      phone: this.phone,
      isReady: this.isReady,
      wasConnectedOnce: this.wasConnectedOnce,
      hasQr: !!this.lastQr
    };
  }

  // Reinicia este tenant: destruye y vuelve a inicializar (regenera QR si hace falta)
  async restart() {
    console.log(`${this.label} [!] Reiniciando cliente...`);
    try {
      await this.client.destroy();
    } catch (error) {
      console.error(`${this.label} Error al destruir el cliente: ${error.message}`);
    }
    this.isReady = false;
    this.lastQr = null;
    this.sentNotifications.clear();
    this.initialize();
    return { success: true, message: `${this.label} Cliente reiniciado.`, tenant: this.tenantId };
  }

  async destroy() {
    try {
      await this.client.destroy();
    } catch (error) {
      console.error(`${this.label} Error al destruir: ${error.message}`);
    }
  }
}

export default WhatsAppClient;
