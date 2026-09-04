#!/usr/bin/env node
// One-off bootstrap: create the first (or another) platform_admin account. There's no
// API route for this deliberately -- only an operator running this script directly
// against the database should ever be able to mint a Lead Hammer platform admin.
//
// Usage: node scripts/create-platform-admin.js <email> <name> <password>

import "dotenv/config";
import { createPlatformAdmin } from "../src/auth/users.js";
import { closePools } from "../src/db/pool.js";

const [, , email, name, password] = process.argv;
if (!email || !name || !password) {
  console.error("Usage: node scripts/create-platform-admin.js <email> <name> <password>");
  process.exit(1);
}

createPlatformAdmin({ email, name, password })
  .then((user) => {
    console.log("Created platform admin:", user);
  })
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closePools());
