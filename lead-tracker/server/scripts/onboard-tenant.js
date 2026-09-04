#!/usr/bin/env node
// One-off bootstrap: create a tenant + its first tenant_admin directly against the
// database, without needing the new (Postgres-backed) app code deployed yet. This lets
// production cutover happen in the safer order: get the tenant, its admin, its PMs
// (via createTenantUser, or just note their info and add them with the Team screen once
// the new code is live), and the migrated historical data all set up and verified
// against production Postgres BEFORE the live site's code ever changes -- so the actual
// deploy is a clean code swap onto already-correct data, not a race to finish setup
// before anyone hits a broken login page.
//
// Usage: node scripts/onboard-tenant.js <tenantName> <slug> <timezone> <adminEmail> <adminName> <password>

import "dotenv/config";
import { createTenantWithAdmin } from "../src/auth/users.js";
import { closePools } from "../src/db/pool.js";

const [, , tenantName, slug, timezone, adminEmail, adminName, password] = process.argv;
if (!tenantName || !slug || !timezone || !adminEmail || !adminName || !password) {
  console.error(
    "Usage: node scripts/onboard-tenant.js <tenantName> <slug> <timezone> <adminEmail> <adminName> <password>\n" +
      'Example: node scripts/onboard-tenant.js "RHX Utah" rhx-utah America/Denver sean@rhxutah.com Sean a-real-password'
  );
  process.exit(1);
}

createTenantWithAdmin({ tenantName, slug, timezone, adminEmail, adminName, password })
  .then((result) => {
    console.log("Created tenant:", result);
    console.log("\nKeep this tenant id -- you'll need it for PUBLIC_INTAKE_TENANT_ID and for the SQLite migration script:");
    console.log(result.tenantId);
  })
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closePools());
