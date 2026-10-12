import React from "react";
import { createRoot } from "react-dom/client";
import "./ds/styles.css";
import "./app.css";
import "./palette/palette.css";
import App from "./App";
import { PublicHelpApp } from "./public/PublicHelpApp";

// SPEC-253 · rute publik pertama: /help/* di-mount sebagai halaman Help Center publik (tanpa auth,
// tanpa Shell dashboard). Selainnya = dashboard biasa. Fallback SPA index.html sudah ada di server
// (prod setNotFoundHandler; dev Vite historyApiFallback), jadi bundle yang sama melayani keduanya.
const isHelp = window.location.pathname.startsWith("/help/");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isHelp ? <PublicHelpApp /> : <App />}</React.StrictMode>,
);
