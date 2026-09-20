/* A saved local demo connection is not proof of a live bank/API connection. */
window.BankState = {
  account(storage, email) {
    try {
      const value = JSON.parse(storage.getItem("bankAccount"));
      if (!value || value.connected !== true || typeof value.owner !== "string" || typeof email !== "string" || value.owner.trim().toLowerCase() !== email.trim().toLowerCase() || typeof value.balance !== "number" || !Number.isFinite(value.balance) || value.balance < 0) return null;
      return value;
    } catch { return null; }
  }
};
