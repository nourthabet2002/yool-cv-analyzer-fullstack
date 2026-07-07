require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const rateLimit = require("express-rate-limit");
const {
  initDatabase,
  listCvAnalyses,
  saveCvAnalysis,
} = require("./db");

const app = express();
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype !== "application/pdf" ||
      !file.originalname.toLowerCase().endsWith(".pdf")
    ) {
      return cb(new Error("Le fichier doit etre un PDF valide."));
    }

    cb(null, true);
  },
});

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      return cb(new Error("Origine non autorisee par CORS."));
    },
  })
);
app.use(express.json({ limit: "1mb" }));

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required in backend/.env");
}

if (!process.env.N8N_WEBHOOK_URL) {
  throw new Error("N8N_WEBHOOK_URL is required in backend/.env");
}

const USERS = [
  {
    username: "admin",
    password: "admin123",
    role: "admin",
  },
  {
    username: "recruiter",
    password: "recruiter123",
    role: "recruiter",
  },
];

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Trop de tentatives de connexion. Reessayez plus tard.",
  },
});

function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({
        message: "Acces reserve a l'administrateur.",
      });
    }

    next();
  };
}

app.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;

  const user = USERS.find(
    (u) =>
      u.username === username &&
      u.password === password
  );

  if (!user) {
    return res.status(401).json({
      message: "Nom d'utilisateur ou mot de passe incorrect",
    });
  }

  const token = jwt.sign(
    {
      username: user.username,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "15m",
    }
  );

  res.json({
    token,
    role: user.role,
    username: user.username,
  });
});

app.get("/verify", (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      message: "Token manquant",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    res.json({
      valid: true,
      user: decoded,
    });
  } catch (err) {
    res.status(401).json({
      valid: false,
      message: "Token expiré ou invalide",
    });
  }
});

function verifyTokenMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      message: "Token manquant",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    req.user = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    next();
  } catch (err) {
    return res.status(401).json({
      message: "Session expirée ou token invalide",
    });
  }
}

function validatePdfSignature(req, res, next) {
  const file = req.file;

  if (!file) {
    return res.status(400).json({
      message: "Aucun fichier recu.",
    });
  }

  if (file.size === 0) {
    return res.status(400).json({
      message: "Le fichier est vide.",
    });
  }

  const header = file.buffer.subarray(0, 1024).toString("latin1");

  if (!header.includes("%PDF-")) {
    return res.status(400).json({
      message: "Le fichier n'est pas un vrai PDF valide.",
    });
  }

  next();
}

app.post(
  "/api/upload-cv",
  verifyTokenMiddleware,
  upload.single("data"),
  validatePdfSignature,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message: "Aucun fichier reçu.",
        });
      }

      const formData = new FormData();

      formData.append(
        "data",
        req.file.buffer,
        {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
        }
      );

      const n8nResponse = await axios.post(
        process.env.N8N_WEBHOOK_URL,
        formData,
        {
          headers: formData.getHeaders(),
          maxBodyLength: Infinity,
        }
      );

      saveCvAnalysis({
        fileName: req.file.originalname,
        result: n8nResponse.data,
        user: req.user,
      }).catch((error) => {
        console.warn("PostgreSQL persistence skipped:", error.message);
      });

      return res
        .status(n8nResponse.status)
        .json(n8nResponse.data);

    } catch (error) {
      console.error("Upload error:", error);

      const status =
        error.response?.status || 500;

      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        "Erreur serveur";

      return res.status(status).json({
        message,
      });
    }
  }
);

app.get(
  "/api/analyses",
  verifyTokenMiddleware,
  requireRole("admin"),
  async (req, res) => {
    try {
      const data = await listCvAnalyses(req.query.limit);
      return res.json(data);
    } catch (error) {
      console.error("Analyses history error:", error);
      return res.status(503).json({
        message: "Historique PostgreSQL indisponible.",
      });
    }
  }
);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      message:
        err.code === "LIMIT_FILE_SIZE"
          ? "Le fichier depasse la taille maximale de 5 Mo."
          : err.message,
    });
  }

  if (err) {
    return res.status(400).json({
      message: err.message || "Erreur de validation du fichier.",
    });
  }

  next();
});

if (require.main === module) {
  app.listen(process.env.PORT, () => {
    console.log(
      `Backend JWT running on port ${process.env.PORT}`
    );
  });

  initDatabase().catch((error) => {
    console.warn("PostgreSQL persistence unavailable:", error.message);
  });
}

module.exports = app;
