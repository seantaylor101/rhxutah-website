#!/usr/bin/env node
// One-off bootstrap: add a PM (or a second tenant admin) to an existing tenant directly
// against the database. Useful during production cutover to get real PM accounts (and
// their user ids, for PM_MANAGER_MAP) in place before running the SQLite migration
// script or deploying the new code -- afterward, just use the Team screen in the app
// instead of this script.
//
// Usage: node scripts/add-user.js <tenantId> <email> <name> <password> <pm|tenant_admin>

import "dotenv/config";
import { createTenantUser } from "../src/auth/users.js";
import { closePools } from "../src/db/pool.js";

const [, , tenantId, email, name, password, role] = process.argv;
if (!tenantId || !email || !name || !password || (role !== "pm" && role !== "tenant_admin")) {
  console.error(
    "Usage: node scripts/add-user.js <tenantId> <email> <name> <password> <pm|tenant_admin>\n" +
      'Example: node scripts/add-user.js 913f0f88-... dave@rhxutah.com Dave a-real-password pm'
  );
  process.exit(1);
}

createTenantUser(tenantId, { email, name, password, role })
  .then((user) => {
    console.log("Created user:", user);
    console.log("\nKeep this user id for PM_MANAGER_MAP if you're migrating historical leads:");
    console.log(user.id);
  })
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closePools());
