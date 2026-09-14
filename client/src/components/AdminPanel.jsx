import { useCallback, useEffect, useRef, useState } from "react";
import GlassModal from "./GlassModal.jsx";
import {
  adminFetchSettings,
  adminLogin,
  adminSaveSettings,
  adminValidateSession,
} from "../lib/adminApi.js";

const TOKEN_KEY = "globalstores_admin_token";
const TOAST_MS = 3200;

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const EDIT_SECTIONS = [
  { id: "email", labelKey: "adminEditEmail" },
  { id: "contact", labelKey: "adminEditContact" },
  { id: "about", labelKey: "adminEditAbout" },
];

const SOCIAL_LABELS = {
  whatsapp: "socialWhatsApp",
  instagram: "socialInstagram",
  tiktok: "socialTikTok",
  youtube: "socialYouTube",
  facebook: "socialFacebook",
};

function toSettingsDraft(settings) {
  return {
    complaintEmail: settings.complaintEmail || "",
    whatsappNumbers:
      Array.isArray(settings.whatsappNumbers) && settings.whatsappNumbers.length
        ? [...settings.whatsappNumbers]
        : [""],
    aboutEn: settings.aboutEn || "",
    aboutAr: settings.aboutAr || "",
    ownersEn: settings.ownersEn || "",
    ownersAr: settings.ownersAr || "",
    socialLinks: {
      whatsapp: settings.socialLinks?.whatsapp || "",
      instagram: settings.socialLinks?.instagram || "",
      tiktok: settings.socialLinks?.tiktok || "",
      youtube: settings.socialLinks?.youtube || "",
      facebook: settings.socialLinks?.facebook || "",
    },
  };
}

function formatWhatsAppInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "+";
}

