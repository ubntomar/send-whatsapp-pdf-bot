#!/usr/bin/env python3
import requests
import json
import sys

# Configuración
API_URL = "http://localhost:8050"
PHONE = "+573162950900"  # Cambia esto a tu número
MESSAGE = "Este es un mensaje de prueba desde Python"
PDF_PATH = "/home/omar/file.pdf"  # Cambia esto a la ruta de tu PDF

def send_whatsapp():
    # URL y headers
    url = f"{API_URL}/api/send-with-path"
    headers = {
        "Content-Type": "application/json"
    }
    
    # Datos a enviar
    data = {
        "phone": PHONE,
        "message": MESSAGE,
        "pdfPath": PDF_PATH
    }
    
    try:
        # Realizar la petición
        response = requests.post(url, headers=headers, data=json.dumps(data))
        
        # Imprimir respuesta
        print(f"Estado: {response.status_code}")
        print(json.dumps(response.json(), indent=2))
        
        # Verificar si fue exitoso
        if response.status_code == 200 and response.json().get("success"):
            print("✅ Mensaje enviado correctamente")
            return True
        else:
            print("❌ Error al enviar el mensaje")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    send_whatsapp()