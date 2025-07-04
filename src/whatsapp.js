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

  // MÉTODO MEJORADO: Enviar solo mensaje de texto a número o grupo
  async sendSimpleMessage(target, message) {
    if (!this.isReady) {
      throw new Error('El cliente de WhatsApp no está listo. Por favor, espere a que se complete la autenticación.');
    }

    try {
      // Verificar si es un grupo o contacto individual
      let isGroup = target.includes('@g.us');
      let displayTarget = target;
      
      if (isGroup) {
        // Es un grupo - no necesitamos verificar si está registrado
        displayTarget = target.replace('@g.us', '');
        logger.info(`Enviando mensaje a grupo: ${displayTarget}`);
      } else {
        // Es un contacto individual - verificar si está registrado
        const contactExists = await this.client.isRegisteredUser(target);
        if (!contactExists) {
          const phoneNumber = target.replace('@c.us', '');
          throw new Error(`El número ${phoneNumber} no está registrado en WhatsApp.`);
        }
        displayTarget = target.replace('@c.us', '');
        logger.info(`Enviando mensaje a contacto: ${displayTarget}`);
      }

      // Enviar mensaje con manejo mejorado del error de serialización
      try {
        await this.client.sendMessage(target, message);
        // Si llegamos aquí, el mensaje se envió correctamente
      } catch (sendError) {
        // Verificar si es el error específico de serialización pero el mensaje se envió
        if (sendError.message && sendError.message.includes('serialize')) {
          logger.info(`Mensaje enviado exitosamente (ignorando error de serialización): ${displayTarget}`);
          // Continuamos como si fuera exitoso
        } else {
          // Es un error real de envío
          throw sendError;
        }
      }
      
      const successMessage = isGroup 
        ? `Mensaje enviado correctamente al grupo ${displayTarget}`
        : `Mensaje enviado correctamente a ${displayTarget}`;
        
      logger.info(successMessage);
      
      return { 
        success: true, 
        message: successMessage,
        target: displayTarget,
        type: isGroup ? 'group' : 'contact'
      };
      
    } catch (error) {
      logger.error(`Error al enviar mensaje: ${error.message}`);
      throw error;
    }
  }

  // Método existente para enviar mensaje con PDF
  async sendMessage(phone, message, pdfPath) {
    if (!this.isReady) {
      throw new Error('El cliente de WhatsApp no está listo. Por favor, espere a que se complete la autenticación.');
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
        try {
          await this.client.sendMessage(formattedPhone, message);
          logger.info(`Mensaje enviado a ${phone}`);
        } catch (sendError) {
          if (sendError.message && sendError.message.includes('serialize')) {
            logger.info(`Mensaje enviado exitosamente a ${phone} (ignorando error de serialización)`);
          } else {
            throw sendError;
          }
        }
      }

      // Enviar PDF si existe
      if (pdfPath && fs.existsSync(pdfPath)) {
        try {
          const media = MessageMedia.fromFilePath(pdfPath);
          await this.client.sendMessage(formattedPhone, media);
          logger.info(`PDF enviado a ${phone}: ${pdfPath}`);
        } catch (sendError) {
          if (sendError.message && sendError.message.includes('serialize')) {
            logger.info(`PDF enviado exitosamente a ${phone}: ${pdfPath} (ignorando error de serialización)`);
          } else {
            throw sendError;
          }
        }
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