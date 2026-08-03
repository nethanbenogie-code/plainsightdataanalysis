import React from "react";
import { createRoot } from "react-dom/client";
import PlainsightDataAnalysis from "./plainsight.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PlainsightDataAnalysis />
  </React.StrictMode>,
);
