class AppContainer {
  constructor() {
    this.services = new Map();
  }

  register(name, serviceInstance) {
    this.services.set(name, serviceInstance);
  }

  get(name) {
    if (!this.services.has(name)) {
      throw new Error(`Service ${name} not found in container.`);
    }
    return this.services.get(name);
  }

  // Gracefully shutdown all services supporting a close() method
  async shutdown() {
    for (const [name, service] of this.services.entries()) {
      if (typeof service.close === "function") {
        try {
          await service.close();
        } catch (err) {
          console.error(`Error closing service ${name}:`, err);
        }
      }
    }
    this.services.clear();
  }
}

module.exports = { AppContainer };
