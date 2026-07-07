const { Pool } = require("pg");

const databaseUrl =
  process.env.NODE_ENV === "test" ? "" : process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
    })
  : null;

function hasDatabase() {
  return Boolean(pool);
}

async function initDatabase() {
  if (!pool) {
    console.log("PostgreSQL persistence disabled: DATABASE_URL is not set.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cv_analyses (
      id BIGSERIAL PRIMARY KEY,
      file_name TEXT,
      candidate_name TEXT,
      email TEXT,
      phone TEXT,
      profile_title TEXT,
      skills TEXT[] NOT NULL DEFAULT '{}',
      education TEXT,
      summary TEXT,
      uploaded_by TEXT,
      uploaded_role TEXT,
      raw_result JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("PostgreSQL persistence ready.");
}

function toText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function parseSkills(value) {
  if (Array.isArray(value)) {
    return value.map(toText).filter(Boolean);
  }

  return toText(value)
    .split(",")
    .map(toText)
    .filter(Boolean);
}

function cleanSpreadsheetPrefix(value) {
  return toText(value).replace(/^'+/, "");
}

async function saveCvAnalysis({ fileName, result, user }) {
  if (!pool) return;

  const payload = result || {};
  const skills = parseSkills(payload.skills);

  await pool.query(
    `
      INSERT INTO cv_analyses (
        file_name,
        candidate_name,
        email,
        phone,
        profile_title,
        skills,
        education,
        summary,
        uploaded_by,
        uploaded_role,
        raw_result
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      toText(fileName),
      toText(payload.name),
      toText(payload.email),
      cleanSpreadsheetPrefix(payload.phone),
      toText(payload.profileTitle),
      skills,
      Array.isArray(payload.education)
        ? payload.education.map(toText).filter(Boolean).join(" | ")
        : toText(payload.education),
      toText(payload.summary),
      toText(user?.username),
      toText(user?.role),
      payload,
    ]
  );
}

async function listCvAnalyses(limit = 100) {
  if (!pool) {
    return {
      analyses: [],
      stats: {
        total: 0,
        profiles: 0,
        latestAt: null,
      },
      profileBreakdown: [],
      databaseEnabled: false,
    };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);

  const [analysesResult, statsResult, profilesResult] = await Promise.all([
    pool.query(
      `
        SELECT
          id,
          file_name,
          candidate_name,
          email,
          phone,
          profile_title,
          skills,
          education,
          summary,
          uploaded_by,
          uploaded_role,
          created_at
        FROM cv_analyses
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [safeLimit]
    ),
    pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(DISTINCT NULLIF(profile_title, ''))::int AS profiles,
        MAX(created_at) AS latest_at
      FROM cv_analyses
    `),
    pool.query(`
      SELECT
        COALESCE(NULLIF(profile_title, ''), 'Profil non classé') AS profile,
        COUNT(*)::int AS count
      FROM cv_analyses
      GROUP BY COALESCE(NULLIF(profile_title, ''), 'Profil non classé')
      ORDER BY count DESC, profile ASC
    `),
  ]);

  const statsRow = statsResult.rows[0] || {};

  return {
    analyses: analysesResult.rows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      candidateName: row.candidate_name,
      email: row.email,
      phone: row.phone,
      profileTitle: row.profile_title,
      skills: row.skills || [],
      education: row.education,
      summary: row.summary,
      uploadedBy: row.uploaded_by,
      uploadedRole: row.uploaded_role,
      createdAt: row.created_at,
    })),
    stats: {
      total: statsRow.total || 0,
      profiles: statsRow.profiles || 0,
      latestAt: statsRow.latest_at || null,
    },
    profileBreakdown: profilesResult.rows.map((row) => ({
      profile: row.profile,
      count: row.count,
    })),
    databaseEnabled: true,
  };
}

module.exports = {
  hasDatabase,
  initDatabase,
  listCvAnalyses,
  parseSkills,
  saveCvAnalysis,
};
