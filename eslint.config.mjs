import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
    {
        ignores: ["dist/**", "release/**", "node_modules/**"]
    },
    js.configs.recommended,
    {
        files: ["**/*.{js,mjs,cjs,ts}"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.node
            }
        },
        rules: {
            "no-undef": "error"
        }
    },
    {
        files: ["**/*.{jsx,tsx}"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                Chart: "readonly" // allow global Chart.js
            },
            parserOptions: {
                ecmaFeatures: { jsx: true }
            }
        },
        plugins: {
            react,
            "react-hooks": reactHooks
        },
        settings: {
            react: {
                version: "19.2"
            }
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "no-undef": "error",
            "react/display-name": "warn",
            "react/no-unescaped-entities": "off",
            "react/no-unstable-nested-components": "warn",
            "react-hooks/set-state-in-effect": "off",
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn"
        }
    }
];
