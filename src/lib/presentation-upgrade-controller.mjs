// Presentation Upgrade Controller (P5) — the operation-state machine behind the
// admin route. It exists so the async read/upgrade flow has ONE authoritative
// session identity that the React component (and the tests) drive through a
// state sink, instead of scattering race guards across event handlers.
//
// Why: file.text() and the upgrade are async. Without an identity guard, an
// earlier read/upgrade can resolve AFTER the admin selected another file or hit
// Clear and overwrite the newer session with stale inspection/report/download/
// error/toast/loading state. This controller captures a monotonic session token
// at the start of every operation and re-checks it AFTER EVERY await before
// touching the sink — disabling controls is not relied upon. A stale `finally`
// can never clear a newer operation's loading flag.
//
// Pure (no DOM, no React, no network): the async dependencies (readFile,
// runUpgrade) and the side-effect sink are injected, so the exact race windows
// are exercised under the pure-Node test runner with deferred promises.

import {
  classifyUpload,
  inspectPresentationHtml,
} from "./presentation-upgrade-session.mjs";

// Cleared/initial state for a brand-new (or cleared) session.
function blankState() {
  return {
    fileName: null,
    fileSize: null,
    inspection: null,
    report: null,
    download: null,
    error: null,
    reading: false,
    upgrading: false,
    html: null,
  };
}

/**
 * Build an upgrade controller.
 *
 * @param deps.checkSize  (size:number) => { ok:boolean, message:string } — the
 *                        dedicated HTML byte-limit check, run BEFORE readFile.
 * @param deps.readFile   (file) => Promise<string> — reads the file as text
 *                        (the route passes `(f) => f.text()`).
 * @param deps.runUpgrade (args) => Promise<UpgradeSessionResult> — the engine
 *                        orchestrator (the route passes `runUpgradeSession`).
 * @param deps.sink       { setState(partial), toastSuccess(msg), toastError(msg) }
 */
function createUpgradeController({ checkSize, readFile, runUpgrade, sink }) {
  let session = 0;
  const isCurrent = (token) => token === session;
  // Apply a side effect only if its operation is still the current session.
  const commit = (token, fn) => {
    if (isCurrent(token)) fn();
  };

  // Select (read + inspect) a file. Bumps the session so any in-flight read or
  // upgrade from a previous selection is invalidated and cannot write back.
  async function select(file) {
    const token = ++session;
    // Synchronous reset for the new selection (already the current token).
    sink.setState({
      ...blankState(),
      fileName: file && typeof file.name === "string" ? file.name : null,
      fileSize: file && typeof file.size === "number" ? file.size : null,
    });

    const cls = classifyUpload({ name: file && file.name, type: file && file.type });
    if (!cls.accepted) {
      commit(token, () => sink.setState({ error: cls.message }));
      return;
    }

    // Enforce the dedicated byte ceiling BEFORE reading the file into memory.
    const sized = checkSize(file && typeof file.size === "number" ? file.size : 0);
    if (!sized.ok) {
      commit(token, () => sink.setState({ error: sized.message }));
      return;
    }

    commit(token, () => sink.setState({ reading: true }));
    try {
      const text = await readFile(file);
      if (!isCurrent(token)) return; // stale read — a newer file/clear won
      sink.setState({ html: text, inspection: inspectPresentationHtml(text) });
    } catch {
      if (!isCurrent(token)) return;
      sink.setState({ html: null, error: "Could not read this file as text." });
    } finally {
      // A stale finally must not clear a newer operation's loading flag.
      commit(token, () => sink.setState({ reading: false }));
    }
  }

  // Clear the session. Bumps the token so every pending read/upgrade is
  // invalidated, then emits the blank state.
  function clear() {
    session += 1;
    sink.setState(blankState());
  }

  // Upgrade the currently selected file. Captures the exact session + bytes
  // being upgraded; a newer selection or Clear invalidates the result.
  async function upgrade({ html, filename, getRuntimeSources }) {
    if (typeof html !== "string") return;
    const token = session; // the file/session being upgraded
    commit(token, () => sink.setState({ upgrading: true, report: null, download: null, error: null }));
    try {
      const runtimeSources = getRuntimeSources();
      const result = await runUpgrade({ filename: filename ?? null, html, runtimeSources });
      if (!isCurrent(token)) return; // stale upgrade — discard report/download/toast
      sink.setState({ report: result.report, download: result.download });
      if (result.downloadable) {
        sink.toastSuccess("Upgrade validated — ready to download.");
      } else {
        sink.setState({ error: result.error });
        sink.toastError(result.error ?? "Upgrade could not be completed.");
      }
    } catch (err) {
      if (!isCurrent(token)) return;
      const message = err && err.message ? String(err.message) : "Upgrade failed unexpectedly.";
      sink.setState({ error: message });
      sink.toastError("Upgrade failed unexpectedly.");
    } finally {
      commit(token, () => sink.setState({ upgrading: false }));
    }
  }

  return {
    select,
    clear,
    upgrade,
    // Test/diagnostic only: the current session token.
    currentSession: () => session,
  };
}

export { createUpgradeController };
