const APP_VERSION = "production-prep-v1";
const AUTH_KEY = "notaryJournalPrototype.auth.v1";
const SESSION_KEY = "notaryJournalPrototype.session.v1";
const STORAGE_PREFIX = "notaryJournalPrototype.user.";
const STORAGE_KEY = "notaryJournalPrototype.v3";
const LEGACY_KEYS = ["notaryJournalPrototype.v2", "notaryJournalPrototype.v1"];
const VALID_LICENSE_KEYS = ["NOTARY-FOUNDERS-2026", "LOCAL-TEST-UNLOCK"];

const app = document.querySelector("#app");
const nextEntryNumber = document.querySelector("#nextEntryNumber");
const notaryIdentity = document.querySelector("#notaryIdentity");
const offlineStatus = document.querySelector("#offlineStatus");
const pwaStatus = document.querySelector("#pwaStatus");
const ipadModeToggle = document.querySelector("#ipadModeToggle");
const signatureModal = document.querySelector("#signatureModal");
const signatureTitle = document.querySelector("#signatureTitle");
const signatureCanvas = document.querySelector("#signaturePad");
const signatureCtx = signatureCanvas.getContext("2d");
const restoreFileInput = document.querySelector("#restoreFileInput");

const steps = [
  "Notarial act",
  "Signer information",
  "ID verification",
  "Fees",
  "Signature",
  "Review and Lock",
];

const participantRoles = {
  signer: "Signer",
  credible_witness: "Credible Witness",
  subscribing_witness: "Subscribing Witness",
};

let auth = loadAuth();
let currentUserEmail = localStorage.getItem(SESSION_KEY) || "";
let state = currentUserEmail ? loadState() : null;
let currentView = currentUserEmail ? "dashboard" : "landing";
let currentStep = 0;
let draft = createDraft();
let selectedEntryId = null;
let integrityStatus = {};
let activeCaptureTarget = null;
let activeCaptureKind = "signature";
let drawing = false;
let activePointerId = null;
let captureDirty = false;

function loadAuth() {
  const saved = localStorage.getItem(AUTH_KEY);
  return saved ? JSON.parse(saved) : { users: {} };
}

