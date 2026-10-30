import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Label color palette shared by the Pipeline and Tasks modules.
export const LABEL_COLORS = [
  {
    value: "green",
    label: "Verde",
    bg: "bg-green-500",
    text: "text-white",
    light: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  },
  {
    value: "yellow",
    label: "Amarelo",
    bg: "bg-yellow-400",
    text: "text-yellow-900",
    light: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  },
  {
    value: "orange",
    label: "Laranja",
    bg: "bg-orange-500",
    text: "text-white",
    light: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  },
  {
    value: "red",
    label: "Vermelho",
    bg: "bg-red-500",
    text: "text-white",
    light: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  {
    value: "purple",
    label: "Roxo",
    bg: "bg-purple-500",
    text: "text-white",
    light: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  },
  {
    value: "blue",
    label: "Azul",
    bg: "bg-blue-500",
    text: "text-white",
    light: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  {
    value: "cyan",
    label: "Ciano",
    bg: "bg-cyan-500",
    text: "text-white",
    light: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  },
  {
    value: "pink",
    label: "Rosa",
    bg: "bg-pink-500",
    text: "text-white",
    light: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300",
  },
  {
    value: "lime",
    label: "Lima",
    bg: "bg-lime-500",
    text: "text-white",
    light: "bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300",
  },
  {
    value: "slate",
    label: "Cinza",
    bg: "bg-slate-500",
    text: "text-white",
    light: "bg-slate-100 text-slate-800 dark:bg-slate-700/40 dark:text-slate-300",
  },
];

export function getLabelColorClasses(colorValue: string) {
  return LABEL_COLORS.find((color) => color.value === colorValue) ?? LABEL_COLORS[5];
}
