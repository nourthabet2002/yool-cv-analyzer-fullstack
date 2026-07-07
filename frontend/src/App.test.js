import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("requires login before CV analysis", () => {
  render(<App />);

  expect(
    screen.getByText(/Connectez-vous pour pouvoir analyser des CV/i)
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Analyser le CV/i })).toBeDisabled();
});

test("admin can open PostgreSQL dashboard", async () => {
  sessionStorage.setItem("jwt_token", "admin-token");
  sessionStorage.setItem(
    "jwt_user",
    JSON.stringify({ username: "admin", role: "admin" })
  );

  global.fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        valid: true,
        user: { username: "admin", role: "admin" },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stats: {
          total: 1,
          profiles: 1,
          latestAt: "2026-07-07T20:00:00.000Z",
        },
        profileBreakdown: [{ profile: "Data Scientist", count: 1 }],
        analyses: [
          {
            id: 1,
            createdAt: "2026-07-07T20:00:00.000Z",
            candidateName: "Nour Test",
            profileTitle: "Data Scientist",
            email: "nour@example.com",
            fileName: "cv.pdf",
          },
        ],
      }),
    });

  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: /Admin DB/i }));

  expect(
    screen.getByRole("heading", { name: /Administration PostgreSQL/i })
  ).toBeInTheDocument();

  await waitFor(() => {
    expect(screen.getByText("Nour Test")).toBeInTheDocument();
  });
});