function saveAuth() {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function userStorageKey(email = currentUserEmail) {
  return `${STORAGE_PREFIX}${encodeURIComponent(email.toLowerCase())}.journal`;
}

function hasUser() {
  return Boolean(currentUserEmail && auth.users[currentUserEmail.toLowerCase()]);
}

function hasSession() {
  return Boolean(currentUserEmail && state);
}

function isDemoMode() {
  return currentUserEmail === "demo";
}

function loadState() {
  const saved = localStorage.getItem(userStorageKey());
  if (saved) return normalizeState(JSON.parse(saved));

  if (Object.keys(auth.users).length <= 1) {
    const legacy = localStorage.getItem(STORAGE_KEY) || LEGACY_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    if (legacy) {
      const migrated = JSON.parse(legacy);
      migrated.ownerEmail = currentUserEmail;
      migrated.onboardingComplete = Boolean(migrated.settings?.notaryName);
      migrated.license = migrated.license ?? { unlocked: false, licenseKey: "", unlockedAt: "" };
      return normalizeState(migrated);
    }
  }

  return {
    ownerEmail: currentUserEmail,
    appVersion: APP_VERSION,
    onboardingComplete: false,
    license: {
      unlocked: false,
      licenseKey: "",
      unlockedAt: "",
    },
    journal: {
      id: crypto.randomUUID(),
      jurisdiction: "NJ",
      status: "active",
      nextEntryNumber: 1,
      createdAt: new Date().toISOString(),
    },
    settings: {
      notaryName: "",
      commissionNumber: "",
      commissionExpirationDate: "",
      businessName: "",
      defaultFee: "0.00",
      defaultTravelFee: "0.00",
    },
    entries: [],
    corrections: [],
    audit: [],
  };
}

function normalizeState(value) {
  value.ownerEmail = value.ownerEmail ?? currentUserEmail;
  value.appVersion = value.appVersion ?? APP_VERSION;
  value.settings = value.settings ?? {};
  value.settings.notaryName = value.settings.notaryName ?? "";
  value.settings.commissionNumber = value.settings.commissionNumber ?? "";
  value.settings.commissionExpirationDate = value.settings.commissionExpirationDate ?? "";
  value.settings.businessName = value.settings.businessName ?? "";
  value.settings.defaultFee = value.settings.defaultFee ?? "0.00";
  value.settings.defaultTravelFee = value.settings.defaultTravelFee ?? "0.00";
  value.entries = value.entries ?? [];
  value.entries = value.entries.map((entry) => {
    if (entry.participants) {
      entry.participants = entry.participants.map((participant) => ({
        ...participant,
        email: participant.email ?? "",
        city: participant.city ?? "",
        state: participant.state ?? "NJ",
        zip: participant.zip ?? "",
        idMethod: participant.idMethod || "Government ID",
        thumbprintImage: participant.thumbprintImage ?? "",
        thumbprintDigest: participant.thumbprintDigest ?? "",
      }));
      entry.collectThumbprints = entry.collectThumbprints ?? entry.participants.some((participant) => participant.thumbprintImage);
      return entry;
    }
    const signatureImage = entry.signatureImage ?? "";
    return {
      id: entry.id ?? crypto.randomUUID(),
      journalId: entry.journalId ?? value.journal?.id,
      entryNumber: entry.entryNumber,
      notarialActAt: entry.createdAt ?? new Date().toISOString(),
      createdAt: entry.createdAt ?? new Date().toISOString(),
      lockedAt: entry.lockedAt ?? entry.createdAt ?? new Date().toISOString(),
      notarialActType: entry.notarialActType ?? "",
      participants: [
        {
          id: crypto.randomUUID(),
          role: "signer",
          name: entry.signerName ?? "",
          email: "",
          address: entry.signerAddress ?? "",
          city: "",
          state: "NJ",
          zip: "",
          idMethod: entry.idMethod ?? "",
          idType: entry.idType ?? "",
          idIssueDate: entry.idIssueDate ?? "",
          idExpirationDate: entry.idExpirationDate ?? "",
          idDetails: entry.idDetails ?? "",
          signatureImage,
          signatureDigest: entry.signatureDigest ?? "",
          thumbprintImage: "",
          thumbprintDigest: "",
        },
      ],
      feeItems: {
        notarialFee: entry.feeCharged ?? "0.00",
        travelFee: "0.00",
        otherFee: "0.00",
      },
      notes: entry.notes ?? "",
      previousHash: entry.previousHash ?? "GENESIS",
      entryHash: entry.entryHash ?? "",
    };
  });
  value.corrections = value.corrections ?? [];
  value.audit = value.audit ?? [];
  value.onboardingComplete = value.onboardingComplete ?? Boolean(value.settings.notaryName);
  value.license = value.license ?? { unlocked: false, licenseKey: "", unlockedAt: "" };
  return value;
}

function saveState() {
  if (!currentUserEmail || !state) return;
  localStorage.setItem(userStorageKey(), JSON.stringify(state));
}

function createDraft() {
  return {
    notarialActAt: localDateTimeValue(new Date()),
    notarialActType: "",
    participants: [createParticipant("signer")],
    collectThumbprints: false,
    feeItems: {
      notarialFee: state?.settings?.defaultFee ?? "0.00",
      travelFee: state?.settings?.defaultTravelFee ?? "0.00",
      otherFee: "0.00",
    },
    notes: "",
  };
}

function createParticipant(role) {
  return {
    id: crypto.randomUUID(),
    role,
    name: "",
    email: "",
    address: "",
    city: "",
    state: "NJ",
    zip: "",
    idMethod: "Government ID",
    idType: "",
    idIssueDate: "",
    idExpirationDate: "",
    idDetails: "",
    signatureImage: "",
    signatureDigest: "",
    thumbprintImage: "",
    thumbprintDigest: "",
  };
}

function localDateTimeValue(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function displayDate(value) {
  return value ? new Date(value).toLocaleString() : "Not set";
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function totalFees(feeItems) {
  return money(Number(feeItems.notarialFee || 0) + Number(feeItems.travelFee || 0) + Number(feeItems.otherFee || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function roleLabel(role) {
  return participantRoles[role] ?? "Participant";
}

function sortedEntries() {
  return [...state.entries].sort((a, b) => a.entryNumber - b.entryNumber);
}

function setPwaStatus(message, isReady = false) {
  offlineStatus.textContent = message;
  offlineStatus.dataset.ready = String(isReady);
}

function updateNetworkStatus() {
  pwaStatus.textContent = navigator.onLine
    ? "Online. Install from Safari Share, then Add to Home Screen."
    : "Offline mode active. Entries save locally on this device.";
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    setPwaStatus("Offline support unavailable in this browser.");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    setPwaStatus("Offline support ready.", true);
    if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
  } catch {
    setPwaStatus("Offline support needs the HTTPS npm dev server.");
  }
}

function setIpadMode(enabled) {
  document.body.classList.toggle("ipad-mode", enabled);
  ipadModeToggle.textContent = enabled ? "Exit iPad Testing Mode" : "iPad Testing Mode";
  localStorage.setItem("notaryJournalPrototype.ipadMode", String(enabled));
}

function setView(view) {
  currentView = view;
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  render();
}

function canonicalParticipant(participant) {
  return {
    role: participant.role,
    name: participant.name.trim(),
    email: (participant.email ?? "").trim().toLowerCase(),
    address: participant.address.trim(),
    city: (participant.city ?? "").trim(),
    state: (participant.state ?? "").trim(),
    zip: (participant.zip ?? "").trim(),
    idMethod: participant.idMethod,
    idType: participant.idType.trim(),
    idIssueDate: participant.idIssueDate,
    idExpirationDate: participant.idExpirationDate,
    idDetails: participant.idDetails.trim(),
    signatureDigest: participant.signatureDigest,
    thumbprintDigest: participant.thumbprintDigest ?? "",
  };
}

function canonicalEntry(entry, previousHash = entry.previousHash) {
  return JSON.stringify({
    entryNumber: entry.entryNumber,
    notarialActAt: entry.notarialActAt,
    createdAt: entry.createdAt,
    lockedAt: entry.lockedAt,
    notarialActType: entry.notarialActType,
    participants: entry.participants.map(canonicalParticipant),
    collectThumbprints: Boolean(entry.collectThumbprints),
    feeItems: {
      notarialFee: money(entry.feeItems.notarialFee),
      travelFee: money(entry.feeItems.travelFee),
      otherFee: money(entry.feeItems.otherFee),
      total: totalFees(entry.feeItems),
    },
    notes: entry.notes.trim(),
    previousHash,
  });
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createAudit(eventType, message, entryId = null, hashValue = null) {
  const payload = {
    eventType,
    message,
    entryId,
    hashValue,
    createdAt: new Date().toISOString(),
  };
  state.audit.unshift({
    id: crypto.randomUUID(),
    ...payload,
    payloadHash: await sha256(JSON.stringify(payload)),
  });
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateSetting(field, value) {
  state.settings[field] = value;
  saveState();
  renderShell();
}

function updateDraft(field, value) {
  draft[field] = field === "collectThumbprints" ? Boolean(value) : value;
  if (field === "collectThumbprints") render();
}

function updateFee(field, value) {
  draft.feeItems[field] = value;
  const total = document.querySelector("#feeTotal");
  if (total) total.textContent = `$${totalFees(draft.feeItems)}`;
}

function updateParticipant(id, field, value) {
  const participant = draft.participants.find((item) => item.id === id);
  if (!participant) return;
  participant[field] = value;
}

function addParticipant(role) {
  draft.participants.push(createParticipant(role));
  render();
}

function removeParticipant(id) {
  if (draft.participants.filter((item) => item.role === "signer").length === 1) {
    const participant = draft.participants.find((item) => item.id === id);
    if (participant?.role === "signer") {
      alert("At least one signer is required.");
      return;
    }
  }
  draft.participants = draft.participants.filter((item) => item.id !== id);
  render();
}

function validateDraft() {
  const errors = [];
  const warnings = [];
  if (!draft.notarialActAt) errors.push("Date and time of notarial act is required.");
  if (!draft.notarialActType) errors.push("Type of notarial act is required.");

  const signers = draft.participants.filter((participant) => participant.role === "signer");
  if (!signers.length) errors.push("At least one signer is required.");

  draft.participants.forEach((participant, index) => {
    const label = `${roleLabel(participant.role)} ${index + 1}`;
    if ((participant.email ?? "").trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(participant.email.trim())) {
      errors.push(`${label} email must be a valid email address or left blank.`);
    }
    if (!participant.name.trim()) errors.push(`${label} name is required.`);
    if (participant.role === "signer" && !participant.address.trim()) errors.push(`${label} address is required.`);
    if (participant.role === "signer" && !(participant.city ?? "").trim()) errors.push(`${label} city is required.`);
    if (participant.role === "signer" && !(participant.state ?? "").trim()) errors.push(`${label} state is required.`);
    if (participant.role === "signer" && !(participant.zip ?? "").trim()) errors.push(`${label} ZIP code is required.`);
    if (participant.role === "signer" && !participant.idMethod) errors.push(`${label} identity method is required.`);
    if (participant.role === "signer" && !participant.idType.trim()) errors.push(`${label} ID type is required.`);
    if (participant.role === "signer" && !participant.idIssueDate) errors.push(`${label} ID issue date is required.`);
    if (participant.role === "signer" && !participant.idExpirationDate) errors.push(`${label} ID expiration date is required.`);
    if (!participant.idDetails.trim()) errors.push(`${label} ID details are required.`);
    if (!participant.signatureImage) errors.push(`${label} signature is required.`);
    if (draft.collectThumbprints && !participant.thumbprintImage) {
      warnings.push(`${label} thumbprint has not been captured.`);
    }
  });

  return { errors, warnings };
}

async function lockEntry() {
  if (!state.license?.unlocked && state.entries.length >= 1) {
    alert("Purchase Notary Ledger to unlock unlimited entries, encrypted backups, restore/import, and PDF exports.");
    return;
  }

  const { errors, warnings } = validateDraft();
  if (errors.length) {
    alert(errors.join("\n"));
    return;
  }
  if (warnings.length && !confirm(`${warnings.join("\n")}\n\nThumbprints are optional. Continue without missing thumbprints?`)) {
    return;
  }

  const entry = {
    id: crypto.randomUUID(),
    journalId: state.journal.id,
    entryNumber: state.journal.nextEntryNumber,
    notarialActAt: new Date(draft.notarialActAt).toISOString(),
    createdAt: new Date().toISOString(),
    lockedAt: new Date().toISOString(),
    notarialActType: draft.notarialActType,
    collectThumbprints: Boolean(draft.collectThumbprints),
    participants: structuredClone(draft.participants),
    feeItems: structuredClone(draft.feeItems),
    notes: draft.notes,
    previousHash: state.entries.at(-1)?.entryHash ?? "GENESIS",
  };

  for (const participant of entry.participants) {
    participant.signatureDigest = await sha256(participant.signatureImage);
    participant.thumbprintDigest = participant.thumbprintImage ? await sha256(participant.thumbprintImage) : "";
  }

  entry.entryHash = await sha256(canonicalEntry(entry));
  state.entries.push(entry);
  state.journal.nextEntryNumber += 1;
  const participantTrail = entry.participants
    .map((participant) => `${roleLabel(participant.role)}: ${participant.name}${participant.email ? ` <${participant.email}>` : ""}${participant.thumbprintImage ? " + thumbprint" : ""}`)
    .join("; ");
  await createAudit("created_and_locked", `Entry #${entry.entryNumber} created and locked with participants: ${participantTrail}`, entry.id, entry.entryHash);
  saveState();
  draft = createDraft();
  currentStep = 0;
  setView("locked");
}

async function verifyIntegrity() {
  let previousHash = "GENESIS";
  let expectedEntryNumber = 1;
  integrityStatus = {};

  for (const entry of sortedEntries()) {
    if (entry.entryNumber !== expectedEntryNumber) {
      integrityStatus[entry.id] = "Failed: sequence mismatch";
      alert(`Integrity check failed. Entry #${entry.entryNumber} is out of sequence.`);
      await createAudit("integrity_check_failed", `Entry #${entry.entryNumber} is out of sequence`, entry.id, entry.entryHash);
      saveState();
      render();
      return;
    }

    for (const participant of entry.participants) {
      const expectedSignatureDigest = await sha256(participant.signatureImage);
      if (participant.signatureDigest !== expectedSignatureDigest) {
        integrityStatus[entry.id] = "Failed: signature mismatch";
        alert(`Integrity check failed. ${roleLabel(participant.role)} signature changed in entry #${entry.entryNumber}.`);
        await createAudit("integrity_check_failed", `Participant signature mismatch in entry #${entry.entryNumber}`, entry.id, entry.entryHash);
        saveState();
        render();
        return;
      }
      if (participant.thumbprintImage) {
        const expectedThumbprintDigest = await sha256(participant.thumbprintImage);
        if (participant.thumbprintDigest !== expectedThumbprintDigest) {
          integrityStatus[entry.id] = "Failed: thumbprint mismatch";
          alert(`Integrity check failed. ${roleLabel(participant.role)} thumbprint changed in entry #${entry.entryNumber}.`);
          await createAudit("integrity_check_failed", `Participant thumbprint mismatch in entry #${entry.entryNumber}`, entry.id, entry.entryHash);
          saveState();
          render();
          return;
        }
      }
    }

    const expectedHash = await sha256(canonicalEntry(entry, previousHash));
    if (entry.previousHash !== previousHash || entry.entryHash !== expectedHash) {
      integrityStatus[entry.id] = "Failed: hash chain mismatch";
      alert(`Integrity check failed at entry #${entry.entryNumber}.`);
      await createAudit("integrity_check_failed", `Hash chain failed at entry #${entry.entryNumber}`, entry.id, entry.entryHash);
      saveState();
      render();
      return;
    }

    previousHash = entry.entryHash;
    integrityStatus[entry.id] = "Verified";
    expectedEntryNumber += 1;
  }

  alert("Journal integrity verified. Entry numbers, participant signatures, entry hashes, and chained hashes are intact.");
  await createAudit("integrity_check_passed", "Journal integrity verified: sequence, participants, entry hashes, and chained hashes passed");
  saveState();
  render();
}

async function recordCorrection(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;
  const message = prompt(`Add a correction record for entry #${entry.entryNumber}. Locked entries cannot be edited.`);
  if (!message?.trim()) return;

  const correction = {
    id: crypto.randomUUID(),
    entryId,
    entryNumber: entry.entryNumber,
    message: message.trim(),
    createdAt: new Date().toISOString(),
  };
  correction.correctionHash = await sha256(JSON.stringify(correction));
  state.corrections.push(correction);
  await createAudit("correction_recorded", `Correction record added to entry #${entry.entryNumber}`, entryId, correction.correctionHash);
  saveState();
  render();
}

function entryTitle(entry) {
  const names = entry.participants.filter((item) => item.role === "signer").map((item) => item.name).join(", ");
  return names || "Untitled entry";
}

function participantSummary(participant) {
  const addressLine = [participant.address, participant.city, participant.state, participant.zip].filter(Boolean).join(", ");
  return `
    <div class="participant-line">
      <div>
        <strong>${escapeHtml(roleLabel(participant.role))}: ${escapeHtml(participant.name || "Unnamed")}</strong>
        ${participant.email ? `<span>Email: ${escapeHtml(participant.email)}</span>` : ""}
        <span>${escapeHtml(addressLine || participant.idDetails || "No details")}</span>
      </div>
      <div class="participant-media">
        ${participant.signatureImage ? `<figure><img src="${participant.signatureImage}" alt="${escapeHtml(roleLabel(participant.role))} signature" /><figcaption>Signature</figcaption></figure>` : `<em>No signature</em>`}
        ${participant.thumbprintImage ? `<figure><img src="${participant.thumbprintImage}" alt="${escapeHtml(roleLabel(participant.role))} thumbprint" /><figcaption>Thumbprint</figcaption></figure>` : ""}
      </div>
    </div>
  `;
}

function renderShell() {
  document.body.classList.toggle("signed-out", !hasSession());
  if (!state) {
    notaryIdentity.textContent = "One-time purchase notary journal";
    nextEntryNumber.textContent = "-";
    return;
  }
  const settings = state.settings;
  notaryIdentity.textContent = [settings.businessName, settings.notaryName].filter(Boolean).join(" - ") || "Set up notary profile in Settings";
  nextEntryNumber.textContent = state.journal.nextEntryNumber;
}

function render() {
  renderShell();
  if (!hasSession()) {
    renderLanding();
    return;
  }
  if (!state.onboardingComplete && currentView !== "settings") {
    renderOnboarding();
    return;
  }
  if (currentView === "dashboard") renderDashboard();
  if (currentView === "new-entry") renderNewEntry();
  if (currentView === "locked") renderLockedEntries();
  if (currentView === "settings") renderSettings();
}

function renderLanding() {
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("active"));
  app.innerHTML = `
    <section class="landing-grid">
      <article class="landing-hero">
        <p class="eyebrow">One-time purchase journal app</p>
        <h2>Notary Ledger</h2>
        <p>Professional electronic journal recordkeeping with locked entries, participant signatures, correction history, and tamper-evident hash verification.</p>
        <div class="landing-actions">
          <button class="button gold" data-action="start-demo" type="button">Try Demo</button>
          <button class="button primary" data-action="mock-purchase" type="button">Buy Full Version</button>
          <button class="button gold" data-auth-mode="signup" type="button">Create Account</button>
          <button class="button secondary" data-auth-mode="login" type="button">Log In</button>
        </div>
      </article>
      <article class="auth-card">
        <div class="section-heading"><div><p class="eyebrow">Local account</p><h2 id="authTitle">Create Account</h2></div></div>
        <label>Email<input id="authEmail" type="email" autocomplete="email" /></label>
        <label>Password<input id="authPassword" type="password" autocomplete="current-password" /></label>
        <button class="button primary full" data-action="auth-submit" data-mode="signup" type="button">Create Account</button>
        <p class="prototype-note">Prototype login stores a password hash locally on this device. Production needs a real backend, password reset, rate limiting, and secure session management.</p>
      </article>
      <article class="feature-card"><strong>Demo mode</strong><span>Try one locked journal entry immediately without creating an account.</span></article>
      <article class="feature-card"><strong>One-time unlock</strong><span>Unlock unlimited entries, PDF export, encrypted backup, and restore/import.</span></article>
      <article class="feature-card"><strong>iPad ready</strong><span>Install to Home Screen and test offline local-first recordkeeping.</span></article>
    </section>
  `;
}

function renderOnboarding() {
  app.innerHTML = `
    <section class="onboarding-card">
      <p class="eyebrow">First-time setup</p>
      <h2>Set up your notary profile</h2>
      <p>These details appear in Settings and PDF exports. You can update them later.</p>
      <div class="field-grid two-col">
        ${settingInput("notaryName", "Notary name", state.settings.notaryName)}
        ${settingInput("businessName", "Business name", state.settings.businessName)}
        ${settingInput("commissionNumber", "Commission number", state.settings.commissionNumber)}
        ${settingInput("commissionExpirationDate", "Commission expiration date", state.settings.commissionExpirationDate, "date")}
        ${settingInput("defaultFee", "Default fee", state.settings.defaultFee, "number")}
        ${settingInput("defaultTravelFee", "Default travel fee", state.settings.defaultTravelFee, "number")}
      </div>
      <button class="button gold" data-action="finish-onboarding" type="button">Finish Setup</button>
    </section>
  `;
}

function renderDashboard() {
  const lockedCount = state.entries.length;
  app.innerHTML = `
    <section class="home-panel">
      <div>
        <p class="eyebrow">${isDemoMode() ? "Demo mode" : "Active journal"}</p>
        <h2>Entry #${state.journal.nextEntryNumber} is ready</h2>
        <p>${lockedCount ? `${lockedCount} locked ${lockedCount === 1 ? "entry" : "entries"} stored locally.` : "Start a guided journal entry when you are ready."}</p>
      </div>
      <button class="button gold start-button" data-action="new-entry" type="button">Start New Entry</button>
    </section>
    <section class="home-actions">
      <button class="quick-action" data-action="locked" type="button"><strong>Locked Entries</strong><span>Search and review records</span></button>
      <button class="quick-action" data-action="verify" type="button"><strong>Verify Integrity</strong><span>Check hashes and sequence</span></button>
      <button class="quick-action" data-action="export-pdf" type="button"><strong>Export PDF</strong><span>Create journal report</span></button>
      <button class="quick-action" data-action="settings" type="button"><strong>Settings</strong><span>Profile, license, backup</span></button>
    </section>
    ${!state.license?.unlocked && state.entries.length >= 1 ? `<section class="warning-card"><strong>Demo limit reached.</strong><span>Purchase Notary Ledger to unlock unlimited entries, encrypted backups, restore/import, and PDF exports.</span></section>` : ""}
    <section class="notice-card">
      <strong>Locked entries cannot be edited.</strong>
      <span>Corrections must be added as separate correction records.</span>
    </section>
  `;
}

function renderNewEntry() {
  app.innerHTML = `
    <section class="workflow-layout">
      <aside class="step-card">
        ${steps.map((step, index) => `<button class="step-button ${index === currentStep ? "active" : ""}" data-step="${index}" type="button"><span>Step ${index + 1}</span>${step}</button>`).join("")}
      </aside>
      <section class="form-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Entry #${state.journal.nextEntryNumber}</p>
            <h2>${steps[currentStep]}</h2>
          </div>
          <button class="button secondary" data-action="reset-draft" type="button">Reset Draft</button>
        </div>
        ${renderStep()}
        <div class="wizard-actions">
          <button class="button secondary" data-action="prev-step" type="button" ${currentStep === 0 ? "disabled" : ""}>Back</button>
          ${
            currentStep === steps.length - 1
              ? `<button class="button gold" data-action="lock-entry" type="button">Save and Lock Entry</button>`
              : `<button class="button primary" data-action="next-step" type="button">Continue</button>`
          }
        </div>
      </section>
    </section>
  `;
}

function renderStep() {
  if (currentStep === 0) {
    return `
      <div class="field-grid">
        <label>Date and time of notarial act<input data-draft="notarialActAt" type="datetime-local" value="${escapeHtml(draft.notarialActAt)}" required /></label>
        <label>Type of notarial act
          <select data-draft="notarialActType" required>
            ${["", "Acknowledgment", "Jurat", "Oath or affirmation", "Copy certification", "Other"].map((value) => `<option value="${escapeHtml(value)}" ${draft.notarialActType === value ? "selected" : ""}>${value || "Select act"}</option>`).join("")}
          </select>
        </label>
      </div>
    `;
  }

  if (currentStep === 1) {
    return `
      <div class="section-tools">
        <button class="button secondary" data-action="add-signer" type="button">Add Signer</button>
        <button class="button secondary" data-action="add-credible-witness" type="button">Add Credible Witness</button>
        <button class="button secondary" data-action="add-subscribing-witness" type="button">Add Subscribing Witness</button>
      </div>
      ${draft.participants.map(renderParticipantCard).join("")}
    `;
  }

  if (currentStep === 2) {
    return draft.participants.map((participant) => renderParticipantCard(participant, true)).join("");
  }

  if (currentStep === 3) {
    return `
      <div class="field-grid three-col">
        <label>Notarial fee<input data-fee="notarialFee" type="number" min="0" step="0.01" value="${escapeHtml(draft.feeItems.notarialFee)}" /></label>
        <label>Travel fee<input data-fee="travelFee" type="number" min="0" step="0.01" value="${escapeHtml(draft.feeItems.travelFee)}" /></label>
        <label>Other fee<input data-fee="otherFee" type="number" min="0" step="0.01" value="${escapeHtml(draft.feeItems.otherFee)}" /></label>
      </div>
      <div class="total-card"><span>Total fees</span><strong id="feeTotal">$${totalFees(draft.feeItems)}</strong></div>
      <label>Notes<textarea data-draft="notes" rows="4">${escapeHtml(draft.notes)}</textarea></label>
    `;
  }

  if (currentStep === 4) {
    return `
      <label class="toggle-row">
        <input data-draft="collectThumbprints" type="checkbox" ${draft.collectThumbprints ? "checked" : ""} />
        <span>Collect thumbprint (optional)</span>
      </label>
      <div class="signature-list">
        ${draft.participants.map((participant) => `
          <article class="signature-tile">
            <div>
              <strong>${escapeHtml(roleLabel(participant.role))}: ${escapeHtml(participant.name || "Unnamed")}</strong>
              <span>${participant.signatureImage ? "Signature captured" : "Signature required"}</span>
              ${draft.collectThumbprints ? `<span>${participant.thumbprintImage ? "Thumbprint captured" : "Thumbprint optional"}</span>` : ""}
            </div>
            <div class="capture-previews">
              ${participant.signatureImage ? `<figure><img src="${participant.signatureImage}" alt="Captured signature" /><figcaption>Signature</figcaption></figure>` : ""}
              ${draft.collectThumbprints && participant.thumbprintImage ? `<figure><img src="${participant.thumbprintImage}" alt="Captured thumbprint" /><figcaption>Thumbprint</figcaption></figure>` : ""}
            </div>
            <div class="capture-actions">
              <button class="button ${participant.signatureImage ? "secondary" : "primary"}" data-signature="${participant.id}" type="button">${participant.signatureImage ? "Replace Signature" : "Capture Signature"}</button>
              ${draft.collectThumbprints ? `<button class="button ${participant.thumbprintImage ? "secondary" : "primary"}" data-thumbprint="${participant.id}" type="button">${participant.thumbprintImage ? "Re-capture Thumbprint" : "Capture Thumbprint"}</button>` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  return `
    <div class="warning-card">
      <strong>Locked entries cannot be edited.</strong>
      <span>Corrections must be added as separate correction records.</span>
    </div>
    <div class="review-card">
      <h3>${escapeHtml(draft.notarialActType || "No act selected")}</h3>
      <p>${displayDate(draft.notarialActAt)}</p>
      <p>Total fees: $${totalFees(draft.feeItems)}</p>
      <h4>Participants</h4>
      ${draft.participants.map(participantSummary).join("")}
      <h4>Notes</h4>
      <p>${escapeHtml(draft.notes || "None")}</p>
    </div>
  `;
}

function renderParticipantCard(participant, idFocus = false) {
  if (idFocus) {
    return `
      <article class="participant-card">
        <header>
          <div><span class="role-pill">${escapeHtml(roleLabel(participant.role))}</span><strong>${escapeHtml(participant.name || "New participant")}</strong></div>
        </header>
        <div class="field-grid three-col highlight-fields">
          <label>Identity method
            <select data-participant="${participant.id}" data-field="idMethod">
              ${["Government ID", "Personal knowledge", "Credible witness"].map((value) => `<option value="${escapeHtml(value)}" ${participant.idMethod === value ? "selected" : ""}>${value}</option>`).join("")}
            </select>
          </label>
          <label>ID type<input data-participant="${participant.id}" data-field="idType" value="${escapeHtml(participant.idType)}" placeholder="Driver license, passport" /></label>
          <label>ID details<input data-participant="${participant.id}" data-field="idDetails" value="${escapeHtml(participant.idDetails)}" placeholder="Issuer, number ending, witness details" /></label>
        </div>
        <div class="field-grid two-col highlight-fields">
          <label>ID issue date<input data-participant="${participant.id}" data-field="idIssueDate" type="date" value="${escapeHtml(participant.idIssueDate)}" /></label>
          <label>ID expiration date<input data-participant="${participant.id}" data-field="idExpirationDate" type="date" value="${escapeHtml(participant.idExpirationDate)}" /></label>
        </div>
      </article>
    `;
  }

  return `
    <article class="participant-card">
      <header>
        <div><span class="role-pill">${escapeHtml(roleLabel(participant.role))}</span><strong>${escapeHtml(participant.name || "New participant")}</strong></div>
        <button class="icon-button" data-remove-participant="${participant.id}" type="button" aria-label="Remove participant">Remove</button>
      </header>
      <div class="field-grid">
        <label>Name<input data-participant="${participant.id}" data-field="name" value="${escapeHtml(participant.name)}" required /></label>
        <label>Email (optional)<input data-participant="${participant.id}" data-field="email" type="email" value="${escapeHtml(participant.email ?? "")}" /></label>
      </div>
      <div class="field-grid">
        <label class="${participant.role === "signer" ? "" : "optional"}">Address<input data-participant="${participant.id}" data-field="address" value="${escapeHtml(participant.address)}" /></label>
        <label>City<input data-participant="${participant.id}" data-field="city" value="${escapeHtml(participant.city ?? "")}" /></label>
      </div>
      <div class="field-grid three-col">
        <label>State<input data-participant="${participant.id}" data-field="state" value="${escapeHtml(participant.state ?? "")}" maxlength="2" /></label>
        <label>ZIP code<input data-participant="${participant.id}" data-field="zip" value="${escapeHtml(participant.zip ?? "")}" inputmode="numeric" /></label>
      </div>
    </article>
  `;
}

function renderLockedEntries() {
  const query = sessionStorage.getItem("entrySearch") ?? "";
  const roleFilter = sessionStorage.getItem("roleFilter") ?? "all";
  const entries = sortedEntries()
    .filter((entry) => {
      const haystack = `${entry.entryNumber} ${entry.notarialActType} ${entry.participants.map((p) => `${p.name} ${p.address} ${p.city ?? ""} ${p.state ?? ""} ${p.zip ?? ""} ${p.idDetails}`).join(" ")}`.toLowerCase();
      const matchesQuery = haystack.includes(query.toLowerCase());
      const matchesRole = roleFilter === "all" || entry.participants.some((participant) => participant.role === roleFilter);
      return matchesQuery && matchesRole;
    })
    .reverse();

  const selected = selectedEntryId ? state.entries.find((entry) => entry.id === selectedEntryId) : entries[0];
  app.innerHTML = `
    <section class="locked-layout">
      <aside class="list-card">
        <div class="section-heading">
          <div><p class="eyebrow">Locked journal</p><h2>Entries</h2></div>
          <button class="button primary" data-action="verify" type="button">Verify Journal Integrity</button>
        </div>
        <div class="filter-row">
          <input id="entrySearch" placeholder="Search signer, witness, hash, act..." value="${escapeHtml(query)}" />
          <select id="roleFilter">
            ${["all", "signer", "credible_witness", "subscribing_witness"].map((role) => `<option value="${role}" ${roleFilter === role ? "selected" : ""}>${role === "all" ? "All roles" : roleLabel(role)}</option>`).join("")}
          </select>
        </div>
        <div class="entry-list">
          ${entries.length ? entries.map((entry) => `<button class="entry-list-item ${selected?.id === entry.id ? "active" : ""}" data-entry="${entry.id}" type="button"><strong>#${entry.entryNumber} ${escapeHtml(entryTitle(entry))}</strong><span>${displayDate(entry.notarialActAt)} - ${escapeHtml(entry.notarialActType)}</span><span>Fees: $${totalFees(entry.feeItems)} - Hash: ${integrityStatus[entry.id] ?? "Recorded"}</span></button>`).join("") : `<p class="empty">No locked entries found.</p>`}
        </div>
      </aside>
      <section class="detail-card">
        ${selected ? renderEntryDetail(selected) : `<p class="empty">Select an entry to view details.</p>`}
      </section>
    </section>
  `;
}

function renderEntryDetail(entry) {
  const corrections = state.corrections.filter((item) => item.entryId === entry.id);
  const status = integrityStatus[entry.id] ?? "Not verified this session";
  return `
    <div class="section-heading">
      <div>
        <p class="eyebrow">Journal entry #${entry.entryNumber}</p>
        <h2>${escapeHtml(entryTitle(entry))}</h2>
      </div>
      <button class="button secondary" data-correction="${entry.id}" type="button">Add Correction</button>
    </div>
    <div class="detail-grid">
      <div><span>Notarial act</span><strong>${escapeHtml(entry.notarialActType)}</strong></div>
      <div><span>Timestamp</span><strong>${displayDate(entry.notarialActAt)}</strong></div>
      <div><span>Locked</span><strong>${displayDate(entry.lockedAt)}</strong></div>
      <div><span>Total fees</span><strong>$${totalFees(entry.feeItems)}</strong></div>
      <div><span>Integrity status</span><strong>${escapeHtml(status)}</strong></div>
    </div>
    <h3>Fees</h3>
    <div class="detail-grid">
      <div><span>Notarial fee</span><strong>$${money(entry.feeItems.notarialFee)}</strong></div>
      <div><span>Travel fee</span><strong>$${money(entry.feeItems.travelFee)}</strong></div>
      <div><span>Other fee</span><strong>$${money(entry.feeItems.otherFee)}</strong></div>
      <div><span>Total</span><strong>$${totalFees(entry.feeItems)}</strong></div>
    </div>
    <h3>Participants</h3>
    ${entry.participants.map(participantSummary).join("")}
    <h3>Hash Chain</h3>
    <div class="hash-panel"><span>Previous hash</span><code>${entry.previousHash}</code><span>Entry hash</span><code>${entry.entryHash}</code></div>
    <h3>Correction History</h3>
    ${corrections.length ? corrections.map((correction) => `<div class="correction-row"><strong>${displayDate(correction.createdAt)}</strong><span>${escapeHtml(correction.message)}</span><code>${correction.correctionHash}</code></div>`).join("") : `<p class="empty">No corrections recorded.</p>`}
  `;
}

function renderSettings() {
  const settings = state.settings;
  app.innerHTML = `
    <section class="settings-grid">
      <article class="form-card">
        <div class="section-heading"><div><p class="eyebrow">Profile</p><h2>Settings</h2></div></div>
        <div class="field-grid two-col">
          ${settingInput("notaryName", "Notary name", settings.notaryName)}
          ${settingInput("businessName", "Business name", settings.businessName)}
          ${settingInput("commissionNumber", "Commission number", settings.commissionNumber)}
          ${settingInput("commissionExpirationDate", "Commission expiration date", settings.commissionExpirationDate, "date")}
          ${settingInput("defaultFee", "Default fee", settings.defaultFee, "number")}
          ${settingInput("defaultTravelFee", "Default travel fee", settings.defaultTravelFee, "number")}
        </div>
      </article>
      <article class="form-card">
        <div class="section-heading"><div><p class="eyebrow">Testing</p><h2>Prototype Tools</h2></div></div>
        <div class="account-box">
          <strong>${escapeHtml(currentUserEmail)}</strong>
          <span>${state.license?.unlocked ? "Full license active" : "Limited mode: one locked entry before unlock"}</span>
        </div>
        ${
          state.license?.unlocked
            ? `<button class="button secondary full" data-action="export-encrypted" type="button">Export Encrypted Backup</button>`
            : `<button class="button gold full" data-action="enter-license" type="button">Enter License Key</button><button class="button secondary full" data-action="mock-purchase" type="button">One-Time Purchase</button>`
        }
        <button class="button secondary full" data-action="restore-backup" type="button">Import / Restore Backup</button>
        <button class="button gold full" data-action="demo" type="button">Load Sample Demo Data</button>
        <button class="button secondary full" data-action="export-json" type="button">Export Backup File</button>
        <button class="button secondary full" data-action="export-pdf" type="button">Export PDF Journal</button>
        <button class="button secondary full" data-action="logout" type="button">Log Out</button>
        <button class="button danger full" data-action="reset-demo" type="button">Reset Prototype Data</button>
        <p class="prototype-note">Prototype only. Not legally certified. Designed for tamper-evident electronic journal recordkeeping review.</p>
      </article>
    </section>
  `;
}

function settingInput(field, label, value, type = "text") {
  const attrs = type === "number" ? `min="0" step="0.01"` : "";
  return `<label>${label}<input data-setting="${field}" type="${type}" ${attrs} value="${escapeHtml(value)}" /></label>`;
}

function toCsv(entries) {
  const headers = ["entryNumber", "notarialActAt", "lockedAt", "notarialActType", "participants", "feeTotal", "notes", "previousHash", "entryHash"];
  const rows = entries.map((entry) => [
    entry.entryNumber,
    entry.notarialActAt,
    entry.lockedAt,
    entry.notarialActType,
    entry.participants.map((participant) => `${roleLabel(participant.role)}: ${participant.name} (${participant.idMethod}; ${participant.idDetails})`).join(" | "),
    totalFees(entry.feeItems),
    entry.notes,
    entry.previousHash,
    entry.entryHash,
  ].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","));
  return [headers.join(","), ...rows].join("\n");
}

async function exportJson() {
  if (!state.license?.unlocked && state.entries.length >= 1) {
    alert("Purchase Notary Ledger to unlock unlimited entries, encrypted backups, restore/import, and PDF exports.");
    return;
  }
  await createAudit("exported", "Backup file exported as JSON");
  saveState();
  render();
  download("notary-journal-backup.json", JSON.stringify(state, null, 2), "application/json");
}

async function deriveBackupKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function exportEncryptedBackup() {
  if (!state.license?.unlocked) {
    alert("Encrypted backups are a full-feature unlock in this prototype.");
    return;
  }

  const password = prompt("Create a backup password. You will need it to restore this file.");
  if (!password || password.length < 8) {
    alert("Use at least 8 characters for the backup password.");
    return;
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const backup = {
    app: "Notary Journal Prototype",
    version: APP_VERSION,
    encrypted: true,
    kdf: "PBKDF2-SHA256-250000",
    cipher: "AES-256-GCM",
    ownerEmail: currentUserEmail,
    createdAt: new Date().toISOString(),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  };

  await createAudit("encrypted_backup_exported", "Encrypted backup file exported");
  saveState();
  download("notary-journal-encrypted.njbackup", JSON.stringify(backup, null, 2), "application/json");
}

async function importRestoreFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  let restored;

  if (parsed.encrypted) {
    const password = prompt("Enter the backup password to restore this encrypted file.");
    if (!password) return;
    const key = await deriveBackupKey(password, base64ToBytes(parsed.salt));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(parsed.iv) },
      key,
      base64ToBytes(parsed.data)
    );
    restored = JSON.parse(new TextDecoder().decode(decrypted));
  } else {
    restored = parsed;
  }

  if (!restored?.journal || !Array.isArray(restored.entries)) {
    alert("This does not look like a valid journal backup.");
    return;
  }

  if (!confirm("Restore this backup into the current signed-in account? This replaces the local journal data for this user.")) return;
  state = normalizeState(restored);
  state.ownerEmail = currentUserEmail;
  await createAudit("backup_restored", `Backup restored from ${file.name}`);
  saveState();
  draft = createDraft();
  currentView = "dashboard";
  render();
}

async function exportCsv() {
  if (!state.license?.unlocked && state.entries.length >= 1) {
    alert("Purchase Notary Ledger to unlock unlimited entries, encrypted backups, restore/import, and PDF exports.");
    return;
  }
  await createAudit("exported", "CSV backup exported");
  saveState();
  render();
  download("notary-journal-backup.csv", toCsv(sortedEntries()), "text/csv");
}

async function exportPdf() {
  if (!state.license?.unlocked && state.entries.length >= 1) {
    alert("Purchase Notary Ledger to unlock unlimited entries, encrypted backups, restore/import, and PDF exports.");
    return;
  }
  await createAudit("exported", "PDF export opened for saving or printing");
  saveState();
  render();

  const rows = sortedEntries().map((entry) => {
    const corrections = state.corrections.filter((item) => item.entryId === entry.id);
    return `
    <section class="pdf-entry">
      <h2>Entry #${entry.entryNumber}: ${escapeHtml(entryTitle(entry))}</h2>
      <div class="pdf-grid">
        <p><strong>Act:</strong> ${escapeHtml(entry.notarialActType)}</p>
        <p><strong>Date/time:</strong> ${displayDate(entry.notarialActAt)}</p>
        <p><strong>Locked:</strong> ${displayDate(entry.lockedAt)}</p>
        <p><strong>Total fees:</strong> $${totalFees(entry.feeItems)}</p>
      </div>
      <h3>Participants</h3>
      ${entry.participants.map((participant) => `
        <div class="pdf-participant">
          <p><strong>${escapeHtml(roleLabel(participant.role))}:</strong> ${escapeHtml(participant.name)}</p>
          ${participant.email ? `<p><strong>Email:</strong> ${escapeHtml(participant.email)}</p>` : ""}
          <p><strong>Address:</strong> ${escapeHtml([participant.address, participant.city, participant.state, participant.zip].filter(Boolean).join(", ") || "N/A")}</p>
          <p><strong>ID:</strong> ${escapeHtml(participant.idMethod)} - ${escapeHtml(participant.idType)} - ${escapeHtml(participant.idDetails)}</p>
          <p><strong>ID issue/expiration:</strong> ${escapeHtml(participant.idIssueDate || "N/A")} / ${escapeHtml(participant.idExpirationDate || "N/A")}</p>
          <div class="pdf-captures">
            <figure><img src="${participant.signatureImage}" alt="${escapeHtml(roleLabel(participant.role))} signature" /><figcaption>Signature</figcaption></figure>
            ${participant.thumbprintImage ? `<figure><img src="${participant.thumbprintImage}" alt="${escapeHtml(roleLabel(participant.role))} thumbprint" /><figcaption>Thumbprint</figcaption></figure>` : ""}
          </div>
        </div>
      `).join("")}
      <p><strong>Notes:</strong> ${escapeHtml(entry.notes || "None")}</p>
      <h3>Correction History</h3>
      ${corrections.length ? corrections.map((correction) => `<p><strong>${displayDate(correction.createdAt)}:</strong> ${escapeHtml(correction.message)}<br><code>${correction.correctionHash}</code></p>`).join("") : "<p>No corrections recorded.</p>"}
      <p><strong>Previous hash:</strong> <code>${entry.previousHash}</code></p>
      <p><strong>Entry hash:</strong> <code>${entry.entryHash}</code></p>
    </section>
  `;
  }).join("");

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!doctype html>
    <title>Notary Journal PDF Export</title>
    <style>
      body { color: #0b1f3a; font-family: Arial, sans-serif; margin: 34px; }
      h1 { border-bottom: 4px solid #c59b2d; padding-bottom: 12px; }
      .pdf-entry { break-inside: avoid; border: 1px solid #c9d3df; border-radius: 10px; margin: 18px 0; padding: 18px; }
      .pdf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; }
      .pdf-participant { border-top: 1px solid #d8e0ea; padding-top: 10px; margin-top: 10px; }
      code { overflow-wrap: anywhere; font-size: 11px; }
      .pdf-captures { display: flex; gap: 14px; align-items: end; flex-wrap: wrap; }
      figure { margin: 8px 0; }
      figcaption { color: #5c6f86; font-size: 11px; margin-top: 4px; }
      img { width: 240px; max-height: 110px; object-fit: contain; border: 1px solid #c9d3df; }
    </style>
    <h1>Notary Journal Export</h1>
    <p>${escapeHtml(state.settings.businessName || "")} ${escapeHtml(state.settings.notaryName || "")}</p>
    ${rows || "<p>No entries to export.</p>"}
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function loadDemoData() {
  if (state.entries.length && !confirm("Add sample entries to the current journal?")) return;

  const signature = makeDemoSignature("Sample");
  const demo = {
    id: crypto.randomUUID(),
    journalId: state.journal.id,
    entryNumber: state.journal.nextEntryNumber,
    notarialActAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    lockedAt: new Date().toISOString(),
    notarialActType: "Acknowledgment",
    participants: [
      {
        ...createParticipant("signer"),
        name: "Jordan Rivera",
        address: "123 Market Street",
        city: "Newark",
        state: "NJ",
        zip: "07102",
        idMethod: "Government ID",
        idType: "Driver license",
        idIssueDate: "2022-01-15",
        idExpirationDate: "2028-01-15",
        idDetails: "NJ driver license verified visually",
        signatureImage: signature,
      },
      {
        ...createParticipant("credible_witness"),
        name: "Avery Chen",
        idType: "Passport",
        idDetails: "Credible witness identity verified",
        signatureImage: makeDemoSignature("Witness"),
      },
    ],
    feeItems: { notarialFee: state.settings.defaultFee || "15.00", travelFee: state.settings.defaultTravelFee || "0.00", otherFee: "0.00" },
    notes: "Sample entry for iPad testing.",
    previousHash: state.entries.at(-1)?.entryHash ?? "GENESIS",
  };

  for (const participant of demo.participants) {
    participant.signatureDigest = await sha256(participant.signatureImage);
  }
  demo.entryHash = await sha256(canonicalEntry(demo));
  state.entries.push(demo);
  state.journal.nextEntryNumber += 1;
  await createAudit("demo_created", `Sample entry #${demo.entryNumber} created`, demo.id, demo.entryHash);
  saveState();
  setView("locked");
}

function makeDemoSignature(label) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180"><rect width="600" height="180" fill="white"/><path d="M60 110 C140 30 170 140 240 85 S360 95 430 70 S505 80 545 52" fill="none" stroke="#111" stroke-width="10" stroke-linecap="round"/><text x="62" y="152" font-family="Arial" font-size="22" fill="#555">${label}</text></svg>`)}`;
}

async function handleAuth(mode) {
  const email = document.querySelector("#authEmail")?.value.trim().toLowerCase();
  const password = document.querySelector("#authPassword")?.value;
  if (!email || !password) {
    alert("Email and password are required.");
    return;
  }
  if (password.length < 8) {
    alert("Use at least 8 characters for the password.");
    return;
  }

  const passwordHash = await sha256(`${email}:${password}`);
  if (mode === "signup") {
    if (auth.users[email]) {
      alert("An account already exists for that email. Log in instead.");
      return;
    }
    auth.users[email] = { email, passwordHash, createdAt: new Date().toISOString() };
    saveAuth();
  } else if (!auth.users[email] || auth.users[email].passwordHash !== passwordHash) {
    alert("Email or password did not match.");
    return;
  }

  currentUserEmail = email;
  localStorage.setItem(SESSION_KEY, email);
  state = loadState();
  draft = createDraft();
  currentView = state.onboardingComplete ? "dashboard" : "dashboard";
  render();
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  currentUserEmail = "";
  state = null;
  draft = createDraft();
  currentView = "landing";
  render();
}

function startDemoSession() {
  currentUserEmail = "demo";
  localStorage.setItem(SESSION_KEY, currentUserEmail);
  state = loadState();
  state.onboardingComplete = true;
  state.settings.notaryName = state.settings.notaryName || "Demo Notary";
  state.settings.businessName = state.settings.businessName || "Notary Ledger Demo";
  state.settings.defaultFee = state.settings.defaultFee || "15.00";
  saveState();
  draft = createDraft();
  currentView = "dashboard";
  render();
}

function finishOnboarding() {
  if (!state.settings.notaryName.trim() || !state.settings.commissionNumber.trim() || !state.settings.commissionExpirationDate) {
    alert("Notary name, commission number, and commission expiration date are required.");
    return;
  }
  state.onboardingComplete = true;
  saveState();
  currentView = "dashboard";
  render();
}

async function enterLicenseKey() {
  const key = prompt("Enter your license key.");
  if (!key) return;
  const normalized = key.trim().toUpperCase();
  if (!(await validateLicenseKeyWithServer(normalized))) {
    alert("License key was not recognized in this prototype.");
    return;
  }
  state.license = {
    unlocked: true,
    licenseKey: normalized,
    unlockedAt: new Date().toISOString(),
  };
  saveState();
  alert("Full features unlocked on this device.");
  render();
}

function mockPurchase() {
  initiateStripeCheckout();
}

function initiateStripeCheckout() {
  alert("Future Stripe hook: create a checkout session, collect one-time payment, then issue a unique license key. For this prototype, use license key LOCAL-TEST-UNLOCK.");
}

async function validateLicenseKeyWithServer(licenseKey) {
  // Future production hook: call your backend to validate the unique license key.
  return VALID_LICENSE_KEYS.includes(licenseKey);
}

function openCaptureModal(participantId, kind = "signature") {
  activeCaptureTarget = participantId;
  activeCaptureKind = kind;
  captureDirty = false;
  const participant = draft.participants.find((item) => item.id === participantId);
  const isThumbprint = kind === "thumbprint";
  signatureTitle.textContent = `${roleLabel(participant.role)} ${isThumbprint ? "Thumbprint" : "Signature"}`;
  document.querySelector("#confirmSignature").textContent = isThumbprint ? "Confirm Thumbprint" : "Confirm Signature";
  document.querySelector("#clearSignature").textContent = isThumbprint ? "Clear Thumbprint" : "Clear Signature";
  signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  const existingImage = isThumbprint ? participant.thumbprintImage : participant.signatureImage;
  if (existingImage) {
    const img = new Image();
    img.onload = () => signatureCtx.drawImage(img, 0, 0, signatureCanvas.width, signatureCanvas.height);
    img.src = existingImage;
    captureDirty = true;
  }
  signatureModal.classList.add("open");
  signatureModal.classList.toggle("thumbprint-mode", isThumbprint);
  signatureModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("signature-active");
  screen.orientation?.lock?.("landscape").catch(() => {});
}

function closeSignatureModal() {
  signatureModal.classList.remove("open");
  signatureModal.classList.remove("thumbprint-mode");
  signatureModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("signature-active");
  screen.orientation?.unlock?.();
  activeCaptureTarget = null;
  activeCaptureKind = "signature";
  drawing = false;
  activePointerId = null;
}

function getPointer(event) {
  const rect = signatureCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * signatureCanvas.width,
    y: ((event.clientY - rect.top) / rect.height) * signatureCanvas.height,
  };
}

function startDraw(event) {
  event.preventDefault();
  activePointerId = event.pointerId;
  signatureCanvas.setPointerCapture?.(event.pointerId);
  drawing = true;
  captureDirty = true;
  const point = getPointer(event);
  signatureCtx.beginPath();
  signatureCtx.moveTo(point.x, point.y);
}

function draw(event) {
  if (!drawing || event.pointerId !== activePointerId) return;
  event.preventDefault();
  const point = getPointer(event);
  const pressure = event.pressure && event.pressure > 0 ? event.pressure : 0.5;
  signatureCtx.lineWidth = Math.max(3, pressure * 7);
  signatureCtx.lineCap = "round";
  signatureCtx.lineJoin = "round";
  signatureCtx.strokeStyle = "#111";
  signatureCtx.lineTo(point.x, point.y);
  signatureCtx.stroke();
}

function stopDraw(event) {
  if (event?.pointerId && event.pointerId !== activePointerId) return;
  drawing = false;
  activePointerId = null;
}

function clearSignature() {
  signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  captureDirty = false;
}

async function confirmSignature() {
  if (!captureDirty) {
    alert(activeCaptureKind === "thumbprint" ? "Please capture the thumbprint before confirming." : "Please sign before confirming.");
    return;
  }
  const participant = draft.participants.find((item) => item.id === activeCaptureTarget);
  if (!participant) return;
  const image = signatureCanvas.toDataURL("image/png");
  if (activeCaptureKind === "thumbprint") {
    participant.thumbprintImage = image;
    participant.thumbprintDigest = await sha256(image);
  } else {
    participant.signatureImage = image;
    participant.signatureDigest = await sha256(image);
  }
  closeSignatureModal();
  render();
}

function wireEvents() {
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    if (target.dataset.authMode) {
      const mode = target.dataset.authMode;
      document.querySelector("#authTitle").textContent = mode === "signup" ? "Create Account" : "Log In";
      const submit = document.querySelector("[data-action='auth-submit']");
      submit.dataset.mode = mode;
      submit.textContent = mode === "signup" ? "Create Account" : "Log In";
    }
    if (target.dataset.action === "auth-submit") await handleAuth(target.dataset.mode);
    if (target.dataset.action === "start-demo") startDemoSession();
    if (target.dataset.action === "finish-onboarding") finishOnboarding();
    if (target.dataset.action === "logout") logout();
    if (target.dataset.action === "enter-license") await enterLicenseKey();
    if (target.dataset.action === "mock-purchase") mockPurchase();
    if (target.dataset.action === "export-encrypted") await exportEncryptedBackup();
    if (target.dataset.action === "restore-backup") restoreFileInput.click();
    if (target.dataset.view) setView(target.dataset.view);
    if (target.dataset.action === "new-entry") setView("new-entry");
    if (target.dataset.action === "locked") setView("locked");
    if (target.dataset.action === "settings") setView("settings");
    if (target.dataset.action === "verify") await verifyIntegrity();
    if (target.dataset.action === "export-pdf") await exportPdf();
    if (target.dataset.action === "export-json") await exportJson();
    if (target.dataset.action === "demo") await loadDemoData();
    if (target.dataset.action === "reset-draft") {
      if (confirm("Reset the current draft entry?")) {
        draft = createDraft();
        currentStep = 0;
        render();
      }
    }
    if (target.dataset.action === "reset-demo") {
      if (confirm("Reset all prototype data on this device?")) {
        localStorage.removeItem(userStorageKey());
        state = loadState();
        draft = createDraft();
        currentStep = 0;
        selectedEntryId = null;
        render();
      }
    }
    if (target.dataset.action === "add-signer") addParticipant("signer");
    if (target.dataset.action === "add-credible-witness") addParticipant("credible_witness");
    if (target.dataset.action === "add-subscribing-witness") addParticipant("subscribing_witness");
    if (target.dataset.action === "next-step") {
      currentStep = Math.min(steps.length - 1, currentStep + 1);
      render();
    }
    if (target.dataset.action === "prev-step") {
      currentStep = Math.max(0, currentStep - 1);
      render();
    }
    if (target.dataset.action === "lock-entry") await lockEntry();
    if (target.dataset.step) {
      currentStep = Number(target.dataset.step);
      render();
    }
    if (target.dataset.removeParticipant) removeParticipant(target.dataset.removeParticipant);
    if (target.dataset.signature) openCaptureModal(target.dataset.signature, "signature");
    if (target.dataset.thumbprint) openCaptureModal(target.dataset.thumbprint, "thumbprint");
    if (target.dataset.entry) {
      selectedEntryId = target.dataset.entry;
      render();
    }
    if (target.dataset.correction) await recordCorrection(target.dataset.correction);
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.dataset.draft) updateDraft(target.dataset.draft, target.type === "checkbox" ? target.checked : target.value);
    if (target.dataset.fee) updateFee(target.dataset.fee, target.value);
    if (target.dataset.participant) updateParticipant(target.dataset.participant, target.dataset.field, target.value);
    if (target.dataset.setting) updateSetting(target.dataset.setting, target.value);
    if (target.id === "entrySearch") {
      sessionStorage.setItem("entrySearch", target.value);
      renderLockedEntries();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "roleFilter") {
      sessionStorage.setItem("roleFilter", target.value);
      renderLockedEntries();
    }
  });

  ipadModeToggle.addEventListener("click", () => setIpadMode(!document.body.classList.contains("ipad-mode")));
  document.querySelector("#closeSignature").addEventListener("click", closeSignatureModal);
  document.querySelector("#clearSignature").addEventListener("click", clearSignature);
  document.querySelector("#confirmSignature").addEventListener("click", confirmSignature);

  signatureCanvas.addEventListener("pointerdown", startDraw);
  signatureCanvas.addEventListener("pointermove", draw);
  signatureCanvas.addEventListener("pointerup", stopDraw);
  signatureCanvas.addEventListener("pointercancel", stopDraw);
  signatureCanvas.addEventListener("pointerleave", stopDraw);
  signatureCanvas.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
  signatureCanvas.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });

  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  restoreFileInput.addEventListener("change", async () => {
    const file = restoreFileInput.files?.[0];
    if (!file) return;
    try {
      await importRestoreFile(file);
    } catch (error) {
      alert("Restore failed. Check the file and password.");
    } finally {
      restoreFileInput.value = "";
    }
  });
}

wireEvents();
setIpadMode(localStorage.getItem("notaryJournalPrototype.ipadMode") === "true");
registerServiceWorker();
updateNetworkStatus();
render();
