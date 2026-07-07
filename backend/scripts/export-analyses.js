require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { listCvAnalyses } = require("../db");

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(", ") : String(value || "");
  return `"${text.replace(/"/g, '""')}"`;
}

async function main() {
  const outputDir = path.join(__dirname, "..", "exports");
  const outputPath = path.join(outputDir, "cv_analyses_export.csv");
  const data = await listCvAnalyses(500);

  fs.mkdirSync(outputDir, { recursive: true });

  const rows = [
    [
      "id",
      "created_at",
      "file_name",
      "candidate_name",
      "email",
      "phone",
      "profile_title",
      "skills",
      "education",
      "uploaded_by",
    ],
    ...data.analyses.map((item) => [
      item.id,
      item.createdAt,
      item.fileName,
      item.candidateName,
      item.email,
      item.phone,
      item.profileTitle,
      item.skills,
      item.education,
      item.uploadedBy,
    ]),
  ];

  fs.writeFileSync(
    outputPath,
    rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    "utf8"
  );

  console.log(`Exported ${data.analyses.length} analyses to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
