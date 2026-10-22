// tests/fixtures/profile-gameService-stub.mjs: stands in for lib/gameService.js in tests/profile-service.test.mjs.
export class GameError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }
export async function getProfile() { return {}; }
