import { createContext, useContext } from "react";

/**
 * Provides the current UI theme string ("dark" | "light") to any descendant
 * that calls useTheme(), eliminating the need to thread the `theme` prop
 * through every intermediate component.
 */
export const ThemeContext = createContext("dark");

/** Returns the current theme value from the nearest ThemeContext provider. */
export function useTheme() {
    return useContext(ThemeContext);
}
