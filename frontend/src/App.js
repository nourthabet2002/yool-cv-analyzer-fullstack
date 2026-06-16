import React, { useMemo, useState } from "react";
import "./App.css";

const BACKEND_UPLOAD_URL = "http://localhost:5000/api/upload-cv";
const BACKEND_LOGIN_URL = "http://localhost:5000/login";

const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;

const MAX_FILES = 5;
const MAX_SIZE_MB = 5;
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;

const emptyResult = {
  fileName: "",
  profileTitle: "",
  name: "",
  email: "",
  phone: "",
  skills: [],
  education: "",
  summary: "",
  status: "idle",
  error: "",
};

const cleanValue = (value) => {
  if (typeof value !== "string") return value;
  return value.replace(/^=+/, "").trim();
};

const isRealPdf = async (file) => {
  try {
    const firstBytes = await file.slice(0, 1024).arrayBuffer();
    const text = new TextDecoder("latin1").decode(firstBytes);
    return text.includes("%PDF-");
  } catch {
    return false;
  }
};

const getReadableError = (payload, text, fileName) => {
  return (
    payload?.message ||
    payload?.error?.message ||
    payload?.error ||
    payload?.description ||
    payload?.data?.message ||
    payload?.details ||
    payload?.node?.message ||
    payload?.cause?.message ||
    text ||
    `Erreur lors de l'analyse du fichier : ${fileName}`
  );
};

const validateFilesBeforeUpload = async (files) => {
  if (files.length === 0) {
    return "Veuillez choisir au moins un CV PDF avant l'envoi.";
  }

  if (files.length > MAX_FILES) {
    return `Maximum ${MAX_FILES} fichiers autorisés.`;
  }

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return `Le fichier "${file.name}" doit avoir l'extension .pdf.`;
    }

    if (file.type !== "application/pdf") {
      return `Le fichier "${file.name}" doit être un PDF.`;
    }

    if (file.size === 0) {
      return `Le fichier "${file.name}" est vide.`;
    }

    if (file.size > MAX_SIZE) {
      return `Le fichier "${file.name}" dépasse la taille maximale de ${MAX_SIZE_MB} Mo.`;
    }

    const realPdf = await isRealPdf(file);

    if (!realPdf) {
      return `Le fichier "${file.name}" n'est pas un vrai PDF valide.`;
    }
  }

  return "";
};

const normalizePayload = (payload, fileName = "") => {
  return {
    fileName,
    profileTitle: "",
    name: cleanValue(payload?.name || ""),
    email: cleanValue(payload?.email || ""),
    phone: cleanValue(payload?.phone || ""),
    skills: Array.isArray(payload?.skills)
      ? payload.skills.map((s) => cleanValue(s))
      : typeof payload?.skills === "string" && payload.skills.trim() !== ""
      ? payload.skills
          .split(",")
          .map((s) => cleanValue(s))
          .filter(Boolean)
      : [],
    education: Array.isArray(payload?.education)
      ? payload.education.map((e) => cleanValue(e)).join(" | ")
      : cleanValue(payload?.education || ""),
    summary: cleanValue(payload?.summary || ""),
    status: "done",
    error: "",
  };
};

const generateProfileTitleWithLLM = async (cvData) => {
  if (!OPENAI_API_KEY) {
    return "Profil non classé";
  }

  try {
    const prompt = `
À partir des informations extraites du CV, génère un titre professionnel court en français.

Règles:
- Retourne uniquement le titre.
- Maximum 4 mots.
- Pas de phrase.
- Pas d'explication.
- Le titre doit être basé sur les compétences, les études et le résumé.
- Exemples: "Développeur Python", "Data Scientist", "Designer UX/UI", "Enseignant Mathématiques", "Chargé de communication".

Données CV:
Nom: ${cvData.name}
Compétences: ${cvData.skills.join(", ")}
Études: ${cvData.education}
Résumé: ${cvData.summary}
`;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "YOOL CV Analyzer",
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          temperature: 0,
          messages: [{ role: "user", content: prompt }],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenRouter error:", data);
      return "Profil non classé";
    }

    return cleanValue(
      data?.choices?.[0]?.message?.content || "Profil non classé"
    );
  } catch (err) {
    console.error("LLM title error:", err);
    return "Profil non classé";
  }
};

