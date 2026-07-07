import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const BACKEND_BASE_URL =
  process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";
const BACKEND_UPLOAD_URL = `${BACKEND_BASE_URL}/api/upload-cv`;
const BACKEND_LOGIN_URL = `${BACKEND_BASE_URL}/login`;
const BACKEND_VERIFY_URL = `${BACKEND_BASE_URL}/verify`;
const BACKEND_ANALYSES_URL = `${BACKEND_BASE_URL}/api/analyses`;

const MAX_FILES = 10;
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

const inferProfileTitle = (cvData) => {
  const source = [
    cvData.skills.join(" "),
    cvData.education,
    cvData.summary,
  ]
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const rules = [
    [/react|javascript|typescript|frontend|front-end|html|css/, "Développeur Frontend"],
    [/node|express|backend|back-end|api|spring|java|php|laravel/, "Développeur Backend"],
    [/python|machine learning|deep learning|data science|pandas|tensorflow|pytorch/, "Data Scientist"],
    [/data analyst|power bi|tableau|excel|sql|business intelligence/, "Data Analyst"],
    [/graphisme|graphique|conception visuelle|direction artistique|identite visuelle|branding|illustrator|photoshop|indesign|affiche|print/, "Designer graphique"],
    [/\bux\b|\bui\b|figma|wireframe|prototype|interface|design system/, "Designer UX/UI"],
    [/marketing digital|communication|social media|community manager|reseaux sociaux|creation de contenu|contenu digital|campagne/, "Chargé de communication"],
    [/finance|comptabilite|accounting|audit/, "Assistant Finance"],
    [/ressources humaines|recrutement|hr|rh/, "Assistant RH"],
  ];

  const match = rules.find(([pattern]) => pattern.test(source));
  return match ? match[1] : "Profil non classé";
};

const normalizeText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const isUnclassifiedProfile = (title) => {
  const normalized = normalizeText(cleanValue(title));
  return !normalized || /profil\s+non\s+class/.test(normalized);
};

const JOB_STOPWORDS = new Set([
  "avec",
  "dans",
  "pour",
  "des",
  "les",
  "une",
  "un",
  "sur",
  "par",
  "and",
  "the",
  "for",
  "with",
  "job",
  "poste",
  "profil",
  "candidate",
  "candidat",
  "experience",
  "competence",
  "competences",
]);

