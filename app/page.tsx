"use client";

import jsQR from "jsqr";
import {
  AlertTriangle,
  Clipboard,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Upload,
} from "lucide-react";
import { ChangeEvent, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { generateTotp, OtpAuthData, parseOtpAuthUri, secondsRemaining } from "@/lib/otpauth";

type TotpCodes = {
  current: string;
  next: string;
};

type ThemeMode = "system" | "light" | "dark";

const QR_CELLS = Array.from({ length: 49 }, (_, index) => index);
const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export default function Home() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [rawInput, setRawInput] = useState("");
  const [otpData, setOtpData] = useState<OtpAuthData | null>(null);
  const [codes, setCodes] = useState<TotpCodes | null>(null);
  const [timeLeft, setTimeLeft] = useState(30);
  const [error, setError] = useState("");
  const [secretVisible, setSecretVisible] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");

  const bitwardenLabel = useMemo(() => {
    if (!otpData) {
      return "";
    }
    return otpData.issuer && otpData.account
      ? `${otpData.issuer} (${otpData.account})`
      : otpData.label || otpData.account || otpData.issuer || "TOTP";
  }, [otpData]);
  const timerElapsed =
    otpData?.type === "totp"
      ? Math.max(0, Math.min(1, 1 - timeLeft / otpData.period))
      : 0;
  const timerStyle = {
    "--timer-progress": `${timerElapsed * 360}deg`,
  } as CSSProperties;

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("theme-mode");
    if (isThemeMode(storedTheme)) {
      setThemeMode(storedTheme);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.dataset.theme = themeMode;
    }
    window.localStorage.setItem("theme-mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    function onPaste(event: globalThis.ClipboardEvent) {
      void handleClipboardData(event.clipboardData);
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (!otpData || otpData.type !== "totp") {
      setCodes(null);
      return;
    }

    let cancelled = false;

    async function refreshCodes() {
      if (!otpData) {
        return;
      }

      try {
        const now = Date.now();
        const [current, next] = await Promise.all([
          generateTotp(otpData.secret, otpData, now),
          generateTotp(otpData.secret, otpData, now, 1),
        ]);

        if (!cancelled) {
          setCodes({ current, next });
          setTimeLeft(secondsRemaining(otpData.period, now));
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(errorMessage(nextError));
          setCodes(null);
        }
      }
    }

    void refreshCodes();
    const interval = window.setInterval(refreshCodes, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [otpData]);

  async function handleClipboardData(clipboardData: DataTransfer | null) {
    if (!clipboardData) {
      return;
    }

    const text = clipboardData.getData("text/plain");
    if (text.trim().startsWith("otpauth://")) {
      parseAndStore(text);
      return;
    }

    const imageItem = Array.from(clipboardData.items).find((item) =>
      item.type.startsWith("image/"),
    );

    const file = imageItem?.getAsFile();
    if (file) {
      await readImageFile(file);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      await readImageFile(file);
    }
    event.target.value = "";
  }

  async function readImageFile(file: File) {
    setError("");

    if (!file.type.startsWith("image/")) {
      setError("Use an image file that contains a 2FA setup QR code.");
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return nextPreviewUrl;
    });

    try {
      const uri = await decodeQrFromImage(file);
      setRawInput(uri);
      parseAndStore(uri);
    } catch (nextError) {
      setOtpData(null);
      setCodes(null);
      setError(errorMessage(nextError));
    }
  }

  function parseAndStore(value: string) {
    try {
      const parsed = parseOtpAuthUri(value);
      setOtpData(parsed);
      setRawInput(value);
      setError("");
    } catch (nextError) {
      setOtpData(null);
      setCodes(null);
      setError(errorMessage(nextError));
    }
  }

  async function copyValue(label: string, value: string) {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`);
    } catch {
      toast.error("Clipboard access was blocked by the browser.");
    }
  }

  function reset() {
    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return "";
    });
    setRawInput("");
    setOtpData(null);
    setCodes(null);
    setError("");
    toast.dismiss();
    setSecretVisible(false);
  }

  function cycleThemeMode() {
    setThemeMode((currentMode) => {
      const currentIndex = THEME_MODES.indexOf(currentMode);
      return THEME_MODES[(currentIndex + 1) % THEME_MODES.length];
    });
  }

  return (
    <main>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <KeyRound size={22} />
            </div>
            <div>
              <h1>QR to 2FA Codes</h1>
              <p>Extract a setup QR into Bitwarden-ready TOTP details.</p>
            </div>
          </div>
          <div className="header-actions">
            <div className="privacy-pill">
              <ShieldCheck size={17} />
              <span>Client-side only</span>
            </div>
            <button
              className="button button-secondary button-icon theme-button"
              type="button"
              onClick={cycleThemeMode}
              title={`Theme: ${themeMode}`}
              aria-label={`Theme: ${themeMode}`}
            >
              <ThemeIcon mode={themeMode} />
            </button>
          </div>
        </header>

        <section className="workspace" aria-label="2FA QR decoder">
          <div className="panel input-panel">
            <div className="panel-title">
              <div>
                <h2>Source QR</h2>
                <p>Paste a screenshot, upload an image, or paste an otpauth URI.</p>
              </div>
              <button className="button button-secondary button-icon" type="button" onClick={reset} title="Reset">
                <RefreshCw size={17} />
              </button>
            </div>

            <div className="dropzone" tabIndex={0}>
              {previewUrl ? (
                <div className="preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Pasted 2FA QR code preview" />
                </div>
              ) : (
                <div className="empty-state">
                  <div className="qr-visual" aria-hidden="true">
                    {QR_CELLS.map((cell) => (
                      <span key={cell} />
                    ))}
                  </div>
                  <div>
                    <h2>Paste your setup QR here</h2>
                    <p>
                      Use a screenshot from the service setup page. The QR is decoded locally in
                      your browser.
                    </p>
                  </div>
                  <div className="actions">
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={() => inputRef.current?.click()}
                    >
                      <Upload size={17} />
                      Upload image
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => navigator.clipboard.readText().then(parseAndStore).catch(() => {
                        setError("Clipboard text access was blocked by the browser.");
                      })}
                    >
                      <Clipboard size={17} />
                      Paste URI
                    </button>
                  </div>
                </div>
              )}
            </div>

            <input
              ref={inputRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
            />

            <div className="manual-entry">
              <label htmlFor="manual-uri">otpauth URI</label>
              <textarea
                id="manual-uri"
                value={rawInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setRawInput(value);
                  if (value.trim()) {
                    parseAndStore(value);
                  } else {
                    setOtpData(null);
                    setCodes(null);
                    setError("");
                  }
                }}
                placeholder="otpauth://totp/Issuer:account@example.com?secret=..."
                spellCheck={false}
              />
            </div>

            {error ? (
              <div className="error-banner" role="alert">
                <AlertTriangle size={18} />
                <span>{error}</span>
              </div>
            ) : null}

            {otpData?.type === "hotp" ? (
              <div className="info-banner">
                <AlertTriangle size={18} />
                <span>
                  This QR contains HOTP data. The secret is shown, but Bitwarden TOTP setup expects
                  a time-based authenticator key.
                </span>
              </div>
            ) : null}
          </div>

          <div className="panel result-panel">
            <div className="result-header">
              <div>
                <h2>Bitwarden setup values</h2>
                <p>{otpData ? bitwardenLabel : "Decoded values will appear here."}</p>
              </div>
              <span className={otpData ? "status-dot ready" : "status-dot"} aria-hidden="true" />
            </div>

            <div className="result-body">
              {!otpData ? (
                <div className="placeholder-result">
                  <p>Paste or upload a 2FA setup QR to extract the authenticator key.</p>
                </div>
              ) : (
                <>
                  <div className="field-card">
                    <div className="field-head">
                      <h3>Authenticator key</h3>
                      <button
                        className="button button-secondary button-icon"
                        type="button"
                        onClick={() => copyValue("Authenticator key", otpData.secret)}
                        title="Copy authenticator key"
                      >
                        <Copy size={17} />
                      </button>
                    </div>
                    <div className="secret-row">
                      <div className="value">
                        {secretVisible ? otpData.secret : maskSecret(otpData.secret)}
                      </div>
                      <button
                        className="button button-secondary button-icon"
                        type="button"
                        onClick={() => setSecretVisible((visible) => !visible)}
                        title={secretVisible ? "Hide secret" : "Show secret"}
                      >
                        {secretVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  </div>

                  {otpData.type === "totp" ? (
                    <div className="totp-card">
                      <div className="code-stack">
                        <p className="code-label">Current code</p>
                        <p className="code">{codes?.current || "------"}</p>
                        <p className="next-code">Next: {codes?.next || "------"}</p>
                      </div>
                      <div className="totp-actions">
                        <button
                          className="button button-secondary button-icon"
                          type="button"
                          onClick={() => copyValue("Current code", codes?.current || "")}
                          title="Copy current code"
                          disabled={!codes?.current}
                        >
                          <Copy size={17} />
                        </button>
                        <div
                          className="timer"
                          style={timerStyle}
                          aria-label={`${timeLeft} seconds remaining`}
                        >
                          <span>{timeLeft}s</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <Toaster
        theme={themeMode}
        position="top-center"
        duration={2200}
        visibleToasts={4}
        offset={24}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: "sonner-toast",
            success: "sonner-toast-success",
            error: "sonner-toast-error",
            title: "sonner-toast-title",
            icon: "sonner-toast-icon",
          },
        }}
      />
    </main>
  );
}

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === "light") {
    return <Sun size={17} />;
  }

  if (mode === "dark") {
    return <Moon size={17} />;
  }

  return <Monitor size={17} />;
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

async function decodeQrFromImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Could not read the image.");
  }

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const qr = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });

  if (!qr?.data) {
    throw new Error("No QR code was found in that image.");
  }

  return qr.data;
}

function maskSecret(secret: string) {
  if (secret.length <= 8) {
    return "*".repeat(secret.length);
  }

  return `${secret.slice(0, 4)}${"*".repeat(Math.max(secret.length - 8, 8))}${secret.slice(-4)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