export default function AdminPanel({ open, onClose, t }) {
  const [token, setTokenState] = useState(() => getToken());
  const [view, setView] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [confirmContact, setConfirmContact] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const settingsCache = useRef(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((text) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), TOAST_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const prefetch = useCallback(async (sessionToken) => {
    const settings = settingsCache.current
      ? settingsCache.current
      : await adminFetchSettings(sessionToken);
    settingsCache.current = settings;
    setSettingsDraft(toSettingsDraft(settings));
    return settings;
  }, []);

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmContact(false);
    setConfirmEmail(false);

    const existing = getToken();
    if (!existing) {
      setTokenState("");
      setView("login");
      return;
    }

    let cancelled = false;
    setChecking(true);
    adminValidateSession(existing)
      .then(async (ok) => {
        if (cancelled) return;
        if (!ok) {
          setToken("");
          setTokenState("");
          setView("login");
          return;
        }
        setTokenState(existing);
        setView("dashboard");
        prefetch(existing).catch(() => {});
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, prefetch]);

  const onLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const sessionToken = await adminLogin(username, password);
      setToken(sessionToken);
      setTokenState(sessionToken);
      setPassword("");
      setView("dashboard");
      await prefetch(sessionToken);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    setToken("");
    setTokenState("");
    setView("login");
    settingsCache.current = null;
    setSettingsDraft(null);
    setToast("");
    setError("");
  };

  const goDashboard = () => {
    setView("dashboard");
    setError("");
  };

  const selectEditSection = async (sectionId) => {
    setError("");
    setBusy(true);
    try {
      await prefetch(token);
      setView(`edit-${sectionId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const persistEmail = async () => {
    setBusy(true);
    setError("");
    try {
      const settings = await adminSaveSettings(token, {
        complaintEmail: settingsDraft.complaintEmail,
      });
      settingsCache.current = settings;
      setSettingsDraft(toSettingsDraft(settings));
      setConfirmEmail(false);
      showToast(t.adminSettingsSaved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmSaveContact = async () => {
    setBusy(true);
    setError("");
    try {
      const numbers = (settingsDraft.whatsappNumbers || [])
        .map((n) => String(n).replace(/\D/g, ""))
        .filter(Boolean);
      const settings = await adminSaveSettings(token, { whatsappNumbers: numbers });
      settingsCache.current = settings;
      setSettingsDraft(toSettingsDraft(settings));
      setConfirmContact(false);
      showToast(t.adminSettingsSaved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onSaveAbout = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const settings = await adminSaveSettings(token, {
        aboutEn: settingsDraft.aboutEn,
        aboutAr: settingsDraft.aboutAr,
        ownersEn: settingsDraft.ownersEn,
        ownersAr: settingsDraft.ownersAr,
        socialLinks: settingsDraft.socialLinks,
      });
      settingsCache.current = settings;
      setSettingsDraft(toSettingsDraft(settings));
      showToast(t.adminSettingsSaved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const screenTitle =
    view === "dashboard"
      ? t.adminDashboardTitle
      : view === "edit-email"
        ? t.adminEditEmail
        : view === "edit-contact"
          ? t.adminEditContact
          : view === "edit-about"
            ? t.adminEditAbout
            : t.adminNavLabel;

  const backTarget = view.startsWith("edit-") ? "dashboard" : null;

  return (
    <>
      {view === "login" || checking ? (
        <GlassModal
          title={t.adminLoginTitle}
          onClose={onClose}
          className="admin-login-modal"
        >
          {checking ? (
            <p className="catalog-note">{t.adminLoading}</p>
          ) : (
            <form className="admin-login-form" onSubmit={onLogin}>
              <div className="admin-login-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
                  />
                </svg>
              </div>
              <p className="admin-lead">{t.adminLoginLead}</p>
              <label>
                {t.adminUsername}
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                {t.adminPassword}
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {error ? <p className="error-text">{error}</p> : null}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t.adminWorking : t.adminSignIn}
              </button>
            </form>
          )}
        </GlassModal>
      ) : (
        <div className="admin-fs" role="dialog" aria-modal="true" aria-labelledby="admin-fs-title">
          <header className="admin-fs-header">
            {backTarget ? (
              <button type="button" className="admin-back-btn" onClick={goDashboard}>
                ← {t.adminBack}
              </button>
            ) : (
              <span className="admin-fs-spacer" />
            )}
            <h1 id="admin-fs-title">{screenTitle}</h1>
            <div className="admin-fs-header-actions">
              <button type="button" className="btn btn-ghost" onClick={logout}>
                {t.adminLogout}
              </button>
              <button
                type="button"
                className="glass-modal-close"
                onClick={onClose}
                aria-label={t.close}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M18.3 5.71 12 12.01l-6.3-6.3-1.4 1.41 6.29 6.3-6.3 6.29 1.42 1.42 6.29-6.3 6.3 6.3 1.41-1.42-6.3-6.29 6.3-6.3z"
                  />
                </svg>
              </button>
            </div>
          </header>

          <div className="admin-fs-body">
            {view === "dashboard" ? (
              <div className="admin-dashboard">
                <p className="admin-lead">{t.adminDashboardLead}</p>
                <div className="admin-edit-sections admin-edit-sections--wide" role="menu">
                  {EDIT_SECTIONS.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      role="menuitem"
                      className="admin-edit-section-btn"
                      onClick={() => selectEditSection(section.id)}
                      disabled={busy}
                    >
                      {t[section.labelKey]}
                    </button>
                  ))}
                </div>
                {error ? <p className="error-text">{error}</p> : null}
              </div>
            ) : null}

            {["edit-email", "edit-contact", "edit-about"].includes(view) && !settingsDraft ? (
              <p className="catalog-note">{t.adminLoading}</p>
            ) : null}

            {view === "edit-email" && settingsDraft ? (
              <form
                className="admin-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  setConfirmEmail(true);
                }}
              >
                <label>
                  {t.adminComplaintEmail}
                  <input
                    type="email"
                    value={settingsDraft.complaintEmail}
                    onChange={(e) =>
                      setSettingsDraft((d) => ({ ...d, complaintEmail: e.target.value }))
                    }
                    required
                  />
                </label>
                {error ? <p className="error-text">{error}</p> : null}
                <div className="admin-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? t.adminWorking : t.adminSave}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={goDashboard}>
                    {t.adminCancel}
                  </button>
                </div>
              </form>
            ) : null}

            {view === "edit-contact" && settingsDraft ? (
              <form
                className="admin-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  setConfirmContact(true);
                }}
              >
                <p className="admin-lead">{t.adminContactLead}</p>
                {(settingsDraft.whatsappNumbers || []).map((num, index) => (
                  <label key={`wa-${index}`}>
                    {t.adminWhatsAppNumber} {index + 1}
                    <input
                      inputMode="tel"
                      value={formatWhatsAppInput(num)}
                      onChange={(e) =>
                        setSettingsDraft((d) => {
                          const next = [...d.whatsappNumbers];
                          next[index] = e.target.value.replace(/\D/g, "");
                          return { ...d, whatsappNumbers: next };
                        })
                      }
                      required
                    />
                  </label>
                ))}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setSettingsDraft((d) => ({
                      ...d,
                      whatsappNumbers: [...d.whatsappNumbers, ""],
                    }))
                  }
                >
                  {t.adminAddWhatsApp}
                </button>
                {error ? <p className="error-text">{error}</p> : null}
                <div className="admin-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? t.adminWorking : t.adminSave}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={goDashboard}>
                    {t.adminCancel}
                  </button>
                </div>
              </form>
            ) : null}

            {view === "edit-about" && settingsDraft ? (
              <form className="admin-editor" onSubmit={onSaveAbout}>
                <section className="admin-owner-block">
                  <h3>{t.adminOwnerBlock}</h3>
                  <label>
                    {t.adminOwnersEn}
                    <textarea
                      value={settingsDraft.ownersEn}
                      onChange={(e) =>
                        setSettingsDraft((d) => ({ ...d, ownersEn: e.target.value }))
                      }
                      required
                    />
                  </label>
                  <label>
                    {t.adminOwnersAr}
                    <textarea
                      value={settingsDraft.ownersAr}
                      onChange={(e) =>
                        setSettingsDraft((d) => ({ ...d, ownersAr: e.target.value }))
                      }
                      required
                      dir="rtl"
                    />
                  </label>
                </section>
                <label>
                  {t.adminAboutEn}
                  <textarea
                    value={settingsDraft.aboutEn}
                    onChange={(e) =>
                      setSettingsDraft((d) => ({ ...d, aboutEn: e.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {t.adminAboutAr}
                  <textarea
                    value={settingsDraft.aboutAr}
                    onChange={(e) =>
                      setSettingsDraft((d) => ({ ...d, aboutAr: e.target.value }))
                    }
                    required
                    dir="rtl"
                  />
                </label>
                {["whatsapp", "instagram", "tiktok", "youtube", "facebook"].map((key) => (
                  <label key={key}>
                    {t[SOCIAL_LABELS[key]] || key}
                    <input
                      type="url"
                      value={settingsDraft.socialLinks[key] || ""}
                      onChange={(e) =>
                        setSettingsDraft((d) => ({
                          ...d,
                          socialLinks: { ...d.socialLinks, [key]: e.target.value },
                        }))
                      }
                    />
                  </label>
                ))}
                {error ? <p className="error-text">{error}</p> : null}
                <div className="admin-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? t.adminWorking : t.adminSave}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={goDashboard}>
                    {t.adminCancel}
                  </button>
                </div>
              </form>
            ) : null}
          </div>

          {toast ? (
            <div className="admin-toast" role="status">
              {toast}
            </div>
          ) : null}
        </div>
      )}

      {confirmContact ? (
        <GlassModal
          elevated
          title={t.adminConfirmContactTitle}
          onClose={() => setConfirmContact(false)}
        >
          <p className="modal-prose">{t.adminConfirmContactBody}</p>
          <div className="admin-form-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={confirmSaveContact}>
              {busy ? t.adminWorking : t.adminConfirm}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmContact(false)}>
              {t.adminCancel}
            </button>
          </div>
        </GlassModal>
      ) : null}

      {confirmEmail ? (
        <GlassModal
          elevated
          title={t.adminConfirmEmailTitle}
          onClose={() => setConfirmEmail(false)}
        >
          <p className="modal-prose">{t.adminConfirmEmailBody}</p>
          <div className="admin-form-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={persistEmail}>
              {busy ? t.adminWorking : t.adminConfirm}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmEmail(false)}>
              {t.adminCancel}
            </button>
          </div>
        </GlassModal>
      ) : null}
    </>
  );
}
