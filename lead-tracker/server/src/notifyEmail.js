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
    `Open the job board: ${process.env.APP_URL || "https://rhxutah-website.onrender.com"}`,
  ].filter((l) => l !== null);

  const body = new URLSearchParams({
    access_key: accessKey,
    subject: `New lead: ${lead.name}`,
    from_name: "RHX Job Board",
    message: lines.join("\n"),
  });

  await fetch(WEB3FORMS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
}

// Same Web3Forms key, reused for a once-a-day off-site copy of the leads
// snapshot. File attachments are a paid Web3Forms feature, so the JSON is
// embedded as plain text between clear markers instead — anyone (or any
// script) reading the email can find and parse it back out.
export async function sendBackupSnapshotEmail(snapshot) {
  const accessKey = process.env.WEB3FORMS_ACCESS_KEY;
  if (!accessKey) return;

  const leadCount = snapshot.leads.length;
  const dateLabel = snapshot.takenAt.slice(0, 10);

  const lines = [
    `Daily backup of your RHX Job Board leads — ${leadCount} lead${leadCount === 1 ? "" : "s"}.`,
    ``,
    `Snapshot taken: ${snapshot.takenAt}`,
    ``,
    `Keep this email. It's a full point-in-time copy of every lead and where it stood`,
    `in your pipeline. The raw data is below between the BEGIN/END markers.`,
    ``,
    `---BEGIN RHX BACKUP JSON---`,
    JSON.stringify(snapshot),
    `---END RHX BACKUP JSON---`,
  ];

  const body = new URLSearchParams({
    access_key: accessKey,
    subject: `RHX Job Board backup — ${leadCount} lead${leadCount === 1 ? "" : "s"} — ${dateLabel}`,
    from_name: "RHX Job Board",
    message: lines.join("\n"),
  });

  await fetch(WEB3FORMS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
}
