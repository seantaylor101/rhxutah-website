// Claude marks up one house photo: every wall it can see (corners at the
// base and at the eaves, the gable peak, what it's clad in) plus each
// window and door. It only *finds* things in pixel coordinates — all
// measuring happens in shared/facadeGeometry.js, from those points plus
// the satellite wall widths.
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { createHash } from "node:crypto";

export const VISION_MODEL = "claude-opus-5-5";
// bump when the prompt or schema changes, so cached markups get redone
export const PROMPT_VERSION = "v1";
// Claude Opus 5.5 reads images up to 2576 px on the long edge at full
// detail, with coordinates 1:1 to the pixels it was sent
const MAX_EDGE = 2576;
// list prices for Claude Opus 5.5, $ per million tokens — only used to show
// roughly what a report cost
const PRICE_IN = 4;
const PRICE_OUT = 20;
const PRICE_CACHE_READ = 0.2;

export function anthropicConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const point = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
  additionalProperties: false,
};
const MATERIALS = ["siding", "stucco", "brick", "stone", "other"];

function markupSchema(wallIds) {
  return {
    type: "object",
    properties: {
      usable: { type: "boolean" },
      notes: { type: "string" },
      faces: {
        type: "array",
        items: {
          type: "object",
          properties: {
            wallId: { type: "string", enum: [...wallIds, "unknown"] },
            leftIsCorner: { type: "boolean" },
            rightIsCorner: { type: "boolean" },
            baseVisible: { type: "boolean" },
            corners: {
              type: "object",
              properties: { baseLeft: point, baseRight: point, topLeft: point, topRight: point },
              required: ["baseLeft", "baseRight", "topLeft", "topRight"],
              additionalProperties: false,
            },
            peakVisible: { type: "boolean" },
            peak: point,
            material: { type: "string", enum: MATERIALS },
            materialRegions: {
              type: "array",
              items: {
                type: "object",
                properties: { material: { type: "string", enum: MATERIALS }, polygon: { type: "array", items: point } },
                required: ["material", "polygon"],
                additionalProperties: false,
              },
            },
            openings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["window", "door", "garage_door", "other"] },
                  arched: { type: "boolean" },
                  corners: { type: "array", items: point },
                },
                required: ["type", "arched", "corners"],
                additionalProperties: false,
              },
            },
          },
          required: [
            "wallId",
            "leftIsCorner",
            "rightIsCorner",
            "baseVisible",
            "corners",
            "peakVisible",
            "peak",
            "material",
            "materialRegions",
            "openings",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["usable", "notes", "faces"],
    additionalProperties: false,
  };
}

const SYSTEM = `You mark up photos of house exteriors so the walls can be measured. You never estimate sizes yourself; you only point at things, in pixel coordinates of the image you are given (origin at the top-left, x to the right, y down). Precision matters: every pixel of error in a corner becomes inches in the measurement, so place points exactly on the feature.

For every wall face you can see in the photo, from the list of walls you are given:
- Match it to a wall ID. You are told which side of the house each wall is on, its width, and the order walls appear left to right when you stand outside facing that side. Use only walls you can actually see; walls hidden behind others or around a corner are skipped. A face you can't match goes in as "unknown".
- corners: the four corners of the wall's rectangle, up to the eaves. baseLeft / baseRight are where the wall's cladding meets the foundation or the ground, at the wall's left and right ends as you face it. topLeft / topRight are where the wall meets the underside of the eave or soffit at those ends; for a gable end, that is where the sloped rake starts, at eave height. Use the wall's real outside corners, not the edge of the photo.
- leftIsCorner / rightIsCorner: true only if that end of the wall is actually visible as a corner of the building in the photo. If the wall runs out of the frame or behind something on that side, set it false and put that corner at the last visible point.
- baseVisible: false when bushes, an AC unit, a fence, snow or anything else hides the bottom of the wall along most of its length. Then extend the base line where it would be: the base is level, so carry it from the stretches you can see (often at a corner or behind a gap in the bushes).
- peakVisible / peak: on a gable end, the top point of the triangle of wall under the roof's peak. Set peakVisible false (peak at 0,0) if there is no gable or it's cut off.
- material: what most of the face is clad in. siding = any lap, panel, board-and-batten, shake or metal siding (vinyl, fiber cement, wood, LP); stucco includes EIFS; stone includes manufactured stone veneer.
- materialRegions: areas of the face clad in something other than the main material, each as a polygon (e.g. a brick wainscot along the bottom, a stone column, stucco above a brick first floor). Leave empty if the face is all one material.
- openings: every window, door, garage door and other cut-out in that face, as 4 corners in the order top-left, top-right, bottom-right, bottom-left, on the outer edge of the trim or casing. For an arched window, use its bounding rectangle and set arched true. Include openings on this face only.

usable: false if the photo doesn't show the house well enough to mark anything (blurry, wrong subject, mostly blocked). notes: one or two short sentences on anything that limits the markup.`;

