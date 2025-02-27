#!/usr/bin/env python3
import requests
import mysql.connector
import json
import os
import logging
from datetime import datetime

# Configuración de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(f"whatsapp_sender_{datetime.now().strftime('%Y%m%d')}.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger()

# Configuración de la base de datos MySQL
DB_CONFIG = {
    'host': os.environ.get('MYSQL_SERVER', 'localhost'),
    'user': os.environ.get('MYSQL_USER', 'mikro'),
    'password': os.environ.get('MYSQL_PASSWORD', 'secreto'),
    'database': os.environ.get('MYSQL_DATABASE', 'mikro'),
    'port': int(os.environ.get('MYSQL_PORT', 3306))
}

# Configuración del servicio WhatsApp
WHATSAPP_API = "http://localhost:8050/api/send-with-path"
PDF_PATH = "/home/omar/file.pdf"
MESSAGE = "Este es un archivo PDF de prueba enviado automáticamente por nuestro sistema."

def connect_to_database():
    """Establece conexión con la base de datos MySQL"""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        logger.info("Conexión a la base de datos establecida correctamente")
        return conn
    except mysql.connector.Error as err:
        logger.error(f"Error al conectar a la base de datos: {err}")
        return None

def get_whatsapp_users(conn):
    """Obtiene los usuarios con whatsapp=1 y activos"""
    users = []
    try:
        cursor = conn.cursor(dictionary=True)
        # Seleccionamos solo usuarios activos (activo=1) y con whatsapp habilitado (whatsapp=1)
        query = """
        SELECT id, cliente, apellido, telefono
        FROM afiliados
        WHERE whatsapp = 1 AND activo = 1 AND suspender = 0
        """
        cursor.execute(query)
        users = cursor.fetchall()
        logger.info(f"Se encontraron {len(users)} usuarios con WhatsApp habilitado")
        cursor.close()
        return users
    except mysql.connector.Error as err:
        logger.error(f"Error al obtener usuarios: {err}")
        return []

def send_whatsapp_pdf(phone, client_name, client_id):
    """Envía un PDF por WhatsApp a un número específico"""
    # Personalizar el mensaje para cada cliente
    personalized_message = f"Hola {client_name}, {MESSAGE}"
    
    # Formato adecuado para el número de teléfono
    # Asegurarse de que el número incluya el código de país (+57 para Colombia)
    if not phone.startswith('+'):
        # Si el número no tiene +, verificamos si ya tiene el código de país
        if phone.startswith('57'):
            phone = f"+{phone}"
        else:
            phone = f"+57{phone}"
    
    # Datos para la petición
    data = {
        "phone": phone,
        "message": personalized_message,
        "pdfPath": PDF_PATH
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(
            WHATSAPP_API, 
            headers=headers, 
            data=json.dumps(data),
            timeout=30  # Tiempo máximo de espera: 30 segundos
        )
        
        if response.status_code == 200 and response.json().get("success"):
            logger.info(f"PDF enviado correctamente a {client_name} (ID: {client_id}) - {phone}")
            return True
        else:
            logger.error(f"Error al enviar PDF a {client_name} (ID: {client_id}) - {phone}: {response.text}")
            return False
    except Exception as e:
        logger.error(f"Excepción al enviar PDF a {client_name} (ID: {client_id}) - {phone}: {str(e)}")
        return False

def verify_pdf_exists():
    """Verifica que el archivo PDF exista"""
    if not os.path.exists(PDF_PATH):
        logger.error(f"El archivo PDF no existe en la ruta: {PDF_PATH}")
        return False
    return True

def main():
    """Función principal del script"""
    logger.info("Iniciando proceso de envío de PDFs por WhatsApp")
    
    # Verificar que el archivo PDF exista
    if not verify_pdf_exists():
        return
    
    # Conectar a la base de datos
    conn = connect_to_database()
    if not conn:
        return
    
    try:
        # Obtener usuarios con WhatsApp habilitado
        users = get_whatsapp_users(conn)
        
        # Contadores para estadísticas
        successful_sends = 0
        failed_sends = 0
        
        # Enviar PDF a cada usuario
        for user in users:
            client_name = f"{user['cliente']} {user['apellido']}"
            client_id = user['id']
            phone = user['telefono']
            
            # Si el número de teléfono está vacío o no es válido, continuar con el siguiente usuario
            if not phone or len(phone) < 10:
                logger.warning(f"Número de teléfono no válido para {client_name} (ID: {client_id}): {phone}")
                failed_sends += 1
                continue
            
            # Enviar el PDF
            if send_whatsapp_pdf(phone, client_name, client_id):
                successful_sends += 1
            else:
                failed_sends += 1
        
        # Mostrar estadísticas finales
        logger.info(f"Proceso finalizado. Envíos exitosos: {successful_sends}, Envíos fallidos: {failed_sends}")
        
    except Exception as e:
        logger.error(f"Error en el proceso principal: {str(e)}")
    finally:
        # Cerrar la conexión a la base de datos
        if conn and conn.is_connected():
            conn.close()
            logger.info("Conexión a la base de datos cerrada")

if __name__ == "__main__":
    main()