const request = require("supertest");

jest.mock("axios");
jest.mock("../db", () => ({
  initDatabase: jest.fn(),
  listCvAnalyses: jest.fn().mockResolvedValue({
    analyses: [
      {
        id: 1,
        candidateName: "Nour Test",
        profileTitle: "Data Scientist",
        fileName: "cv.pdf",
      },
    ],
    stats: {
      total: 1,
      profiles: 1,
      latestAt: "2026-07-07T20:00:00.000Z",
    },
    profileBreakdown: [{ profile: "Data Scientist", count: 1 }],
    databaseEnabled: true,
  }),
  saveCvAnalysis: jest.fn(),
}));

const app = require("../server");

async function login(username = "admin", password = "admin123") {
  const response = await request(app)
    .post("/login")
    .send({ username, password });

  return response.body.token;
}

describe("backend API", () => {
  test("logs in a demo admin user", async () => {
    const response = await request(app)
      .post("/login")
      .send({ username: "admin", password: "admin123" });

    expect(response.status).toBe(200);
    expect(response.body.role).toBe("admin");
    expect(response.body.token).toBeTruthy();
  });

  test("verifies a valid JWT", async () => {
    const token = await login();

    const response = await request(app)
      .get("/verify")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
    expect(response.body.user.role).toBe("admin");
  });

  test("rejects upload without token", async () => {
    const response = await request(app).post("/api/upload-cv");

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/Token manquant/);
  });

  test("rejects fake PDF before n8n forwarding", async () => {
    const token = await login("recruiter", "recruiter123");

    const response = await request(app)
      .post("/api/upload-cv")
      .set("Authorization", `Bearer ${token}`)
      .attach("data", Buffer.from("not a real pdf"), {
        filename: "cv.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/vrai PDF/);
  });

  test("blocks analyses history for non-admin users", async () => {
    const token = await login("recruiter", "recruiter123");

    const response = await request(app)
      .get("/api/analyses")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  test("returns analyses history for admin users", async () => {
    const token = await login();

    const response = await request(app)
      .get("/api/analyses")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.stats.total).toBe(1);
    expect(response.body.analyses[0].profileTitle).toBe("Data Scientist");
  });
});
