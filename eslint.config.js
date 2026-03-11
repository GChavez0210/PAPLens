import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

export default [
    js.configs.recommended,
    {
        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
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
        rules: {
            ...react.configs.recommended.rules,
            ...react.configs["jsx-runtime"].rules,
            ...reactHooks.configs.recommended.rules,
            "no-undef": "error",
            "react/prop-types": "off",
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn"
        },
        settings: {
            react: { version: "detect" }
        }
    }
];
