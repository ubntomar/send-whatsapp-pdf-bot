// src/tenants.js - Gestor multi-tenant: un WhatsAppClient por empresa habilitada
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import WhatsAppClient from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tenants.json vive en la raíz del repo (un nivel arriba de src/)
const CONFIG_PATH = path.join(__dirname, '..', 'tenants.json');

class TenantManager {
  constructor() {
    this.config = this._loadConfig();
    this.defaultTenant = Number(process.env.DEFAULT_TENANT || this.config.defaultTenant);
    this.fallbackToDefault = this.config.fallbackToDefault !== false;
    this.clients = new Map(); // id(Number) -> WhatsAppClient
  }

  _loadConfig() {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const cfg = JSON.parse(raw);
      if (!cfg.tenants || typeof cfg.tenants !== 'object') {
        throw new Error('tenants.json sin objeto "tenants"');
      }
      return cfg;
    } catch (e) {
      throw new Error(`No se pudo cargar tenants.json (${CONFIG_PATH}): ${e.message}`);
    }
  }

  // Lista de definiciones de tenant desde el JSON
  definitions() {
    return Object.values(this.config.tenants).map(t => ({
      id: Number(t.id),
      name: t.name,
      phone: t.phone || null,
      enabled: !!t.enabled
    }));
  }

  getDefinition(id) {
    const t = this.config.tenants[String(id)];
    return t ? { id: Number(t.id), name: t.name, phone: t.phone || null, enabled: !!t.enabled } : null;
  }

  // Inicializa un cliente por cada tenant habilitado
  init() {
    for (const def of this.definitions()) {
      if (def.enabled) {
        console.log(`[TenantManager] Inicializando tenant ${def.id} (${def.name})`);
        this.clients.set(def.id, new WhatsAppClient(def));
      }
    }
    console.log(`[TenantManager] Tenants activos: ${[...this.clients.keys()].join(', ') || '(ninguno)'}`);
  }

  // Devuelve la instancia de cliente para un id (o undefined)
  getClient(id) {
    return this.clients.get(Number(id));
  }

  // Resuelve qué cliente usar para enviar.
  // Devuelve { client, requestedTenant, routedVia, fallback } o { error, code } si no hay ruta.
  resolveForSend(requestedId) {
    const reqId = requestedId != null && requestedId !== '' ? Number(requestedId) : this.defaultTenant;

    if (Number.isNaN(reqId)) {
      return { error: `empresa_id inválido: ${requestedId}`, code: 400 };
    }

    const direct = this.clients.get(reqId);
    if (direct && direct.isReady) {
      return { client: direct, requestedTenant: reqId, routedVia: reqId, fallback: false };
    }

    // No está listo o no existe: intentar fallback al default
    if (this.fallbackToDefault) {
      const def = this.clients.get(this.defaultTenant);
      if (def && def.isReady) {
        return {
          client: def,
          requestedTenant: reqId,
          routedVia: this.defaultTenant,
          fallback: reqId !== this.defaultTenant
        };
      }
    }

    // Sin ruta posible
    const known = this.getDefinition(reqId);
    if (!known) {
      return { error: `Tenant ${reqId} no existe en la configuración`, code: 404 };
    }
    return { error: `Tenant ${reqId} no está conectado y no hay fallback disponible`, code: 503 };
  }

  listTenants() {
    return this.definitions().map(def => {
      const c = this.clients.get(def.id);
      return c ? c.getStatus() : { ...def, isReady: false, wasConnectedOnce: false, hasQr: false };
    });
  }

  allStatus() {
    return {
      defaultTenant: this.defaultTenant,
      fallbackToDefault: this.fallbackToDefault,
      tenants: this.listTenants()
    };
  }

  async destroyAll() {
    for (const c of this.clients.values()) {
      await c.destroy();
    }
  }
}

const tenantManager = new TenantManager();
export default tenantManager;
