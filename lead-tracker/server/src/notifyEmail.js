const WEB3FORMS_URL = "https://api.web3forms.com/submit";

// Reuses the same Web3Forms access key already embedded in the site's own
// contact/quote forms, so the backup email lands wherever those already go —
// no separate email service or credentials needed.
export async function sendBackupEmail(lead) {
  const accessKey = process.env.WEB3FORMS_ACCESS_KEY;
  if (!accessKey) return;

  const lines = [
    `New lead came in from the website.`,
    ``,
    `Name: ${lead.name}`,
    lead.job ? `Job: ${lead.job}` : null,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.email ? `Email: ${lead.email}` : null,
    ``,
    `Open Lead Hammer: ${process.env.APP_URL || "https://rhxutah-website.onrender.com"}`,
  ].filter((l) => l !== null);

  const body = new URLSearchParams({
    access_key: accessKey,
    subject: `New lead: ${lead.name}`,
    from_name: "Lead Hammer",
    message: lines.join("\n"),
  });

  await fetch(WEB3FORMS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
}

// The old whole-database JSON-snapshot email backup (sendBackupSnapshotEmail) is gone:
// it dumped the entire (single-tenant) leads table, which doesn't make sense once
// several tenants share one Postgres database. Point-in-time recovery is now the
// hosting platform's job (Render's managed Postgres backups / pg_dump), not the app's.
