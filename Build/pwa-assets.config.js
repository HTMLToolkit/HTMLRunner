import {
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config";

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: {
        fit: "cover",
        background: "transparent",
      },
      padding: 0,
    },
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: {
        fit: "cover",
        background: "transparent",
      },
      padding: 0,
    },
  },
  images: "public/favicon.png",
});