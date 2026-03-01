const { safeStorage } = require("electron");

class SecureSettings {
  constructor(database) {
    this.database = database;
  }

  setEncrypted(key, plaintextValue) {
    if (!safeStorage.isEncryptionAvailable()) {
      this.database.saveSetting(key, plaintextValue, 0);
      return { encrypted: false };
    }
    const encryptedBuffer = safeStorage.encryptString(plaintextValue);
    this.database.saveSetting(key, encryptedBuffer.toString("base64"), 1);
    return { encrypted: true };
  }

  getDecrypted(key) {
    const setting = this.database.getSetting(key);
    if (!setting) {
      return null;
    }
    if (!setting.encrypted) {
      return setting.value;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    const decrypted = safeStorage.decryptString(Buffer.from(setting.value, "base64"));
    return decrypted;
  }
}

module.exports = { SecureSettings };
