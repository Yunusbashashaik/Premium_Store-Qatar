import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { wallpaperUrl } from "./data/serviceImages.js";
import { forgetCachedServices } from "./lib/adminApi.js";
import "./index.css";

forgetCachedServices();

document.documentElement.style.setProperty(
  "--wallpaper-image",
  `url(${wallpaperUrl()})`,
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
