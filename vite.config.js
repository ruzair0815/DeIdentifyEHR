import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,  // Change this to match Vite's actual running port
        proxy: {
            "/upload": "http://localhost:8000",
            "/deidentified": "http://localhost:8000",
            "/reidentify": "http://localhost:8000",
        },
    },
});