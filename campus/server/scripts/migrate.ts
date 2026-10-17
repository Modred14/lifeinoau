import { closeDatabase, runMigrations } from "../src/database/database";

await runMigrations();
await closeDatabase();
console.log("Migrations applied");
