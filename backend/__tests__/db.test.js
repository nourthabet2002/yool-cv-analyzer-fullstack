const { parseSkills } = require("../db");

describe("database helpers", () => {
  test("normalizes comma separated skills", () => {
    expect(parseSkills("Python, SQL, NLP")).toEqual(["Python", "SQL", "NLP"]);
  });

  test("normalizes array skills", () => {
    expect(parseSkills([" React ", "", "Node.js"])).toEqual([
      "React",
      "Node.js",
    ]);
  });
});
