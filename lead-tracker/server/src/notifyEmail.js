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
