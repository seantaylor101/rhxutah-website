import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRoutes from "./routes/auth.js";
import leadsRoutes from "./routes/leads.js";
import pushRoutes from "./routes/push.js";
import publicRoutes from "./routes/public.js";
import notificationsRoutes from "./routes/notifications.js";
import settingsRoutes from "./routes/settings.js";
import goalsRoutes from "./routes/goals.js";
import warrantyRoutes from "./routes/warranty.js";
import calendarRoutes from "./routes/calendar.js";
import activityRoutes from "./routes/activity.js";
import contactsRoutes from "./routes/contacts.js";
import usersRoutes from "./routes/users.js";
import platformRoutes from "./routes/platform.js";
import { startReportReminderScheduler } from "./reportReminders.js";
import { startGoalReminderScheduler } from "./goalReminders.js";
import { startAppointmentReminderScheduler } from "./appointmentReminders.js";
import { startAppointmentDigestScheduler } from "./appointmentDigest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Render sits behind a proxy — needed so req.ip reflects the real visitor,
// not the proxy, for the public intake endpoint's rate limiting.
app.set("trust proxy", true);

app.use(express.json());
app.use(cookieParser());

const ALLOWED_PUBLIC_ORIGINS = new Set(["https://rhxutah.com", "https://www.rhxutah.com"]);
const publicCors = cors({
  origin(origin, callback) {
    callback(null, !origin || ALLOWED_PUBLIC_ORIGINS.has(origin));
  },
});

app.use("/api/auth", authRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/goals", goalsRoutes);
app.use("/api/warranty", warrantyRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/contacts", contactsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/platform", platformRoutes);
app.use("/api/public", publicCors, publicRoutes);

const clientDist = path.join(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(clientDist, "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Lead Hammer listening on port ${port}`));

startReportReminderScheduler();
startGoalReminderScheduler();
startAppointmentReminderScheduler();
startAppointmentDigestScheduler();