function App() {
  const storedToken = sessionStorage.getItem("jwt_token");
  const storedUser = sessionStorage.getItem("jwt_user");

  const [token, setToken] = useState(storedToken || "");
  const [connectedUser, setConnectedUser] = useState(
    storedUser ? JSON.parse(storedUser) : null
  );

  const [showLogin, setShowLogin] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [error, setError] = useState("");
  const [serverMessage, setServerMessage] = useState("");
  const [results, setResults] = useState([]);
  const [activeTab, setActiveTab] = useState(0);

  const isAuthenticated = Boolean(token);

  const fileLabel = useMemo(() => {
    if (selectedFiles.length === 0) return "Choisir un ou plusieurs fichiers";
    if (selectedFiles.length === 1) return selectedFiles[0].name;
    return `${selectedFiles.length} fichiers sélectionnés`;
  }, [selectedFiles]);

  const currentResult = results[activeTab] || emptyResult;
  const hasResults = results.length > 0;

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");

    try {
      const response = await fetch(BACKEND_LOGIN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Erreur de connexion.");
      }

      sessionStorage.setItem("jwt_token", data.token);
      sessionStorage.setItem(
        "jwt_user",
        JSON.stringify({
          username: data.username,
          role: data.role,
        })
      );

      setToken(data.token);
      setConnectedUser({
        username: data.username,
        role: data.role,
      });

      setShowLogin(false);
      setLoginUsername("");
      setLoginPassword("");
      setError("");
      setServerMessage(`Connecté en tant que ${data.username} (${data.role}).`);
    } catch (err) {
      setLoginError(err.message || "Erreur de connexion.");
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("jwt_token");
    sessionStorage.removeItem("jwt_user");

    setToken("");
    setConnectedUser(null);
    setSelectedFiles([]);
    setResults([]);
    setServerMessage("");
    setError("Session fermée. Veuillez vous reconnecter pour analyser un CV.");
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    setError("");
    setServerMessage("");
    setResults([]);
    setActiveTab(0);
  };

  const handleSend = async () => {
    if (!isAuthenticated) {
      setError("Veuillez vous connecter avant d'analyser un CV.");
      setShowLogin(true);
      return;
    }

    const validationError = await validateFilesBeforeUpload(selectedFiles);

    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setLoadingIndex(0);
    setError("");
    setServerMessage("");

    const initialTabs = selectedFiles.map((file) => ({
      ...emptyResult,
      fileName: file.name,
      status: "loading",
      error: "",
    }));

    setResults(initialTabs);
    setActiveTab(0);

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      setLoadingIndex(i + 1);
      setActiveTab(i);

      try {
        const formData = new FormData();
        formData.append("data", file);

        const response = await fetch(BACKEND_UPLOAD_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        let payload = {};
        const text = await response.text();

        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          payload = { message: text };
        }

        if (!response.ok) {
          if (response.status === 401) {
            handleLogout();
          }

          throw new Error(getReadableError(payload, text, file.name));
        }

        let normalized = normalizePayload(payload, file.name);

        const profileTitle = await generateProfileTitleWithLLM(normalized);

        normalized = {
          ...normalized,
          profileTitle,
        };

        setResults((prev) =>
          prev.map((item, index) => (index === i ? normalized : item))
        );

        successCount += 1;
      } catch (err) {
        setResults((prev) =>
          prev.map((item, index) =>
            index === i
              ? {
                  ...item,
                  status: "error",
                  error: err.message || "Erreur inconnue",
                }
              : item
          )
        );

        failedCount += 1;
      }

      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    setLoading(false);
    setLoadingIndex(0);
    setActiveTab(0);

    if (failedCount === 0) {
      setServerMessage(`${successCount} CV analysé(s) avec succès.`);
      setError("");
    } else {
      setServerMessage(
        `${successCount} CV analysé(s) avec succès, ${failedCount} en échec.`
      );
      setError("");
    }
  };

  return (
    <div className="app">
      {showLogin && (
        <div className="login-overlay">
          <form className="login-modal" onSubmit={handleLogin}>
            <h2>Connexion</h2>

            <p className="login-help">
              Utilisez recruiter / recruiter123 ou admin / admin123.
            </p>

            <input
              type="text"
              placeholder="Nom d'utilisateur"
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Mot de passe"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
            />

            {loginError && <p className="error-msg">{loginError}</p>}

            <div className="login-actions">
              <button type="submit" className="send-btn">
                Se connecter
              </button>

              <button
                type="button"
                className="login-cancel-btn"
                onClick={() => setShowLogin(false)}
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      <header className="topbar">
        <div className="container topbar-inner">
          <div className="logo" aria-label="YOOL">
            <span className="logo-y">Y</span>
            <span className="logo-o1">O</span>
            <span className="logo-o2">O</span>
            <span className="logo-l">L</span>
          </div>

          <nav className="nav">
            <a href="#accueil" className="nav-active">
              Accueil
            </a>
            <a href="#accompagnement">Accompagnement Scolaire</a>
            <a href="#ressources">Ressources</a>
            <a href="#contact">Contact</a>
            <a href="#apropos">À Propos</a>
          </nav>

          {isAuthenticated ? (
            <button className="login-btn" onClick={handleLogout}>
              Déconnexion
              {connectedUser?.role ? ` (${connectedUser.role})` : ""}
            </button>
          ) : (
            <button className="login-btn" onClick={() => setShowLogin(true)}>
              Connexion
            </button>
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-overlay hero-overlay-1"></div>
        <div className="hero-overlay hero-overlay-2"></div>
        <div className="hero-overlay hero-overlay-3"></div>

        <div className="container hero-content">
          <h1>Analysez le CV avec YOOL AI</h1>
          <p>
            Obtenez un résumé intelligent, vos compétences
            <br />
            et vos informations automatiquement.
          </p>

          <button
            className="cta-btn"
            onClick={() =>
              document
                .getElementById("upload-section")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            Téléverser le CV
          </button>
        </div>

        <div className="wave wave-1"></div>
        <div className="wave wave-2"></div>
        <div className="wave wave-3"></div>
      </section>

      <main className="main-section" id="upload-section">
        <div className="container cards-grid">
          <section className="card upload-card">
            <h2>Téléverser le CV</h2>

            {!isAuthenticated && (
              <p className="error-msg">
                Connectez-vous pour pouvoir analyser des CV.
              </p>
            )}

            {isAuthenticated && connectedUser && (
              <p className="success-msg">
                Connecté : {connectedUser.username} ({connectedUser.role})
              </p>
            )}

            <div className="upload-box">
              <div className="upload-icon">☁️</div>
              <p className="upload-help">
                Déposez vos fichiers PDF ici ou cliquez ci-dessous
              </p>

              <label className="file-btn">
                {fileLabel}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={handleFileChange}
                  hidden
                  disabled={!isAuthenticated}
                />
              </label>
            </div>

            <button
              className="send-btn"
              onClick={handleSend}
              disabled={loading || !isAuthenticated}
            >
              {loading
                ? `Analyse en cours... (${loadingIndex}/${selectedFiles.length})`
                : "Analyser le CV"}
            </button>

            {selectedFiles.length > 1 && !loading && (
              <p className="success-msg">
                {selectedFiles.length} fichiers prêts pour l'analyse.
              </p>
            )}

            {serverMessage && <p className="success-msg">{serverMessage}</p>}
            {error && <p className="error-msg">{error}</p>}
          </section>

          <section className="card result-card">
            <h2>Résultat</h2>

            {!hasResults && !loading && (
              <div className="empty-state">
                <p>Aucun résultat pour le moment.</p>
                <p>
                  Choisissez un ou plusieurs CV puis cliquez sur “Analyser le
                  CV”.
                </p>
              </div>
            )}

            {hasResults && (
              <>
                <div className="result-tabs">
                  {results.map((item, index) => (
                    <button
                      key={`${item.fileName}-${index}`}
                      className={`result-tab ${
                        activeTab === index ? "active-tab" : ""
                      }`}
                      onClick={() => setActiveTab(index)}
                      type="button"
                    >
                      CV {index + 1}
                    </button>
                  ))}
                </div>

                <div className="result-file-name">
                  <strong>Fichier :</strong> {currentResult.fileName}
                </div>

                {currentResult.status === "loading" && (
                  <div className="empty-state">
                    <p>Analyse de ce CV en cours...</p>
                  </div>
                )}

                {currentResult.status === "error" && (
                  <div className="empty-state">
                    <p>Erreur lors de l’analyse de ce CV.</p>
                    <p>{currentResult.error}</p>
                  </div>
                )}

                {currentResult.status === "done" && (
                  <>
                    {currentResult.profileTitle && (
                      <div className="profile-title-box">
                        🎯 Profil détecté :{" "}
                        <strong>{currentResult.profileTitle}</strong>
                      </div>
                    )}

                    {currentResult.name && (
                      <div className="info-line">
                        <span className="info-icon">👤</span>
                        <span>{currentResult.name}</span>
                      </div>
                    )}

                    {currentResult.email && (
                      <div className="info-line">
                        <span className="info-icon">✉️</span>
                        <span className="email-link">
                          {currentResult.email}
                        </span>
                      </div>
                    )}

                    {currentResult.phone && (
                      <div className="info-line">
                        <span className="info-icon">📱</span>
                        <span>{currentResult.phone}</span>
                      </div>
                    )}

                    {currentResult.skills.length > 0 && (
                      <div className="section-block">
                        <h3>
                          <span className="section-icon">🧠</span>
                          Compétences
                        </h3>
                        <div className="skills-list">
                          {currentResult.skills.map((skill, index) => (
                            <span className="skill-chip" key={index}>
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {currentResult.education && (
                      <div className="section-block">
                        <h3>
                          <span className="section-icon">🎓</span>
                          Études
                        </h3>
                        <p>{currentResult.education}</p>
                      </div>
                    )}

                    {currentResult.summary && (
                      <div className="section-block">
                        <h3>
                          <span className="section-icon">📝</span>
                          Résumé
                        </h3>
                        <p>{currentResult.summary}</p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;