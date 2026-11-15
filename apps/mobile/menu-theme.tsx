import React,{createContext,useContext} from 'react';
import {ThemeContext,tokens,type ThemeTokens} from './theme-context';
import {nativewindVariables} from './theme-variables';

// Menus follow the resolved app scheme: beige in Light, dark in Dark.
// This is deliberately NOT ThemeProvider: no storage, native chrome or night-mode
// effects, no host View, and no scheme-dependent keys/component identities.
export const menuThemes:Record<ThemeTokens['scheme'],ThemeTokens>={light:{...tokens.light},dark:{...tokens.dark}};
export const menuVariables={light:nativewindVariables(menuThemes.light.colors),dark:nativewindVariables(menuThemes.dark.colors)};
const ChatPaletteContext=createContext<ThemeTokens|undefined>(undefined);
export function useChatTheme(){const original=useContext(ChatPaletteContext),current=useContext(ThemeContext);return original??current;}
export function useMenuTheme(){return menuThemes[useChatTheme().scheme];}
export function MenuTheme({children}:{children:React.ReactNode}){
 const original=useChatTheme();
 return <ChatPaletteContext.Provider value={original}><ThemeContext.Provider value={menuThemes[original.scheme]}>{children}</ThemeContext.Provider></ChatPaletteContext.Provider>;
}
// Explicit escape for helper transcripts embedded in menu chrome. The original
// scheme continues updating while hidden; this boundary never owns their state.
export function ChatTheme({children}:{children:React.ReactNode}){
 const theme=useChatTheme();
 return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
export function withMenuTheme<P extends object>(Component:React.ComponentType<P>){
 return function MenuPaletteBoundary(props:P){return <MenuTheme><Component {...props}/></MenuTheme>;};
}
// Keep NativeWind variables in the same resolved scheme as the menu context.
// Use existing primitive hosts rather than layout wrappers around live lists.
export function useMenuVariables(){const theme=useContext(ThemeContext);return theme===menuThemes.light||theme===menuThemes.dark?menuVariables[theme.scheme]:undefined;}
