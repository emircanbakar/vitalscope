export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-empty": [2, "never"],
    "scope-enum": [
      2,
      "always",
      ["sdk", "protocol", "ingest", "dashboard", "charts", "infra", "repo", "deps"],
    ],
  },
};
