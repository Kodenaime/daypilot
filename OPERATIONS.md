# DayPilot Operations & Architecture Manual

This document outlines key operational procedures, configurations, and design trade-offs for the DayPilot backend service.

---

## 1. Key Rotation Procedure (`TOKEN_ENCRYPTION_KEY`)

The `TOKEN_ENCRYPTION_KEY` is a 32-byte secret used to encrypt/decrypt Google Calendar OAuth tokens stored in the database. If this key is compromised or needs to be rotated, follow these steps:

1. **Update the Key**: Generate a new 32-byte (256-bit) cryptographically secure key and update the `TOKEN_ENCRYPTION_KEY` environment variable in Railway.
2. **Invalidate Stored Credentials**: Since credentials encrypted with the old key cannot be decrypted by the new key, all historical tokens must be deleted. Run the following SQL query on the PostgreSQL database:
   ```sql
   TRUNCATE TABLE google_accounts CASCADE;
   ```
3. **User Action**: The next time a user opens the mobile application or performs actions requiring calendar access, their connection state will show "Disconnected" or "Reconnection Required". They will need to tap the Google Reconnect button to re-authorize via Google OAuth, which will save a freshly encrypted set of tokens using the rotated key.

---

## 2. Process Restart-on-Crash Policy (Railway)

To handle catastrophic failures, memory leaks, or uncaught process-level exceptions, DayPilot depends on Railway's native process lifecycle manager:

* **Automatic Restart**: Railway's default restart policy is **always active**. If the backend Node.js process crashes or exits with a non-zero exit code (such as `1`), Railway automatically provisions a new container instance and restarts the server immediately.
* **Graceful Logging on Crash**: Inside `src/index.ts`, top-level process event listeners intercept `uncaughtException` and `unhandledRejection`. Before the process exits, it outputs a structured JSON log containing the error type, message, and call stack, allowing quick debugging via Railway's log console.

---

## 3. Background Job Architectural Trade-offs

* **In-Process Worker Coupling**: All BullMQ background queues (Google Calendar synchronization, Daily Briefing calculations, template-based instance generation, and push/email notification dispatches) run in-process on the same Node.js/Express application container.
* **Risk & Mitigations**:
  * *Degradation Risk*: A CPU-intensive background job or a hung external network call could block the Event Loop, causing API responsiveness to degrade for other client routes.
  * *Mitigation*: Defensive network timeout wrappers (`withTimeout` limiting external requests to 8 seconds) are configured on external service requests (Firebase, Resend API, Google APIs).
  * *Trade-off*: Running queues in-process simplifies V1 deployment and hosting costs at a solo-user scale. A full microservice isolation (separating API routers and background workers into independent services) was rejected as disproportionate engineering overhead.