// walls on the given sides, in the order they appear left → right when
// standing outside facing that side, with how far each is set back
export function wallListText(model, sides) {
  const lines = [];
  for (const side of sides) {
    const ws = model.walls.filter((w) => w.side === side);
    if (!ws.length) continue;
    const n = ws[0].normalAz;
    const out = [Math.sin((n * Math.PI) / 180), Math.cos((n * Math.PI) / 180)];
    // standing outside looking at the wall you face az n+180, so your right
    // hand points 90° clockwise of that: az n+270 (= n-90)
    const rightAz = n - 90;
    const right = [Math.sin((rightAz * Math.PI) / 180), Math.cos((rightAz * Math.PI) / 180)];
    const depth = (w) => w.mid[0] * out[0] + w.mid[1] * out[1];
    const maxDepth = Math.max(...ws.map(depth));
    const sorted = ws.slice().sort((a, b) => a.mid[0] * right[0] + a.mid[1] * right[1] - (b.mid[0] * right[0] + b.mid[1] * right[1]));
    lines.push(`${side.toUpperCase()} side, left to right as you face it from outside:`);
    for (const w of sorted) {
      const ft = w.lengthM * 3.28084;
      const back = (maxDepth - depth(w)) * 3.28084;
      const bits = [`${ft.toFixed(1)} ft wide`];
      if (back > 1.5) bits.push(`set back ${back.toFixed(0)} ft from the frontmost wall on this side`);
      if (w.roofEdge === "gable") bits.push("probably a gable end");
      if (w.roofEdge === "eave") bits.push("probably under an eave");
      lines.push(`  ${w.id}: ${bits.join(", ")}`);
    }
  }
  return lines.join("\n");
}

const SIDES = ["front", "right", "back", "left"];

export function visionContext(model, photo, slot) {
  let sides;
  let shot;
  if (slot && slot.kind === "side") {
    sides = slot.sides;
    shot = `the guided "${slot.label}" shot, taken from in front of the middle of that side`;
  } else if (slot && slot.kind === "corner") {
    sides = slot.sides;
    shot = `the guided "${slot.label}" shot, taken off that outside corner so both sides show at an angle`;
  } else {
    const assigned = model.walls.find((w) => w.id === photo.wallId);
    sides = assigned ? [assigned.side, ...SIDES.filter((s) => s !== assigned.side)] : SIDES;
    shot = assigned ? `an extra photo, most likely of ${assigned.id} (${assigned.label})` : "an extra photo of unknown direction";
  }
  return { sides, text: `This photo is ${shot}.\n\nWalls you may see:\n${wallListText(model, sides)}` };
}

export async function prepareImage(filePath) {
  const { data, info } = await sharp(filePath)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  return { base64: data.toString("base64"), width: info.width, height: info.height };
}

export function cacheKey(contextText, wallIds) {
  return createHash("sha256").update(`${PROMPT_VERSION}\n${VISION_MODEL}\n${wallIds.join(",")}\n${contextText}`).digest("hex").slice(0, 32);
}

function costOf(usage) {
  if (!usage) return 0;
  return (
    ((usage.input_tokens || 0) * PRICE_IN +
      (usage.cache_creation_input_tokens || 0) * PRICE_IN * 1.25 +
      (usage.cache_read_input_tokens || 0) * PRICE_CACHE_READ +
      (usage.output_tokens || 0) * PRICE_OUT) /
    1e6
  );
}

// One photo → markup. Throws on API failure; returns { usable: false } on a
// refusal or an unparseable answer so one bad photo doesn't sink a report.
export async function markUpPhoto({ image, contextText, wallIds }) {
  const response = await getClient().beta.messages.create({
    model: VISION_MODEL,
    max_tokens: 16000,
    // pointing precisely at corners is where the extra thinking pays
    output_config: { effort: "high", format: { type: "json_schema", schema: markupSchema(wallIds) } },
    // if a safety classifier ever misfires on a house photo, retry on the
    // model Anthropic recommends instead of failing the photo
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.base64 } },
          { type: "text", text: `Image size: ${image.width} × ${image.height} px.\n\n${contextText}` },
        ],
      },
    ],
  });
  const cost = costOf(response.usage);
  if (response.stop_reason === "refusal") return { usable: false, notes: "Declined by the model", faces: [], cost };
  if (response.stop_reason === "max_tokens") return { usable: false, notes: "Answer was cut off", faces: [], cost };
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    const parsed = JSON.parse(text);
    return { usable: !!parsed.usable, notes: String(parsed.notes || ""), faces: Array.isArray(parsed.faces) ? parsed.faces : [], cost, model: response.model };
  } catch {
    return { usable: false, notes: "Unreadable answer", faces: [], cost };
  }
}
