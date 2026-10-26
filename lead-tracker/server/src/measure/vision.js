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
export const PROMPT_VERSION = "v2";
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

Houses often have more than one level: a one-story garage or wing in front, with a second story rising above and behind its roof. You are given a list of the walls, including which are one story, which are two stories from the ground, and which are UPPER walls that start on top of a lower roof. Treat each as its own face.

For every wall face you can see in the photo, from the list of walls you are given:
- Match it to a wall ID. You are told which side of the house each wall is on, its width, its level, and the order walls appear left to right when you stand outside facing that side. Use only walls you can actually see; walls hidden behind others or around a corner are skipped. A face you can't match goes in as "unknown".
- corners: the four corners of the wall's rectangle. baseLeft / baseRight: for a wall that stands on the ground, where its cladding meets the foundation or ground; for an UPPER wall, where it meets the lower roof in front of it (not the ground). topLeft / topRight: where the wall meets the underside of its eave or soffit; on a gable end, where the sloped rake starts, at eave height. Use the wall's real ends, not the edge of the photo.
- leftIsCorner / rightIsCorner: true only if that end of the wall is actually visible as a corner of the building in the photo. If the wall runs out of the frame or behind something on that side, set it false and put that corner at the last visible point.
- baseVisible: false when bushes, an AC unit, a fence, a car, snow or anything else hides the bottom of the wall along most of its length. Then extend the base line where it would be: the base is level, so carry it from the stretches you can see (often at a corner or behind a gap).
- peakVisible / peak: on a gable end, the top point of the triangle of wall under the roof's peak. Set peakVisible false (peak at 0,0) if there is no gable or it's cut off.
- material: what most of the face is clad in. siding = any lap, panel, board-and-batten, shake or metal siding (vinyl, fiber cement, wood, LP); stucco includes EIFS; stone includes manufactured stone veneer.
- materialRegions: areas of the face clad in something other than the main material, each as a polygon (e.g. a brick wainscot along the bottom, a stone column, stucco around a bay). Leave empty if the face is all one material.
- openings: every opening in that face, as 4 corners in the order top-left, top-right, bottom-right, bottom-left, on the outer edge of the trim or casing.
  - garage_door: the large overhead door; it always sits at the base of a wall that stands on the ground. Never miss it.
  - door: entry doors (with any sidelights and transom as one opening), patio, French and sliding doors. Their bottom is at or near the base, maybe a few steps up.
  - window: every separately framed window unit, including small ones and a half-round window above another window (mark that one on its own, with arched true). For an arched window use its bounding rectangle.
  - other: any other cut-out in the cladding, such as a pass-through.
  Do not mark vents, light fixtures, address numbers, shutters, satellite dishes, downspouts or anything on the roof. Mark each opening on the one face it is in.

usable: false if the photo doesn't show the house well enough to mark anything (blurry, wrong subject, mostly blocked). notes: one or two short sentences on anything that limits the markup.`;

const ZOOM_SYSTEM = `${SYSTEM}

This image is a zoomed-in crop of one wall from a larger photo, enlarged so you can place points more precisely. Mark only the wall you are told about, using pixel coordinates of this crop. Parts of the wall may run past the crop's edge only if they did in the original photo; otherwise its corners are inside the crop.`;

