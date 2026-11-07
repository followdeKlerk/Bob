import {createContext,useContext} from 'react';
import {darkColors,lightColors,makeMenuChrome,makeSurfaceShadows,noteShades,type ThemeColors} from './theme-tokens';

export type ThemePreference='system'|'light'|'dark';
export const APPEARANCE_KEY='appearance';
export type ThemeTokens={scheme:'light'|'dark';shadows:ReturnType<typeof makeSurfaceShadows>;colors:ThemeColors;noteShades:Record<keyof typeof noteShades.dark,string>;menuChrome:ReturnType<typeof makeMenuChrome>};
export const tokens:Record<'light'|'dark',ThemeTokens>={light:{scheme:'light',shadows:makeSurfaceShadows('light'),colors:lightColors,noteShades:noteShades.light,menuChrome:makeMenuChrome(lightColors)},dark:{scheme:'dark',shadows:makeSurfaceShadows('dark'),colors:darkColors,noteShades:noteShades.dark,menuChrome:makeMenuChrome(darkColors)}};
export const ThemeContext=createContext<ThemeTokens>(tokens.dark);
export const PreferenceContext=createContext<{preference:ThemePreference;setPreference:(value:ThemePreference)=>Promise<void>;storageError:string}>({preference:'dark',setPreference:async()=>{},storageError:''});
export function useTheme(){return {...useContext(ThemeContext),...useContext(PreferenceContext)};}
// Immutable styles are cached by palette, not mutated or regenerated per render.
// Context updates reach memoized transcript components without remounting them.
export function themed<T>(factory:(theme:ThemeTokens)=>T){const cache=new WeakMap<ThemeTokens,T>();return (theme:ThemeTokens):T=>{if(!cache.has(theme))cache.set(theme,factory(theme));return cache.get(theme)!;};}
export function useThemedValue<T>(factory:(theme:ThemeTokens)=>T){return factory(useContext(ThemeContext));}