const extractJobKeywords = (criteriaText) => {
  const normalized = normalizeText(criteriaText);
  const knownPhrases = [
    "machine learning",
    "deep learning",
    "data science",
    "data analyst",
    "power bi",
    "business intelligence",
    "computer vision",
    "cloud computing",
    "project management",
    "node js",
    "react js",
  ];

  const phraseMatches = knownPhrases.filter((phrase) =>
    normalized.includes(phrase)
  );
  const tokens = normalized
    .split(/[^a-z0-9+#.]+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        !JOB_STOPWORDS.has(token) &&
        !/^\d+$/.test(token)
    );

  return Array.from(new Set([...phraseMatches, ...tokens])).slice(0, 24);
};

const canonicalizeProfileTitle = (title) => {
  const rawTitle = cleanValue(title || "Profil non classé");
  const normalized = normalizeText(rawTitle);

  if (isUnclassifiedProfile(rawTitle)) {
    return "Profil non classé";
  }

  const classes = [
    {
      label: "Data Scientist",
      pattern:
        /data scientist|scientifique.*donnees|science.*donnees|data science|machine learning|deep learning/,
    },
    {
      label: "Data Analyst",
      pattern:
        /data analyst|analyste.*donnees|analyse.*donnees|business intelligence|\bbi\b|power bi/,
    },
    {
      label: "Ingénieur IA",
      pattern:
        /ingenieur.*ia|ingenieur.*intelligence artificielle|ai engineer|ml engineer|intelligence artificielle|\bia\b|\bai\b/,
    },
    {
      label: "Ingénieur Cloud / DevOps",
      pattern: /cloud|devops|infrastructure|kubernetes|docker|aws|azure|gcp/,
    },
    {
      label: "Développeur Frontend",
      pattern: /frontend|front-end|react|javascript|typescript|html|css/,
    },
    {
      label: "Développeur Backend",
      pattern: /backend|back-end|node|express|spring|java|php|laravel|api/,
    },
    {
      label: "Designer UX/UI",
      pattern: /ux|ui|designer ux|designer ui|figma|wireframe|prototype|interface|design system/,
    },
    {
      label: "Designer graphique",
      pattern:
        /designer graphique|graphiste|graphisme|conception visuelle|direction artistique|identite visuelle|branding|illustrator|photoshop|indesign|affiche|print/,
    },
    {
      label: "Chargé de communication",
      pattern:
        /charge.*communication|communication|marketing digital|community manager|social media|reseaux sociaux|creation de contenu|contenu digital|campagne/,
    },
  ];

  const match = classes.find((item) => item.pattern.test(normalized));
  return match ? match.label : rawTitle;
};

const getProfileScore = (cvData, jobCriteria = "") => {
  const text = normalizeText(
    [
      cvData.profileTitle,
      cvData.skills.join(" "),
      cvData.education,
      cvData.summary,
    ].join(" ")
  );

  const profileRules = [
    {
      label: "IA / Data",
      profile: /\bia\b|\bai\b|\bdata\b|machine learning|deep learning|scientist/,
      keywords:
        /python|machine learning|deep learning|tensorflow|pytorch|scikit|pandas|numpy|nlp|llm|computer vision|data mining|classification|prediction|model/i,
    },
    {
      label: "Cloud / DevOps",
      profile: /cloud|devops|systeme|infrastructure/,
      keywords:
        /aws|azure|gcp|docker|kubernetes|terraform|linux|ci\/cd|jenkins|gitlab|cloud|devops|deployment|monitoring/i,
    },
    {
      label: "Frontend",
      profile: /frontend|front-end|react|web/,
      keywords:
        /react|javascript|typescript|html|css|redux|tailwind|bootstrap|frontend|front-end|responsive/i,
    },
    {
      label: "Backend",
      profile: /backend|back-end|api|java|node|php/,
      keywords:
        /node|express|spring|java|php|laravel|api|rest|mongodb|mysql|postgresql|backend|back-end/i,
    },
    {
      label: "Data Analyst",
      profile: /analyst|analyse|bi|business intelligence/,
      keywords:
        /power bi|tableau|excel|sql|dashboard|reporting|kpi|business intelligence|data analysis/i,
    },
    {
      label: "Design graphique",
      profile: /designer graphique|graphiste|graphisme|conception visuelle|direction artistique|identite visuelle|branding/,
      keywords:
        /graphisme|conception visuelle|direction artistique|identite visuelle|branding|illustrator|photoshop|indesign|affiche|print|adobe/i,
    },
    {
      label: "UX/UI",
      profile: /\bux\b|\bui\b|designer ux|designer ui|interface|design system/,
      keywords: /figma|\bux\b|\bui\b|wireframe|prototype|interface|design system|responsive/i,
    },
    {
      label: "Communication",
      profile: /communication|marketing digital|community manager|social media|reseaux sociaux/,
      keywords:
        /communication|marketing digital|community manager|social media|reseaux sociaux|creation de contenu|campagne|contenu digital/i,
    },
  ];

  const activeRule =
    profileRules.find((rule) => rule.profile.test(text)) ||
    profileRules.find((rule) => rule.keywords.test(text));

  const skillMatches = activeRule
    ? cvData.skills.filter((skill) => activeRule.keywords.test(skill)).length
    : 0;
  const profileMatchScore = activeRule ? Math.min(skillMatches * 8, 32) : 0;
  const skillRichnessScore = Math.min(cvData.skills.length, 12) * 3;
  const projectExperienceScore =
    Math.min(
      (text.match(/projet|stage|experience|developpe|deploi|realise|application/g) ||
        []).length,
      5
    ) * 5;
  const educationScore =
    /ingenieur|master|licence|bachelor|formation|universite|ecole/.test(text)
      ? 12
      : 0;
  const completenessScore =
    [cvData.name, cvData.email, cvData.phone, cvData.education, cvData.summary]
      .filter(Boolean).length * 3;
  const jobKeywords = extractJobKeywords(jobCriteria);
  const jobMatches = jobKeywords.filter((keyword) => text.includes(keyword));
  const jobMatchScore = Math.min(jobMatches.length * 10, 50);

  const score =
    jobMatchScore +
    profileMatchScore +
    skillRichnessScore +
    projectExperienceScore +
    educationScore +
    completenessScore;

  const reasons = [];

  if (jobMatches.length > 0) reasons.push(`${jobMatches.length} critère(s) offre`);
  if (jobKeywords.length > 0 && jobMatches.length === 0) {
    reasons.push("Offre peu couverte");
  }
  if (activeRule) reasons.push(`Profil ${activeRule.label}`);
  if (skillMatches > 0) reasons.push(`${skillMatches} compétence(s) clé(s)`);
  if (projectExperienceScore > 0) reasons.push("Projets/expérience");
  if (educationScore > 0) reasons.push("Formation pertinente");
  if (completenessScore >= 12) reasons.push("CV complet");

  return {
    score,
    reasons: reasons.length > 0 ? reasons : ["Données limitées"],
  };
};

const readStoredUser = () => {
  try {
    const value = sessionStorage.getItem("jwt_user");
    return value ? JSON.parse(value) : null;
  } catch {
    sessionStorage.removeItem("jwt_user");
    return null;
  }
};

const formatDateTime = (value) => {
  if (!value) return "—";

  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

function App() {
  const storedToken = sessionStorage.getItem("jwt_token");

  const [token, setToken] = useState(storedToken || "");
  const [connectedUser, setConnectedUser] = useState(readStoredUser);

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
  const [selectedProfileFilter, setSelectedProfileFilter] = useState("all");
  const [jobCriteria, setJobCriteria] = useState("");
  const [currentPage, setCurrentPage] = useState("main");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminData, setAdminData] = useState({
    analyses: [],
    stats: {
      total: 0,
      profiles: 0,
      latestAt: null,
    },
    profileBreakdown: [],
  });

  const isAuthenticated = Boolean(token);
  const isAdmin = connectedUser?.role === "admin";

  const fileLabel = useMemo(() => {
    if (selectedFiles.length === 0) return "Choisir un ou plusieurs fichiers";
    if (selectedFiles.length === 1) return selectedFiles[0].name;
    return `${selectedFiles.length} fichiers sélectionnés`;
  }, [selectedFiles]);

  const currentResult = results[activeTab] || emptyResult;
  const hasResults = results.length > 0;

  const doneResults = useMemo(
    () =>
      results
        .map((item, index) => ({ ...item, index }))
        .filter((item) => item.status === "done"),
    [results]
  );

  const profileOptions = useMemo(() => {
    const counts = new Map();

    doneResults.forEach((item) => {
      const profile = item.profileTitle || "Profil non classé";
      counts.set(profile, (counts.get(profile) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([profile, count]) => ({ profile, count }))
      .sort((a, b) => a.profile.localeCompare(b.profile));
  }, [doneResults]);

  const rankedProfileResults = useMemo(() => {
    const candidates =
      selectedProfileFilter === "all"
        ? doneResults
        : doneResults.filter(
            (item) =>
              (item.profileTitle || "Profil non classé") ===
              selectedProfileFilter
          );

    return candidates
      .map((item) => ({
        ...item,
        ranking: getProfileScore(item, jobCriteria),
      }))
      .sort((a, b) => b.ranking.score - a.ranking.score || a.index - b.index);
  }, [doneResults, selectedProfileFilter, jobCriteria]);

  const performLogout = (message = "") => {
    sessionStorage.removeItem("jwt_token");
    sessionStorage.removeItem("jwt_user");

    setToken("");
    setConnectedUser(null);
    setSelectedFiles([]);
    setResults([]);
    setSelectedProfileFilter("all");
    setCurrentPage("main");
    setAdminData({
      analyses: [],
      stats: {
        total: 0,
        profiles: 0,
        latestAt: null,
      },
      profileBreakdown: [],
    });
    setAdminError("");
    setServerMessage("");
    setError(message);
  };

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function verifyStoredToken() {
      try {
        const response = await fetch(BACKEND_VERIFY_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();

        if (!response.ok || !data.valid) {
          throw new Error(data?.message || "Session expirée.");
        }

        if (!cancelled && data.user) {
          setConnectedUser({
            username: data.user.username,
            role: data.user.role,
          });
        }
      } catch {
        if (!cancelled) {
          performLogout("Session expirée. Veuillez vous reconnecter.");
        }
      }
    }

    verifyStoredToken();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const loadAdminData = useCallback(async () => {
    if (!isAdmin) return;

    setAdminLoading(true);
    setAdminError("");

    try {
      const response = await fetch(`${BACKEND_ANALYSES_URL}?limit=100`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.message || "Historique indisponible.");
      }

      setAdminData({
        analyses: payload.analyses || [],
        stats: payload.stats || {
          total: 0,
          profiles: 0,
          latestAt: null,
        },
        profileBreakdown: payload.profileBreakdown || [],
      });
    } catch (err) {
      setAdminError(err.message || "Impossible de charger l'historique.");
    } finally {
      setAdminLoading(false);
    }
  }, [isAdmin, token]);

  useEffect(() => {
    if (currentPage === "admin" && isAdmin) {
      loadAdminData();
    }
  }, [currentPage, isAdmin, loadAdminData]);

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
      setCurrentPage("main");
    } catch (err) {
      setLoginError(err.message || "Erreur de connexion.");
    }
  };

  const handleLogout = () => {
    performLogout("Session fermée. Veuillez vous reconnecter pour analyser un CV.");
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    setError("");
    setServerMessage("");
    setResults([]);
    setActiveTab(0);
    setSelectedProfileFilter("all");
  };

  const handleProfileFilterChange = (profile) => {
    setSelectedProfileFilter(profile);

    if (profile === "all") {
      setActiveTab(0);
      return;
    }

    const firstMatch = results.findIndex(
      (item) =>
        item.status === "done" &&
        (item.profileTitle || "Profil non classé") === profile
    );

    if (firstMatch !== -1) {
      setActiveTab(firstMatch);
    }
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
    setSelectedProfileFilter("all");

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

        const normalizedPayload = normalizePayload(payload, file.name);
        const aiProfileTitle = cleanValue(payload?.profileTitle || "");
        const profileTitle = isUnclassifiedProfile(aiProfileTitle)
          ? inferProfileTitle(normalizedPayload)
          : aiProfileTitle || inferProfileTitle(normalizedPayload);
        const normalized = {
          ...normalizedPayload,
          profileTitle: canonicalizeProfileTitle(profileTitle),
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
            <div className="topbar-actions">
              {isAdmin && (
                <button
                  className="admin-nav-btn"
                  onClick={() =>
                    setCurrentPage(currentPage === "admin" ? "main" : "admin")
                  }
                  type="button"
                >
                  {currentPage === "admin" ? "Accueil" : "Admin DB"}
                </button>
              )}

              <button className="login-btn" onClick={handleLogout}>
                Déconnexion
                {connectedUser?.role ? ` (${connectedUser.role})` : ""}
              </button>
            </div>
          ) : (
            <button className="login-btn" onClick={() => setShowLogin(true)}>
              Connexion
            </button>
          )}
        </div>
      </header>

      {currentPage === "main" ? (
        <>
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
                {profileOptions.length > 0 && (
                  <div className="profile-filter">
                    <div className="profile-filter-header">
                      <span>Filtrer par profil détecté</span>
                      <small>{rankedProfileResults.length} CV affiché(s)</small>
                    </div>

                    <div className="job-criteria-box">
                      <label htmlFor="job-criteria">Critères du poste</label>
                      <textarea
                        id="job-criteria"
                        value={jobCriteria}
                        onChange={(e) => setJobCriteria(e.target.value)}
                        placeholder="Ex : Python, SQL, machine learning, NLP, Power BI..."
                        rows="3"
                      />
                      <small>
                        Optionnel : ces critères influencent le classement sans
                        changer le profil détecté.
                      </small>
                    </div>

                    <div className="profile-filter-list">
                      <button
                        type="button"
                        className={`profile-filter-chip ${
                          selectedProfileFilter === "all"
                            ? "active-profile-chip"
                            : ""
                        }`}
                        onClick={() => handleProfileFilterChange("all")}
                      >
                        Tous
                        <span>{doneResults.length}</span>
                      </button>

                      {profileOptions.map(({ profile, count }) => (
                        <button
                          type="button"
                          key={profile}
                          className={`profile-filter-chip ${
                            selectedProfileFilter === profile
                              ? "active-profile-chip"
                              : ""
                          }`}
                          onClick={() => handleProfileFilterChange(profile)}
                        >
                          {profile}
                          <span>{count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedProfileFilter !== "all" &&
                  rankedProfileResults.length > 0 && (
                    <div className="ranking-panel">
                      <div className="ranking-header">
                        <strong>Classement</strong>
                        <span>{selectedProfileFilter}</span>
                      </div>

                      <div className="ranking-list">
                        {rankedProfileResults.map((item, rank) => (
                          <button
                            type="button"
                            key={`${item.fileName}-${item.index}`}
                            className={`ranking-item ${
                              activeTab === item.index
                                ? "active-ranking-item"
                                : ""
                            }`}
                            onClick={() => setActiveTab(item.index)}
                          >
                            <span className="ranking-position">
                              #{rank + 1}
                            </span>
                            <span className="ranking-candidate">
                              <strong>{item.name || "Candidat sans nom"}</strong>
                              <small>{item.fileName}</small>
                              <span className="ranking-reasons">
                                {item.ranking.reasons.map((reason) => (
                                  <em key={reason}>{reason}</em>
                                ))}
                              </span>
                            </span>
                            <span className="ranking-score">
                              {item.ranking.score} pts
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

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
        </>
      ) : (
        <main className="main-section admin-page">
          <div className="container admin-layout">
            <section className="admin-header">
              <div>
                <h1>Administration PostgreSQL</h1>
                <p>
                  Vue interne des analyses sauvegardées en base de données.
                </p>
              </div>

              <button
                type="button"
                className="send-btn admin-refresh-btn"
                onClick={loadAdminData}
                disabled={adminLoading}
              >
                {adminLoading ? "Chargement..." : "Actualiser"}
              </button>
            </section>

            {adminError && <p className="error-msg">{adminError}</p>}

            <section className="admin-stats-grid">
              <div className="admin-stat-card">
                <span>Total analyses</span>
                <strong>{adminData.stats.total}</strong>
              </div>

              <div className="admin-stat-card">
                <span>Profils distincts</span>
                <strong>{adminData.stats.profiles}</strong>
              </div>

              <div className="admin-stat-card">
                <span>Dernière analyse</span>
                <strong>{formatDateTime(adminData.stats.latestAt)}</strong>
              </div>
            </section>

            <section className="admin-content-grid">
              <div className="card admin-panel">
                <h2>Répartition par profil</h2>

                {adminData.profileBreakdown.length === 0 ? (
                  <div className="empty-state">
                    <p>Aucune donnée de profil disponible.</p>
                  </div>
                ) : (
                  <div className="profile-bars">
                    {adminData.profileBreakdown.map((item) => {
                      const percent =
                        adminData.stats.total > 0
                          ? Math.round((item.count / adminData.stats.total) * 100)
                          : 0;

                      return (
                        <div className="profile-bar-row" key={item.profile}>
                          <div className="profile-bar-label">
                            <span>{item.profile}</span>
                            <strong>{item.count}</strong>
                          </div>
                          <div className="profile-bar-track">
                            <div
                              className="profile-bar-fill"
                              style={{ width: `${percent}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="card admin-panel admin-table-panel">
                <h2>Historique des analyses</h2>

                {adminLoading && (
                  <div className="empty-state">
                    <p>Chargement des données PostgreSQL...</p>
                  </div>
                )}

                {!adminLoading && adminData.analyses.length === 0 && (
                  <div className="empty-state">
                    <p>Aucune analyse enregistrée pour le moment.</p>
                  </div>
                )}

                {!adminLoading && adminData.analyses.length > 0 && (
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Candidat</th>
                          <th>Profil</th>
                          <th>Email</th>
                          <th>Fichier</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminData.analyses.map((item) => (
                          <tr key={item.id}>
                            <td>{formatDateTime(item.createdAt)}</td>
                            <td>{item.candidateName || "Sans nom"}</td>
                            <td>{item.profileTitle || "Profil non classé"}</td>
                            <td>{item.email || "—"}</td>
                            <td>{item.fileName || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      )}
    </div>
  );
}

export default App;
