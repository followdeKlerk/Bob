import {vars} from 'nativewind';
import type {ThemeColors} from './theme-tokens';

export function nativewindVariables(colors:ThemeColors){const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(' ');return vars({
 '--color-background':rgb(colors.background),'--color-foreground':rgb(colors.foreground),'--color-primary':rgb(colors.accent),'--color-primary-foreground':rgb(colors.onAccent),
 '--color-secondary':rgb(colors.surface),'--color-secondary-foreground':rgb(colors.foreground),'--color-muted':rgb(colors.surface),'--color-muted-foreground':rgb(colors.muted),
 '--color-accent':rgb(colors.selectedSurface),'--color-accent-foreground':rgb(colors.foreground),'--color-destructive':rgb(colors.destructive),'--color-border':rgb(colors.border),'--color-input':rgb(colors.border),'--color-ring':rgb(colors.accent),
});}
