// Builds a one-off PDF for a single sub/PM: just what they need to do the
// job (customer, address, their agreed amount, their own instructions) plus
// every job reference photo — nothing about other payees or other jobs.
import PDFDocument from "pdfkit";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { JOB_MEDIA_DIR } from "./uploads.js";

const MAX_IMAGE_DIM = 1400;
const PHOTO_BOX = [480, 360];

// photos can be jpg/png/webp/heic — pdfkit only embeds jpeg/png, so every
// photo gets normalized to jpeg here. A photo that fails to convert (a
// corrupt file, or HEIC decoding unsupported in this environment) is just
// skipped rather than failing the whole PDF.
async function toEmbeddableJpeg(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return await sharp(absPath)
      .rotate()
      .resize({ width: MAX_IMAGE_DIM, height: MAX_IMAGE_DIM, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}

function row(doc, label, value) {
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(label, { continued: true });
  doc.font("Helvetica").fontSize(11).text(` ${value || "—"}`);
}

export async function buildPayeePdf({ lead, payee, media }) {
  const doc = new PDFDocument({ margin: 50, autoFirstPage: true });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#000").text(lead.name || "Job");
  doc.font("Helvetica").fontSize(11).fillColor("#666").text(`Prepared for ${payee.name}`);
  doc.moveDown(1);

  row(doc, "Customer:", lead.name);
  row(doc, "Address:", lead.address);
  row(doc, "Agreed amount:", `$${Number(payee.agreedAmount || 0).toFixed(2)}`);
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text("Instructions");
  doc.moveDown(0.3);
  doc
    .font("Helvetica")
    .fontSize(11)
    .text(payee.instructions || "No specific instructions written for this job yet.");
  doc.moveDown(1);

  const photos = (media || []).filter((m) => m.kind === "image");
  if (photos.length) {
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text("Photos");
    doc.moveDown(0.3);
    for (const photo of photos) {
      const filename = (photo.filename || photo.url || "").split("/").pop();
      if (!filename) continue;
      const buf = await toEmbeddableJpeg(path.join(JOB_MEDIA_DIR, filename));
      if (!buf) continue;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;
      if (doc.y + PHOTO_BOX[1] > bottomLimit) doc.addPage();
      doc.image(buf, doc.x, doc.y, { fit: PHOTO_BOX });
      doc.y += PHOTO_BOX[1] + 12;
    }
  }

  doc.end();
  return done;
}
