/**
 * Capaxero Cloud — Gerenciador de Estado e Interface para Banco de Dados Relacional
 * Encaminha todas as operações para o database.js e mantém compatibilidade total de API.
 */

const db = require('./database');

class StoreFacade {
  constructor() {
    this.db = db;
  }

  // Acessores para compatibilidade
  get branches() { return this.db.tables.branches; }
  get depots() { return this.db.tables.depots; }
  get operators() { return this.db.tables.users; }
  get transactions() { return this.db.tables.transactions; }
  get alerts() { return this.db.tables.alerts; }
  get pendingOrders() { return this.db.pendingOrders; }
  get checkouts() { return this.db.pendingOrders; }
  get totems() {
    return new Map(this.db.tables.totems.map(t => [t.devno, t]));
  }

  authenticateOperator(companyNo, userName, userPwd) {
    const user = this.db.authenticateUser(userName, userPwd);
    if (!user) return null;

    return {
      compno: "87550094",
      logno: user.username,
      cocode: (companyNo || user.company_name || "CAPAXERO").toUpperCase(),
      langkind: 2,
      branno: "BR-01",
      corpno: "CORP-01",
      usertype: user.role === 'CRPADMIN' ? 1 : 2,
      secretkey: "CAPAXERO_SECRET_KEY_2026",
      username: user.responsible_name || user.username,
      role: user.role,
      id: user.id
    };
  }

  createUser(data) { return this.db.createUser(data); }
  deleteUser(id) { return this.db.deleteUser(id); }
  authenticateUser(login, password) { return this.db.authenticateUser(login, password); }
  getUserById(id) { return this.db.getUserById(id); }
  updateUserProfile(userId, updates) { return this.db.updateUserProfile(userId, updates); }
  getUsersList() { return this.db.getUsersList(); }

  getBranchesList() { return this.db.getBranchesList(); }
  addBranch(data) { return this.db.addBranch(data); }

  getDepotsList(userFilter) { return this.db.getDepotsList(userFilter); }
  addDepot(data) { return this.db.addDepot(data); }
  deleteDepot(depotno) { return this.db.deleteDepot(depotno); }
  relocateTotem(devno, depotno) { return this.db.relocateTotem(devno, depotno); }

  getOwnersList() { return this.db.getOwnersList(); }
  setTotemOwner(devno, owner) { return this.db.setTotemOwner(devno, owner); }
  transferTotemOwner(devno, targetUserId) { return this.db.transferTotemOwner(devno, targetUserId); }

  getTotemsList(userFilter) { return this.db.getTotemsList(userFilter); }
  getTotem(devno) { return this.db.getTotem(devno); }
  upsertTotem(data) { return this.db.upsertTotem(data); }
  deleteTotem(devno) { return this.db.deleteTotem(devno); }
  updateTotemConfig(devno, config, userRole) { return this.db.updateTotemConfig(devno, config, userRole); }

  createCheckout(data) {
    return this.createPendingOrder(data);
  }

  getCheckout(orderId) {
    return this.getPendingOrder(orderId);
  }

  createPendingOrder(order) { return this.db.createPendingOrder(order); }
  getPendingOrder(orderId) { return this.db.getPendingOrder(orderId); }
  updatePendingOrder(orderId, updates) { return this.db.updatePendingOrder(orderId, updates); }

  updateHeartbeat(devno, telemetry) { return this.db.updateHeartbeat(devno, telemetry); }
  addTransaction(tx) { return this.db.addTransaction(tx); }
  getTransactions(limit, userFilter) { return this.db.getTransactions(limit, userFilter); }

  recordCycleComplete(devno, cycleData) { return this.db.recordCycleComplete(devno, cycleData); }
  addAlert(alert) { return this.db.addAlert(alert); }
  getAlerts(activeOnly, userFilter) { return this.db.getAlerts(activeOnly, userFilter); }
  resolveAlert(id) { return this.db.resolveAlert(id); }

  getStats(userFilter) { return this.db.getStats(userFilter); }
  getIncomeReport(userFilter) { return this.db.getIncomeReport(userFilter); }

  getSystemSettings() { return this.db.getSystemSettings(); }
  updateSystemSettings(updates) { return this.db.updateSystemSettings(updates); }

  getCouponsList() { return this.db.getCouponsList(); }
  getCoupon(code) { return this.db.getCoupon(code); }
  addCoupon(data) { return this.db.addCoupon(data); }
  deleteCoupon(code) { return this.db.deleteCoupon(code); }
  resetCoupon(code) { return this.db.resetCoupon(code); }
  redeemCoupon(code, totemId, details) { return this.db.redeemCoupon(code, totemId, details); }
  resetCoupons(scope) { return this.db.resetCoupons(scope); }
}

module.exports = new StoreFacade();
