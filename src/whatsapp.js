// src/whatsapp.js (ESM with simplified approach like working test)
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const { Client, LocalAuth, MessageMedia } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

class WhatsAppClient {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 10000;
    this.initialize();
  }

  initialize() {
    // Configurar directorio de sesión
    const sessionPath = process.env.SESSION_PATH || './.wwebjs_auth';
    fs.ensureDirSync(sessionPath);

    // Crear cliente con configuración robusta para evitar errores de navegación
    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: sessionPath }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ]
      },
      webVersionCache: {
        type: 'none'
      }
    });

    // Manejo de QR
    this.client.on('qr', qr => {
      console.log('Escanea este QR con WhatsApp:');
      qrcode.generate(qr, { small: true });
    });

    // Estados del cliente
    this.client.on('change_state', s => console.log('[STATE]', s));

    this.client.on('disconnected', r => {
      console.log('[DISCONNECTED]', r);
      this.isReady = false;
      this.attemptReconnect();
    });

    this.client.on('auth_failure', m => {
      console.log('[AUTH_FAILURE]', m);
      this.isReady = false;
      this.attemptReconnect();
    });

    // Cliente listo
    this.client.on('ready', () => {
      console.log('Cliente conectado ✅');
      this.isReady = true;
      this.reconnectAttempts = 0;

    });



    this.client.initialize();
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Intentando reconectar (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      
      setTimeout(() => {
        if (!this.isReady) {
          this.client.destroy();
          this.initialize();
        }
      }, this.reconnectInterval);
    } else {
      console.error('Número máximo de intentos de reconexión alcanzado. Reinicie manualmente el servicio.');
    }
  }

  // Método unificado para enviar mensajes (texto y/o archivos)
  async sendMessage(target, message = '', filePath = null) {
    if (!this.isReady) {
      throw new Error('El cliente de WhatsApp no está listo.');
    }

    if (!this.client.pupPage || this.client.pupPage.isClosed()) {
      this.isReady = false;
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
        console.log(`Mensaje enviado (ID: ${msg.id.id})`);
      }

      // Enviar archivo si existe
      if (filePath) {
        if (!fs.existsSync(filePath)) {
          throw new Error(`Archivo no encontrado: ${filePath}`);
        }
        const media = MessageMedia.fromFilePath(filePath);
        const fileMsg = await this.client.sendMessage(formattedTarget, media);
        console.log(`Archivo enviado (ID: ${fileMsg.id.id}): ${filePath}`);
      }

      return { success: true, message: 'Enviado correctamente', target: formattedTarget };

    } catch (error) {
      console.error(`Error: ${error.message}`);

      if (error.message.includes('Session closed') || error.message.includes('Target closed')) {
        this.isReady = false;
        this.attemptReconnect();
      }

      throw error;
    }
  }

  // Método para verificar el estado del cliente
  getStatus() {
    return {
      isReady: this.isReady,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  // Método para reiniciar el cliente
  async restart() {
    console.log('Reiniciando cliente de WhatsApp...');
    try {
      await this.client.destroy();
    } catch (error) {
      console.error(`Error al destruir el cliente: ${error.message}`);
    }
    
    this.reconnectAttempts = 0;
    this.initialize();
    return { success: true, message: 'Cliente reiniciado' };
  }
}

// Crear y exportar una instancia única del cliente
const whatsappClient = new WhatsAppClient();
export default whatsappClient;