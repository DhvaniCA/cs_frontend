// src/api.ts
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

// Add this — catches 401s and logs clearly so you can debug
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.error(
        "[api] 401 Unauthorized on:",
        error.config?.method?.toUpperCase(),
        error.config?.url,
        "| Token present:",
        !!localStorage.getItem("token")
      );
      // Uncomment once confirmed working:
      // localStorage.removeItem("token");
      // window.location.href = "/";
    }
    return Promise.reject(error);
  }
);

export default api;
