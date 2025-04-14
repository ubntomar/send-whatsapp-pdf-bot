# send-whatsapp-pdf-bot



curl -X POST \
  http://localhost:8050/api/send \
  -F "phone=+573162950915" \
  -F "message=Este es un PDF de prueba" \
  -F "pdf=@/home/omar/file.pdf"






curl -X POST \
  http://localhost:8050/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+573162950915",
    "message": "Este es un mensaje de prueba desde la API de WhatsApp"
  }'  


Usando un PDF que ya existe en el servidor:
  curl -X POST \
  http://45.61.59.204:8050/api/send \
  -F "phone=+573162950915" \
  -F "message=Este es un PDF de prueba" \
  -F "pdf=@/home/omar/file.pdf"


  curl -X POST \
  http://45.61.59.204:8050/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+573162950915",
    "message": "Este es un mensaje de prueba desde la API de WhatsApp"
  }'  



Subiendo un PDF en la petición:

curl -X POST \
  http://45.61.59.204:8050/api/send \
  -F "phone=+573162950915" \
  -F "message=Aquí está el PDF de prueba ALIxxx" \
  -F "pdf=@/home/omar/file.pdf"