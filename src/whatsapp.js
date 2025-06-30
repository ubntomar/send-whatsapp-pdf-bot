const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const logger = require('./utils/error-handler');

class WhatsAppClient {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 10000; // 10 segundos
    this.initialize();
  }

  initialize() {
    // Asegurar que existe el directorio de sesiones
    const sessionPath = process.env.SESSION_PATH || './sessions';
    fs.ensureDirSync(sessionPath);

    // Inicializar el cliente
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: sessionPath
      }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        headless: true
      }
    });

    // Manejar el evento del código QR
    this.client.on('qr', (qr) => {
      logger.info('Escanee el siguiente código QR:');
      qrcode.generate(qr, { small: true });
    });

    // Manejar el evento de autenticación
    this.client.on('authenticated', () => {
      logger.info('Cliente autenticado correctamente');
    });

    // Manejar el evento de inicio de sesión
    this.client.on('ready', () => {
      this.isReady = true;
      this.reconnectAttempts = 0;
      logger.info('Cliente WhatsApp listo y conectado');
    });

    // Manejar el evento de desconexión
    this.client.on('disconnected', (reason) => {
      this.isReady = false;
      logger.error(`Cliente desconectado: ${reason}`);
      
      // Intentar reconectar
      this.attemptReconnect();
    });

    // Manejar errores
    this.client.on('auth_failure', (error) => {
      logger.error(`Error de autenticación: ${error}`);
      this.attemptReconnect();
    });

    // Inicializar el cliente
    this.client.initialize().catch(error => {
      logger.error(`Error al inicializar el cliente: ${error}`);
      this.attemptReconnect();
    });
  }

  // Método para intentar reconectar
  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      logger.info(`Intentando reconectar (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      
      setTimeout(() => {
        if (!this.isReady) {
          this.client.destroy();
          this.initialize();
        }
      }, this.reconnectInterval);
    } else {
      logger.error('Número máximo de intentos de reconexión alcanzado. Reinicie manualmente el servicio.');
    }
  }

  // Método para enviar mensaje con PDF
  async sendMessage(phone, message, pdfPath) {
    if (!this.isReady) {
      throw new Error('El cliente de WhatsApp no está listo . pista :Soy API en 45.65...regenerar QR es con qr_scanner.js pm2 st.. what314 . Por favor, espere a que se complete la autenticación.');
    }

    try {
      // Formatear el número de teléfono
      let formattedPhone = phone.replace(/\D/g, '');
      // Agregar @c.us al final para formato whatsapp-web.js
      if (!formattedPhone.endsWith('@c.us')) {
        formattedPhone = `${formattedPhone}@c.us`;
      }

      // Verificar si el contacto existe
      const contactExists = await this.client.isRegisteredUser(formattedPhone);
      if (!contactExists) {
        throw new Error(`El número ${phone} no está registrado en WhatsApp.`);
      }

      // Enviar mensaje
      if (message && message.trim() !== '') {
        await this.client.sendMessage(formattedPhone, message);
        logger.info(`Mensaje enviado a ${phone}`);
      }

      // Enviar PDF si existe
      if (pdfPath && fs.existsSync(pdfPath)) {
        const media = MessageMedia.fromFilePath(pdfPath);
        await this.client.sendMessage(formattedPhone, media);
        logger.info(`PDF enviado a ${phone}: ${pdfPath}`);
        return { success: true, message: 'Mensaje y PDF enviados correctamente' };
      } else if (pdfPath) {
        throw new Error(`El archivo PDF no existe en la ruta: ${pdfPath}`);
      }

      return { success: true, message: 'Mensaje enviado correctamente' };
    } catch (error) {
      logger.error(`Error al enviar mensaje: ${error.message}`);
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
    logger.info('Reiniciando cliente de WhatsApp...');
    try {
      await this.client.destroy();
    } catch (error) {
      logger.error(`Error al destruir el cliente: ${error.message}`);
    }
    
    this.reconnectAttempts = 0;
    this.initialize();
    return { success: true, message: 'Cliente reiniciado' };
  }
}

// Crear y exportar una instancia única del cliente
const whatsappClient = new WhatsAppClient();
module.exports = whatsappClient;