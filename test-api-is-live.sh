#!/bin/bash

# Script para probar la API de WhatsApp
# Uso: ./test-api.sh [puerto] [numero_telefono]

PORT=${1:-8050}
PHONE=${2:-"573215450397"}
BASE_URL="http://localhost:$PORT"

echo "==================================="
echo "🧪 PRUEBAS DE API WHATSAPP"
echo "==================================="
echo "Puerto: $PORT"
echo "URL Base: $BASE_URL"
echo "Teléfono de prueba: $PHONE"
echo "==================================="

# Función para mostrar resultados
show_result() {
    local test_name="$1"
    local response="$2"
    local status_code="$3"
    
    echo
    echo "📋 TEST: $test_name"
    echo "Status Code: $status_code"
    
    if command -v jq &> /dev/null; then
        echo "Response:"
        echo "$response" | jq '.'
    else
        echo "Response: $response"
    fi
    echo "-----------------------------------"
}

# 1. Prueba básica de salud
echo "1️⃣  Probando endpoint raíz..."
response=$(curl -s -w "%{http_code}" "$BASE_URL/")
status_code="${response: -3}"
response_body="${response%???}"
show_result "Health Check" "$response_body" "$status_code"

# 2. Verificar estado del cliente
echo "2️⃣  Verificando estado del cliente WhatsApp..."
response=$(curl -s -w "%{http_code}" "$BASE_URL/api/status")
status_code="${response: -3}"
response_body="${response%???}"
show_result "Client Status" "$response_body" "$status_code"

# 3. Enviar mensaje de prueba (solo si hay un número válido)
if [[ ${#PHONE} -gt 5 && "$PHONE" != "573215450397" ]]; then
    echo "3️⃣  Enviando mensaje de prueba..."
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    response=$(curl -s -w "%{http_code}" -X POST "$BASE_URL/api/send-message" \
        -H "Content-Type: application/json" \
        -d "{
            \"target\": \"$PHONE\",
            \"message\": \"🤖 Prueba de API - $timestamp\"
        }")
    status_code="${response: -3}"
    response_body="${response%???}"
    show_result "Send Test Message" "$response_body" "$status_code"
else
    echo "3️⃣  ⚠️  Saltando envío de mensaje (número no configurado)"
    echo "   Para probar envío, ejecuta: ./test-api.sh $PORT TU_NUMERO"
fi

echo
echo "✅ Pruebas completadas!"
echo "==================================="

# Verificar si el cliente está listo
if command -v jq &> /dev/null; then
    status_response=$(curl -s "$BASE_URL/api/status")
    is_ready=$(echo "$status_response" | jq -r '.isReady // false')
    
    if [ "$is_ready" = "true" ]; then
        echo "🟢 Cliente WhatsApp está LISTO"
    else
        echo "🔴 Cliente WhatsApp NO está listo"
        echo "   - Asegúrate de haber escaneado el código QR"
        echo "   - Revisa los logs para más detalles"
    fi
fi

echo "==================================="
