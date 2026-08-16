import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { listBackups, restoreBackup } from "../backupService.js";

const router = Router();

router.get("/", requireAuth("manageSettings"), (req, res) => {
  res.json({ backups: listBackups() });
});

router.post("/:filename/restore", requireAuth("manageSettings"), (req, res) => {
  try {
    const result = restoreBackup(req.params.filename);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