// walls on the given sides, in the order they appear left → right when
// standing outside facing that side, with level and how far each is set back
export function wallListText(model, sides) {
  const lines = [];
  const levelText = (w) => {
    if (w.tier === "upper") {
      const back = w.setbackM != null ? ` about ${(w.setbackM * 3.28084).toFixed(0)} ft behind the wall below it` : "";
      return `UPPER-story wall, set back${back}; it starts on top of the lower roof — mark its base where it meets that roof`;
    }
    if (w.stories === 2) return "two stories, from the ground up to the main roof's eave";
    if (w.stories === 1) return "one story, from the ground up to the lower roof's eave";
    return null;
  };
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
    const ground = ws.filter((w) => w.tier !== "upper");
    const maxDepth = Math.max(...(ground.length ? ground : ws).map(depth));
    const order = (a, b) => a.mid[0] * right[0] + a.mid[1] * right[1] - (b.mid[0] * right[0] + b.mid[1] * right[1]);
    lines.push(`${side.toUpperCase()} side, left to right as you face it from outside:`);
    for (const w of [...ground.sort(order), ...ws.filter((x) => x.tier === "upper").sort(order)]) {
      const ft = w.lengthM * 3.28084;
      const bits = [`${ft.toFixed(1)} ft wide`];
      const lv = levelText(w);
      if (lv) bits.push(lv);
      if (w.tier !== "upper") {
        const back = (maxDepth - depth(w)) * 3.28084;
        if (back > 1.5) bits.push(`set back ${back.toFixed(0)} ft from the frontmost wall on this side`);
      }
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

// Zoomed pass for one wall: crop that wall out of the stored photo (with a
// margin), enlarge it, and have Claude re-mark just that wall. A wall that
// fills a small part of a photo gets far more of the model's attention this
// way. Returns the face in the *original* markup image's coordinates, or null.
export async function zoomCrop(filePath, markupImage, face) {
  const meta = await sharp(filePath).rotate().metadata();
  const W = meta.autoOrient?.width || meta.width;
  const H = meta.autoOrient?.height || meta.height;
  const s = W / markupImage.width; // stored px per markup px
  const pts = [face.corners.baseLeft, face.corners.baseRight, face.corners.topLeft, face.corners.topRight, ...(face.peakVisible ? [face.peak] : [])];
  const xs = pts.map((p) => p.x * s);
  const ys = pts.map((p) => p.y * s);
  const mx = (Math.max(...xs) - Math.min(...xs)) * 0.1 + 20;
  const my = (Math.max(...ys) - Math.min(...ys)) * 0.1 + 20;
  const left = Math.max(0, Math.floor(Math.min(...xs) - mx));
  const top = Math.max(0, Math.floor(Math.min(...ys) - my));
  const right = Math.min(W, Math.ceil(Math.max(...xs) + mx));
  const bottom = Math.min(H, Math.ceil(Math.max(...ys) + my));
  const cw = right - left;
  const ch = bottom - top;
  if (cw < 40 || ch < 40) return null;
  // worth it only when the wall is a modest part of the frame
  if (cw * ch > 0.6 * W * H) return null;
  const up = Math.min(2, MAX_EDGE / Math.max(cw, ch));
  const { data, info } = await sharp(filePath)
    .rotate()
    .extract({ left, top, width: cw, height: ch })
    .resize({ width: Math.round(cw * up), height: Math.round(ch * up) })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  return {
    image: { base64: data.toString("base64"), width: info.width, height: info.height },
    // crop px → original markup px
    back: (p) => ({ x: (p.x / up + left) / s, y: (p.y / up + top) / s }),
  };
}

export function mapFaceBack(face, back) {
  const pt = (p) => (p ? back(p) : p);
  return {
    ...face,
    corners: Object.fromEntries(Object.entries(face.corners || {}).map(([k, v]) => [k, pt(v)])),
    peak: face.peakVisible ? pt(face.peak) : face.peak,
    materialRegions: (face.materialRegions || []).map((r) => ({ ...r, polygon: (r.polygon || []).map(pt) })),
    openings: (face.openings || []).map((o) => ({ ...o, corners: (o.corners || []).map(pt) })),
  };
}

// One photo → markup. Throws on API failure; returns { usable: false } on a
// refusal or an unparseable answer so one bad photo doesn't sink a report.
export async function markUpPhoto({ image, contextText, wallIds, zoom = false }) {
  const response = await getClient().beta.messages.create({
    model: VISION_MODEL,
    max_tokens: 16000,
    // pointing precisely at corners is where the extra thinking pays
    output_config: { effort: "high", format: { type: "json_schema", schema: markupSchema(wallIds) } },
    // if a safety classifier ever misfires on a house photo, retry on the
    // model Anthropic recommends instead of failing the photo
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: zoom ? ZOOM_SYSTEM : SYSTEM,
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
