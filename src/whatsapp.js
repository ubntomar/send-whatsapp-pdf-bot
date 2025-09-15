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
        executablePath: '/usr/bin/chromium-browser',
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
    this.client.on('ready', async () => {
      console.log('Cliente conectado ✅');
      this.isReady = true;
      this.reconnectAttempts = 0;

      // Configurar listeners de Puppeteer después de que esté listo
      if (this.client.pupPage) {
        this.client.pupPage.on('error', error => {
          console.error('[PUPPETEER_ERROR]', error);
          this.isReady = false;
          this.attemptReconnect();
        });

        this.client.pupPage.on('close', () => {
          console.log('[PUPPETEER_CLOSE] Página cerrada');
          this.isReady = false;
          this.attemptReconnect();
        });
      }
    });

    // Tracking de ACKs (acknowledgments)
    this.client.on('message_ack', (message, ack) => {
      // 0: pending, 1: server, 2: device, 3: read, 4: played (audio)
      console.log(`[ACK] Mensaje ${message.id.id}: ${ack}`);
    });

    // Timeout para inicialización
    const initTimeout = setTimeout(() => {
      if (!this.isReady) {
        console.log('[TIMEOUT] La inicialización está tardando mucho, reiniciando...');
        this.client.destroy().catch(() => {});
        setTimeout(() => this.initialize(), 5000);
      }
    }, 120000); // 2 minutos

    // Limpiar timeout cuando se conecte
    this.client.once('ready', () => {
      clearTimeout(initTimeout);
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

  // Método principal para enviar mensajes con validación adecuada
  async sendSimpleMessage(target, message) {
    if (!this.isReady) {
      throw new Error('El cliente de WhatsApp no está listo. Por favor, espere a que se complete la autenticación.');
    }

    // Verificar que la página de Puppeteer esté disponible
    if (!this.client.pupPage || this.client.pupPage.isClosed()) {
      this.isReady = false;
      throw new Error('La sesión del navegador se ha cerrado. Reintentando reconexión...');
    }

    try {
      // Formatear número si es necesario (similar al test)
      let formattedTarget = target;
      if (!target.includes('@')) {
        const raw = target.replace(/\D/g, ''); // Solo números
        const numeroId = await this.client.getNumberId(raw);
        
        if (!numeroId) {
          throw new Error(`❌ Ese número no está en WhatsApp o está mal formateado: ${raw}`);
        }
        
        console.log('JID resuelto:', numeroId._serialized);
        formattedTarget = numeroId._serialized;
      }

      // Enviar mensaje y rastrear ACKs
      console.log(`Enviando mensaje a: ${formattedTarget}`);
      const msg = await this.client.sendMessage(formattedTarget, message);
      console.log('Mensaje enviado (ID):', msg.id.id);

      return new Promise((resolve, reject) => {
        // Listener temporal para este mensaje específico
        const ackListener = (ackMessage, ack) => {
          if (ackMessage.id.id === msg.id.id) {
            console.log(`[ACK] ${ack}`);
            if (ack >= 2) {
              console.log('✅ Entregado al dispositivo del destinatario.');
              this.client.removeListener('message_ack', ackListener);
              resolve({
                success: true,
                message: 'Mensaje entregado correctamente',
                messageId: msg.id.id,
                target: formattedTarget
              });
            }
          }
        };

        this.client.on('message_ack', ackListener);

        // Timeout de seguridad
        setTimeout(() => {
          this.client.removeListener('message_ack', ackListener);
          console.warn('⚠️ No se obtuvo ACK>=2 en 60s. Posibles causas:\n' +
            '- Destinatario no tiene WhatsApp o cambió de cuenta.\n' +
            '- Te tiene bloqueado (WhatsApp no lo expone claramente; el ACK puede quedarse en 1).\n' +
            '- Sesión recién reinstalada: vuelve a vincular y prueba.\n' +
            '- Problema temporal del multi-dispositivo (reintenta).');
          resolve({
            success: true,
            message: 'Mensaje enviado (confirmación de entrega pendiente)',
            messageId: msg.id.id,
            target: formattedTarget,
            warning: 'No se confirmó la entrega completa'
          });
        }, 60000);
      });

    } catch (error) {
      console.error(`Error al enviar mensaje: ${error.message}`);
      
      // Si es un error de sesión cerrada, intentar reconectar
      if (error.message.includes('Session closed') || error.message.includes('Target closed')) {
        console.log('Detectado cierre de sesión, iniciando reconexión...');
        this.isReady = false;
        this.attemptReconnect();
      }
      
      throw error;
    }
  }

  // Método para enviar mensaje con PDF (manteniendo compatibilidad)
  async sendMessage(phone, message, pdfPath) {
    if (!this.isReady) {
      throw new Error('El cliente de WhatsApp no está listo. Por favor, espere a que se complete la autenticación.');
    }

    try {
      // Formatear el número
      const raw = phone.replace(/\D/g, '');
      const numeroId = await this.client.getNumberId(raw);
      
      if (!numeroId) {
        throw new Error(`El número ${phone} no está registrado en WhatsApp.`);
      }

      const target = numeroId._serialized;

      // Enviar mensaje de texto si existe
      if (message && message.trim() !== '') {
        const msg = await this.client.sendMessage(target, message);
        console.log(`Mensaje enviado a ${phone} (ID: ${msg.id.id})`);
      }

      // Enviar PDF si existe
      if (pdfPath && fs.existsSync(pdfPath)) {
        const media = MessageMedia.fromFilePath(pdfPath);
        const pdfMsg = await this.client.sendMessage(target, media);
        console.log(`PDF enviado a ${phone} (ID: ${pdfMsg.id.id}): ${pdfPath}`);
        return { success: true, message: 'Mensaje y PDF enviados correctamente' };
      } else if (pdfPath) {
        throw new Error(`El archivo PDF no existe en la ruta: ${pdfPath}`);
      }

      return { success: true, message: 'Mensaje enviado correctamente' };
    } catch (error) {
      console.error(`Error al enviar mensaje: ${error.message}`);
      
      // Si es un error de sesión cerrada, intentar reconectar
      if (error.message.includes('Session closed') || error.message.includes('Target closed')) {
        console.log('Detectado cierre de sesión, iniciando reconexión...');
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