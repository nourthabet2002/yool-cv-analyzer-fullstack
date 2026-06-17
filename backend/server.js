require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");

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

app.use(cors());
app.use(express.json());

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

app.post("/login", (req, res) => {
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

app.listen(process.env.PORT, () => {
  console.log(
    `Backend JWT running on port ${process.env.PORT}`
  );
});
